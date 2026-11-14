'use strict';
const {GetCommand,QueryCommand,ScanCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {randomUUID}=require('crypto');
const {allowed}=require('./catalog');
const KEY={pk:'HOME_DISCOVERY',sk:'CATALOG'},STATS={pk:'HOME_DISCOVERY',sk:'COMPLETED_ORDERS'};
const fail=(message,status=400)=>Object.assign(Error(message),{status});
const id=x=>typeof x==='string'&&/^[\w-]{1,128}$/.test(x)&&!['__proto__','prototype','constructor'].includes(x);
function validateCatalog(input){
 const out={};
 for(const type of ['cuisines','brands']){
  const rows=input[type];if(!Array.isArray(rows))throw fail('Invalid catalog.');if(rows.length>500)throw fail('Classification entry limit exceeded.');const ids=new Set();
  out[type]=rows.map(r=>{if(!id(r.id)||ids.has(r.id)||typeof r.label!=='string'||!r.label.trim()||r.label.length>70||/[<>\u0000-\u001f]/.test(r.label))throw fail('Invalid catalog entry.');ids.add(r.id);const activityIds=r.activityIds??[];if(!Array.isArray(activityIds)||activityIds.length>30||new Set(activityIds).size!==activityIds.length||activityIds.some(x=>typeof x!=='string'||!/^[A-Z][A-Z0-9_]{1,39}$/.test(x)))throw fail('Invalid classification activities.');return {id:r.id,label:r.label.trim(),...(activityIds.length?{activityIds}: {})};});
 }
 if(!input.profiles||typeof input.profiles!=='object'||Array.isArray(input.profiles)||Object.keys(input.profiles).length>1500)throw fail('Invalid profiles.');
 const cuisines=new Set(out.cuisines.map(x=>x.id)),brands=new Set(out.brands.map(x=>x.id));out.profiles={};
 for(const [branch,p]of Object.entries(input.profiles)){
  if(!id(branch)||!p||!Array.isArray(p.cuisineIds)||p.cuisineIds.length>12||new Set(p.cuisineIds).size!==p.cuisineIds.length||p.cuisineIds.some(x=>!cuisines.has(x))||(p.brandId!=null&&!brands.has(p.brandId)))throw fail('Invalid merchant classification.');
  const priceCategoryIds=p.priceCategoryIds??[];if(!Array.isArray(priceCategoryIds)||priceCategoryIds.length>20||new Set(priceCategoryIds).size!==priceCategoryIds.length||priceCategoryIds.some(x=>!id(x)))throw fail('Invalid price categories.');
  const mappings={};for(const kind of ['productCuisineIds','categoryCuisineIds']){const entries=p[kind]??{};if(!entries||typeof entries!=='object'||Array.isArray(entries)||Object.keys(entries).length>500)throw fail('Invalid menu classifications.');mappings[kind]={};for(const [key,values]of Object.entries(entries)){if(!id(key)||!Array.isArray(values)||values.length>12||new Set(values).size!==values.length||values.some(x=>!cuisines.has(x)))throw fail('Invalid menu classification reference.');if(values.length)mappings[kind][key]=values;}}out.profiles[branch]={cuisineIds:p.cuisineIds,brandId:p.brandId||null,priceCategoryIds,...(Object.keys(mappings.productCuisineIds).length?{productCuisineIds:mappings.productCuisineIds}:{}),...(Object.keys(mappings.categoryCuisineIds).length?{categoryCuisineIds:mappings.categoryCuisineIds}:{})};
 }
 return out;
}
async function read(ctx,key){return (await ctx.db.send(new GetCommand({TableName:ctx.table,Key:key,ConsistentRead:true}))).Item;}
const offerCache=new WeakMap();
async function offerFacts(ctx,scope){
 const empty={merchantIds:[],allMerchants:false,expiresAt:new Date(Date.now()+60000).toISOString()};
 if(!scope?.offerLive||!scope?.eligibility)return empty;
 let entry=offerCache.get(ctx.db);
 if(!entry||entry.until<Date.now()){
  const pending=(async()=>{const out=[];for(const [table,source]of [['WhizzMerchants_Discounts','merchant'],['WizzCentral_Platform_Discounts','platform']]){let cursor;for(let page=0;page<20;page++){const r=await ctx.db.send(new ScanCommand({TableName:table,ExclusiveStartKey:cursor,Limit:200}));out.push(...(r.Items||[]).map(row=>({row,source})));if(out.length>2000)throw fail('Offer discovery capacity exceeded.',503);cursor=r.LastEvaluatedKey;if(!cursor)break;if(page===19)throw fail('Incomplete offer discovery.',503);}}return out;})();entry={until:Date.now()+60000,pending};offerCache.set(ctx.db,entry);pending.catch(()=>offerCache.delete(ctx.db));
 }
 const ids=new Set();let all=false,expires=Date.now()+60000;
 for(const {row,source}of await entry.pending){if(row.benefit||!scope.offerLive(row))continue;
  try{await scope.eligibility(ctx.db,row,{identity:scope.identity,customer:scope.customer,regionIds:scope.regionIds,source,preview:true});}catch(e){if(e.status===409||e.statusCode===409)continue;throw e;}
  const end=scope.offerEnd?.(row);if(end&&Number.isFinite(Date.parse(end)))expires=Math.min(expires,Date.parse(end));
  const targets=row.targetRestaurants?.length?row.targetRestaurants:row.allowedBusinessIds?.length?row.allowedBusinessIds:row.businessIds?.length?row.businessIds:row.businessId?[row.businessId]:[];
  if(!targets.length&&source==='platform')all=true;for(const id of targets)if(typeof id==='string')ids.add(id);
 }
 return {...empty,merchantIds:[...ids],allMerchants:all,expiresAt:new Date(expires).toISOString()};
}
async function facts(ctx,scope){const [catalog,stats,offers]=await Promise.all([read(ctx,KEY),read(ctx,STATS),offerFacts(ctx,scope)]);return {offers,catalog:catalog?{cuisines:catalog.cuisines,brands:catalog.brands,profiles:catalog.profiles}:{cuisines:[],brands:[],profiles:{}},stats:stats&&Date.parse(stats.expiresAt)>Date.now()?{asOf:stats.asOf,expiresAt:stats.expiresAt,basis:stats.basis,counts:stats.counts}:null};}
async function route(ctx,actor,method,input){
 if(actor.scope?.allRegions!==true||!allowed(actor,'promotions.read'))throw fail('Global promotions permission required.',403);
 const current=await read(ctx,KEY)||{...KEY,version:0,cuisines:[],brands:[],profiles:{}};
 if(method==='GET')return {...current,canEdit:allowed(actor,'promotions.edit')};
 if(method!=='POST'||!allowed(actor,'promotions.edit'))throw fail('Permission required.',403);
 if(input.baseVersion!==current.version)throw fail('Catalog changed. Refresh first.',409);
 const data=validateCatalog(input),now=new Date().toISOString();
 const activityKey={pk:'OPERATIONAL_SETTINGS#MERCHANT_ONBOARDING',sk:'CURRENT'},policy=await read(ctx,activityKey);const types=policy?.values?.types||require('./onboarding-policy').DEFAULTS.types;for(const row of [...data.cuisines,...data.brands])if((row.activityIds||[]).some(id=>!types.some(t=>t.id===id)))throw fail('Unknown classification activity.');
 const layout=await read(ctx,{pk:'HOME_LAYOUT',sk:'CURRENT'});
 const referenced=[...(layout?.draft||[]),...(layout?.published?.sections||[]),...(layout?.history||[]).flatMap(x=>x.sections||[])];
 for(const section of referenced){if(section.filters?.cuisineIds?.some(id=>!data.cuisines.some(x=>x.id===id))||section.filters?.brandIds?.some(id=>!data.brands.some(x=>x.id===id)))throw fail('Classification still used by a saved section.');}
 for(const nav of [layout?.draftNavigation,layout?.published?.navigation,...(layout?.history||[]).map(h=>h.navigation)])require('./home-navigation').references(nav,data);
 const interfaces=(await read(ctx,{pk:'CUSTOMER_INTERFACES',sk:'CURRENT'}));
 for(const t of [...(interfaces?.draft||[]),...(interfaces?.published?.templates||[]),...(interfaces?.history||[]).flatMap(h=>h.templates||[])]){if(t.target?.cuisineIds?.some(id=>!data.cuisines.some(x=>x.id===id))||t.target?.brandIds?.some(id=>!data.brands.some(x=>x.id===id)))throw fail('Classification used by interface template.');}
 for(const branch of Object.keys(data.profiles)){const m=(await ctx.db.send(new GetCommand({TableName:'WhizzMerchants_Businesses',Key:{businessId:branch},ConsistentRead:true}))).Item;if(!m||m.isDeleted||m.deletedAt)throw fail('Unknown merchant.');const activityId=require('./business-activity').resolve(m,types);const profile=data.profiles[branch];for(const classification of [...new Set([...profile.cuisineIds,...Object.values(profile.productCuisineIds||{}).flat(),...Object.values(profile.categoryCuisineIds||{}).flat()])]){const row=data.cuisines.find(c=>c.id===classification);if(row.activityIds?.length&&!row.activityIds.includes(activityId))throw fail('Classification does not support this branch activity.');}if(profile.brandId){const brand=data.brands.find(r=>r.id===profile.brandId);if(brand.activityIds?.length&&!brand.activityIds.includes(activityId))throw fail('Brand does not support this branch activity.');}for(const categoryId of data.profiles[branch].priceCategoryIds){const category=(await ctx.db.send(new GetCommand({TableName:'WhizzMerchants_Categories',Key:{categoryId},ConsistentRead:true}))).Item;if(!category||category.businessId&&category.businessId!==branch||category.isActive===false||category.is_active===false)throw fail('Invalid price category ownership.');}}
 for(const [branch,p]of Object.entries(data.profiles)){
  const selected=Object.keys(p.productCuisineIds||{});if(selected.length){const owned=new Set();let cursor;for(let page=0;page<10;page++){const result=await ctx.db.send(new QueryCommand({TableName:'WhizzMerchants_Products',IndexName:'BusinessIdIndex',KeyConditionExpression:'businessId=:b',ExpressionAttributeValues:{':b':branch},Limit:100,ExclusiveStartKey:cursor}));for(const row of result.Items||[])if(row.businessId===branch&&!row.isDeleted&&!row.deletedAt)owned.add(row.productId);cursor=result.LastEvaluatedKey;if(!cursor)break;if(page===9)throw fail('Branch catalog capacity exceeded.',413);}if(selected.some(id=>!owned.has(id)))throw fail('Product does not belong to this branch.');}
  for(const categoryId of Object.keys(p.categoryCuisineIds||{})){const row=(await ctx.db.send(new GetCommand({TableName:'WhizzMerchants_Categories',Key:{categoryId},ConsistentRead:true}))).Item;if(!row||row.isDeleted||row.deletedAt||(row.businessId||row.business_id)&&(row.businessId||row.business_id)!==branch)throw fail('Menu category does not belong to this branch.');}
 }

 const layoutGuard={ConditionCheck:{TableName:ctx.table,Key:{pk:'HOME_LAYOUT',sk:'CURRENT'},ConditionExpression:layout?'#v=:v':'attribute_not_exists(pk)',...(layout?{ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':v':layout.version}}:{})}};
 const interfaceGuard={ConditionCheck:{TableName:ctx.table,Key:{pk:'CUSTOMER_INTERFACES',sk:'CURRENT'},ConditionExpression:interfaces?'#v=:v':'attribute_not_exists(pk)',...(interfaces?{ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':v':interfaces.version}}:{})}};
 const next={...KEY,...data,version:current.version+1,updatedAt:now};if(Buffer.byteLength(JSON.stringify(next))>350000)throw fail('Classification catalog capacity exceeded.',413);
 try{await ctx.db.send(new TransactWriteCommand({TransactItems:[ctx.guard(actor),{Put:{TableName:ctx.table,Item:next,ConditionExpression:current.version?'#v=:v':'attribute_not_exists(pk)',...(current.version?{ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':v':current.version}}:{})}},{ConditionCheck:{TableName:ctx.table,Key:activityKey,ConditionExpression:policy?'#v=:v':'attribute_not_exists(pk)',...(policy?{ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':v':policy.version}}:{})}},ctx.audit(actor.employeeId,'HOME_DISCOVERY_CATALOG_SAVED',current,next,randomUUID()),layoutGuard,interfaceGuard]}));}catch(e){if(e.name==='TransactionCanceledException')throw fail('Catalog changed or permission revoked.',409);throw e;}
 return {saved:true,version:next.version};
}
function aggregate(rows,now){
 const counts={},seen=new Set();for(const row of rows){
  if(row.SK!=='META'||typeof row.PK!=='string'||!row.PK.startsWith('ORDER#')||seen.has(row.PK))continue;seen.add(row.PK);
  if(!['DELIVERED','COMPLETED'].includes(String(row.status||row.orderStatus||'').toUpperCase())||row.isTestOrder===true||row.isTest===true||row.testMode===true)continue;
  const branch=row.businessId||row.branchId||row.restaurantId||row.storeId||row.merchantId,raw=row.createdAt;
  const at=typeof raw==='number'?(raw<1e12?raw*1000:raw):Date.parse(raw);if(!id(branch)||!Number.isFinite(at)||at>now||at<now-30*86400000)continue;
  const item=counts[branch]||{days7:0,days30:0};item.days30++;if(at>=now-7*86400000)item.days7++;counts[branch]=item;
 }
 return counts;
}
function aggregateProducts(rows,now){
 const result={},seen=new Set();for(const row of rows){
  if(!Object.keys(aggregate([row],now)).length||seen.has(row.PK))continue;seen.add(row.PK);
  const branch=row.businessId||row.branchId||row.restaurantId||row.storeId||row.merchantId;
  const out=result[branch]||{};for(const item of Array.isArray(row.items)?row.items:[]){const product=item.productId||item.product_id||item.dish_id||item.itemId,quantity=item.quantity;
   if(!id(product)||!Number.isSafeInteger(quantity)||quantity<1||quantity>1000)continue;out[product]=(out[product]||0)+quantity;
  }result[branch]=out;
 }return result;
}
async function rebuild(ctx,{now=Date.now(),maxPages=200}={}){
 const before=await read(ctx,STATS),rows=[];let cursor,complete=false;
 for(let n=0;n<maxPages;n++){
  const page=await ctx.db.send(new ScanCommand({TableName:'WizzOrders',ConsistentRead:true,Limit:500,ExclusiveStartKey:cursor,ProjectionExpression:'PK,SK,orderId,businessId,branchId,restaurantId,storeId,merchantId,#s,orderStatus,createdAt,isTestOrder,isTest,testMode,#items',ExpressionAttributeNames:{'#s':'status','#items':'items'}}));rows.push(...(page.Items||[]));if(rows.length>100000)throw fail('Metrics rebuild capacity exceeded.',503);cursor=page.LastEvaluatedKey;if(!cursor){complete=true;break;}
 }
 if(!complete)throw fail('Incomplete metrics rebuild.',503);
 const next={...STATS,version:(before?.version||0)+1,asOf:new Date(now).toISOString(),expiresAt:new Date(now+2*3600000).toISOString(),basis:'COMPLETED_STATUS_BY_ORDER_CREATION_DATE_EXCLUDING_FLAGGED_TESTS',counts:aggregate(rows,now)};
 const productCounts=aggregateProducts(rows,now);
 for(const [branch,counts] of Object.entries(productCounts)){const item={pk:'HOME_DISCOVERY',sk:'PRODUCTS#'+branch,asOf:next.asOf,expiresAt:next.expiresAt,counts};if(Buffer.byteLength(JSON.stringify(item))>350000)throw fail('Branch metrics capacity exceeded.',503);await ctx.db.send(new TransactWriteCommand({TransactItems:[{Put:{TableName:ctx.table,Item:item}}]}));}
 if(Buffer.byteLength(JSON.stringify(next))>350000)throw fail('Metrics snapshot capacity exceeded.',503);
 await ctx.db.send(new TransactWriteCommand({TransactItems:[{Put:{TableName:ctx.table,Item:next,ConditionExpression:before?'#v=:v':'attribute_not_exists(pk)',...(before?{ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':v':before.version}}:{})}}]}));return {rebuilt:true,branches:Object.keys(next.counts).length,asOf:next.asOf};
}
module.exports={KEY,STATS,validateCatalog,route,facts,aggregate,aggregateProducts,rebuild};
