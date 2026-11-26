'use strict';
const {createService}=require('./branch-drafts.cjs');
const assets=require('./assets.cjs');
const {listOwnedBusinesses}=require('./owned-businesses.cjs');
const TABLES=Object.freeze({platform:'wizz-production-MerchantPlatform',policy:'wizz-production-PlatformStaff',lifecycle:'wizz-production-AccountDeletion'});
const failure=(code,status)=>Object.assign(Error(code),{code,status});
function phone(value){if(typeof value!=='string'||!/^\+9647\d{9}$/.test(value))throw failure('INVALID_PHONE',400);return value;}
function createRequestService({db,sdk,regions,authenticate}){
 const core=createService({sdk,regions,tables:TABLES});
 return async event=>{
  const {sub,user}=await authenticate(event);
  const attributes=Object.fromEntries((user?.UserAttributes||[]).map(a=>[a.Name,a.Value]));
  if(attributes.sub!==sub||attributes.phone_number_verified!=='true'||user.Enabled!==true||user.UserStatus!=='CONFIRMED')throw failure('VERIFIED_PHONE_IDENTITY_REQUIRED',403);
  phone(attributes.phone_number);
  const path=event.path,method=event.httpMethod;
  const allowed=(method==='GET'&&['/auth/branch-drafts','/auth/branch-drafts/config','/auth/branch-drafts/regions','/auth/user-businesses','/auth/branch-drafts/assets'].includes(path))||(method==='POST'&&['/auth/branch-drafts','/auth/branch-drafts/submit','/auth/branch-drafts/rebase','/auth/branch-drafts/assets'].includes(path));
  if(!allowed)throw failure('NOT_FOUND',404);
  const life=await db.send(new sdk.GetCommand({TableName:TABLES.lifecycle,Key:{pk:'ACCOUNT_LIFECYCLE#MERCHANT#'+sub,sk:'META'},ConsistentRead:true}));
  if(life.Item)throw failure('ACCOUNT_CLOSING',403);
  if(path==='/auth/branch-drafts/regions')return regions.list();
  if(path==='/auth/user-businesses')return listOwnedBusinesses({db,sdk,sub});
  let input={};
  if(method==='POST'){
   if(typeof event.body!=='string'||Buffer.byteLength(event.body,'utf8')>(path==='/auth/branch-drafts/assets'?4200000:65536))throw failure('INVALID_BODY',400);
   try{input=JSON.parse(event.body);}catch{throw failure('INVALID_JSON',400);}
   if(!input||typeof input!=='object'||Array.isArray(input))throw failure('INVALID_BODY',400);
  }
  if(path==='/auth/branch-drafts/assets')return assets.route({db,sub},event,input);
  return core.route({db,sub,phone},event,input);
 };
}
module.exports={createRequestService,TABLES,phone};
