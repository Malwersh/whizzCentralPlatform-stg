'use strict';
const {createHash}=require('node:crypto');
const canonical=v=>v&&typeof v==='object'&&!Array.isArray(v)?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':Array.isArray(v)?'['+v.map(canonical).join(',')+']':JSON.stringify(v);
function sourceFingerprint(offer,order){
 return createHash('sha256').update(canonical({plan:offer.performanceTiming,orderId:offer.orderId,driverId:offer.driverId,offerId:offer.offerId,attempt:offer.financialReceipt?.assignmentAttempt,
  status:order.status,walletFinancialStatus:order.walletFinancialStatus,financialOutcome:order.financialOutcome,
  arrivedAtStoreAt:order.arrivedAtStoreAt??null,pickedUpAt:order.pickedUpAt??null,arrivedAtCustomerAt:order.arrivedAtCustomerAt??null,deliveredAt:order.deliveredAt??null})).digest('hex');
}
const reviewable=observation=>observation?.status==='LATE_OBSERVED'||observation?.status==='REVIEW'&&observation.reason==='PICKUP_DELAY_REQUIRES_REVIEW';
function applyTimingReview(observation,offer,order,review,event){
 if(!review)return observation;
 const pending=reason=>({...observation,status:'REVIEW',reason});
 if(!order||review.kind!=='DRIVER_SERVICE_REVIEW'||review.schemaVersion!==1||review.dimension!=='TIMING'||review.orderId!==offer.orderId||review.driverId!==offer.driverId||review.offerId!==offer.offerId||review.attempt!==offer.financialReceipt?.assignmentAttempt||review.actorKind!=='STAFF'||review.sourceFingerprint!==sourceFingerprint(offer,order))return pending('TIMING_SOURCE_CHANGED');
 if((review.appeals||[]).some(a=>a.status==='OPEN'))return pending('TIMING_APPEAL_OPEN');
 const d=review.decision;
 if(!d||d.value==='PENDING_REVIEW')return pending('TIMING_REVIEW_PENDING');
 if(!event||event.kind!=='DRIVER_SERVICE_REVIEW_EVENT'||event.action!=='DECIDE_DRIVER_TIMING_REVIEW'||event.actorKind!=='STAFF'||event.schemaVersion!==1||event.orderId!==review.orderId||event.caseId!==review.caseId||event.recordId!==d.id||event.driverId!==review.driverId||event.offerId!==review.offerId||event.attempt!==review.attempt||event.sourceFingerprint!==review.sourceFingerprint||event.decision?.value!==d.value||event.decision?.id!==d.id||!reviewable(observation))return pending('TIMING_DECISION_UNVERIFIED');
 return d.value==='EXCUSED'?{...observation,status:'EXCLUDED',reason:'VERIFIED_DELAY_EXCUSED'}:d.value==='COUNT_LATE'?{...observation,status:'LATE_OBSERVED',reason:'REVIEW_CONFIRMED_LATE'}:pending('TIMING_DECISION_UNVERIFIED');
}
module.exports={sourceFingerprint,reviewable,applyTimingReview};
