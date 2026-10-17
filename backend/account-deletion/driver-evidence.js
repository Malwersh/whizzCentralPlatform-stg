'use strict';
const {GetCommand,ScanCommand,QueryCommand}=require('@aws-sdk/lib-dynamodb');
const {error}=require('./policy');
const terminalOrders=new Set(['returned','delivered','completed','rejected','refunded','cancelled','canceled','canceled_by_user','canceled_by_customer','canceled_by_store','canceled_by_restaurant','canceled_by_driver','canceled_by_system']);
const terminalTransfers=new Set(['COMPLETED','REJECTED','CANCELLED','CANCELED']);
function driverEvidence({db,maxPages=100,clock=()=>Math.floor(Date.now()/1000)}){
 async function scan(table,fields,ids){
  const names={},values={};ids.forEach((id,i)=>values[':id'+i]=id);
  const refs=ids.map((_,i)=>':id'+i).join(',');
  const filter=fields.map((f,i)=>{names['#f'+i]=f;return '#f'+i+' IN ('+refs+')';}).join(' OR ');
  let cursor,count=0,rows=[];
  do{const r=await db.send(new ScanCommand({TableName:table,ConsistentRead:true,ExclusiveStartKey:cursor,FilterExpression:'('+filter+')',ExpressionAttributeNames:names,ExpressionAttributeValues:values}));if((r.Items||[]).some(row=>!fields.some(f=>ids.includes(row[f]))))throw error('OWNERSHIP_MISMATCH');rows.push(...r.Items||[]);cursor=r.LastEvaluatedKey;if(++count>=maxPages&&cursor)throw error('EVIDENCE_INCOMPLETE');}while(cursor);
  return rows;
 }
 return async actor=>{
  if(actor?.type!=='DRIVER'||!actor.sub||!actor.username)throw error('UNAUTHORIZED');
  const {Item:p}=await db.send(new GetCommand({TableName:'WhizzDrivers_staging',Key:{driverId:actor.sub},ConsistentRead:true}));
  if(!p)throw error('PROFILE_NOT_FOUND');
  if(p.driverId!==actor.sub||(p.cognitoSub&&p.cognitoSub!==actor.sub))throw error('OWNERSHIP_MISMATCH');
  // Legacy aliases are accepted only through the canonical profile's migration
  // record, never by matching a phone number that another account may reuse.
  const ids=[actor.sub];
  if(p.migratedFromDriverId){const {Item:old}=await db.send(new GetCommand({TableName:'WhizzDrivers_staging',Key:{driverId:p.migratedFromDriverId},ConsistentRead:true}));if(old){if(old.cognitoSub!==actor.sub)throw error('IDENTITY_AMBIGUOUS');ids.push(old.driverId);}}
  const wallets=[];
  for(const id of ids){const walletId='WALLET#DRIVER#'+id;const {Item:w}=await db.send(new GetCommand({TableName:'staging-Wallets',Key:{walletId,sk:'META'},ConsistentRead:true}));if(w){if(w.ownerType!=='DRIVER'||w.ownerId!==id||w.walletId!==walletId||w.currency!=='IQD'||!Number.isSafeInteger(w.version)||!Number.isSafeInteger(w.availableBalance)||!Number.isSafeInteger(w.lockedBalance))throw error('EVIDENCE_UNAVAILABLE');wallets.push({walletId,ownerId:id,source:'CORE',version:w.version,available:w.availableBalance,locked:w.lockedBalance});}}
  const walletIds=ids.map(id=>'WALLET#DRIVER#'+id);
  const orders=await scan('WizzOrders',['driverId','assignedDriverId'],ids);
  const acceptedOffers=(await scan('WaveOffers_staging',['driverId'],ids)).filter(r=>require('./cod-retention').isAccepted(r));
  const relatedOrders=acceptedOffers.length?await scan('WizzOrders',['orderId'],[...new Set(acceptedOffers.map(o=>o.orderId))]):[];
  const priorAttempts=relatedOrders.filter(o=>!terminalOrders.has(String(o.status||'').toLowerCase())&&!orders.some(x=>x.orderId===o.orderId)).map(o=>({orderId:o.orderId,status:'COD_REASSIGNMENT_RETENTION_PENDING'}));
  const holds=await scan('staging-Holds',['walletId'],walletIds);
  const transfers=await scan('staging-IdempotencyKeys',['sourceWalletId','recipientWalletId'],walletIds);
  const payments=await scan('staging-TopupRequests',['driverId','walletId'],[...ids,...walletIds]);
  const cod=await require('./cod-retention').pendingCod({db,maxPages,driverIds:ids});
  const operations=await db.send(new QueryCommand({TableName:'staging-AccountDeletion',KeyConditionExpression:'pk = :pk',ExpressionAttributeValues:{':pk':'ACCOUNT_OPERATION#DRIVER#'+actor.sub},ConsistentRead:true}));
  if(operations.LastEvaluatedKey)throw error('EVIDENCE_INCOMPLETE');
  const uploads=(operations.Items||[]).filter(o=>o.kind==='FUNDING_RECEIPT'&&o.expiresAt>clock());
  const sandbox=await scan('staging-SandboxPayments',['driverId','pk'],[...ids,...ids.map(id=>'DRIVER#'+id)]);
  const pendingSandbox=sandbox.filter(p=>String(p.sk||'').startsWith('PAYMENT#')&&!['SUCCESS','FAILED','EXPIRED','AUTHENTICATION_FAILED','CANCELED','CANCELLED'].includes(p.state));
  return {complete:true,profileIds:ids,wallets,activeOrders:orders.filter(o=>!terminalOrders.has(String(o.status||'').toLowerCase())).map(o=>({orderId:o.orderId,status:o.status})),activeHolds:holds.filter(h=>h.status==='ACTIVE').map(h=>({orderId:h.orderId,status:h.status})),pendingTransfers:transfers.filter(t=>t.transferId&&!terminalTransfers.has(t.status)).map(t=>({transferId:t.transferId,status:t.status})),pendingPayments:[...priorAttempts,...cod,...payments.filter(p=>!['APPROVED','REJECTED','COMPLETED','CANCELLED','CANCELED'].includes(p.status)).map(p=>({topupId:p.topupId,status:p.status})),...uploads.map(o=>({operationId:o.operationId,status:'RECEIPT_UPLOAD_PENDING'})),...pendingSandbox.map(p=>({transactionId:p.requestId,status:p.state,environment:'sandbox'}))]};
 };
}
module.exports={driverEvidence};
