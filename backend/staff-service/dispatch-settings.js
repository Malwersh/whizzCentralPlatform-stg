'use strict';
const PK='OPERATIONAL_SETTINGS#DELIVERY_OPERATIONS',PATH='/staff/settings/delivery-operations';
const {OPERATIONS_LIMITS:limits,validateOperationsValues:validate}=require('./dispatch-settings-contract');
const {GetCommand}=require('@aws-sdk/lib-dynamodb');
async function route(ctx,actor,method,path,input){
 if(actor.scope?.allRegions!==true)throw Object.assign(Error('PERMISSION_REQUIRED'),{status:403});
 // Preserve schema on requests and approvals from cached five-field clients.
 // Policy publication never changes runtime activation gates.
 const request=method==='POST'&&path===PATH+'/request';
 const approve=method==='POST'&&path===PATH+'/approve';
 if((request&&ctx.allowed(actor,'settings.change.request'))||(approve&&ctx.allowed(actor,'settings.change.approve'))){
  const current=(await ctx.db.send(new GetCommand({TableName:ctx.table,Key:{pk:PK,sk:'CURRENT'},ConsistentRead:true}))).Item;
  if(request&&current?.values?.dispatch&&!Object.prototype.hasOwnProperty.call(input?.values||{},'dispatch'))throw Object.assign(Error('DISPATCH_POLICY_REQUIRED'),{status:409});
  const change=approve&&typeof input?.changeId==='string'?(await ctx.db.send(new GetCommand({TableName:ctx.table,Key:{pk:PK,sk:'CHANGE#'+input.changeId},ConsistentRead:true}))).Item:null;
  if(approve&&current?.values?.dispatch&&!change?.values?.dispatch)throw Object.assign(Error('DISPATCH_POLICY_REQUIRED'),{status:409});
 }
 const result=await require('./operational-settings').route({...ctx,allowed:(person,permission)=>person.scope?.allRegions===true&&ctx.allowed(person,permission),settingsSpec:{pk:PK,validate,actionPrefix:'DELIVERY_OPERATIONS'}},actor,method,path.replace(PATH,'/staff/settings/account-deletion'),input);
 return {...result,requiresDispatchEditor:!!result.current?.values?.dispatch,dispatchSchemaVersion:2,limits,effectiveFor:'NEW_QUOTES_OFFERS_AND_SEARCH_WINDOWS',activationManagedSeparately:true};
}
module.exports={PK,PATH,limits,validate,route};
