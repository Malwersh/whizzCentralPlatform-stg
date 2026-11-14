'use strict';
const {GetCommand,QueryCommand}=require('@aws-sdk/lib-dynamodb');
const {exact}=require('./cod-retention');
const {error}=require('./policy');
const held=r=>r?.legalHold===true||r?.retentionHold===true;
const terminal=new Set(['delivered','completed','returned','cancelled','canceled']);
function caseClosed(r){
 if(r.correctionReview?.status==='PENDING')return false;
 if(r.kind==='CUSTOMER_CASH_REVIEW_CASE')return r.state==='CLOSED';
 if(['CUSTOMER_CANCELLATION','MERCHANT_CANCELLATION'].includes(r.kind))return ['DECLINED','SUPERSEDED'].includes(r.state)||r.state==='CANCELLED'&&['SETTLED','NOT_APPLICABLE'].includes(r.settlementStatus);
 return r.kind==='COD_RETURN_CASE'&&r.exceptionResolution?.status==='RESOLVED';
}
// Read-only assessment; a Query is NOT a transactional fence against a newly
// opened case. Never grants compaction authority, even if current rows are closed.
async function reviewClosure({db,orderId,maxPages=20}){
 if(!db||typeof orderId!=='string'||!/^[A-Za-z0-9_.:-]{1,150}$/.test(orderId)||!Number.isSafeInteger(maxPages)||maxPages<1||maxPages>100)throw error('FUNDING_CLOSURE_SCOPE_INVALID');
 const key={PK:'ORDER#'+orderId,SK:'META'},order=(await db.send(new GetCommand({TableName:'WizzOrders',Key:key,ConsistentRead:true}))).Item;
 const blockers=new Set(),conditions=[];
 if(!order||order.PK!==key.PK||order.SK!==key.SK||order.orderId!==orderId)blockers.add('ORDER_EVIDENCE_MISSING');
 else {if(!terminal.has(order.status))blockers.add('ORDER_NOT_TERMINAL');if(held(order))blockers.add('DOCUMENTED_HOLD');conditions.push({ConditionCheck:{TableName:'WizzOrders',Key:key,...exact(order)}});}
 let cursor,rows=[],complete=false;
 for(let page=0;page<maxPages;page++){
  const result=await db.send(new QueryCommand({TableName:'staging-Holds',KeyConditionExpression:'#o=:o',ExpressionAttributeNames:{'#o':'orderId'},ExpressionAttributeValues:{':o':orderId},ConsistentRead:true,Limit:100,...(cursor?{ExclusiveStartKey:cursor}:{})}));
  rows.push(...result.Items||[]);cursor=result.LastEvaluatedKey;if(!cursor){complete=true;break;}
 }
 if(!complete)blockers.add('CASE_INVENTORY_INCOMPLETE');
 const seen=new Set();let cases=0;
 for(const r of rows){
  if(r.orderId!==orderId||typeof r.sk!=='string'||seen.has(r.sk))throw error('FUNDING_CLOSURE_SCOPE_INVALID');seen.add(r.sk);
  if(held(r))blockers.add('DOCUMENTED_HOLD');
  if(r.status==='ACTIVE')blockers.add('ACTIVE_FINANCIAL_HOLD');
  if(r.sk==='MERCHANT_PAYABLE'){
   if(!Number.isSafeInteger(r.amount)||r.amount<0)blockers.add('PAYABLE_AMOUNT_INVALID');
   else if(r.amount>0){if(r.status!=='PAID'||!r.paidPayoutId||!r.paidAt)blockers.add('MERCHANT_PAYOUT_PENDING');else blockers.add('PAYOUT_JOURNAL_VERIFICATION_REQUIRED');}
  }
  if(r.driverCompensationStatus==='PENDING_POLICY_REVIEW'||r.receipt?.driverCompensationStatus==='PENDING_POLICY_REVIEW'||r.codFinancialEvidence?.receipt?.driverCompensationStatus==='PENDING_POLICY_REVIEW')blockers.add('COMPENSATION_REVIEW_PENDING');
  if(['CUSTOMER_CANCELLATION','MERCHANT_CANCELLATION','COD_RETURN_CASE','CUSTOMER_CASH_REVIEW_CASE'].includes(r.kind)||/^(CUSTOMER_CANCELLATION|MERCHANT_CANCELLATION|RETURN#[0-9]+|CUSTOMER_CASH_REVIEW)$/.test(r.sk)){
   cases++;if(!caseClosed(r))blockers.add('CASE_NOT_CLOSED');
  }
  conditions.push({ConditionCheck:{TableName:'staging-Holds',Key:{orderId,sk:r.sk},...exact(r)}});
 }
 if(!seen.has('FINANCIAL_OUTCOME'))blockers.add('FINANCIAL_OUTCOME_MISSING');
 // These independent proofs remain mandatory; status labels alone are insufficient.
 blockers.add('SETTLEMENT_JOURNAL_VERIFICATION_REQUIRED');
 blockers.add('CASE_INVENTORY_FENCE_REQUIRED');
 if(conditions.length>95)blockers.add('TRANSACTION_LIMIT');
 return {closureVerified:false,deleteEligible:false,complete,observed:{records:rows.length,cases},blockers:[...blockers].sort(),conditions};
}
module.exports={reviewClosure,caseClosed};
