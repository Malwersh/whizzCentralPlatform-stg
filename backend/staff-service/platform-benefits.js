'use strict';
const {GetCommand,ScanCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {allowed}=require('./catalog');
const {readPlatformBenefit,benefitGrantKey,BENEFIT_TABLE}=require('./platform-benefits-runtime');
const {fence,digest}=require('./campaign-version');
const CAMPAIGNS='WizzCentral_Platform_Discounts';
const fail=(code,status=409)=>{throw Object.assign(Error(code),{status});};
const id=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:#-]{0,149}$/.test(v);
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
const put=(table,item,before)=>({Put:{TableName:table,Item:item,...(before?fence(before):{ConditionExpression:'attribute_not_exists('+ (table===CAMPAIGNS?'discountId':'pk') +')'})}});
function values(input){
 if(!input||Object.keys(input).sort().join(',')!=='benefit,description,endDate,startDate,title'||typeof input.title!=='string'||!input.title.trim()||input.title.length>150||typeof input.description!=='string'||input.description.length>2000)fail('BENEFIT_INVALID',400);
 for(const k of ['startDate','endDate'])if(typeof input[k]!=='string'||!Number.isFinite(Date.parse(input[k]))||new Date(input[k]).toISOString()!==input[k])fail('BENEFIT_INVALID',400);
 if(input.endDate<=input.startDate)fail('BENEFIT_INVALID',400);
 return {...input,title:input.title.trim(),benefit:readPlatformBenefit(input.benefit)};
}
async function route(ctx,actor,method,input){
 if(!allowed(actor,'promotions.read'))fail('PERMISSION_REQUIRED',403);
 const read=async(t,k)=>(await ctx.db.send(new GetCommand({TableName:t,Key:k,ConsistentRead:true}))).Item;
 const scope=async row=>{
  const b=readPlatformBenefit(row.benefit),global=actor.scope?.allRegions===true,ops=[];
  if(!global&&(!b.regionIds.length||b.regionIds.some(r=>!allowed(actor,'promotions.read',r))))fail('REGION_SCOPE_REQUIRED',403);
  for(const regionId of b.regionIds){const region=await read('WizzCentral_Regions',{regionId});if(!region)fail('BENEFIT_REGION_UNAVAILABLE');ops.push({ConditionCheck:{TableName:'WizzCentral_Regions',Key:{regionId},ConditionExpression:'attribute_exists(regionId)'}});}
  for(const businessId of b.branchIds){const branch=await read('WhizzMerchants_Businesses',{businessId});if(!branch||branch.deletionRequestId||branch.deletedAt||typeof branch.regionId!=='string')fail('BENEFIT_BRANCH_UNAVAILABLE');if(!global&&!allowed(actor,'promotions.read',branch.regionId))fail('REGION_SCOPE_REQUIRED',403);ops.push({ConditionCheck:{TableName:'WhizzMerchants_Businesses',Key:{businessId},ConditionExpression:'regionId=:region AND attribute_not_exists(deletionRequestId) AND attribute_not_exists(deletedAt)',ExpressionAttributeValues:{':region':branch.regionId}}});}
  return ops;
 };
 if(method==='GET'&&input?.view==='customers'){
  if(!allowed(actor,'promotions.grant'))fail('PERMISSION_REQUIRED',403);
  const digits=String(input.phone||'').replace(/[^0-9]/g,'');if(!/^0?7\d{9}$/.test(digits)&&!/^9647\d{9}$/.test(digits))fail('BENEFIT_PHONE_INVALID',400);
  const local=digits.startsWith('964')?'0'+digits.slice(3):digits.startsWith('0')?digits:'0'+digits,international='+964'+local.slice(1),items=[];let cursor;
  for(let n=0;n<20;n++){const r=await ctx.db.send(new ScanCommand({TableName:'WizzUser_users_staging',Limit:100,ExclusiveStartKey:cursor,FilterExpression:'#phone IN (:local,:intl,:bare) OR #phone2 IN (:local,:intl,:bare)',ProjectionExpression:'userId,cognitoSub,#name,fullName,#phone,#phone2,isActive,deletionRequestId',ExpressionAttributeNames:{'#phone':'phone','#phone2':'phoneNumber','#name':'name'},ExpressionAttributeValues:{':local':local,':intl':international,':bare':international.slice(1)}}));for(const row of r.Items||[])if(row.cognitoSub===row.userId&&row.isActive!==false&&!row.deletionRequestId)items.push({id:row.userId,name:row.name||row.fullName||'زبون',phone:row.phoneNumber||row.phone});cursor=r.LastEvaluatedKey;if(!cursor)return {customers:items};}fail('BENEFIT_CUSTOMER_LOOKUP_LIMIT');
 }
 if(method==='GET'){
  const items=[];let cursor;for(let page=0;page<20;page++){const result=await ctx.db.send(new ScanCommand({TableName:CAMPAIGNS,Limit:50,ExclusiveStartKey:cursor,ConsistentRead:true}));for(const row of result.Items||[])if(row.benefit){try{await scope(row);items.push({...row,revision:digest(row)});}catch(e){if(e.message!=='REGION_SCOPE_REQUIRED')throw e;}}cursor=result.LastEvaluatedKey;if(!cursor)return {items,can:{create:allowed(actor,'promotions.create'),edit:allowed(actor,'promotions.edit'),publish:allowed(actor,'promotions.approve'),grant:allowed(actor,'promotions.grant')}};}fail('BENEFIT_LIST_LIMIT');
 }
 if(method!=='POST'||!input||!uuid(input.requestId)||!id(input.id)||!['CREATE','UPDATE','PUBLISH','PAUSE','RESUME','GRANT','REVOKE'].includes(input.action))fail('BENEFIT_INVALID',400);
 if(!allowed(actor,input.action==='PUBLISH'?'promotions.approve':input.action==='CREATE'?'promotions.create':['GRANT','REVOKE'].includes(input.action)?'promotions.grant':'promotions.edit'))fail('PERMISSION_REQUIRED',403);
 if(!ctx.enrolled)fail('ENROLLMENT_REQUIRED',403);ctx.recent(ctx.claims);
 const allowedKeys=['action','id','requestId',...(input.action==='CREATE'||input.action==='UPDATE'?['values']:[]),...(input.action==='CREATE'?[]:['baseRevision']),...(['GRANT','REVOKE'].includes(input.action)?['userSub','uses','reason']:[])];
 if(Object.keys(input).some(k=>!allowedKeys.includes(k)))fail('BENEFIT_INVALID',400);
 const markerKey={pk:'BENEFIT_REQUEST#'+input.requestId,sk:'META'},fingerprint=digest({actor:actor.employeeId,input}),oldRequest=await read(BENEFIT_TABLE,markerKey);
 if(oldRequest){if(oldRequest.fingerprint!==fingerprint)fail('REQUEST_ID_CONFLICT');return {...oldRequest.receipt,replayed:true};}
 const current=await read(CAMPAIGNS,{discountId:input.id});if(input.action==='CREATE'&&!/^[A-Za-z0-9_-]{1,100}$/.test(input.id))fail('BENEFIT_INVALID',400);
 if(current&&!current.benefit)fail('BENEFIT_SCOPE_INVALID');
 if(input.action==='CREATE'?!!current:!current||input.baseRevision!==digest(current))fail('VERSION_OR_STATE_CONFLICT');
 const now=new Date().toISOString(),ops=[ctx.guard(actor)];if(current)ops.push(...await scope(current));
 let next=current,result={id:input.id,action:input.action};
 if(['CREATE','UPDATE'].includes(input.action)){
  if(current&&current.status!=='draft')fail('BENEFIT_PUBLISHED_TERMS_IMMUTABLE');
  const v=values(input.values);next={...current,...v,discountId:input.id,version:(current?.version||0)+1,status:'draft',isActive:false,type:v.benefit.kind==='GOODS_AMOUNT'?'fixed':'freeDelivery',value:v.benefit.amountIqd,createdAt:current?.createdAt||now,createdBy:current?.createdBy||actor.employeeId,updatedAt:now};ops.push(...await scope(next),put(CAMPAIGNS,next,current));
 }else if(['PUBLISH','PAUSE','RESUME'].includes(input.action)){
  if(input.action==='PUBLISH'&&current.status!=='draft'||input.action==='PAUSE'&&current.status!=='active'||input.action==='RESUME'&&current.status!=='paused')fail('BENEFIT_STATE_CONFLICT');
  if(input.action!=='PAUSE'&&Date.parse(current.endDate)<=Date.now())fail('BENEFIT_EXPIRED');
  next={...current,status:input.action==='PAUSE'?'paused':'active',isActive:input.action!=='PAUSE',updatedAt:now};ops.push(put(CAMPAIGNS,next,current));
 }else{
  if(!id(input.userSub)||!Number.isSafeInteger(input.uses)||input.uses<1||input.uses>current.benefit.usesPerCustomer||typeof input.reason!=='string'||input.reason.trim().length<5||input.reason.length>300||!['active','paused'].includes(current.status))fail('BENEFIT_GRANT_INVALID',400);
  const profile=await read('WizzUser_users_staging',{userId:input.userSub});if(!profile||profile.isActive===false||profile.deletionRequestId||profile.cognitoSub!==input.userSub)fail('BENEFIT_ACCOUNT_UNAVAILABLE');
  const key=benefitGrantKey(input.id,input.userSub),before=await read(BENEFIT_TABLE,key);if(before&&(!Number.isSafeInteger(before.grantedUses)||!Number.isSafeInteger(before.reservedUses)||!Number.isSafeInteger(before.usedUses)||!Number.isSafeInteger(before.version)))fail('BENEFIT_GRANT_INVALID');
  // Re-issuing changes the entitlement cap, never resets counters or adds another copy.
  if(before&&(before.version<1||before.version>=Number.MAX_SAFE_INTEGER||before.reservedUses<0||before.usedUses<0||before.reservedUses+before.usedUses>before.grantedUses))fail('BENEFIT_GRANT_INVALID');
  if(current.benefit.customerIds.length&&!current.benefit.customerIds.includes(input.userSub))fail('BENEFIT_NOT_ELIGIBLE');
  if(before&&input.uses<before.grantedUses||input.action==='REVOKE'&&!before)fail('BENEFIT_GRANT_INVALID');
  const grant={...key,...(before?.compensationReference?{compensationReference:before.compensationReference}:{}),version:(before?.version||0)+1,grantedUses:input.uses,reservedUses:before?.reservedUses||0,usedUses:before?.usedUses||0,revoked:input.action==='REVOKE',grantedBy:actor.employeeId,reason:input.reason.trim(),updatedAt:now};
  ops.push({ConditionCheck:{TableName:CAMPAIGNS,Key:{discountId:input.id},...fence(current)}},{ConditionCheck:{TableName:'WizzUser_users_staging',Key:{userId:input.userSub},...fence(profile)}},put(BENEFIT_TABLE,grant,before));result.userSub=input.userSub;
 }
 result.revision=digest(next);ops.push(put(BENEFIT_TABLE,{...markerKey,fingerprint,receipt:result,createdAt:now}),ctx.audit(actor.employeeId,'PLATFORM_BENEFIT_'+input.action,current,next,input.requestId));
 const seen=new Map(),unique=[];for(const op of ops){const c=op.ConditionCheck;if(c){const key=digest([c.TableName,c.Key]),before=seen.get(key);if(before){if(digest(before)!==digest(c))fail('VERSION_OR_STATE_CONFLICT');continue;}seen.set(key,c);}unique.push(op);}
 if(unique.length>100)fail('BENEFIT_TARGET_LIMIT');
 try{await ctx.db.send(new TransactWriteCommand({TransactItems:unique}));}catch(e){if(e.name==='TransactionCanceledException')fail('VERSION_OR_STATE_CONFLICT');throw e;}return result;
}
module.exports={route,values};
