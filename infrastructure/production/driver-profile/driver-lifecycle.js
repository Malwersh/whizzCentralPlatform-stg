'use strict';
const {AsyncLocalStorage}=require('node:async_hooks');
const {randomUUID}=require('node:crypto');
const {TransactWriteCommand,GetCommand,PutCommand,DeleteCommand}=require('@aws-sdk/lib-dynamodb');
const context=new AsyncLocalStorage();
const writeNames=new Set(['PutCommand','UpdateCommand','DeleteCommand']);
function driverLifecycleClient(raw){
 return {send:async command=>{
  const name=command.constructor.name,scope=context.getStore();
  if(!writeNames.has(name)&&name!=='TransactWriteCommand')return raw.send(command);
  if(!scope?.sub)throw Object.assign(Error('AUTHENTICATED_WRITE_REQUIRED'),{code:'AUTHENTICATED_WRITE_REQUIRED'});
  const fence={ConditionCheck:{TableName:'wizz-production-AccountDeletion',Key:{pk:'ACCOUNT_LIFECYCLE#DRIVER#'+scope.sub,sk:'META'},ConditionExpression:'attribute_not_exists(pk)'}};
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
async function beginDriverUpload(raw,subjectId){
 if(context.getStore()?.sub!==subjectId)throw Error('UPLOAD_SUBJECT_MISMATCH');
 const operationId=randomUUID(),key={pk:'ACCOUNT_OPERATION#DRIVER#'+subjectId,sk:'UPLOAD#'+operationId};
 // The worker first closes the lifecycle fence, then waits for every registered
 // external write to finish before inventorying and deleting the S3 prefix.
 await driverLifecycleClient(raw).send(new PutCommand({TableName:'wizz-production-AccountDeletion',Item:{...key,subjectId,operationId,kind:'DOCUMENT_UPLOAD',startedAt:Math.floor(Date.now()/1000),expiresAt:Math.floor(Date.now()/1000)+3600},ConditionExpression:'attribute_not_exists(pk)'}));
 return async()=>raw.send(new DeleteCommand({TableName:'wizz-production-AccountDeletion',Key:key,ConditionExpression:'subjectId = :sub AND operationId = :id',ExpressionAttributeValues:{':sub':subjectId,':id':operationId}}));
}
module.exports={driverRequestContext:context,driverLifecycleClient,beginDriverUpload};
