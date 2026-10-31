'use strict';
const {GetCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {randomUUID}=require('crypto');
const {allowed}=require('./catalog');
const KEY={pk:'HOME_LAYOUT',sk:'CURRENT'};
const SOURCES=['region','rating','new','curated','favorites'];
const fail=(message,status=400)=>Object.assign(Error(message),{status});
function validate(rows){
 if(!Array.isArray(rows)||rows.length>12)throw fail('Maximum 12 sections.');
 const ids=new Set();
 return rows.map(r=>{
  if(!r||typeof r.id!=='string'||!/^[-\w]{1,64}$/.test(r.id)||ids.has(r.id))throw fail('Invalid or duplicate section ID.');ids.add(r.id);
  if(typeof r.title!=='string'||!r.title.trim()||r.title.length>80||/[<>\u0000-\u001f]/.test(r.title))throw fail('Invalid section title.');
  if(!SOURCES.includes(r.source)||!['all','guest','signedIn'].includes(r.audience)||typeof r.enabled!=='boolean')throw fail('Invalid source or audience.');
  if(!Array.isArray(r.regionIds)||r.regionIds.length>40||r.regionIds.some(x=>typeof x!=='string'||!/^[-\w]{1,128}$/.test(x)))throw fail('Invalid regions.');
  if(!Number.isInteger(r.limit)||r.limit<1||r.limit>12)throw fail('Invalid section size.');
  const idsList=r.merchantIds??[];
  if(!Array.isArray(idsList)||idsList.length>30||new Set(idsList).size!==idsList.length||idsList.some(x=>typeof x!=='string'||!/^[-\w]{1,128}$/.test(x))||(r.source==='curated'&&!idsList.length))throw fail('Select curated merchants.');
  const ranking=r.ranking??({rating:'rating',new:'new',curated:'manual'}[r.source]||'default');
  if((ranking==='manual'&&r.source!=='curated')||!['default','manual','rating','new','distance','orders'].includes(ranking))throw fail('Invalid ranking.');
  const raw=r.filters??{};if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(k=>!['cuisineIds','brandIds','openNow','offersOnly','maxDistanceKm','minimumRating'].includes(k)))throw fail('Invalid filters.');
  const filters={cuisineIds:raw.cuisineIds??[],brandIds:raw.brandIds??[],openNow:raw.openNow??false,offersOnly:raw.offersOnly??false,maxDistanceKm:raw.maxDistanceKm??null,minimumRating:raw.minimumRating??null};
  for(const values of [filters.cuisineIds,filters.brandIds])if(!Array.isArray(values)||values.length>20||new Set(values).size!==values.length||values.some(x=>typeof x!=='string'||!/^[-\w]{1,128}$/.test(x)))throw fail('Invalid classification filter.');
  if(typeof filters.openNow!=='boolean'||typeof filters.offersOnly!=='boolean'||(filters.maxDistanceKm!==null&&(!Number.isFinite(filters.maxDistanceKm)||filters.maxDistanceKm<=0||filters.maxDistanceKm>100))||(filters.minimumRating!==null&&(!Number.isFinite(filters.minimumRating)||filters.minimumRating<1||filters.minimumRating>5)))throw fail('Invalid filter range.');
  const windowDays=r.windowDays??30;if(![7,30].includes(windowDays))throw fail('Invalid metric period.');
  const layout=r.layout??'carousel';if(!['carousel','compactList'].includes(layout))throw fail('Invalid section layout.');
  const dates=[r.startAt||null,r.endAt||null];
  if(dates.some(x=>x!==null&&(typeof x!=='string'||!Number.isFinite(Date.parse(x))))||(dates[0]&&dates[1]&&Date.parse(dates[0])>=Date.parse(dates[1])))throw fail('Invalid schedule.');
  return {ranking,filters,windowDays,layout,id:r.id,title:r.title.trim(),source:r.source,audience:r.audience,enabled:r.enabled,regionIds:[...new Set(r.regionIds)],merchantIds:r.source==='curated'?idsList:[],limit:r.limit,startAt:dates[0],endAt:dates[1]};
 });
}
async function state(ctx){return (await ctx.db.send(new GetCommand({TableName:ctx.table,Key:KEY,ConsistentRead:true}))).Item||{...KEY,version:0,draft:[],published:null,history:[]};}
function legacySafe(s){
 const filters=s.filters||{},ranking=s.ranking||({rating:'rating',new:'new',curated:'manual'}[s.source]||'default');
 return (!s.layout||s.layout==='carousel')&&ranking===({rating:'rating',new:'new',curated:'manual'}[s.source]||'default')&&!filters.openNow&&!filters.offersOnly&&!filters.maxDistanceKm&&!filters.minimumRating&&!filters.cuisineIds?.length&&!filters.brandIds?.length;
}
function project(current,{signedIn,regionIds,layoutVersion=1,now=Date.now()}){
 const p=current.published;if(!p)return {configured:false,version:0,sections:[]};
 return {configured:true,version:p.revision,sections:p.sections.filter(s=>(layoutVersion>=2||legacySafe(s))&&s.enabled&&(!s.startAt||Date.parse(s.startAt)<=now)&&(!s.endAt||Date.parse(s.endAt)>now)&&(s.audience==='all'||s.audience===(signedIn?'signedIn':'guest'))&&(!s.regionIds.length||s.regionIds.some(r=>regionIds.includes(r))))};
}
async function feed(ctx,scope){return {...project(await state(ctx),scope),discovery:await require('./home-discovery').facts(ctx,scope)};}
async function route(ctx,actor,method,path,input){
 if(!allowed(actor,'promotions.read')||actor.scope?.allRegions!==true)throw fail('Global promotions permission required.',403);
 const current=await state(ctx);
 const permissions={edit:allowed(actor,'promotions.edit'),publish:allowed(actor,'promotions.approve')};
 if(method==='GET')return {...current,permissions,capabilities:{rulesVersion:2}};
 if(method!=='POST'||!['/staff/home-layout/draft','/staff/home-layout/publish','/staff/home-layout/rollback'].includes(path))throw fail('Unknown layout operation.',404);
 const publishing=path!=='/staff/home-layout/draft';
 if(!permissions[publishing?'publish':'edit'])throw fail('Permission required.',403);
 if(!Number.isInteger(input.baseVersion)||input.baseVersion!==current.version)throw fail('Layout changed. Refresh first.',409);
 let sections;
 if(!publishing){sections=validate(input.sections);
  for(const regionId of new Set(sections.flatMap(s=>s.regionIds))){if(!(await ctx.db.send(new GetCommand({TableName:process.env.REGIONS_TABLE||'WizzCentral_Regions',Key:{regionId},ConsistentRead:true}))).Item)throw fail('Unknown region.');}
  for(const businessId of new Set(sections.flatMap(s=>s.merchantIds))){const m=(await ctx.db.send(new GetCommand({TableName:'WhizzMerchants_Businesses',Key:{businessId},ConsistentRead:true}))).Item;if(!m||m.isDeleted||m.deletedAt)throw fail('Unknown merchant.');}
 }else if(path.endsWith('/rollback')){const snapshot=(current.history||[]).find(x=>x.revision===input.revision);if(!snapshot)throw fail('Snapshot unavailable.');sections=validate(snapshot.sections);}else sections=validate(current.draft);
 const catalogKey=require('./home-discovery').KEY,catalog=(await ctx.db.send(new GetCommand({TableName:ctx.table,Key:catalogKey,ConsistentRead:true}))).Item;
 for(const section of sections){if(section.filters.cuisineIds.some(id=>!(catalog?.cuisines||[]).some(x=>x.id===id))||section.filters.brandIds.some(id=>!(catalog?.brands||[]).some(x=>x.id===id)))throw fail('Unknown cuisine or brand.');}
 const catalogGuard={ConditionCheck:{TableName:ctx.table,Key:catalogKey,ConditionExpression:catalog?'#v=:v':'attribute_not_exists(pk)',...(catalog?{ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':v':catalog.version}}:{})}};
 const now=new Date().toISOString(),next={...current,version:current.version+1,updatedAt:now};
 if(publishing){next.history=[...(current.history||[]),...(current.published?[current.published]:[])].slice(-10);next.published={revision:next.version,sections,publishedAt:now};}else next.draft=sections;
 const put={TableName:ctx.table,Item:next,ConditionExpression:current.version?'#v=:v':'attribute_not_exists(pk)',...(current.version?{ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':v':current.version}}:{})};
 try{await ctx.db.send(new TransactWriteCommand({TransactItems:[ctx.guard(actor),{Put:put},ctx.audit(actor.employeeId,publishing?'HOME_LAYOUT_PUBLISHED':'HOME_LAYOUT_DRAFT',current,next,randomUUID()),catalogGuard]}));}catch(e){if(e.name==='TransactionCanceledException')throw fail('Layout changed or access revoked. Refresh first.',409);throw e;}
 return {saved:true,version:next.version};
}
module.exports={KEY,SOURCES,validate,project,feed,route};
