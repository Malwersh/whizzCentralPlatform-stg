'use strict';
const {QueryCommand,GetCommand}=require('@aws-sdk/lib-dynamodb');
const {digest}=require('./commercial-retention');
const {error}=require('./policy');
const P='staging-MerchantPlatform';
// This inventory cannot pay, erase a financial source, or infer that a transfer succeeded.
async function payoutInventory({db,branchId,ownerId,maxPages=30}){
 const rows=[],challenges=[];let cursor;
 for(let page=0;page<maxPages;page++){
  const q=await db.send(new QueryCommand({TableName:P,ConsistentRead:true,KeyConditionExpression:'pk=:pk',ExpressionAttributeValues:{':pk':'MERCHANT_PAYOUT#'+branchId},Limit:100,...(cursor?{ExclusiveStartKey:cursor}:{})}));rows.push(...q.Items||[]);cursor=q.LastEvaluatedKey;if(!cursor)break;
 }
 if(cursor)throw error('PAYOUT_RETENTION_INCOMPLETE');
 const correctionRows=[];cursor=undefined;
 for(let page=0;page<maxPages;page++){
  const q=await db.send(new QueryCommand({TableName:P,ConsistentRead:true,KeyConditionExpression:'pk=:pk',ExpressionAttributeValues:{':pk':'MERCHANT_CORRECTIONS#'+branchId},Limit:100,...(cursor?{ExclusiveStartKey:cursor}:{})}));correctionRows.push(...q.Items||[]);cursor=q.LastEvaluatedKey;if(!cursor)break;
 }
 if(cursor)throw error('PAYOUT_RETENTION_INCOMPLETE');
 for(const c of correctionRows){
  if(c.pk!=='MERCHANT_CORRECTIONS#'+branchId||c.ownerId!==ownerId||c.branchId!==undefined&&c.branchId!==branchId||c.legalHold===true||c.retentionHold===true)throw error('PAYOUT_RETENTION_SCOPE_INVALID');
  if(!['MERCHANT_SETTLEMENT_CORRECTION','MERCHANT_CORRECTION_POSITION','MERCHANT_CORRECTION_ORDER_TOTALS','MERCHANT_POST_PAYOUT_CORRECTION_JOURNAL','MERCHANT_CORRECTION_EVENT','MERCHANT_CORRECTION_RESERVATION'].includes(c.kind))throw error('PAYOUT_RETENTION_SCOPE_INVALID');
  if(c.kind==='MERCHANT_SETTLEMENT_CORRECTION'&&!['PENDING_APPROVAL','POSTED','REJECTED'].includes(c.status)||c.kind==='MERCHANT_CORRECTION_RESERVATION'&&!['ACTIVE','SETTLED','RELEASED'].includes(c.status))throw error('PAYOUT_RETENTION_SCOPE_INVALID');
  if(c.kind==='MERCHANT_CORRECTION_POSITION'&&(['creditIqd','creditPaidIqd','debtIqd','debtRecoveredIqd'].some(k=>!Number.isSafeInteger(c[k])||c[k]<0)||c.creditIqd!==c.creditPaidIqd||c.debtIqd!==c.debtRecoveredIqd||(c.creditReservedIqd??0)!==0||(c.debtReservedIqd??0)!==0))throw error('PAYOUTS_UNSETTLED');
  if(c.kind==='MERCHANT_SETTLEMENT_CORRECTION'&&(c.status==='PENDING_APPROVAL'||c.status==='POSTED'&&((c.settledIqd??0)!==c.amountIqd||(c.reservedIqd??0)!==0)))throw error('PAYOUTS_UNSETTLED');
  if(c.kind==='MERCHANT_CORRECTION_RESERVATION'&&c.status==='ACTIVE')throw error('PAYOUTS_UNSETTLED');
  if(['MERCHANT_POST_PAYOUT_CORRECTION_JOURNAL','MERCHANT_CORRECTION_RESERVATION'].includes(c.kind)){const {digest:d,...body}=c;if(digest(body)!==d)throw error('PAYOUT_RETENTION_PROOF_INVALID');}
 }
 const payouts=new Map(rows.filter(r=>r.kind==='MERCHANT_PAYOUT').map(r=>[r.payoutId,r]));
 const c=(await db.send(new GetCommand({TableName:P,Key:{pk:'MERCHANT_PAYOUT_DESTINATION#'+branchId,sk:'OWNER#'+ownerId},ConsistentRead:true}))).Item;
 if(c){if(c.kind!=='MERCHANT_PAYOUT_DESTINATION_CHALLENGE'||c.branchId!==branchId||c.ownerId!==ownerId||c.legalHold===true||c.retentionHold===true)throw error('PAYOUT_RETENTION_SCOPE_INVALID');challenges.push(c);}
 const items=correctionRows.map(row=>({row,table:P}));
 for(const r of rows){
  if(r.branchId!==branchId||r.pk!=='MERCHANT_PAYOUT#'+branchId||r.legalHold===true||r.retentionHold===true)throw error('PAYOUT_RETENTION_SCOPE_INVALID');
  const p=payouts.get(r.payoutId);
  if(!p||p.ownerId!==ownerId||!['PAID','CANCELLED','FAILED_NOT_PAID'].includes(p.status))throw error('PAYOUTS_UNSETTLED');
  if(!['MERCHANT_PAYOUT','MERCHANT_PAYOUT_CLAIM','MERCHANT_PAYOUT_EVENT','MERCHANT_PAYOUT_DESTINATION','MERCHANT_CORRECTION_PAYOUT_SOURCE'].includes(r.kind)||r.kind!=='MERCHANT_PAYOUT_CLAIM'&&r.retentionClass!=='FINANCIAL_SETTLEMENT')throw error('PAYOUT_RETENTION_SCOPE_INVALID');
  if(r.kind==='MERCHANT_PAYOUT'&&(r.sk!==r.payoutId||!/^MPO:[a-f0-9]{48}$/.test(r.payoutId)||!(r.sourceKind==='CORRECTIONS_ONLY'?/^MCP:[a-f0-9]{48}$/:/^MSB:[a-f0-9]{48}$/).test(r.batchId)||!['CASH','ZAIN_CASH'].includes(r.method)))throw error('PAYOUT_RETENTION_SCOPE_INVALID');
  if(r.kind==='MERCHANT_PAYOUT_DESTINATION'&&(r.sk!=='PRIVATE#'+p.payoutId||r.ownerId!==ownerId||!/^\+9647\d{9}$/.test(r.phone||'')))throw error('PAYOUT_RETENTION_SCOPE_INVALID');
  if(r.kind==='MERCHANT_PAYOUT_CLAIM'&&(r.sk!=='BATCH#'+p.batchId||r.batchId!==p.batchId||r.status!==p.status))throw error('PAYOUT_RETENTION_SCOPE_INVALID');
  if(r.kind==='MERCHANT_CORRECTION_PAYOUT_SOURCE'){const {digest:d,...body}=r;if(p.sourceKind!=='CORRECTIONS_ONLY'||r.sk!=='SOURCE#'+p.batchId||r.ownerId!==ownerId||r.batchDigest!==p.batchDigest||digest(body)!==d||digest(r.correctionSettlement)!==digest(p.correctionSettlement))throw error('PAYOUT_RETENTION_PROOF_INVALID');}
  items.push({row:r,table:P});
 }
 for(const p of payouts.values()){
  if(p.sourceKind==='CORRECTIONS_ONLY'&&!rows.some(r=>r.kind==='MERCHANT_CORRECTION_PAYOUT_SOURCE'&&r.payoutId===p.payoutId))throw error('PAYOUT_RETENTION_PROOF_INVALID');
  if(p.externalReference&&p.settlementMode!=='OFFSET_ONLY'){
   const k={pk:'MERCHANT_PAYOUT_REFERENCE#'+digest({method:p.method,source:p.method==='CASH'?p.sourceAccount:'ZAIN_CASH',reference:p.externalReference}),sk:'META'};
   const r=(await db.send(new GetCommand({TableName:P,Key:k,ConsistentRead:true}))).Item;
   if(!r||r.payoutId!==p.payoutId||r.branchId!==branchId||r.externalReference!==p.externalReference||r.sourceAccount!==p.sourceAccount)throw error('PAYOUT_RETENTION_PROOF_INVALID');items.push({row:r,table:P});
  }
  if(p.status==='PAID'){
   const r=(await db.send(new GetCommand({TableName:P,Key:{pk:'MERCHANT_PAYOUT_PAID#'+p.payoutId,sk:'META'},ConsistentRead:true}))).Item;
   if(!r)throw error('PAYOUT_RETENTION_PROOF_INVALID');const {digest:d,...body}=r;
   if(digest(body)!==d||r.kind!=='MERCHANT_PAYOUT_PAID_JOURNAL'||r.schemaVersion!==1||r.branchId!==branchId||r.ownerId!==ownerId||(p.settlementMode==='OFFSET_ONLY'?(r.settlementMode!=='OFFSET_ONLY'||r.amount?.minorAmount!==0||r.receiptOwnerId!=null||r.ownerReceiptAt!=null):r.receiptOwnerId!==ownerId)||r.payoutId!==p.payoutId||r.batchId!==p.batchId||r.batchDigest!==p.batchDigest||r.status!=='PAID'||r.paidAt!==p.paidAt||digest(r.amount)!==digest(p.amount))throw error('PAYOUT_RETENTION_PROOF_INVALID');items.push({row:r,table:P});
  }
 }
 return {items,challenges};
}
module.exports={payoutInventory};
