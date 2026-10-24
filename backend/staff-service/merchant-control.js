'use strict';
const {GetCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {allowed}=require('./catalog');
const B='WhizzMerchants_Businesses';
const fail=(code,status=400)=>Object.assign(Error(code),{status});
function change(b,action){
 const off={acceptingOrders:false,onlineStatus:'offline',operatingStatus:'OFFLINE'};
 switch(action){
  case 'PAUSE_ORDERS':return {...off,ordersBlocked:true};
  case 'RESUME_ORDERS':return {ordersBlocked:false};
  case 'SUSPEND':return {...off,platformSuspended:true,isActive:false};
  case 'UNSUSPEND':return {...off,platformSuspended:false,isActive:b.status==='approved'&&(b.onboardingSchemaVersion===undefined||b.onboardingComplete===true)};
  default:throw fail('INVALID_CONTROL_ACTION');
 }
}
async function route(ctx,actor,method,input){
 if(!allowed(actor,'merchants.suspend'))throw fail('PERMISSION_REQUIRED',403);
 if(method!=='POST'||typeof input.businessId!=='string'||input.businessId.length>150||typeof input.reason!=='string'||input.reason.trim().length<5||input.reason.length>1000)throw fail('INVALID_CONTROL_REQUEST');
 const b=(await ctx.db.send(new GetCommand({TableName:B,Key:{businessId:input.businessId},ConsistentRead:true}))).Item;
 if(!b||!allowed(actor,'merchants.suspend',b.regionId))throw fail('BUSINESS_UNAVAILABLE',404);
 if(b.deletionRequestId||['closed','closing'].includes(b.status))throw fail('BUSINESS_CLOSING',409);
 if(input.baseUpdatedAt!==(b.updatedAt??null))throw fail('VERSION_OR_STATE_CONFLICT',409);
 const patch={...change(b,input.action),updatedAt:new Date().toISOString(),platformControlUpdatedBy:actor.employeeId,platformControlReason:input.reason.trim()};
 const names={'#base':'updatedAt'},values={};let counter=0;const sets=Object.entries(patch).map(([k,v])=>{const n='#n'+counter,p=':p'+counter++;names[n]=k;values[p]=v;return n+'='+p;});
 let condition='attribute_exists(businessId) AND attribute_not_exists(deletionRequestId)';
 if(b.updatedAt!==undefined){condition+=' AND #base=:base';values[':base']=b.updatedAt;}else condition+=' AND attribute_not_exists(#base)';
 const scope={businessId:b.businessId,platformSuspended:b.platformSuspended===true,ordersBlocked:b.ordersBlocked===true,isActive:b.isActive===true};
 const tx=[ctx.guard(actor),{ConditionCheck:{TableName:'staging-AccountDeletion',Key:{pk:'BUSINESS_LIFECYCLE#MERCHANT#'+b.businessId,sk:'META'},ConditionExpression:'attribute_not_exists(pk)'}},{Update:{TableName:B,Key:{businessId:b.businessId},UpdateExpression:'SET '+sets.join(','),ConditionExpression:condition,ExpressionAttributeNames:names,ExpressionAttributeValues:values}},ctx.audit(actor.employeeId,'MERCHANT_'+input.action,scope,{...scope,...patch,reason:input.reason.trim()},b.businessId+'#'+patch.updatedAt)];
 try{await ctx.db.send(new TransactWriteCommand({TransactItems:tx}));}catch(e){if(e.name==='TransactionCanceledException')throw fail('VERSION_OR_STATE_CONFLICT',409);throw e;}
 return {saved:true,action:input.action,...patch};
}
module.exports={route,change};
