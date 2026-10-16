'use strict';
const {GetCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {error}=require('./policy');
function driverLock({db,table='staging-AccountDeletion',verifiedMutationGuards=false,clock=()=>Math.floor(Date.now()/1000)}){
 if(table!=='staging-AccountDeletion')throw error('INVALID_STAGING_TABLE');
 return async(r,e,manifest)=>{
  if(!verifiedMutationGuards)throw error('MUTATION_GUARDS_NOT_VERIFIED');
  if(r.actorType!=='DRIVER'||r.scope.kind!=='ACCOUNT'||r.scope.id!==r.subjectId||!r.leaseOwner||manifest.subjectId!==r.subjectId||manifest.requestId!==r.requestId)throw error('INVALID_LOCK_CONTEXT');
  if(!e.complete||e.activeOrders.length||e.activeHolds.length||e.pendingTransfers.length||e.pendingPayments?.length||e.wallets.some(w=>w.available!==0||w.locked!==0))throw error('SETTLEMENT_REQUIRED');
  const profiles=[];
  for(const id of e.profileIds){
   const {Item:p}=await db.send(new GetCommand({TableName:'WhizzDrivers_staging',Key:{driverId:id},ConsistentRead:true}));
   if(!p||p.driverId!==id||(id!==r.subjectId&&p.cognitoSub!==r.subjectId)||(p.cognitoSub&&p.cognitoSub!==r.subjectId))throw error('PROFILE_BINDING_CHANGED');
   if(p.legalHold===true||p.retentionHold===true)throw error('DOCUMENTED_RETENTION_HOLD');
   const values={':request':r.requestId,':no':false,':closed':'SUSPENDED'},names={'#s':'status'};
   let condition='attribute_exists(driverId) AND (attribute_not_exists(deletionRequestId) OR deletionRequestId = :request)';
   for(const field of ['cognitoSub','updatedAt','status','drivingLicenseUrl','registrationPaperUrl','nationalIdUrl','legalHold','retentionHold']){
    names['#'+field]=field;
    if(p[field]!==undefined){values[':'+field]=p[field];condition+=' AND #'+field+' = :'+field;}
    else condition+=' AND attribute_not_exists(#'+field+')';
   }
   profiles.push({Update:{TableName:'WhizzDrivers_staging',Key:{driverId:id},UpdateExpression:'SET #s = :closed, isActive = :no, isOnline = :no, deletionRequestId = :request',ConditionExpression:condition,ExpressionAttributeNames:names,ExpressionAttributeValues:values}});
  }
  const wallets=e.wallets.map(w=>{
   if(w.source!=='CORE'||!e.profileIds.includes(w.ownerId))throw error('WALLET_BINDING_CHANGED');
   return {Update:{TableName:'staging-Wallets',Key:{walletId:w.walletId,sk:'META'},UpdateExpression:'SET #s = :closing, deletionRequestId = :id ADD #v :one',ConditionExpression:'#v = :version AND ownerId = :owner AND ownerType = :type AND availableBalance = :zero AND lockedBalance = :zero AND currency = :iqd AND #s = :active AND attribute_not_exists(deletionRequestId)',ExpressionAttributeNames:{'#s':'status','#v':'version'},ExpressionAttributeValues:{':closing':'SUSPENDED',':active':'ACTIVE',':id':r.requestId,':owner':w.ownerId,':type':'DRIVER',':one':1,':version':w.version,':zero':0,':iqd':'IQD'}}};
  });
  if(!e.wallets.some(w=>w.ownerId===r.subjectId)){
   const walletId='WALLET#DRIVER#'+r.subjectId,zero={walletId,ownerId:r.subjectId,source:'CORE',available:0,locked:0,version:1};
   manifest={...manifest,wallets:[...manifest.wallets,zero],walletIds:[...manifest.walletIds,walletId]};
   wallets.push({Put:{TableName:'staging-Wallets',Item:{walletId,sk:'META',ownerId:r.subjectId,ownerType:'DRIVER',currency:'IQD',status:'SUSPENDED',availableBalance:0,lockedBalance:0,minRequiredBalance:0,version:1,deletionRequestId:r.requestId},ConditionExpression:'attribute_not_exists(walletId)'}});
  }
  const tx=[{Put:{TableName:table,Item:{...r,job:manifest,status:'PROCESSING',blockers:[],version:r.version+1},ConditionExpression:'#v = :v AND leaseOwner = :lease AND leaseUntil > :now',ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':v':r.version,':lease':r.leaseOwner,':now':clock()}}},{Put:{TableName:table,Item:{pk:'ACCOUNT_LIFECYCLE#DRIVER#'+r.subjectId,sk:'META',subjectId:r.subjectId,requestId:r.requestId,state:'CLOSING'},ConditionExpression:'attribute_not_exists(pk)'}},...profiles,...wallets];
  if(tx.length>100)throw error('LOCK_TOO_LARGE');
  await db.send(new TransactWriteCommand({TransactItems:tx}));return manifest;
 };
}
module.exports={driverLock};
