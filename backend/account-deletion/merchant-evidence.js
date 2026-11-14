'use strict';
const {GetCommand,ScanCommand}=require('@aws-sdk/lib-dynamodb');
const {error}=require('./policy');
const terminalOrders=new Set(['returned','delivered','completed','rejected','refunded','cancelled','canceled','canceled_by_user','canceled_by_customer','canceled_by_store','canceled_by_restaurant','canceled_by_driver','canceled_by_system']);
const terminalTransfers=new Set(['COMPLETED','REJECTED','CANCELLED','CANCELED']);
function merchantEvidence({db,maxPages=100}){
 async function rows(table){let cursor,count=0,all=[];do{const r=await db.send(new ScanCommand({TableName:table,ConsistentRead:true,ExclusiveStartKey:cursor}));all.push(...r.Items||[]);cursor=r.LastEvaluatedKey;if(++count>=maxPages&&cursor)throw error('EVIDENCE_INCOMPLETE');}while(cursor);return all;}
 return async(actor,scope)=>{
  if(actor?.type!=='MERCHANT'||!actor.sub||!scope)throw error('UNAUTHORIZED');
  const businesses=await rows('WhizzMerchants_Businesses');
  const owned=businesses.filter(b=>b.ownerId===actor.sub||b.cognitoUserId===actor.sub);
  // Conflicting ownership fields must be reconciled, not interpreted as permission.
  if(owned.some(b=>b.ownerId&&b.cognitoUserId&&b.ownerId!==b.cognitoUserId))throw error('IDENTITY_AMBIGUOUS');
  if(scope.kind==='ACCOUNT')return {complete:true,ownedBusinesses:owned.map(b=>b.businessId),wallets:[],activeOrders:[],activeHolds:[],pendingTransfers:[]};
  const b=businesses.find(b=>b.businessId===scope.id);if(!b)throw error('BUSINESS_NOT_FOUND');
  const isOwner=b.ownerId===actor.sub||b.cognitoUserId===actor.sub;
  const {Item:membership}=await db.send(new GetCommand({TableName:'staging-IdempotencyKeys',Key:{idempotencyKey:`MERCHANT_FINANCE#${scope.id}#${actor.sub}`,sk:'META'},ConsistentRead:true}));
  const isMember=membership?.enabled===true&&membership.memberId===actor.sub&&membership.ownerId===(b.ownerId||b.cognitoUserId);
  if(scope.kind==='BUSINESS'&&!isOwner)throw error('OWNER_REQUIRED');
  if(scope.kind==='MEMBERSHIP'){if(isOwner)throw error('OWNERSHIP_TRANSFER_REQUIRED');if(!isMember)throw error('MEMBERSHIP_REQUIRED');if(!Number.isSafeInteger(membership.version))throw error('EVIDENCE_UNAVAILABLE');return {complete:true,isOwner:false,isMember:true,membership:{ownerId:membership.ownerId,version:membership.version},wallets:[],activeOrders:[],activeHolds:[],pendingTransfers:[]};}
  const walletId='WALLET#MERCHANT#'+scope.id;
  const {Item:w}=await db.send(new GetCommand({TableName:'staging-Wallets',Key:{walletId,sk:'META'},ConsistentRead:true}));
  if(w&&(w.ownerType!=='MERCHANT'||w.ownerId!==scope.id||w.walletId!==walletId||w.currency!=='IQD'||!Number.isSafeInteger(w.version)||!Number.isSafeInteger(w.availableBalance)||!Number.isSafeInteger(w.lockedBalance)))throw error('EVIDENCE_UNAVAILABLE');
  const orders=(await rows('WizzOrders')).filter(o=>o.storeId===scope.id||o.businessId===scope.id||o.restaurantId===scope.id);
  const holds=(await rows('staging-Holds')).filter(h=>h.walletId===walletId);
  const topups=(await rows('staging-TopupRequests')).filter(t=>t.walletId===walletId&&!['APPROVED','REJECTED','COMPLETED','CANCELLED','CANCELED'].includes(t.status));
  const transfers=(await rows('staging-IdempotencyKeys')).filter(t=>(t.sourceWalletId===walletId||t.recipientWalletId===walletId)&&t.transferId&&!terminalTransfers.has(t.status));
  const cod=await require('./cod-retention').pendingCod({db,maxPages,branchId:scope.id});
  return {complete:true,isOwner:true,isMember,wallets:w?[{walletId,source:'CORE',version:w.version,available:w.availableBalance,locked:w.lockedBalance}]:[],activeOrders:orders.filter(o=>!terminalOrders.has(String(o.status||'').toLowerCase())).map(o=>({orderId:o.orderId,status:o.status})),activeHolds:holds.filter(h=>h.status==='ACTIVE').map(h=>({orderId:h.orderId,status:h.status})),pendingTransfers:transfers.map(t=>({transferId:t.transferId,status:t.status})),pendingPayments:[...cod,...topups.map(t=>({topupId:t.topupId,status:t.status}))],externalAssets:['businessPhotoUrl','businessPhoto','logoUrl','photoUrl','imageUrl','licenseUrl','identityUrl','healthCertificateUrl','ownerPhotoUrl'].filter(k=>typeof b[k]==='string'&&b[k].includes('order-receiver-business-photos-dev-1755170214.s3.amazonaws.com/'))};
 };
}
module.exports={merchantEvidence};
