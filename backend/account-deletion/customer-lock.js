'use strict';
const {GetCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {error}=require('./policy');
const {customerPhoneClosureKey}=require('./customer-phone-binding');
// This is the durable, conditional fence only. It is not enabled until the mutation
// services also enforce the same profile/wallet lifecycle markers.
function customerLock({db,table,verifiedMutationGuards=false,clock=()=>Math.floor(Date.now()/1000),environment='staging'}){
 const production=environment==='production';
 if(production&&table!=='wizz-production-AccountDeletion')throw error('INVALID_PRODUCTION_TABLE');
 if(!production&&environment!=='staging')throw error('INVALID_STAGING_TABLE');
 const profilesTable=production?'wizz-production-Customers':'WizzUser_users_staging';
 const walletsTable=production?'wizz-production-Wallets':'staging-Wallets';
 return async(request,evidence,manifest)=>{
  if(!verifiedMutationGuards)throw error('MUTATION_GUARDS_NOT_VERIFIED');
  if(request.actorType!=='CUSTOMER'||!request.leaseOwner||!manifest||manifest.subjectId!==request.subjectId)throw error('INVALID_LOCK_CONTEXT');
  if(!evidence.complete||evidence.activeOrders.length||evidence.activeHolds.length||evidence.pendingTransfers.length||evidence.pendingPayments?.length||evidence.wallets.some(w=>w.available!==0||w.locked!==0))throw error('SETTLEMENT_REQUIRED');
  if(production&&(request.scope?.kind!=='ACCOUNT'||request.scope.id!==request.subjectId||
     manifest.requestId!==request.requestId||manifest.identity?.username!==request.subjectId||evidence.profileIds.some(id=>id!==request.subjectId)||
     evidence.wallets.length>1||evidence.wallets.some(w=>w.source!=='CORE'||w.walletId!=='WALLET#CUSTOMER#'+request.subjectId))){
   throw error('INVALID_LOCK_CONTEXT');
  }
  const snapshots=[];
  for(const id of evidence.profileIds){const {Item}=await db.send(new GetCommand({TableName:profilesTable,Key:{userId:id},ConsistentRead:true}));if(!Item)throw error('PROFILE_NOT_FOUND');snapshots.push(Item);}
  const profiles=snapshots.map(p=>{
   if(p.userId!==request.subjectId&&p.cognitoSub!==request.subjectId&&p.cognitoUsername!==manifest.username&&(!manifest.email||p.cognitoUsername!==manifest.email))throw error('PROFILE_BINDING_CHANGED');
   const values={':no':false,':yes':true,':id':request.requestId},names={'#active':'isActive'};
   let condition='attribute_exists(userId) AND (attribute_not_exists(deletionRequestId) OR deletionRequestId = :id)';
   if(p.cognitoSub){condition+=' AND cognitoSub = :sub';values[':sub']=request.subjectId;}
   else if(p.cognitoUsername){condition+=' AND cognitoUsername = :username';values[':username']=p.cognitoUsername;}
   else if(p.userId!==request.subjectId)throw error('PROFILE_BINDING_REQUIRED');
   condition+=' AND (attribute_not_exists(#active) OR #active = :yes OR deletionRequestId = :id)';
   return {Update:{TableName:profilesTable,Key:{userId:p.userId},UpdateExpression:'SET #active = :no, deletionRequestId = :id',ConditionExpression:condition,ExpressionAttributeNames:names,ExpressionAttributeValues:values}};
  });
  if(production&&snapshots.some(p=>p.cognitoSub!==request.subjectId))throw error('PROFILE_BINDING_CHANGED');
  if(production&&evidence.profileIds.length===0){
   profiles.push({ConditionCheck:{TableName:profilesTable,Key:{userId:request.subjectId},
    ConditionExpression:'attribute_not_exists(userId)'}});
  }
  const wallets=evidence.wallets.map(w=>{
   if(w.source==='CORE')return {Update:{TableName:walletsTable,Key:{walletId:w.walletId,sk:'META'},UpdateExpression:'SET #s = :closing, deletionRequestId = :id ADD #v :one',ConditionExpression:'#v = :version AND ownerId = :owner AND ownerType = :type AND availableBalance = :zero AND lockedBalance = :zero AND currency = :iqd AND (#s = :active OR deletionRequestId = :id)',ExpressionAttributeNames:{'#s':'status','#v':'version'},ExpressionAttributeValues:{':closing':'SUSPENDED',':active':'ACTIVE',':id':request.requestId,':owner':request.subjectId,':type':'CUSTOMER',':one':1,':version':w.version,':zero':0,':iqd':'IQD'}}};
   if(!evidence.profileIds.includes(w.ownerId)&&w.ownerId!==request.subjectId)throw error('WALLET_BINDING_CHANGED');
   return {Update:{TableName:'WizzUser_wallets_staging',Key:{walletId:w.walletId},UpdateExpression:'SET #s = :closing, deletionRequestId = :id',ConditionExpression:'userId = :owner AND balance = :zero AND currency = :iqd AND (#s = :active OR deletionRequestId = :id)',ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':closing':'SUSPENDED',':active':'ACTIVE',':id':request.requestId,':owner':w.ownerId,':zero':0,':iqd':'IQD'}}};
  });
  if(!evidence.wallets.some(w=>w.source==='CORE')){
   const walletId='WALLET#CUSTOMER#'+request.subjectId;
   if(production){
    wallets.push({ConditionCheck:{TableName:walletsTable,Key:{walletId,sk:'META'},
     ConditionExpression:'attribute_not_exists(walletId)'}});
   }else{
    const zero={walletId,source:'CORE',available:0,locked:0,version:1};
    manifest={...manifest,wallets:[...manifest.wallets,zero],walletIds:[...manifest.walletIds,walletId]};
    wallets.push({Put:{TableName:walletsTable,Item:{walletId,sk:'META',ownerId:request.subjectId,ownerType:'CUSTOMER',currency:'IQD',status:'SUSPENDED',availableBalance:0,lockedBalance:0,minRequiredBalance:0,version:1,deletionRequestId:request.requestId},ConditionExpression:'attribute_not_exists(walletId)'}});
   }
  }
  const item={...request,job:manifest,status:'PROCESSING',blockers:[],version:request.version+1};
  const now=clock();
  const phoneLock=production?[{Put:{TableName:table,
   Item:{...customerPhoneClosureKey(manifest.identity.phone),requestId:request.requestId,subjectId:request.subjectId,lockedAt:now},
   ConditionExpression:'attribute_not_exists(pk)'},
  }]:[];
  const tx=[{Put:{TableName:table,Item:item,ConditionExpression:'#v = :version AND leaseOwner = :lease AND leaseUntil > :now',ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':version':request.version,':lease':request.leaseOwner,':now':now}}},
   {Put:{TableName:table,Item:{pk:'ACCOUNT_LIFECYCLE#CUSTOMER#'+request.subjectId,sk:'META',state:'CLOSING',requestId:request.requestId,subjectId:request.subjectId,...(production?{lockedAt:now}:{})},ConditionExpression:'attribute_not_exists(pk) OR requestId = :id',ExpressionAttributeValues:{':id':request.requestId}}},...phoneLock,...profiles,...wallets];
  if(tx.length>100)throw error('LOCK_TOO_LARGE');
  await db.send(new TransactWriteCommand({TransactItems:tx}));return manifest;
 };
}
module.exports={customerLock};
