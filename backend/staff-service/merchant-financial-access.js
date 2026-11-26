'use strict';
const {GetCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {createHash}=require('node:crypto');
const {createMerchantFinancialSession}=require('./merchant-financial-session');
const fail=code=>{throw Object.assign(Error(code),{code,status:403});};
const actions=new Set(['FINANCIAL_START','FINANCIAL_UNLOCK','FINANCIAL_LOCK']);
function createAccess(ctx,owner){
 const production=['production','prod'].includes(process.env.ENVIRONMENT)||
  ['production','prod'].includes(process.env.PLATFORM_ENVIRONMENT);
 if(production&&(ctx.financialSessionTable!=='wizz-production-MerchantFinancialSessions'||
     typeof ctx.deduplicateGuards!=='function'||typeof ctx.payoutOtp?.secret!=='function'||
     typeof ctx.payoutOtp?.send!=='function'))fail('PAYOUT_FINANCIAL_VERIFICATION_UNAVAILABLE');
 const deduplicate=ctx.deduplicateGuards||require('./settlement-runtime').cashAccountingDeduplicate;
 const branches=production?'wizz-production-Merchants':'WhizzMerchants_Businesses';
 const deletion=production?'wizz-production-AccountDeletion':'staging-AccountDeletion';
 const branchGuard=b=>{const names={},values={},terms=[];for(const [i,field] of ['ownerId','cognitoUserId','status','version','deletionRequestId','deletedAt','isDeleted'].entries()){names['#f'+i]=field;if(b[field]===undefined)terms.push('attribute_not_exists(#f'+i+')');else{values[':f'+i]=b[field];terms.push('#f'+i+'=:f'+i);}}return {ConditionCheck:{TableName:branches,Key:{businessId:b.businessId},ConditionExpression:terms.join(' AND '),ExpressionAttributeNames:names,ExpressionAttributeValues:values}};};
 const get=async(table,key)=>(await ctx.db.send(new GetCommand({TableName:table,Key:key,ConsistentRead:true,...(table===deletion?{ProjectionExpression:'pk,sk'}:{})}))).Item;
 const authorize=async branchId=>{
  if(!owner?.subjectId||typeof owner.revalidate!=='function')fail('PAYOUT_FINANCIAL_OWNER_REQUIRED');
  const live=await owner.revalidate();
  if(live?.sub!==owner.subjectId||live.phone_number_verified!=='true'||!/^\+9647\d{9}$/.test(live.phone_number||''))fail('PAYOUT_FINANCIAL_OWNER_REQUIRED');
  const b=await get(branches,{businessId:branchId});
  if(!b||b.businessId!==branchId||b.ownerId!==owner.subjectId||b.cognitoUserId!==owner.subjectId||b.status!=='approved'||b.deletionRequestId!=null||b.deletedAt!=null||b.isDeleted===true)fail('PAYOUT_FINANCIAL_OWNER_REQUIRED');
  const guards=[branchGuard(b)];
  for(const pk of ['BUSINESS_LIFECYCLE#MERCHANT#'+branchId,'ACCOUNT_LIFECYCLE#MERCHANT#'+owner.subjectId]){
   const key={pk,sk:'META'};if(await get(deletion,key))fail('PAYOUT_FINANCIAL_OWNER_REQUIRED');
   guards.push({ConditionCheck:{TableName:deletion,Key:key,ConditionExpression:'attribute_not_exists(pk)'}});
  }
  return {subjectId:owner.subjectId,branchId,verifiedPhone:live.phone_number,fingerprint:createHash('sha256').update(JSON.stringify([owner.subjectId,live.phone_number,b.ownerId,b.version??null,b.status])).digest('hex'),guards};
 };
 const service=createMerchantFinancialSession({db:ctx.db,authorize,otp:ctx.payoutOtp||require('./payout-otp-provider'),tableName:ctx.financialSessionTable,...(ctx.now?{now:ctx.now}:{})});
 const checked=async input=>{try{return await service.check(input);}catch(e){if(e.code?.startsWith('FINANCIAL_'))fail('PAYOUT_'+e.code);throw e;}};
 return {async act(input){
  const allowed={FINANCIAL_START:['action','branchId','deviceId'],FINANCIAL_UNLOCK:['action','branchId','deviceId','challengeId','code'],FINANCIAL_LOCK:['action','branchId','deviceId','token']};
  if(!actions.has(input?.action)||Object.keys(input).some(k=>!allowed[input.action].includes(k)))fail('PAYOUT_FINANCIAL_INVALID_REQUEST');
  const {action,...body}=input;
  try{return await service[{FINANCIAL_START:'start',FINANCIAL_UNLOCK:'unlock',FINANCIAL_LOCK:'lock'}[action]](body);}catch(e){if(e.code?.startsWith('FINANCIAL_'))fail('PAYOUT_'+e.code);throw e;}
 },async protect(input){
  const {financialAccess,...body}=input||{};
  if(!financialAccess||Object.keys(financialAccess).sort().join(',')!=='deviceId,token')fail('PAYOUT_FINANCIAL_UNLOCK_REQUIRED');
  const access={branchId:body.branchId,...financialAccess};await checked(access);
  return {body,async verify(){return checked(access);},db:{async send(command){
   const kind=command.constructor.name;
   if(kind==='TransactWriteCommand'){
    const authorization=await checked(access);
    const items=deduplicate([...authorization.guards,...command.input.TransactItems]);
    if(items.length>100)fail('PAYOUT_FINANCIAL_TRANSACTION_LIMIT');
    return ctx.db.send(new TransactWriteCommand({...command.input,TransactItems:items}));
   }
   if(!['GetCommand','QueryCommand','ScanCommand','BatchGetCommand'].includes(kind))fail('PAYOUT_FINANCIAL_WRITE_REQUIRES_TRANSACTION');
   // One request-scoped read boundary: protect() validates before any reads,
   // and every caller must verify() before returning data. Writes recheck fresh
   // identity and carry atomic guards; no cached authorization crosses requests.
   return ctx.db.send(command);
  }}};
 }};
}
module.exports={createAccess,actions};
