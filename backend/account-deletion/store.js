'use strict';
const {DynamoDBClient}=require('@aws-sdk/client-dynamodb');
const {DynamoDBDocumentClient,GetCommand,PutCommand,QueryCommand,UpdateCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {error}=require('./policy');
const {randomUUID}=require('node:crypto');
const key=(actor,id)=>({pk:`SUBJECT#${actor.type}#${actor.sub}`,sk:`REQUEST#${id}`});
function dynamoStore({table=process.env.DELETION_TABLE,db=DynamoDBDocumentClient.from(new DynamoDBClient({})),clock=()=>Math.floor(Date.now()/1000),environment='staging'}={}){
 const production=environment==='production';
 if(production){
  if(table!=='wizz-production-AccountDeletion')throw error('INVALID_PRODUCTION_TABLE');
 }else if(environment!=='staging'||!table?.startsWith('staging-'))throw error('INVALID_STAGING_TABLE');
 const businessTable=production?'wizz-production-Merchants':'WhizzMerchants_Businesses';
 const actor=r=>({type:r.actorType,sub:r.subjectId});
 async function get(a,id){return (await db.send(new GetCommand({TableName:table,Key:key(a,id),ConsistentRead:true}))).Item;}
 async function createVerified(r,proof,affectedBranches=[]){
  if(!proof?.challengeId||!proof?.fingerprint)throw error('INVALID_VERIFICATION');
  if(proof.fingerprint!==r.fingerprint)throw error('INVALID_VERIFICATION');
  const time=clock(),a=actor(r),item={...key(a,r.requestId),...r,verification:{method:'PHONE_OTP',challengeId:proof.challengeId,verifiedAt:time}};
  const branchIds=[...new Set(affectedBranches)];
  const proofGuard=production?[{ConditionCheck:{
   TableName:table,Key:{pk:`VERIFY_ACTIVE#${a.type}#${a.sub}`,sk:'META'},
   ConditionExpression:'challengeId = :id AND expiresAt > :now',
   ExpressionAttributeValues:{':id':proof.challengeId,':now':time},
  }}]:[];
  if(branchIds.length>97-proofGuard.length)throw error('DELETION_SCOPE_EXCEEDS_TRANSACTION_LIMIT');
  if(production&&branchIds.length&&(a.type!=='MERCHANT'||!['ACCOUNT','BUSINESS'].includes(r.scope.kind)||
     r.scope.kind==='BUSINESS'&&(branchIds.length!==1||branchIds[0]!==r.scope.id))){
   throw error('INVALID_SCOPE');
  }
  let parentLock;
  const parentKey={pk:item.pk,sk:`ACTIVE#ACCOUNT#${r.subjectId}`};
  if(production&&r.scope.kind==='BUSINESS'&&branchIds.length){
   const parent=(await db.send(new GetCommand({TableName:table,Key:parentKey,ConsistentRead:true}))).Item;
   if(parent?.requestId)parentLock=parent.requestId;
  }
  const parentGuard=parentLock?[{ConditionCheck:{TableName:table,Key:parentKey,
   ConditionExpression:'requestId=:parent',ExpressionAttributeValues:{':parent':parentLock}}}]:[];
  const branchUpdates=[];
  for(const businessId of branchIds){
   if(production&&r.scope.kind==='ACCOUNT'){
    const childKey={pk:item.pk,sk:'ACTIVE#BUSINESS#'+businessId};
    const child=(await db.send(new GetCommand({TableName:table,Key:childKey,ConsistentRead:true}))).Item;
    if(child?.requestId){
     const closure=await get(a,child.requestId);
     if(closure?.subjectId!==r.subjectId||closure.actorType!=='MERCHANT'||
        closure.scope?.kind!=='BUSINESS'||closure.scope.id!==businessId||
        ['COMPLETED','CANCELLED'].includes(closure.status))throw error('REQUEST_CONFLICT');
     branchUpdates.push(
      {ConditionCheck:{TableName:table,Key:childKey,ConditionExpression:'requestId=:child',
       ExpressionAttributeValues:{':child':closure.requestId}}},
      {ConditionCheck:{TableName:businessTable,Key:{businessId},
       ConditionExpression:'ownerId=:owner AND cognitoUserId=:owner AND attribute_not_exists(deletedAt) AND orderIntakeDeletionRequestId=:child',
       ExpressionAttributeValues:{':child':closure.requestId,':owner':r.subjectId}}}
     );
     continue;
    }
   }
   branchUpdates.push({Update:{
   TableName:businessTable,Key:{businessId},
   UpdateExpression:'SET orderIntakeDeletionRequestId=:request',
   ConditionExpression:(production?'ownerId=:owner AND cognitoUserId=:owner AND attribute_not_exists(deletedAt) AND attribute_not_exists(deletionRequestId)':
    '(ownerId=:owner OR attribute_not_exists(ownerId)) AND (cognitoUserId=:owner OR attribute_not_exists(cognitoUserId)) AND (ownerId=:owner OR cognitoUserId=:owner)')+
    ' AND (attribute_not_exists(orderIntakeTransferExpiresAt) OR orderIntakeTransferExpiresAt<=:now)'+
    (parentLock?' AND (attribute_not_exists(orderIntakeDeletionRequestId) OR orderIntakeDeletionRequestId=:parent)':
     production||r.scope.kind==='ACCOUNT'?' AND attribute_not_exists(orderIntakeDeletionRequestId)':''),
   ExpressionAttributeValues:{':request':r.requestId,':owner':r.subjectId,':now':time*1000,
    ...(parentLock?{':parent':parentLock}:{})},
   }});
  }
  if(3+proofGuard.length+parentGuard.length+branchUpdates.length>100)throw error('DELETION_SCOPE_EXCEEDS_TRANSACTION_LIMIT');
  // The OTP and request share a transaction. A crash cannot consume a proof without a receipt.
  await db.send(new TransactWriteCommand({TransactItems:[
   {Update:{TableName:table,Key:{pk:`CHALLENGE#${proof.challengeId}`,sk:'META'},UpdateExpression:'SET used = :yes',ConditionExpression:'purpose = :purpose AND subjectId = :subject AND actorType = :type AND fingerprint = :fp AND used = :no AND verifiedAt >= :recent AND expiresAt > :now',ExpressionAttributeValues:{':yes':true,':no':false,':purpose':'account-deletion',':subject':a.sub,':type':a.type,':fp':r.fingerprint,':recent':time-120,':now':time}}},
   {Put:{TableName:table,Item:item,ConditionExpression:'attribute_not_exists(pk)'}},
   {Put:{TableName:table,Item:{pk:item.pk,sk:`ACTIVE#${r.scope.kind}#${r.scope.id}`,requestId:r.requestId},ConditionExpression:'attribute_not_exists(pk)'}},
   ...proofGuard,...parentGuard,...branchUpdates
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
