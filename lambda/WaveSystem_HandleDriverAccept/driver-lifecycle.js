'use strict';
const {AsyncLocalStorage}=require('node:async_hooks');
const {TransactWriteCommand,GetCommand}=require('@aws-sdk/lib-dynamodb');
const context=new AsyncLocalStorage();
const writeNames=new Set(['PutCommand','UpdateCommand','DeleteCommand']);
function driverLifecycleClient(raw){
 return {send:async command=>{
  const name=command.constructor.name,scope=context.getStore();
  if(!writeNames.has(name)&&name!=='TransactWriteCommand')return raw.send(command);
  if(!scope?.sub)throw Object.assign(Error('AUTHENTICATED_WRITE_REQUIRED'),{code:'AUTHENTICATED_WRITE_REQUIRED'});
  const fence={ConditionCheck:{TableName:'staging-AccountDeletion',Key:{pk:'ACCOUNT_LIFECYCLE#DRIVER#'+scope.sub,sk:'META'},ConditionExpression:'attribute_not_exists(pk)'}};
  if(name==='TransactWriteCommand')return raw.send(new TransactWriteCommand({...command.input,TransactItems:[fence,...command.input.TransactItems]}));
  if(command.input.ReturnValues&&!['NONE','ALL_NEW'].includes(command.input.ReturnValues))throw Error('UNSUPPORTED_GUARDED_RETURN_VALUES');
  const op=name.slice(0,-7),input={...command.input};delete input.ReturnValues;
  const result=await raw.send(new TransactWriteCommand({TransactItems:[fence,{[op]:input}]}));
  if(command.input.ReturnValues==='ALL_NEW'){
   const read=await raw.send(new GetCommand({TableName:input.TableName,Key:input.Key,ConsistentRead:true}));
   if(!read.Item)throw Error('STATE_CHANGED_AFTER_WRITE');
   return {...result,Attributes:read.Item};
  }
  return result;
 }};
}
module.exports={driverRequestContext:context,driverLifecycleClient};
