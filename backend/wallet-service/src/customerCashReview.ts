import {quoteHash, quoteEntityIdValid} from './deliveryQuoteRecord';

/** Internal planners only. Facts and actors must be read/authenticated by the server,
 * fenced in the eventual transaction, and never copied from a request body.
 * A plan is not a money posting, customer acknowledgment, or permission grant. */
export type CashReviewActor = {kind:'CUSTOMER'|'DRIVER'|'STAFF'; subjectId:string};
export type RefundSource = {kind:'DRIVER_UNSETTLED'; driverId:string} |
 {kind:'COMPANY_CASHBOX'; code:string; custodianId:string};
export type CashReviewFacts = {
 orderId:string; customerId:string; driverId:string; expectedIqd:number;
 collectedIqd:number; settledIqd:number; collectionProofId:string;
 collectionProofDigest:string; settlementProofDigest:string;
};
type Refund = {
 refundId:string; voucherNumber:string; amountIqd:number; reason:string;
 source:RefundSource; approvedBy:string; approvedAt:string;
 collectionProofDigest:string; settlementProofDigest:string;
 status:'APPROVED'|'EXECUTED'|'ACKNOWLEDGED'|'RECONCILED'|'CANCELLED';
 execution?:{actorId:string; at:string; sourceJournalId:string; reference:string};
 acknowledgment?:{customerId:string; at:string};
 reconciliation?:{actorId:string; at:string; reference:string};
 cancellation?:{actorId:string; at:string; reason:string};
};
export type CustomerCashReview = {
 schemaVersion:1; orderId:string; version:number; refunds:Refund[]; digest:string;
};
const fail=(code:string):never=>{throw Object.assign(Error(code),{code});};
const uuid=(s:unknown):s is string=>typeof s==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(s);
const sha=(s:unknown)=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const amount=(n:unknown):n is number=>Number.isSafeInteger(n)&&Number(n)>=0&&Number(n)<=Math.floor(Number.MAX_SAFE_INTEGER/1000);
const text=(s:unknown):s is string=>typeof s==='string'&&s.trim().length>=5&&s.length<=1000;
const atValid=(s:string)=>typeof s==='string'&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString()===s;
const exact=(v:object,keys:string[])=>Object.keys(v).sort().join(',')===[...keys].sort().join(',');
const copy=<T>(v:T):T=>JSON.parse(JSON.stringify(v));
const seal=(v:Omit<CustomerCashReview,'digest'>):CustomerCashReview=>({...v,digest:quoteHash(v)});
function actor(a:CashReviewActor,kind:CashReviewActor['kind']){
 if(!a||a.kind!==kind||!quoteEntityIdValid(a.subjectId))return fail('CASH_REVIEW_FORBIDDEN');
}
function facts(f:CashReviewFacts){
 if(!f||![f.orderId,f.customerId,f.driverId,f.collectionProofId].every(quoteEntityIdValid)||
  ![f.expectedIqd,f.collectedIqd,f.settledIqd].every(amount)||f.settledIqd>f.collectedIqd||
  !sha(f.collectionProofDigest)||!sha(f.settlementProofDigest))return fail('CASH_REVIEW_PROOF_REQUIRED');
}
function source(s:RefundSource){
 if(!s)return fail('REFUND_SOURCE_INVALID');
 if(s.kind==='DRIVER_UNSETTLED'){
  if(!exact(s,['kind','driverId'])||!quoteEntityIdValid(s.driverId))return fail('REFUND_SOURCE_INVALID');
 }else if(s.kind!=='COMPANY_CASHBOX'||!exact(s,['kind','code','custodianId'])||
  !/^[A-Z][A-Z0-9-]{2,39}$/.test(s.code)||!quoteEntityIdValid(s.custodianId))return fail('REFUND_SOURCE_INVALID');
}
function state(s:CustomerCashReview){
 if(!s||!exact(s,['schemaVersion','orderId','version','refunds','digest'])||s.schemaVersion!==1||
  !quoteEntityIdValid(s.orderId)||!Number.isSafeInteger(s.version)||s.version<1||s.version>=Number.MAX_SAFE_INTEGER||
  !Array.isArray(s.refunds)||s.refunds.length>100)return fail('CASH_REVIEW_CONFLICT');
 const {digest,...body}=s;if(!sha(digest)||quoteHash(body)!==digest)return fail('CASH_REVIEW_CONFLICT');
 const ids=new Set<string>();
 for(const r of s.refunds){
  if(!uuid(r.refundId)||ids.has(r.refundId)||!amount(r.amountIqd)||r.amountIqd===0||!text(r.reason)||
   !quoteEntityIdValid(r.approvedBy)||!atValid(r.approvedAt)||!sha(r.collectionProofDigest)||!sha(r.settlementProofDigest)||
   r.voucherNumber!==refundVoucher(s.orderId,r.refundId,r.approvedAt)||
   !['APPROVED','EXECUTED','ACKNOWLEDGED','RECONCILED','CANCELLED'].includes(r.status))return fail('CASH_REVIEW_CONFLICT');
  ids.add(r.refundId);source(r.source);
  const executed=['EXECUTED','ACKNOWLEDGED','RECONCILED'].includes(r.status);
  if(executed!==!!r.execution||!!r.acknowledgment!==['ACKNOWLEDGED','RECONCILED'].includes(r.status)||
   !!r.reconciliation!==(r.status==='RECONCILED')||!!r.cancellation!==(r.status==='CANCELLED'))return fail('CASH_REVIEW_CONFLICT');
  if(r.execution&&(!quoteEntityIdValid(r.execution.actorId)||!quoteEntityIdValid(r.execution.sourceJournalId)||!text(r.execution.reference)||!atValid(r.execution.at)||Date.parse(r.execution.at)<Date.parse(r.approvedAt)))return fail('CASH_REVIEW_CONFLICT');
  if(r.acknowledgment&&(!quoteEntityIdValid(r.acknowledgment.customerId)||!atValid(r.acknowledgment.at)||Date.parse(r.acknowledgment.at)<Date.parse(r.execution!.at)))return fail('CASH_REVIEW_CONFLICT');
  if(r.reconciliation&&(!quoteEntityIdValid(r.reconciliation.actorId)||!atValid(r.reconciliation.at)||!text(r.reconciliation.reference)||Date.parse(r.reconciliation.at)<Date.parse(r.acknowledgment!.at)))return fail('CASH_REVIEW_CONFLICT');
  if(r.cancellation&&(!quoteEntityIdValid(r.cancellation.actorId)||!atValid(r.cancellation.at)||!text(r.cancellation.reason)||Date.parse(r.cancellation.at)<Date.parse(r.approvedAt)))return fail('CASH_REVIEW_CONFLICT');
 }
}
/** Stable server-generated reference, not a user-entered cash receipt number. */
function refundVoucher(orderId:string,refundId:string,at:string){
 return 'CRV-'+new Date(Date.parse(at)+10800000).toISOString().slice(0,10).replace(/-/g,'')+'-'+quoteHash({orderId,refundId}).slice(0,20).toUpperCase();
}
export function createCustomerCashReview(orderId:string):CustomerCashReview{
 if(!quoteEntityIdValid(orderId))return fail('INVALID_CASH_REVIEW');
 return seal({schemaVersion:1,orderId,version:1,refunds:[]});
}
/** Reports are allegations, even when the reporter is staff. Only verified facts
 * establish a collection amount; this calculation never creates liability. */
export function assessReportedCash(expectedIqd:number,reportedPaidIqd:number){
 if(!amount(expectedIqd)||!amount(reportedPaidIqd))return fail('INVALID_CASH_REVIEW');
 return {expectedIqd,reportedPaidIqd,reportedShortfallIqd:Math.max(0,expectedIqd-reportedPaidIqd),
  reportedExcessIqd:Math.max(0,reportedPaidIqd-expectedIqd),status:'REVIEW_REQUIRED' as const,
  collectionVerified:false,liability:'NOT_ASSESSED' as const,financialPosting:false};
}
export function cashRefundCapacity(s:CustomerCashReview,f:CashReviewFacts){
 state(s);facts(f);if(s.orderId!==f.orderId)return fail('CASH_REVIEW_CONFLICT');
 let reserved=0n,executed=0n,driver=0n,company=0n;
 for(const r of s.refunds){if(r.status==='CANCELLED')continue;
  reserved+=BigInt(r.amountIqd);if(r.execution)executed+=BigInt(r.amountIqd);
  if(r.source.kind==='DRIVER_UNSETTLED')driver+=BigInt(r.amountIqd);else company+=BigInt(r.amountIqd);
 }
 if(reserved>BigInt(f.collectedIqd))return fail('REFUND_COLLECTION_PROOF_CHANGED');
 return {remainingRefundableIqd:f.collectedIqd-Number(reserved),executedRefundIqd:Number(executed),
  reservedRefundIqd:Number(reserved),driverUnsettledAvailableIqd:Math.max(0,f.collectedIqd-f.settledIqd-Number(driver)),
  companySettledAvailableIqd:Math.max(0,f.settledIqd-Number(company))};
}
function next(s:CustomerCashReview,refunds:Refund[]){return seal({schemaVersion:1,orderId:s.orderId,version:s.version+1,refunds});}
export function approveCustomerRefund(s:CustomerCashReview,f:CashReviewFacts,a:CashReviewActor,
 v:{refundId:string;amountIqd:number;source:RefundSource;reason:string},at:string){
 actor(a,'STAFF');const cap=cashRefundCapacity(s,f);source(v.source);
 if(!exact(v,['refundId','amountIqd','source','reason'])||!uuid(v.refundId)||!amount(v.amountIqd)||v.amountIqd===0||!text(v.reason)||!atValid(at))return fail('INVALID_CASH_REVIEW');
 if(s.refunds.some(r=>r.refundId===v.refundId))return fail('REFUND_ALREADY_EXISTS');
 if(s.refunds.length>=100||s.refunds.filter(r=>r.status!=='CANCELLED').length>=20)return fail('CASH_REVIEW_LIMIT');
 if(v.amountIqd>cap.remainingRefundableIqd)return fail('REFUND_EXCEEDS_COLLECTED');
 if(v.source.kind==='DRIVER_UNSETTLED'?(v.source.driverId!==f.driverId||v.amountIqd>cap.driverUnsettledAvailableIqd):v.amountIqd>cap.companySettledAvailableIqd)return fail('REFUND_SOURCE_NOT_ELIGIBLE');
 const r:Refund={refundId:v.refundId,voucherNumber:refundVoucher(s.orderId,v.refundId,at),amountIqd:v.amountIqd,
  source:copy(v.source),reason:v.reason.trim(),approvedBy:a.subjectId,approvedAt:at,
  collectionProofDigest:f.collectionProofDigest,settlementProofDigest:f.settlementProofDigest,status:'APPROVED'};
 return next(s,[...copy(s.refunds),r]);
}
function find(s:CustomerCashReview,id:string,status:Refund['status'],at:string){
 state(s);if(!uuid(id)||!atValid(at))return fail('INVALID_CASH_REVIEW');
 const r=s.refunds.find(r=>r.refundId===id);if(!r||r.status!==status)return fail('REFUND_STATE_CONFLICT');
 if(Date.parse(at)<Date.parse(r.reconciliation?.at??r.acknowledgment?.at??r.execution?.at??r.approvedAt))return fail('CASH_REVIEW_CONFLICT');return r;
}
function replace(s:CustomerCashReview,r:Refund){return next(s,s.refunds.map(old=>old.refundId===r.refundId?copy(r):copy(old)));}
/** Returns a plan. Persist with the actual source journal and cash/custody debit
 * in ONE conditional transaction. A reference typed by a caller is insufficient. */
export function executeCustomerRefund(s:CustomerCashReview,f:CashReviewFacts,a:CashReviewActor,
 v:{refundId:string;confirmPhysicalExecution:true;sourceJournalId:string;reference:string},at:string){
 const r=find(s,v.refundId,'APPROVED',at);cashRefundCapacity(s,f);
 if(!exact(v,['refundId','confirmPhysicalExecution','sourceJournalId','reference'])||v.confirmPhysicalExecution!==true||!quoteEntityIdValid(v.sourceJournalId)||!text(v.reference))return fail('REFUND_EXECUTION_PROOF_REQUIRED');
 actor(a,r.source.kind==='DRIVER_UNSETTLED'?'DRIVER':'STAFF');
 if(a.subjectId!==(r.source.kind==='DRIVER_UNSETTLED'?r.source.driverId:r.source.custodianId))return fail('REFUND_CUSTODIAN_REQUIRED');
 if(r.collectionProofDigest!==f.collectionProofDigest||r.settlementProofDigest!==f.settlementProofDigest)return fail('REFUND_SOURCE_PROOF_CHANGED');
 return replace(s,{...r,status:'EXECUTED',execution:{actorId:a.subjectId,at,sourceJournalId:v.sourceJournalId,reference:v.reference.trim()}});
}
export function acknowledgeCustomerRefund(s:CustomerCashReview,f:CashReviewFacts,a:CashReviewActor,
 v:{refundId:string;confirmFullReceipt:true},at:string){
 const r=find(s,v.refundId,'EXECUTED',at);facts(f);actor(a,'CUSTOMER');
 if(s.orderId!==f.orderId||a.subjectId!==f.customerId)return fail('CASH_REVIEW_FORBIDDEN');
 if(!exact(v,['refundId','confirmFullReceipt'])||v.confirmFullReceipt!==true)return fail('REFUND_CUSTOMER_ACK_REQUIRED');
 return replace(s,{...r,status:'ACKNOWLEDGED',acknowledgment:{customerId:a.subjectId,at}});
}
export function reconcileCustomerRefund(s:CustomerCashReview,a:CashReviewActor,
 v:{refundId:string;verifiedSourceJournalId:string;reference:string},at:string){
 const r=find(s,v.refundId,'ACKNOWLEDGED',at);actor(a,'STAFF');
 if(!exact(v,['refundId','verifiedSourceJournalId','reference'])||!text(v.reference)||v.verifiedSourceJournalId!==r.execution!.sourceJournalId)return fail('REFUND_RECONCILIATION_REQUIRED');
 return replace(s,{...r,status:'RECONCILED',reconciliation:{actorId:a.subjectId,at,reference:v.reference.trim()}});
}
/** Missing customer acknowledgment never reverses a real cash outflow. */
export function cancelCustomerRefund(s:CustomerCashReview,a:CashReviewActor,
 v:{refundId:string;reason:string},at:string){
 const r=find(s,v.refundId,'APPROVED',at);actor(a,'STAFF');
 if(!exact(v,['refundId','reason'])||!text(v.reason))return fail('INVALID_CASH_REVIEW');
 return replace(s,{...r,status:'CANCELLED',cancellation:{actorId:a.subjectId,at,reason:v.reason.trim()}});
}
