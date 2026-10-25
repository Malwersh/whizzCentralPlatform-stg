'use strict';
// Original per-assignment plan; observations are server-recorded status times, not GPS proof.
const POLICY='ORIGINAL_ACCEPTED_ROUTE_V1';
const ms=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT/.test(v)&&Number.isFinite(Date.parse(v))?Date.parse(v):NaN;
const id=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(v);
const iso=n=>new Date(n).toISOString();
function buildTimingPlan({orderId,driverId,offerId,attempt,acceptedAt,pickupSeconds,deliverySeconds,estimatedReadyAt=null}){
 const at=ms(acceptedAt),ready=estimatedReadyAt==null?at:ms(estimatedReadyAt);
 if(![orderId,driverId,offerId].every(id)||!Number.isSafeInteger(at)||!Number.isSafeInteger(ready)||!Number.isSafeInteger(attempt)||attempt<1||![pickupSeconds,deliverySeconds].every(n=>Number.isSafeInteger(n)&&n>0&&n<=86400))throw Error('INVALID_PERFORMANCE_TIMING');
 const pickup=at+pickupSeconds*1000,delivery=Math.max(ready,pickup)+deliverySeconds*1000;
 return {schemaVersion:1,kind:'DRIVER_ORIGINAL_TIMING_PLAN',policyVersion:POLICY,orderId,driverId,offerId,attempt,acceptedAt:iso(at),estimatedReadyAt:estimatedReadyAt==null?null:iso(ready),pickupSeconds,deliverySeconds,pickupTargetAt:iso(pickup),customerTargetAt:iso(delivery),graceSeconds:300,eventBasis:'SERVER_RECORDED_DRIVER_STATUS',affectsEligibility:false};
}
function classifyTiming(offer,order,asOf){
 const p=offer?.performanceTiming;
 if(!p)return {status:'EXCLUDED',reason:'ORIGINAL_TARGET_UNAVAILABLE'};
 let rebuilt;
 try{rebuilt=buildTimingPlan(p);}catch{return {status:'EXCLUDED',reason:'ORIGINAL_TARGET_INVALID'};}
 if(Object.keys(p).length!==Object.keys(rebuilt).length||Object.keys(rebuilt).some(k=>rebuilt[k]!==p[k])||p.orderId!==offer.orderId||p.driverId!==offer.driverId||p.offerId!==offer.offerId||p.attempt!==offer.financialReceipt?.assignmentAttempt||ms(p.acceptedAt)!==ms(offer.financialReceipt?.acceptedAt))return {status:'EXCLUDED',reason:'ORIGINAL_TARGET_INVALID'};
 if(!order||order.orderId!==p.orderId||order.driverId!==p.driverId||order.financialAcceptance?.offerId!==p.offerId||order.assignmentAttemptCounter!==p.attempt)return {status:'EXCLUDED',reason:'ASSIGNMENT_CHANGED'};
 if(!Number.isFinite(ms(asOf))||ms(p.acceptedAt)>ms(asOf))return {status:'EXCLUDED',reason:'INVALID_EVENT_SEQUENCE'};
 if(!['delivered','completed'].includes(order.status))return {status:['cancelled','canceled','returned','failed','rejected'].includes(order.status)?'EXCLUDED':'IN_PROGRESS',reason:['cancelled','canceled','returned','failed','rejected'].includes(order.status)?'NOT_DELIVERED':'AWAITING_COMPLETION'};
 if(order.walletFinancialStatus!=='SETTLED'||!order.financialOutcome)return {status:'REVIEW',reason:'COMPLETION_UNVERIFIED'};
 const arrival=ms(order.arrivedAtStoreAt),pickup=ms(order.pickedUpAt),customer=ms(order.arrivedAtCustomerAt),delivered=ms(order.deliveredAt),accepted=ms(p.acceptedAt);
 if(![arrival,pickup,customer,delivered].every(Number.isFinite))return {status:'EXCLUDED',reason:'SERVER_EVENTS_INCOMPLETE'};
 if(!(accepted<=arrival&&arrival<=pickup&&pickup<=customer&&customer<=delivered&&delivered<=ms(asOf)))return {status:'REVIEW',reason:'INVALID_EVENT_SEQUENCE'};
 // Later estimates, client times, cash/compensation, and self-reported reasons never rewrite targets.
 const pickupLate=arrival>ms(p.pickupTargetAt)+p.graceSeconds*1000;
 const customerLate=customer>ms(p.customerTargetAt)+p.graceSeconds*1000;
 // A wait after the original preparation/pickup target may explain lateness, but
 // current storage has no independent restaurant-delay proof. Keep it under review.
 const expectedPickup=Math.max(ms(p.pickupTargetAt),p.estimatedReadyAt==null?accepted:ms(p.estimatedReadyAt));
 if(customerLate&&pickup>expectedPickup+p.graceSeconds*1000)return {status:'REVIEW',reason:'PICKUP_DELAY_REQUIRES_REVIEW',pickupLate,customerLate};
 return {status:pickupLate||customerLate?'LATE_OBSERVED':'ON_TIME',reason:pickupLate?'STORE_ARRIVAL_AFTER_TARGET':customerLate?'CUSTOMER_ARRIVAL_AFTER_TARGET':'WITHIN_ORIGINAL_TARGETS',pickupLate,customerLate};
}
module.exports={POLICY,buildTimingPlan,classifyTiming};
