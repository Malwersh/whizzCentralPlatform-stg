'use strict';
const {GetCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {error}=require('./policy');
function merchantBusinessLock({db,verifiedMutationGuards=false,clock=()=>Math.floor(Date.now()/1000)}){
 return async(r,e,manifest)=>{
  if(!verifiedMutationGuards)throw error('MUTATION_GUARDS_NOT_VERIFIED');
  if(r.actorType!=='MERCHANT'||r.scope.kind!=='BUSINESS'||!r.leaseOwner||manifest.subjectId!==r.subjectId||manifest.businessId!==r.scope.id||manifest.requestId!==r.requestId)throw error('INVALID_LOCK_CONTEXT');
  if(!e.complete||!e.isOwner||e.activeOrders.length||e.activeHolds.length||e.pendingTransfers.length||e.pendingPayments?.length||e.wallets.some(w=>w.available||w.locked))throw error('SETTLEMENT_REQUIRED');
  const table='staging-AccountDeletion',businessId=r.scope.id;
  const {Item:p}=await db.send(new GetCommand({TableName:'WhizzMerchants_Businesses',Key:{businessId},ConsistentRead:true}));
  if(!p||p.ownerId!==r.subjectId||p.cognitoUserId!==r.subjectId)throw error('OWNER_REQUIRED');
  if(p.legalHold||p.retentionHold)throw error('DOCUMENTED_RETENTION_HOLD');
  const names={'#owner':'ownerId','#cognito':'cognitoUserId','#active':'isActive','#online':'isOnline','#request':'deletionRequestId'},values={':owner':r.subjectId,':request':r.requestId,':no':false};
  let condition='#owner = :owner AND #cognito = :owner AND attribute_not_exists(#request)';
  for(const field of ['updatedAt','legalHold','retentionHold','businessPhotoUrl','businessPhoto','logoUrl','photoUrl','imageUrl','licenseUrl','identityUrl','healthCertificateUrl','ownerPhotoUrl']){names['#'+field]=field;if(p[field]===undefined)condition+=' AND attribute_not_exists(#'+field+')';else{condition+=' AND #'+field+' = :'+field;values[':'+field]=p[field];}}
  const wallets=e.wallets.map(w=>({Update:{TableName:'staging-Wallets',Key:{walletId:w.walletId,sk:'META'},UpdateExpression:'SET #s=:closing, deletionRequestId=:id ADD #v :one',ConditionExpression:'#v=:v AND ownerId=:owner AND ownerType=:type AND #s=:active AND availableBalance=:zero AND lockedBalance=:zero AND attribute_not_exists(deletionRequestId)',ExpressionAttributeNames:{'#s':'status','#v':'version'},ExpressionAttributeValues:{':closing':'SUSPENDED',':active':'ACTIVE',':id':r.requestId,':one':1,':v':w.version,':owner':businessId,':type':'MERCHANT',':zero':0}}}));
  if(!wallets.length){const walletId='WALLET#MERCHANT#'+businessId;manifest={...manifest,wallets:[{walletId,ownerId:businessId,source:'CORE',available:0,locked:0,version:1}],walletIds:[walletId]};wallets.push({Put:{TableName:'staging-Wallets',Item:{walletId,sk:'META',ownerId:businessId,ownerType:'MERCHANT',currency:'IQD',status:'SUSPENDED',availableBalance:0,lockedBalance:0,version:1,deletionRequestId:r.requestId},ConditionExpression:'attribute_not_exists(walletId)'}});}
  await db.send(new TransactWriteCommand({TransactItems:[
   {Put:{TableName:table,Item:{...r,job:manifest,status:'PROCESSING',blockers:[],version:r.version+1},ConditionExpression:'#v=:v AND leaseOwner=:owner AND leaseUntil>:now',ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':v':r.version,':owner':r.leaseOwner,':now':clock()}}},
   {Put:{TableName:table,Item:{pk:'BUSINESS_LIFECYCLE#MERCHANT#'+businessId,sk:'META',businessId,subjectId:r.subjectId,requestId:r.requestId,state:'CLOSING'},ConditionExpression:'attribute_not_exists(pk)'}},
   {Update:{TableName:'WhizzMerchants_Businesses',Key:{businessId},UpdateExpression:'SET #active=:no, #online=:no, #request=:request',ConditionExpression:condition,ExpressionAttributeNames:names,ExpressionAttributeValues:values}},...wallets
  ]}));return manifest;
 };
}
module.exports={merchantBusinessLock};
