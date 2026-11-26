'use strict';
const {randomUUID}=require('node:crypto');
const {validate}=require('../../../backend/staff-service/onboarding-policy');
const {prepareInitialConfig}=require('./config.cjs');
const TABLE='wizz-production-PlatformStaff',PK='OPERATIONAL_SETTINGS#MERCHANT_ONBOARDING';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
function createService({GetCommand,TransactWriteCommand}){
 return async function route(ctx,actor,method,path,input={}){
  if(!ctx.allowed(actor,'merchants.read')||actor.scope?.allRegions!==true)fail('PERMISSION_REQUIRED',403);
  const get=async()=> (await ctx.db.send(new GetCommand({TableName:TABLE,Key:{pk:PK,sk:'CURRENT'},ConsistentRead:true}))).Item;
  const current=await get();
  if(method==='GET'&&path==='/staff/merchants/onboarding')return {current:current||null,canEdit:ctx.allowed(actor,'merchants.edit')};
  if(method!=='POST'||!['/staff/merchants/onboarding/initialize','/staff/merchants/onboarding/save'].includes(path))fail('NOT_FOUND',404);
  if(!ctx.allowed(actor,'merchants.edit'))fail('PERMISSION_REQUIRED',403);
  if(typeof input.reason!=='string'||input.reason.trim().length<5||input.reason.length>300)fail('REASON_REQUIRED');
  const now=new Date().toISOString();let items,next;
  if(path.endsWith('/initialize')){
   if(Object.keys(input).some(k=>k!=='reason'))fail('UNKNOWN_FIELD');if(current)fail('ALREADY_INITIALIZED',409);
   items=prepareInitialConfig({policyVersion:randomUUID(),actorId:actor.employeeId,now}).TransactItems;next=items[0].Put.Item;
  }else{
   if(Object.keys(input).some(k=>!['reason','baseVersion','values'].includes(k)))fail('UNKNOWN_FIELD');
   if(!current||input.baseVersion!==current.version)fail('VERSION_OR_STATE_CONFLICT',409);
   const values=validate(input.values);
   if(values.partnershipReady===true&&/قيد الاعتماد/.test(values.termsTextAr))fail('AGREEMENT_NOT_READY');
   if(values.termsTextAr!==current.values.termsTextAr&&values.termsVersion===current.values.termsVersion)fail('NEW_AGREEMENT_VERSION_REQUIRED');
   for(const old of current.values.types){const type=values.types.find(t=>t.id===old.id);if(!type||type.model!==old.model)fail('TYPE_ARCHIVE_OR_MODEL_REQUIRED');}
   if(values.types.some(t=>t.registrationOpen)&&values.partnershipReady!==true)fail('PARTNERSHIP_AGREEMENT_REQUIRED');
   next={pk:PK,sk:'CURRENT',version:current.version+1,policyVersion:randomUUID(),values,updatedBy:actor.employeeId,updatedAt:now,effectiveFor:'NEW_REQUESTS'};
   items=[{Put:{TableName:TABLE,Item:next,ConditionExpression:'#v=:v',ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':v':current.version}}},{Put:{TableName:TABLE,Item:{...next,sk:'VERSION#'+next.policyVersion},ConditionExpression:'attribute_not_exists(pk)'}}];
  }
  await ctx.db.send(new TransactWriteCommand({TransactItems:[ctx.guard(actor),...items,ctx.audit(actor.employeeId,'MERCHANT_ONBOARDING_CONFIG_SAVED',current||null,{...next,reason:input.reason.trim()},next.policyVersion)]}));
  return {saved:true,current:next};
 };
}
module.exports={createService};
