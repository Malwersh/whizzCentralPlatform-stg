'use strict';
const {GetCommand,QueryCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {randomUUID}=require('node:crypto');
const {allowed}=require('./catalog');
const {validateCashRoundingPolicy,calculateCashRounding,CASH_ROUNDING_PK:PK}=require('./pricing-runtime/cashRounding');
const {fromWholeIqd}=require('./pricing-runtime/money');
const PATH='/staff/pricing/cash-rounding';
const fail=(code,status=400)=>Object.assign(Error(code),{status});
async function route(ctx,actor,method,path,input){
 if(!allowed(actor,'pricing.read')||actor.scope?.allRegions!==true)throw fail('PERMISSION_REQUIRED',403);
 const read=async()=>(await ctx.db.send(new GetCommand({TableName:ctx.table,Key:{pk:PK,sk:'CURRENT'},ConsistentRead:true}))).Item;
 if(method==='GET'&&path===PATH)return {current:await read()||null,canSave:allowed(actor,'pricing.approve')};
 if(method==='GET'&&path===PATH+'/history'){
  const result=await ctx.db.send(new QueryCommand({TableName:ctx.table,KeyConditionExpression:'pk=:pk AND begins_with(sk,:s)',ExpressionAttributeValues:{':pk':PK,':s':'VERSION#'},ConsistentRead:true,ScanIndexForward:false,Limit:30}));
  return {items:result.Items||[]};
 }
 if(method!=='POST'||![PATH+'/save',PATH+'/simulate'].includes(path))throw fail('NOT_FOUND',404);
 let values;try{values=validateCashRoundingPolicy(input.values);}catch{throw fail('INVALID_CASH_ROUNDING');}
 if(path.endsWith('/simulate')){
  if(!allowed(actor,'pricing.simulate'))throw fail('PERMISSION_REQUIRED',403);
  if(!['COD','PREPAID'].includes(input.paymentMethod))throw fail('INVALID_CASH_ROUNDING');
  try{return {simulation:true,result:calculateCashRounding({policy:values,version:1,paymentMethod:input.paymentMethod,customerTotal:fromWholeIqd(input.customerTotalIqd),baseServiceFee:fromWholeIqd(input.baseServiceFeeIqd)})};}catch{throw fail('INVALID_CASH_ROUNDING');}
 }
 if(!allowed(actor,'pricing.approve'))throw fail('PERMISSION_REQUIRED',403);
 if(!ctx.enrolled)throw fail('ENROLLMENT_REQUIRED',403);ctx.recent(ctx.claims);
 if(!Number.isSafeInteger(input.baseVersion)||input.baseVersion<0||typeof input.reason!=='string'||input.reason.trim().length<5||input.reason.length>300)throw fail('INVALID_CASH_ROUNDING');
 const current=await read();if((current?.version||0)!==input.baseVersion)throw fail('VERSION_OR_STATE_CONFLICT',409);
 const version=input.baseVersion+1;if(!Number.isSafeInteger(version))throw fail('INVALID_CASH_ROUNDING');
 const next={pk:PK,sk:'CURRENT',version,values,updatedBy:actor.employeeId,updatedAt:new Date().toISOString(),reason:input.reason.trim(),effectiveFor:'NEW_CHECKOUT_CONFIRMATIONS'};
 const id=randomUUID();
 await ctx.db.send(new TransactWriteCommand({TransactItems:[ctx.guard(actor),{Put:{TableName:ctx.table,Item:next,...(current?{ConditionExpression:'#v=:v',ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':v':current.version}}:{ConditionExpression:'attribute_not_exists(pk)'})}},{Put:{TableName:ctx.table,Item:{...next,sk:'VERSION#'+String(version).padStart(12,'0')},ConditionExpression:'attribute_not_exists(pk)'}},ctx.audit(actor.employeeId,'CASH_ROUNDING_POLICY_SAVED',current||null,next,id)]}));
 return {status:'SAVED',current:next};
}
module.exports={route};
