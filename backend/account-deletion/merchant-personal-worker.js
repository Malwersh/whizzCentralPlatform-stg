'use strict';
const {GetCommand,ScanCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {AdminGetUserCommand,AdminDisableUserCommand,AdminUserGlobalSignOutCommand,AdminDeleteUserCommand}=require('@aws-sdk/client-cognito-identity-provider');
const {DeleteConnectionCommand}=require('@aws-sdk/client-apigatewaymanagementapi');
const {merchantEvidence}=require('./merchant-evidence'),{coordinator}=require('./coordinator'),{dynamoStore}=require('./store'),{retentionSettings}=require('./settings'),{error}=require('./policy');
const POOL='us-east-1_gtCR3ndzT';
function createMerchantPersonalWorker({db,cognito,connections,verifiedMutationGuards=false,requestTable='staging-AccountDeletion',settings}){
 const store=dynamoStore({db,table:requestTable}),evidence=merchantEvidence({db});
 async function rows(table,optional=false){let all=[],cursor;do{let p;try{p=await db.send(new ScanCommand({TableName:table,ConsistentRead:true,ExclusiveStartKey:cursor}));}catch(e){if(optional&&e.name==='ResourceNotFoundException')return [];throw e;}all.push(...p.Items||[]);cursor=p.LastEvaluatedKey;}while(cursor);return all;}
 const fence=r=>({ConditionCheck:{TableName:requestTable,Key:{pk:r.pk,sk:r.sk},ConditionExpression:'leaseOwner=:lease AND leaseUntil>:now AND #v=:v AND #s=:processing',ExpressionAttributeNames:{'#v':'version','#s':'status'},ExpressionAttributeValues:{':lease':r.leaseOwner,':now':Math.floor(Date.now()/1000),':v':r.version,':processing':'PROCESSING'}}});
 async function lease(r){const {Item:p}=await db.send(new GetCommand({TableName:requestTable,Key:{pk:r.pk,sk:r.sk},ConsistentRead:true}));if(p?.leaseOwner!==r.leaseOwner||p.version!==r.version||p.leaseUntil<=Date.now()/1000)throw error('LEASE_LOST');}
 async function remove(r,table,row,keys,ownerField){if(row.legalHold||row.retentionHold)throw error('DOCUMENTED_RETENTION_HOLD');await db.send(new TransactWriteCommand({TransactItems:[fence(r),{Delete:{TableName:table,Key:Object.fromEntries(keys.map(k=>[k,row[k]])),ConditionExpression:'#owner=:owner AND (attribute_not_exists(legalHold) OR legalHold=:no) AND (attribute_not_exists(retentionHold) OR retentionHold=:no)',ExpressionAttributeNames:{'#owner':ownerField},ExpressionAttributeValues:{':owner':row[ownerField],':no':false}}}]}));}
 const steps=s=>s.kind==='ACCOUNT'?['disableIdentity','memberships','personalData','identityClosure']:['memberships'];
 const adapter={evidence,requiredSteps:steps,async lock(r,e,policy){
  if(e.ownedBusinesses?.length)throw error('OWNED_BUSINESSES');
  if(policy.documentRetentionDays||policy.locationRetentionDays||policy.supportRetentionDays)throw error('RETENTION_ADAPTER_NOT_READY');
  const marker=r.scope.kind==='ACCOUNT'?{pk:'ACCOUNT_LIFECYCLE#MERCHANT#'+r.subjectId,sk:'META'}:{pk:'MEMBERSHIP_LIFECYCLE#MERCHANT#'+r.scope.id+'#'+r.subjectId,sk:'META'};
  const job={subjectId:r.subjectId,requestId:r.requestId,pool:POOL,scope:r.scope,policyVersion:r.policyVersion};
  const tx=[{Put:{TableName:requestTable,Item:{...r,job,status:'PROCESSING',blockers:[],version:r.version+1},ConditionExpression:'#v=:v AND leaseOwner=:lease AND leaseUntil>:now',ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':v':r.version,':lease':r.leaseOwner,':now':Math.floor(Date.now()/1000)}}},{Put:{TableName:requestTable,Item:{...marker,subjectId:r.subjectId,requestId:r.requestId,state:'CLOSING'},ConditionExpression:'attribute_not_exists(pk)'}}];
  if(r.scope.kind==='MEMBERSHIP'){
   if(!e.isMember||!e.membership?.ownerId||!Number.isSafeInteger(e.membership.version))throw error('MEMBERSHIP_REQUIRED');
   tx.push({ConditionCheck:{TableName:'WhizzMerchants_Businesses',Key:{businessId:r.scope.id},ConditionExpression:'ownerId=:owner AND (attribute_not_exists(cognitoUserId) OR cognitoUserId=:owner) AND attribute_not_exists(deletionRequestId)',ExpressionAttributeValues:{':owner':e.membership.ownerId}}});
   tx.push({Update:{TableName:'staging-IdempotencyKeys',Key:{idempotencyKey:'MERCHANT_FINANCE#'+r.scope.id+'#'+r.subjectId,sk:'META'},UpdateExpression:'SET enabled=:no, deletionRequestId=:request',ConditionExpression:'memberId=:member AND ownerId=:owner AND #v=:version AND enabled=:yes',ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':no':false,':yes':true,':request':r.requestId,':member':r.subjectId,':owner':e.membership.ownerId,':version':e.membership.version}}});
  }

  await db.send(new TransactWriteCommand({TransactItems:tx}));return job;
 },async execute(step,r,job){
  if(job.subjectId!==r.subjectId||job.requestId!==r.requestId||job.pool!==POOL)throw error('INVALID_CLEANUP_SCOPE');
  if(step==='disableIdentity'||step==='identityClosure'){
   if(r.scope.kind!=='ACCOUNT')throw error('INVALID_CLEANUP_SCOPE');await lease(r);
   try{const u=await cognito.send(new AdminGetUserCommand({UserPoolId:POOL,Username:r.subjectId}));if(!u.UserAttributes?.some(a=>a.Name==='sub'&&a.Value===r.subjectId))throw error('IDENTITY_GENERATION_CHANGED');if(step==='disableIdentity'){await cognito.send(new AdminDisableUserCommand({UserPoolId:POOL,Username:r.subjectId}));await cognito.send(new AdminUserGlobalSignOutCommand({UserPoolId:POOL,Username:r.subjectId}));}else await cognito.send(new AdminDeleteUserCommand({UserPoolId:POOL,Username:r.subjectId}));}catch(e){if(e.name!=='UserNotFoundException')throw e;}return;
  }
  if(step==='memberships'){
   for(const row of await rows('staging-IdempotencyKeys'))if(row.memberId===r.subjectId&&row.idempotencyKey?.startsWith('MERCHANT_FINANCE#')&&(r.scope.kind==='ACCOUNT'||row.idempotencyKey==='MERCHANT_FINANCE#'+r.scope.id+'#'+r.subjectId))await remove(r,'staging-IdempotencyKeys',row,['idempotencyKey','sk'],'memberId');return;
  }
  if(step==='personalData'){
   if(r.scope.kind!=='ACCOUNT')throw error('INVALID_CLEANUP_SCOPE');
   for(const row of await rows('WhizzMerchants_Users',true)){const owner=['userId','cognitoSub','cognitoUserId'].find(k=>row[k]===r.subjectId);if(owner)await remove(r,'WhizzMerchants_Users',row,['userId'],owner);}
   for(const row of await rows('WizzCentral_PushDeviceTokens_staging'))if(row.subjectId===r.subjectId&&row.app==='merchant')await remove(r,'WizzCentral_PushDeviceTokens_staging',row,['token'],'subjectId');
   for(const row of await rows('WizzUser_websocket_connections_staging'))if(row.userId===r.subjectId){await lease(r);try{await connections.send(new DeleteConnectionCommand({ConnectionId:row.connectionId}));}catch(e){if(e.name!=='GoneException'&&e.$metadata?.httpStatusCode!==410)throw e;}await remove(r,'WizzUser_websocket_connections_staging',row,['connectionId'],'userId');}
   for(const row of await rows('WizzUser_websocket_subscriptions_staging'))if(row.userId===r.subjectId)await remove(r,'WizzUser_websocket_subscriptions_staging',row,['subscriptionId'],'userId');return;
  }
  throw error('INVALID_CLEANUP_STEP');
 }};
 const service=coordinator({store,adapters:{MERCHANT:adapter},settings:settings||retentionSettings({db,table:'staging-PlatformStaff',approvedInventories:new Set(verifiedMutationGuards?['MERCHANT']:[])})});
 async function finishMembership(r,result){
  if(r.scope.kind!=='MEMBERSHIP'||result.status!=='COMPLETED')return result;
  const keys=[{pk:'MEMBERSHIP_LIFECYCLE#MERCHANT#'+r.scope.id+'#'+r.subjectId,sk:'META'},{pk:r.pk,sk:'ACTIVE#MEMBERSHIP#'+r.scope.id}],deletes=[];
  for(const key of keys){const {Item:item}=await db.send(new GetCommand({TableName:requestTable,Key:key,ConsistentRead:true}));if(item?.requestId===r.requestId)deletes.push({Delete:{TableName:requestTable,Key:key,ConditionExpression:'requestId=:id',ExpressionAttributeValues:{':id':r.requestId}}});}
  if(deletes.length)await db.send(new TransactWriteCommand({TransactItems:[{ConditionCheck:{TableName:requestTable,Key:{pk:r.pk,sk:r.sk},ConditionExpression:'#s=:done',ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':done':'COMPLETED'}}},...deletes]}));return result;
 }
 return {async process(subjectId,id){if(!verifiedMutationGuards)throw error('MUTATION_GUARDS_NOT_VERIFIED');let r=await store.get({type:'MERCHANT',sub:subjectId},id);if(!r||!['ACCOUNT','MEMBERSHIP'].includes(r.scope.kind))throw error('INVALID_CLEANUP_SCOPE');if(r.status==='COMPLETED')return finishMembership(r,await service.process({type:'MERCHANT',sub:subjectId},id));if(!r.job&&JSON.stringify(r.requiredSteps)!==JSON.stringify(steps(r.scope))){if(Object.keys(await store.steps(r)).length||r.leaseOwner)throw error('REQUEST_SCHEMA_MIGRATION_REQUIRED');r=await store.update(r,{requiredSteps:steps(r.scope)});}return finishMembership(r,await service.process({type:'MERCHANT',sub:subjectId},id));}};
}
module.exports={createMerchantPersonalWorker};
