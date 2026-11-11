'use strict';
// Presentation only. Catalog, pricing, stock, eligibility and required choices remain authoritative.
const {GetCommand,QueryCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {randomUUID}=require('crypto');
const {allowed}=require('./catalog');
const KEY={pk:'CUSTOMER_INTERFACES',sk:'CURRENT'};
const fail=(message,status=400)=>Object.assign(Error(message),{status});
const id=v=>typeof v==='string'&&/^[-\w]{1,128}$/.test(v)&&!['__proto__','prototype','constructor'].includes(v);
const sources={store:['menu','search','menuTabs','menuContent','offers','discounted','featured','lastOrder','previousOrders','recent','curated','category','bestsellers'],product:['description','choices','notes','similar','complementary','curated','discounted','previousOrders','recent','bestsellers']};
function ids(v,max=40){if(!Array.isArray(v)||v.length>max||new Set(v).size!==v.length||v.some(x=>!id(x)))throw fail('Invalid identifiers.');return v;}
function text(v,max=80){if(typeof v!=='string'||!v.trim()||v.length>max||/[<>\u0000-\u001f]/.test(v))throw fail('Invalid text.');return v.trim();}
function dates(r){const values=[r.startAt||null,r.endAt||null];if(values.some(x=>x!==null&&(typeof x!=='string'||!Number.isFinite(Date.parse(x))))||(values[0]&&values[1]&&Date.parse(values[0])>=Date.parse(values[1])))throw fail('Invalid schedule.');return values;}
function section(r,surface){
 if(!r||!id(r.id)||!sources[surface].includes(r.source)||!['all','guest','signedIn'].includes(r.audience)||typeof r.enabled!=='boolean'||typeof r.deduplicate!=='boolean')throw fail('Invalid section.');
 const list=ids(r.productIds||[]),categories=ids(r.categoryIds||[]),layout=r.layout||'horizontal',ranking=r.ranking||'default',filters=r.filters||{};
 if(!['horizontal','vertical','grid'].includes(layout)||!['default','manual','priceAsc','priceDesc','newest'].includes(ranking)||!Number.isInteger(r.limit)||r.limit<1||r.limit>30)throw fail('Invalid presentation.');
 if(r.source==='curated'&&!list.length||r.source==='category'&&!categories.length)throw fail('Choose section products/categories.');
 if(!['curated','complementary'].includes(r.source)&&list.length||!['category','complementary'].includes(r.source)&&categories.length)throw fail('Unexpected selectors.');
 if(r.source==='complementary'&&!list.length&&!categories.length)throw fail('Choose complementary products or categories.');
 if(!filters||typeof filters!=='object'||Array.isArray(filters)||Object.keys(filters).some(k=>!['availableOnly','minPrice','maxPrice','vegetarian','vegan','glutenFree'].includes(k)))throw fail('Invalid filters.');
 const f={availableOnly:filters.availableOnly??false,minPrice:filters.minPrice??null,maxPrice:filters.maxPrice??null,vegetarian:filters.vegetarian??false,vegan:filters.vegan??false,glutenFree:filters.glutenFree??false};
 if(['availableOnly','vegetarian','vegan','glutenFree'].some(k=>typeof f[k]!=='boolean')||['minPrice','maxPrice'].some(k=>f[k]!==null&&(!Number.isFinite(f[k])||f[k]<0||f[k]>10000000))||(f.minPrice!==null&&f.maxPrice!==null&&f.minPrice>f.maxPrice))throw fail('Invalid filters.');
 if(r.source!=='offers'&&r.offerSlot!=null)throw fail('Offer settings require offers source.');
 const offerSlot=r.source==='offers'?require('./offer-slot').validate(r.offerSlot):undefined;
 const [startAt,endAt]=dates(r);
 if(['menu','menuTabs','menuContent','description','choices'].includes(r.source)&&(!r.enabled||r.audience!=='all'||startAt||endAt))throw fail('Required content must remain visible.');
 if(['menu','menuTabs','menuContent','search'].includes(r.source)&&(layout!=='vertical'||Object.values(f).some(v=>v!==false&&v!==null)))throw fail('Full menu must remain vertical and unfiltered.');
 return {id:r.id,title:text(r.title),description:r.description?text(r.description,180):'',source:r.source,layout,ranking,limit:r.limit,enabled:r.enabled,audience:r.audience,deduplicate:r.deduplicate,productIds:list,categoryIds:categories,filters:f,startAt,endAt,...(offerSlot?{offerSlot}:{})};
}
function validate(rows){
 if(!Array.isArray(rows)||rows.length>30)throw fail('Maximum 30 templates.');const seen=new Set();
 return rows.map(r=>{if(!r||!id(r.id)||seen.has(r.id)||!sources[r.surface]||typeof r.enabled!=='boolean'||!Number.isInteger(r.priority)||r.priority<0||r.priority>100)throw fail('Invalid template.');seen.add(r.id);
 const target=r.target||{};if(Object.keys(target).some(k=>!['branchIds','businessTypes','cuisineIds','brandIds','regionIds'].includes(k)))throw fail('Invalid targeting.');
 const t=Object.fromEntries(['branchIds','businessTypes','cuisineIds','brandIds','regionIds'].map(k=>[k,ids(target[k]||[])]));
 if(!Array.isArray(r.sections)||r.sections.length>16)throw fail('Maximum 16 sections.');const sections=r.sections.map(s=>section(s,r.surface));if(new Set(sections.map(s=>s.id)).size!==sections.length)throw fail('Duplicate sections.');
 for(const required of r.surface==='store'?(sections.some(s=>s.source==='menu')?['menu']:['menuTabs','menuContent']):['description','choices'])if(sections.filter(s=>s.source===required).length!==1)throw fail('Required content missing/duplicated.');
 if(r.surface==='store'&&(sections.filter(s=>s.source==='search').length>1||sections.some(s=>s.source==='menu')&&sections.some(s=>['search','menuTabs','menuContent'].includes(s.source))))throw fail('Duplicate store structure.');
 if(sections.some(s=>s.productIds.length||s.categoryIds.length)&&t.branchIds.length!==1)throw fail('Product/category selectors require exactly one branch.');
 const [startAt,endAt]=dates(r);return {id:r.id,name:text(r.name),surface:r.surface,enabled:r.enabled,priority:r.priority,target:t,sections,startAt,endAt};});
}
const active=(r,now)=>r.enabled&&(!r.startAt||Date.parse(r.startAt)<=now)&&(!r.endAt||Date.parse(r.endAt)>now);
function project(current,{surface,branchId,businessType,cuisineIds=[],brandId,regionIds=[],signedIn=false,now=Date.now(),storeStructureVersion=1}){
 if(!sources[surface])throw fail('Unknown surface.');
 const candidates=(current.published?.templates||[]).filter(t=>t.surface===surface&&active(t,now)&&Object.entries(t.target).every(([key,values])=>!values.length||values.some(v=>({branchIds:[branchId],businessTypes:[businessType],cuisineIds,brandIds:[brandId],regionIds}[key]||[]).includes(v))));
 const specificity=t=>t.target.branchIds.length?5:t.target.brandIds.length?4:t.target.cuisineIds.length?3:t.target.businessTypes.length?2:t.target.regionIds.length?1:0;
 candidates.sort((a,b)=>specificity(b)-specificity(a)||b.priority-a.priority||a.id.localeCompare(b.id));const t=candidates[0];
 let displaySections=t?.sections||[];if(surface==='store'&&storeStructureVersion<2&&displaySections.some(s=>s.source==='menuContent'))displaySections=displaySections.filter(s=>!['search','menuTabs'].includes(s.source)).map(s=>s.source==='menuContent'?{...s,source:'menu'}:s);
 return {configured:!!t,version:current.published?.revision||0,surface,templateId:t?.id||null,sections:displaySections.filter(s=>active(s,now)&&(s.audience==='all'||s.audience===(signedIn?'signedIn':'guest'))&&(!['lastOrder','previousOrders'].includes(s.source)||signedIn)),validUntil:new Date(Math.min(now+60000,...[t,...(t?.sections||[])].flatMap(r=>[r?.startAt,r?.endAt]).map(x=>Date.parse(x)).filter(x=>x>now))).toISOString()};
}
async function read(ctx){return (await ctx.db.send(new GetCommand({TableName:ctx.table,Key:KEY,ConsistentRead:true}))).Item||{...KEY,version:0,draft:[],published:null,history:[]};}
async function feed(ctx,scope,query){
 if(!id(query.branchId)||!sources[query.surface])throw fail('Invalid interface request.');
 const merchant=(await ctx.db.send(new GetCommand({TableName:'WhizzMerchants_Businesses',Key:{businessId:query.branchId}}))).Item;
 if(!merchant||merchant.isDeleted||merchant.deletedAt||merchant.isActive===false||merchant.platformSuspended===true)throw fail('Merchant unavailable.',404);
 const [state,catalog]=await Promise.all([read(ctx),ctx.db.send(new GetCommand({TableName:ctx.table,Key:require('./home-discovery').KEY}))]);const p=catalog.Item?.profiles?.[query.branchId]||{};
 const result=project(state,{...scope,storeStructureVersion:query.storeStructureVersion==='2'?2:1,surface:query.surface,branchId:query.branchId,businessType:merchant.businessType||merchant.business_type||'restaurant',cuisineIds:p.cuisineIds||[],brandId:p.brandId});
 if(result.sections.some(s=>s.source==='bestsellers')){const stats=(await ctx.db.send(new GetCommand({TableName:ctx.table,Key:{pk:'HOME_DISCOVERY',sk:'PRODUCTS#'+query.branchId}}))).Item;result.itemCounts=stats&&Date.parse(stats.expiresAt)>Date.now()?stats.counts:{};}
 if(query.offerSlotsVersion==='1'&&result.sections.some(s=>s.source==='offers')){try{result.offers=await require('./offer-slot').feed(ctx,scope,query.branchId,result.sections.filter(s=>s.source==='offers').map(s=>s.offerSlot));result.offerState='ready';}catch(e){console.warn('Store offer presentation unavailable',{code:e.name||'Error'});result.offers=[];result.offerState='unavailable';}}
 return result;
}
async function catalogOptions(ctx,branchId){
 const products=[];let cursor;for(let page=0;page<10;page++){const r=await ctx.db.send(new QueryCommand({TableName:'WhizzMerchants_Products',IndexName:'BusinessIdIndex',KeyConditionExpression:'businessId = :b',ExpressionAttributeValues:{':b':branchId},Limit:100,ExclusiveStartKey:cursor}));products.push(...(r.Items||[]).filter(p=>!p.isDeleted&&!p.deletedAt).map(p=>({id:p.productId,label:p.name_ar||p.name||p.productName||p.productId,categoryId:p.categoryId})));cursor=r.LastEvaluatedKey;if(!cursor)break;if(page===9)throw fail('Catalog too large. Narrow configuration.',413);}
 const categories=[];for(const categoryId of new Set(products.map(p=>p.categoryId).filter(id))){const c=(await ctx.db.send(new GetCommand({TableName:'WhizzMerchants_Categories',Key:{categoryId}}))).Item;if(c&&!c.isDeleted&&!c.deletedAt&&(!(c.businessId||c.business_id)||(c.businessId||c.business_id)===branchId))categories.push({id:categoryId,label:c.name_ar||c.categoryName||c.name||categoryId});}
 return {products,categories};
}
async function route(ctx,actor,method,path,input){
 if(actor.scope?.allRegions!==true||!allowed(actor,'promotions.read'))throw fail('Global promotions permission required.',403);
 if(path.endsWith('/catalog')){if(method!=='POST'||!id(input.branchId))throw fail('Invalid catalog request.');return catalogOptions(ctx,input.branchId);}
 const current=await read(ctx),permissions={edit:allowed(actor,'promotions.edit'),publish:allowed(actor,'promotions.approve')};
 if(method==='GET')return {...current,permissions,capabilities:{version:1,sources,businessTypes:['restaurant','store','grocery','cafe','pharmacy','bakery']}};
 const operation=path.split('/').pop();if(method!=='POST'||!['draft','publish','rollback'].includes(operation))throw fail('Unknown operation.',404);
 if(!permissions[operation==='draft'?'edit':'publish'])throw fail('Permission required.',403);
 if(!Number.isInteger(input.baseVersion)||input.baseVersion!==current.version)throw fail('Configuration changed. Refresh.',409);
 const templates=validate(operation==='draft'?input.templates:operation==='rollback'?(current.history||[]).find(h=>h.revision===input.revision)?.templates:current.draft);
 const catalog=(await ctx.db.send(new GetCommand({TableName:ctx.table,Key:require('./home-discovery').KEY,ConsistentRead:true}))).Item;
 for(const t of templates){for(const c of t.target.cuisineIds)if(!catalog?.cuisines?.some(x=>x.id===c))throw fail('Unknown cuisine.');for(const b of t.target.brandIds)if(!catalog?.brands?.some(x=>x.id===b))throw fail('Unknown brand.');}
 for(const branch of new Set(templates.flatMap(t=>t.target.branchIds))){const m=(await ctx.db.send(new GetCommand({TableName:'WhizzMerchants_Businesses',Key:{businessId:branch}}))).Item;if(!m||m.isDeleted||m.deletedAt)throw fail('Unknown branch.');}
 const branchCatalogs=new Map();
 for(const t of templates){
  const productIds=new Set(t.sections.flatMap(s=>s.productIds)),categoryIds=new Set(t.sections.flatMap(s=>s.categoryIds));if(!productIds.size&&!categoryIds.size)continue;
  const branch=t.target.branchIds[0];if(!branchCatalogs.has(branch))branchCatalogs.set(branch,await catalogOptions(ctx,branch));const choices=branchCatalogs.get(branch);
  for(const productId of productIds)if(!choices.products.some(p=>p.id===productId))throw fail('Product does not belong to selected branch.');
  for(const categoryId of categoryIds)if(!choices.categories.some(c=>c.id===categoryId))throw fail('Category does not belong to selected branch.');
 }

 for(const region of new Set(templates.flatMap(t=>t.target.regionIds))){const r=(await ctx.db.send(new GetCommand({TableName:process.env.REGIONS_TABLE||'WizzCentral_Regions',Key:{regionId:region}}))).Item;if(!r)throw fail('Unknown region.');}
 await require('./offer-slot').validateRefs(ctx,templates);
 const next={...current,version:current.version+1,updatedAt:new Date().toISOString()};
 if(operation==='draft')next.draft=templates;else{next.history=[...(current.history||[]),...(current.published?[current.published]:[])].slice(-10);next.published={revision:next.version,templates,publishedAt:next.updatedAt};}
 // Cap audit/document size before transaction; no partial publication.
 if(Buffer.byteLength(JSON.stringify(next))>180000)throw fail('Configuration capacity exceeded.');
 const guard={ConditionCheck:{TableName:ctx.table,Key:require('./home-discovery').KEY,ConditionExpression:catalog?'#v=:v':'attribute_not_exists(pk)',...(catalog?{ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':v':catalog.version}}:{})}};
 try{await ctx.db.send(new TransactWriteCommand({TransactItems:[ctx.guard(actor),{Put:{TableName:ctx.table,Item:next,ConditionExpression:current.version?'#v=:v':'attribute_not_exists(pk)',...(current.version?{ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':v':current.version}}:{})}},ctx.audit(actor.employeeId,'CUSTOMER_INTERFACES_'+operation.toUpperCase(),current,next,randomUUID()),guard]}));}catch(e){if(e.name==='TransactionCanceledException')throw fail('Configuration changed or permission revoked.',409);throw e;}
 return {saved:true,version:next.version};
}
module.exports={KEY,sources,validate,project,feed,route};
