"use strict";
const {GetCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {randomBytes,randomInt,createHash,createHmac,timingSafeEqual}=require('node:crypto');
const TABLE='staging-MerchantPlatform';
const fail=code=>{throw Object.assign(Error(code),{code});};
const hash=v=>createHash('sha256').update(v).digest('hex');
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const valid=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_:#.-]{0,149}$/.test(v);
/** Internal service, not an unauthenticated route. authorize must independently
 * verify the live owner, branch, verified phone and account-deletion fences.
 * Its versioned fingerprint and transactional guards fence ownership changes.
 * Never accept an owner identity or verified phone supplied by the caller.
 */
function createMerchantFinancialSession({db,authorize,otp,now=Date.now}){
 const epoch=()=>Math.floor(now()/1000);
 async function identity(input){
  if(!valid(input?.branchId)||typeof input?.deviceId!=='string'||!/^[A-Za-z0-9_-]{24,128}$/.test(input.deviceId))fail('FINANCIAL_INVALID_REQUEST');
  const a=await authorize(input.branchId);
  if(!a||!valid(a.subjectId)||a.branchId!==input.branchId||!/^\+9647\d{9}$/.test(a.verifiedPhone||'')||typeof a.fingerprint!=='string'||a.fingerprint.length<16||!Array.isArray(a.guards)||!a.guards.length)fail('FINANCIAL_OWNER_REQUIRED');
  return a;
 }
 const scope=(a,input)=>hash(JSON.stringify([a.subjectId,input.branchId,input.deviceId]));
 const key=(a,input,kind)=>({pk:'MERCHANT_FINANCIAL_SESSION#'+scope(a,input),sk:kind});
 const get=async Key=>(await db.send(new GetCommand({TableName:TABLE,Key,ConsistentRead:true}))).Item;
 const put=(row,prior)=>({Put:{TableName:TABLE,Item:row,ConditionExpression:prior?'#version=:version':'attribute_not_exists(pk)',...(prior?{ExpressionAttributeNames:{'#version':'version'},ExpressionAttributeValues:{':version':prior.version}}:{})}});
 async function write(a,items){await db.send(new TransactWriteCommand({TransactItems:[...a.guards,...items]}));}
 async function fresh(a,input){const b=await identity(input);if(a.subjectId!==b.subjectId||a.fingerprint!==b.fingerprint)fail('FINANCIAL_IDENTITY_CHANGED');return b;}
 async function start(input){
  const a=await identity(input),k=key(a,input,'CHALLENGE'),prior=await get(k),at=epoch();
  const rateKey={pk:'MERCHANT_FINANCIAL_RATE#'+hash(a.subjectId),sk:'OTP'},rate=await get(rateKey);
  if(rate&&at-rate.sentAt<60)fail('FINANCIAL_RATE_LIMIT');
  const recent=rate&&at-rate.windowStart<3600;
  if(recent&&rate.sentCount>=5)fail('FINANCIAL_RATE_LIMIT');
  const challengeId=randomBytes(24).toString('base64url'),code=String(randomInt(0,1000000)).padStart(6,'0');
  const secret=await otp.secret();if(typeof secret!=='string'||secret.length<32)fail('FINANCIAL_VERIFICATION_UNAVAILABLE');
  const digest=createHmac('sha256',secret).update(JSON.stringify([scope(a,input),challengeId,code])).digest('hex');
  const row={...k,kind:'MERCHANT_FINANCIAL_CHALLENGE',subjectId:a.subjectId,branchId:input.branchId,version:(prior?.version||0)+1,challengeId,codeDigest:digest,fingerprint:a.fingerprint,attempts:0,consumed:false,sentAt:at,expiresAt:at+300,ttl:at+86400};
  const nextRate={...rateKey,subjectId:a.subjectId,version:(rate?.version||0)+1,sentAt:at,windowStart:recent?rate.windowStart:at,sentCount:recent?rate.sentCount+1:1,ttl:at+86400};
  await write(await fresh(a,input),[put(row,prior),put(nextRate,rate)]);
  // No code or phone in the response, audit metadata or logs. A provider timeout
  // is uncertain delivery: the same challenge can still be verified if received.
  let delivery='SENT';try{await otp.send(a.verifiedPhone,code);}catch{delivery='UNCONFIRMED';}
  await fresh(a,input);
  return {challengeId,expiresAt:row.expiresAt,resendAfter:at+60,delivery};
 }
 async function unlock(input){
  if(typeof input?.code!=='string'||!/^\d{6}$/.test(input.code)||typeof input?.challengeId!=='string')fail('FINANCIAL_INVALID_CODE');
  const a=await identity(input),k=key(a,input,'CHALLENGE'),row=await get(k),at=epoch();
  if(!row||row.challengeId!==input.challengeId||row.consumed||row.expiresAt<=at||row.attempts>=5||row.fingerprint!==a.fingerprint)fail('FINANCIAL_CHALLENGE_EXPIRED');
  const secret=await otp.secret(),digest=createHmac('sha256',secret).update(JSON.stringify([scope(a,input),row.challengeId,input.code])).digest('hex');
  if(!same(digest,row.codeDigest)){
   await write(await fresh(a,input),[put({...row,version:row.version+1,attempts:row.attempts+1},row)]);
   fail('FINANCIAL_INVALID_CODE');
  }
  const sk=key(a,input,'SESSION'),prior=await get(sk),token=randomBytes(32).toString('base64url');
  const session={...sk,kind:'MERCHANT_FINANCIAL_SESSION',subjectId:a.subjectId,branchId:input.branchId,version:(prior?.version||0)+1,tokenHash:hash(token),fingerprint:a.fingerprint,expiresAt:at+300,ttl:at+86400};
  await write(await fresh(a,input),[put({...row,version:row.version+1,consumed:true},row),put(session,prior)]);
  return {token,expiresAt:session.expiresAt};
 }
 async function check(input){
  if(typeof input?.token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(input.token))fail('FINANCIAL_UNLOCK_REQUIRED');
  const a=await identity(input),row=await get(key(a,input,'SESSION'));
  if(!row||row.expiresAt<=epoch()||row.fingerprint!==a.fingerprint||!same(hash(input.token),row.tokenHash))fail('FINANCIAL_UNLOCK_REQUIRED');
  const after=await fresh(a,input);
  // Mutations must include these guards in THEIR transaction. Reading this
  // result alone is insufficient authorization for a later financial write.
  return {subjectId:a.subjectId,branchId:input.branchId,expiresAt:row.expiresAt,guards:[...after.guards,{ConditionCheck:{TableName:TABLE,Key:{pk:row.pk,sk:row.sk},ConditionExpression:'#version=:version AND expiresAt>:now',ExpressionAttributeNames:{'#version':'version'},ExpressionAttributeValues:{':version':row.version,':now':epoch()}}}]};
 }
 async function lock(input){
  const a=await identity(input),k=key(a,input,'SESSION'),row=await get(k);
  if(row){
   if(typeof input.token!=='string'||!same(hash(input.token),row.tokenHash))fail('FINANCIAL_UNLOCK_REQUIRED');
   await write(await fresh(a,input),[put({...row,version:row.version+1,expiresAt:0,tokenHash:''},row)]);
  }
  return {locked:true};
 }
 return {start,unlock,check,lock};
}
module.exports={createMerchantFinancialSession};
