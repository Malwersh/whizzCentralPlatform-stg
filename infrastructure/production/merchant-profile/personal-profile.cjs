'use strict';
// Authenticated personal onboarding only. Branches, staff permissions and wallets are separate.
const legal=require('../../../backend/shared/customer-legal-contract-344');
const TABLE='wizz-production-MerchantPlatform',LIFECYCLE='wizz-production-AccountDeletion';
const SETTINGS='wizz-production-PlatformStaff';
const ACK_VERSION='personal-account-2026-10-14';
const ACK_TEXT='أوافق على إنشاء حساب شخصي بالهاتف لإدارة أنشطتي، وأفهم أن توثيق الرقم لا يعني اعتماد النشاط أو إثبات ملكيته.';
const fail=(code,status=409)=>{throw Object.assign(Error(code),{code,status});};
function verifiedUser(user,sub){
 const a=Object.fromEntries((user?.UserAttributes||[]).map(x=>[x.Name,x.Value]));
 if(!/^[a-f0-9-]{36}$/i.test(sub||'')||a.sub!==sub||user.Enabled!==true||user.UserStatus!=='CONFIRMED'||a.phone_number_verified!=='true'||!/^\+9647\d{9}$/.test(a.phone_number||''))fail('VERIFIED_PHONE_IDENTITY_REQUIRED',403);
 const name=(a.name||[a.given_name,a.family_name].filter(Boolean).join(' ')).trim();
 if(!name||name.length>201)fail('PERSONAL_DETAILS_REQUIRED',400);
 return {name,phoneNumber:a.phone_number};
}
function createService({db,GetCommand,TransactWriteCommand,authenticate,now=()=>new Date().toISOString()}){
 return async(event)=>{
  // authenticate must verify the production pool/client and read the live Cognito user.
  const {sub,user}=await authenticate(event),attrs=verifiedUser(user,sub);
  const key={pk:'PERSON#'+sub,sk:'PROFILE'},life={pk:'ACCOUNT_LIFECYCLE#MERCHANT#'+sub,sk:'META'};
  const read=async(TableName,Key)=>(await db.send(new GetCommand({TableName,Key,ConsistentRead:true}))).Item;
  const closing=async()=>{if(await read(LIFECYCLE,life))fail('ACCOUNT_CLOSING',403);};
  await closing();
  if(event.path!=='/auth/person-profile')fail('NOT_FOUND',404);
  const current=await read(TABLE,key);
  if(current&&(current.subjectId!==sub||current.isDeleted||current.deletedAt))fail('PROFILE_STATE_INVALID');
  if(event.httpMethod==='GET')return {profile:current||null};
  if(event.httpMethod!=='POST')fail('METHOD_NOT_ALLOWED',405);
  let input;try{input=JSON.parse(event.body||'{}');}catch{fail('INVALID_JSON',400);}
  if(!input||Array.isArray(input)||typeof input!=='object'||Object.keys(input).some(k=>!['acknowledgementVersion','legalAccepted','legalAcceptance'].includes(k))||input.acknowledgementVersion!==ACK_VERSION)fail('ACKNOWLEDGEMENT_REQUIRED',400);
  if(current)return {profile:current};
  if(input.legalAccepted!==true)fail('LEGAL_ACCEPTANCE_REQUIRED');
  const consent=await legal.consent(db,GetCommand,SETTINGS,input.legalAcceptance,'MERCHANT');
  const timestamp=now(),profile={...key,subjectId:sub,...attrs,acknowledgementVersion:ACK_VERSION,acknowledgementText:ACK_TEXT,acknowledgedAt:timestamp,createdAt:timestamp,version:1,legalAcceptance:{schemaVersion:1,subjectId:sub,acceptedAt:timestamp,...legal.pin(consent.bundle),documentSnapshot:consent.bundle}};
  try{await db.send(new TransactWriteCommand({TransactItems:[consent.condition,{ConditionCheck:{TableName:LIFECYCLE,Key:life,ConditionExpression:'attribute_not_exists(pk)'}},{Put:{TableName:TABLE,Item:profile,ConditionExpression:'attribute_not_exists(pk)'}}]}));}
  catch(e){if(!['TransactionCanceledException','ConditionalCheckFailedException'].includes(e.name))throw e;
   await closing();const saved=await read(TABLE,key);
   if(saved?.subjectId===sub&&!saved.isDeleted&&!saved.deletedAt)return {profile:saved};
   fail('VERSION_OR_STATE_CONFLICT');
  }
  return {profile};
 };
}
module.exports={createService,verifiedUser,ACK_VERSION,ACK_TEXT};
