'use strict';
const {error}=require('./policy');
const supports=r=>r?.kind==='CUSTOMER_CASH_REVIEW_CASE'||r?.kind==='DRIVER_UNSETTLED_CASH_REFUND'||r?.cashReviewSchemaVersion===1||r?.kind==='CUSTOMER_CASH_RECEIVABLE'||r?.kind==='CASH_ADJUDICATION_ACCOUNTING_JOURNAL';
const pending=r=>r?.kind==='CUSTOMER_CASH_REVIEW_CASE'&&r.state!=='CLOSED'||r?.kind==='CUSTOMER_CASH_RECEIVABLE'&&r.status==='OPEN';
const pick=(r,fields)=>Object.fromEntries(fields.filter(k=>r?.[k]!==undefined).map(k=>{const v=r[k];if(v!==null&&!['string','number','boolean'].includes(typeof v))throw error('COD_FINANCIAL_RECORD_INVALID');return [k,v];}));
const amount=n=>{if(!Number.isSafeInteger(n)||n<0||n>Math.floor(Number.MAX_SAFE_INTEGER/1000))throw error('COD_FINANCIAL_RECORD_INVALID');return n;};
/** Financial proof only. Free-text claims, employee profile guards, customer
 * names/contact data and raw acknowledgment principals are not archived. */
function evidence(row){
 const out=pick(row,['kind','schemaVersion','financialSchemaVersion','cashReviewSchemaVersion','orderId','branchId','driverId','caseId','state','version','createdAt','updatedAt','closedAt','action','requestDigest','journalId','refundId','voucherNumber','collectionProofDigest','settlementProofDigest','accountingEffect','walletPosting','at','digest']);
 out.currency='IQD';out.unit='WHOLE_IQD';
 if(row.kind==='DRIVER_UNSETTLED_CASH_REFUND')out.amountIqd=amount(row.amountIqd);
 if(row.kind==='CUSTOMER_CASH_RECEIVABLE'){
  if(row.status==='OPEN')throw error('COD_INTEGRATION_PENDING');out.amountIqd=amount(row.amountIqd);
 }
 if(row.kind==='CASH_ADJUDICATION_ACCOUNTING_JOURNAL'){
  out.actualCollectedIqd=amount(row.actualCollectedIqd);out.expectedIqd=amount(row.expectedIqd);
  out.lines=(row.lines||[]).map(l=>({...pick(l,['account','side']),amount:{...pick(l.amount,['currency','scale','moneySchemaVersion']),minorAmount:amount(l.amount.minorAmount)}}));
 }
 if(row.kind==='CUSTOMER_CASH_REVIEW_CASE'){
  if(row.state!=='CLOSED'||!row.refunds||!Array.isArray(row.refunds.refunds)||row.refunds.refunds.length>100)throw error('COD_INTEGRATION_PENDING');
  out.acceptedTermsDigest=row.acceptedTermsDigest;out.refundAggregateDigest=row.refunds.digest;
  if(row.collectionVerification)out.collection={...pick(row.collectionVerification,['verificationId','customerReportId','driverReportId','verifiedAt']),collectedIqd:amount(row.collectionVerification.collectedIqd)};
  out.refunds=row.refunds.refunds.map(r=>{
   if(!['RECONCILED','CANCELLED'].includes(r.status))throw error('COD_INTEGRATION_PENDING');
   const item={...pick(r,['refundId','voucherNumber','status','approvedAt','collectionProofDigest','settlementProofDigest']),amountIqd:amount(r.amountIqd),source:pick(r.source,['kind','code'])};
   if(r.execution)item.execution=pick(r.execution,['at','sourceJournalId']);
   if(r.acknowledgment)item.acknowledgment=pick(r.acknowledgment,['at']);
   if(r.reconciliation)item.reconciliation=pick(r.reconciliation,['at']);
   if(r.cancellation)item.cancellation=pick(r.cancellation,['at']);
   return item;
  });
  if(row.adjudication){const a=row.adjudication;if(!['EXECUTED','CANCELLED','SUPERSEDED_BY_MATCHED_DECLARATIONS'].includes(a.status))throw error('COD_INTEGRATION_PENDING');out.adjudication={...pick(a,['decisionId','basis','outcome','status','approvedAt','digest','reportsDigest','acceptedTermsDigest']),collectedIqd:amount(a.collectedIqd),shortfallIqd:amount(a.shortfallIqd),expectedIqd:amount(a.expectedIqd),...(a.execution?{execution:pick(a.execution,['at','operationId'])}:{})};}
  if(row.shortfallDecision)out.shortfallDecision={...pick(row.shortfallDecision,['outcome','status','at','resolvedAt']),shortfallIqd:amount(row.shortfallDecision.shortfallIqd)};
 }
 return out;
}
module.exports={supports,pending,evidence};
