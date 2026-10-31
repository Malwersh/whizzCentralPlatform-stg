'use strict';
const {GetCommand,ScanCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {randomUUID}=require('crypto');
const {allowed}=require('./catalog');
const KEY={pk:'HOME_DISCOVERY',sk:'CATALOG'},STATS={pk:'HOME_DISCOVERY',sk:'COMPLETED_ORDERS'};
const fail=(message,status=400)=>Object.assign(Error(message),{status});
const id=x=>typeof x==='string'&&/^[\w-]{1,128}$/.test(x)&&!['__proto__','prototype','constructor'].includes(x);
function validateCatalog(input){
 const out={};
 for(const type of ['cuisines','brands']){
  const rows=input[type];if(!Array.isArray(rows)||rows.length>100)throw fail('Invalid catalog.');const ids=new Set();
  out[type]=rows.map(r=>{if(!id(r.id)||ids.has(r.id)||typeof r.label!=='string'||!r.label.trim()||r.label.length>70||/[<>\u0000-\u001f]/.test(r.label))throw fail('Invalid catalog entry.');ids.add(r.id);return {id:r.id,label:r.label.trim()};});
 }
 if(!input.profiles||typeof input.profiles!=='object'||Array.isArray(input.profiles)||Object.keys(input.profiles).length>1500)throw fail('Invalid profiles.');
 const cuisines=new Set(out.cuisines.map(x=>x.id)),brands=new Set(out.brands.map(x=>x.id));out.profiles={};
 for(const [branch,p]of Object.entries(input.profiles)){
  if(!id(branch)||!p||!Array.isArray(p.cuisineIds)||p.cuisineIds.length>12||new Set(p.cuisineIds).size!==p.cuisineIds.length||p.cuisineIds.some(x=>!cuisines.has(x))||(p.brandId!=null&&!brands.has(p.brandId)))throw fail('Invalid merchant classification.');
  out.profiles[branch]={cuisineIds:p.cuisineIds,brandId:p.brandId||null};
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
 const layout=await read(ctx,{pk:'HOME_LAYOUT',sk:'CURRENT'});
 const referenced=[...(layout?.draft||[]),...(layout?.published?.sections||[]),...(layout?.history||[]).flatMap(x=>x.sections||[])];
 for(const section of referenced){if(section.filters?.cuisineIds?.some(id=>!data.cuisines.some(x=>x.id===id))||section.filters?.brandIds?.some(id=>!data.brands.some(x=>x.id===id)))throw fail('Classification still used by a saved section.');}
 for(const branch of Object.keys(data.profiles)){const m=(await ctx.db.send(new GetCommand({TableName:'WhizzMerchants_Businesses',Key:{businessId:branch},ConsistentRead:true}))).Item;if(!m||m.isDeleted||m.deletedAt)throw fail('Unknown merchant.');}
 const layoutGuard={ConditionCheck:{TableName:ctx.table,Key:{pk:'HOME_LAYOUT',sk:'CURRENT'},ConditionExpression:layout?'#v=:v':'attribute_not_exists(pk)',...(layout?{ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':v':layout.version}}:{})}};
 const next={...KEY,...data,version:current.version+1,updatedAt:now};
 try{await ctx.db.send(new TransactWriteCommand({TransactItems:[ctx.guard(actor),{Put:{TableName:ctx.table,Item:next,ConditionExpression:current.version?'#v=:v':'attribute_not_exists(pk)',...(current.version?{ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':v':current.version}}:{})}},ctx.audit(actor.employeeId,'HOME_DISCOVERY_CATALOG_SAVED',current,next,randomUUID()),layoutGuard]}));}catch(e){if(e.name==='TransactionCanceledException')throw fail('Catalog changed or permission revoked.',409);throw e;}
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
async function rebuild(ctx,{now=Date.now(),maxPages=200}={}){
 const before=await read(ctx,STATS),rows=[];let cursor,complete=false;
 for(let n=0;n<maxPages;n++){
  const page=await ctx.db.send(new ScanCommand({TableName:'WizzOrders',ConsistentRead:true,Limit:500,ExclusiveStartKey:cursor,ProjectionExpression:'PK,SK,orderId,businessId,branchId,restaurantId,storeId,merchantId,#s,orderStatus,createdAt,isTestOrder,isTest,testMode',ExpressionAttributeNames:{'#s':'status'}}));rows.push(...(page.Items||[]));if(rows.length>100000)throw fail('Metrics rebuild capacity exceeded.',503);cursor=page.LastEvaluatedKey;if(!cursor){complete=true;break;}
 }
 if(!complete)throw fail('Incomplete metrics rebuild.',503);
 const next={...STATS,version:(before?.version||0)+1,asOf:new Date(now).toISOString(),expiresAt:new Date(now+2*3600000).toISOString(),basis:'COMPLETED_STATUS_BY_ORDER_CREATION_DATE_EXCLUDING_FLAGGED_TESTS',counts:aggregate(rows,now)};
 if(Buffer.byteLength(JSON.stringify(next))>350000)throw fail('Metrics snapshot capacity exceeded.',503);
 await ctx.db.send(new TransactWriteCommand({TransactItems:[{Put:{TableName:ctx.table,Item:next,ConditionExpression:before?'#v=:v':'attribute_not_exists(pk)',...(before?{ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':v':before.version}}:{})}}]}));return {rebuilt:true,branches:Object.keys(next.counts).length,asOf:next.asOf};
}
module.exports={KEY,STATS,validateCatalog,route,facts,aggregate,rebuild};
