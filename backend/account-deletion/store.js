'use strict';
const {DynamoDBClient}=require('@aws-sdk/client-dynamodb');
const {DynamoDBDocumentClient,GetCommand,PutCommand,QueryCommand,UpdateCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {error}=require('./policy');
const {randomUUID}=require('node:crypto');
const key=(actor,id)=>({pk:`SUBJECT#${actor.type}#${actor.sub}`,sk:`REQUEST#${id}`});
function dynamoStore({table=process.env.DELETION_TABLE,db=DynamoDBDocumentClient.from(new DynamoDBClient({})),clock=()=>Math.floor(Date.now()/1000)}={}){
 if(!table||!table.startsWith('staging-'))throw error('INVALID_STAGING_TABLE');
 const actor=r=>({type:r.actorType,sub:r.subjectId});
 async function get(a,id){return (await db.send(new GetCommand({TableName:table,Key:key(a,id),ConsistentRead:true}))).Item;}
 async function createVerified(r,proof){
  if(!proof?.challengeId||!proof?.fingerprint)throw error('INVALID_VERIFICATION');
  if(proof.fingerprint!==r.fingerprint)throw error('INVALID_VERIFICATION');
  const time=clock(),a=actor(r),item={...key(a,r.requestId),...r,verification:{method:'PHONE_OTP',challengeId:proof.challengeId,verifiedAt:time}};
  // The OTP and request share a transaction. A crash cannot consume a proof without a receipt.
  await db.send(new TransactWriteCommand({TransactItems:[
   {Update:{TableName:table,Key:{pk:`CHALLENGE#${proof.challengeId}`,sk:'META'},UpdateExpression:'SET used = :yes',ConditionExpression:'purpose = :purpose AND subjectId = :subject AND actorType = :type AND fingerprint = :fp AND used = :no AND verifiedAt >= :recent AND expiresAt > :now',ExpressionAttributeValues:{':yes':true,':no':false,':purpose':'account-deletion',':subject':a.sub,':type':a.type,':fp':r.fingerprint,':recent':time-120,':now':time}}},
   {Put:{TableName:table,Item:item,ConditionExpression:'attribute_not_exists(pk)'}},
   {Put:{TableName:table,Item:{pk:item.pk,sk:`ACTIVE#${r.scope.kind}#${r.scope.id}`,requestId:r.requestId},ConditionExpression:'attribute_not_exists(pk)'}}
  ]}));return item;
 }
 async function update(r,patch){
  if(!Number.isSafeInteger(r.version))throw error('INVALID_VERSION');
  const item={...r,...patch,version:r.version+1};
  await db.send(new PutCommand({TableName:table,Item:item,ConditionExpression:'#v = :old'+(r.leaseOwner?' AND leaseOwner = :lease AND leaseUntil > :now':''),ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':old':r.version,...(r.leaseOwner?{':lease':r.leaseOwner,':now':clock()}:{})}}));return item;
 }
 async function steps(r){
  const all={};let cursor;
  do{const res=await db.send(new QueryCommand({TableName:table,KeyConditionExpression:'pk = :pk AND begins_with(sk,:prefix)',ExpressionAttributeValues:{':pk':key(actor(r),r.requestId).pk,':prefix':`STEP#${r.requestId}#`},ConsistentRead:true,ExclusiveStartKey:cursor}));for(const row of res.Items||[])all[row.step]={status:row.status};cursor=res.LastEvaluatedKey;}while(cursor);return all;
 }
 async function completeStep(r,step,at){
  if(!r.requiredSteps.includes(step))throw error('INVALID_STEP');
  const put={Put:{TableName:table,Item:{pk:key(actor(r),r.requestId).pk,sk:`STEP#${r.requestId}#${step}`,requestId:r.requestId,step,status:'COMPLETED',completedAt:at}}};
  if(!r.leaseOwner)throw error('LEASE_REQUIRED');
  await db.send(new TransactWriteCommand({TransactItems:[{ConditionCheck:{TableName:table,Key:key(actor(r),r.requestId),ConditionExpression:'#v = :v AND leaseOwner = :lease AND leaseUntil > :now',ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':v':r.version,':lease':r.leaseOwner,':now':clock()}}},put]}));
 }
 async function acquireLease(r){
  const result=await db.send(new UpdateCommand({TableName:table,Key:key(actor(r),r.requestId),UpdateExpression:'SET leaseOwner = :owner, leaseUntil = :until ADD #v :one',ConditionExpression:'#v = :old AND (attribute_not_exists(leaseUntil) OR leaseUntil <= :now)',ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':owner':randomUUID(),':until':clock()+180,':old':r.version,':now':clock(),':one':1},ReturnValues:'ALL_NEW'}));return result.Attributes;
 }
 async function renewLease(r){
  const result=await db.send(new UpdateCommand({TableName:table,Key:key(actor(r),r.requestId),UpdateExpression:'SET leaseUntil = :until ADD #v :one',ConditionExpression:'#v = :old AND leaseOwner = :owner AND leaseUntil > :now',ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':until':clock()+180,':owner':r.leaseOwner,':old':r.version,':now':clock(),':one':1},ReturnValues:'ALL_NEW'}));return result.Attributes;
 }
 async function releaseLease(r){
  if(!r?.leaseOwner)return;
  try{await db.send(new UpdateCommand({TableName:table,Key:key(actor(r),r.requestId),UpdateExpression:'REMOVE leaseOwner, leaseUntil ADD #v :one',ConditionExpression:'leaseOwner = :owner',ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':owner':r.leaseOwner,':one':1}}));}catch(e){if(e.name!=='ConditionalCheckFailedException')throw e;}
 }

 return {get,createVerified,update,steps,completeStep,acquireLease,renewLease,releaseLease};
}
module.exports={dynamoStore};
