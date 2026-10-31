import {quoteHash,quoteCanonical,quoteEntityIdValid} from './deliveryQuoteRecord';
import {moneyFromMinor,readMoney} from './money';
type Row=Record<string,any>;
const fail=():never=>{throw Object.assign(Error('ORDER_EXCEPTION_POLICY_INVALID'),{code:'ORDER_EXCEPTION_POLICY_INVALID'});};
export const EXCEPTION_POLICY_VERSION='OECSR_STAGING_COD_V1';
const rules={payments:'COD_ONLY',returnExtraFeeEnabled:false,returnExtraFee:moneyFromMinor(0),
 originalFareAfterVerifiedAttempt:'FULL_WITHOUT_UNCOLLECTED_TIP',prePickupAutomaticFare:false,
 incidentBeforeAttempt:'MANUAL_REVIEW',merchantCompensation:'AGREEMENT_AND_EVIDENCE',
 allegedReasonDeterminesLiability:false,autoDisposition:false,autoDriverFare:false,
 autoMerchantCompensation:false,autoCustomerCashRefund:false,driverSelfDisposal:false,
 contactWaitSeconds:600,minimumContactAttempts:3,claimWindowSeconds:null,appealWindowSeconds:null};
function freeze<T>(v:T):T{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;}
/** Server-pinned at creation only. Null timings require a human decision, never a default timer. */
export function createOrderExceptionPolicy(at:string){
 if(typeof at!=='string'||!Number.isFinite(Date.parse(at))||new Date(at).toISOString()!==at)return fail();
 const body={schemaVersion:1,version:EXCEPTION_POLICY_VERSION,market:'STAGING',effectiveForOrderCreatedAt:at,rules};
 return freeze(JSON.parse(JSON.stringify({...body,digest:quoteHash(body)})));
}
export function readOrderExceptionPolicy(order:Row){
 if(order.exceptionPolicy===undefined)return null;
 const expected=createOrderExceptionPolicy(order.createdAt);
 if(quoteCanonical(order.exceptionPolicy)!==quoteCanonical(expected)||!['cash','cod'].includes(String(order.paymentMethod).toLowerCase()))return fail();
 return expected;
}
/** Case metadata only: no entitlement approval, money posting or inferred delivery attempt. */
export function returnResolution(order:Row,offer:Row,record:Row,status:string,at:string){
 const policy=readOrderExceptionPolicy(order);if(!policy)return null;
 if(!quoteEntityIdValid(record.returnId)||!['REQUESTED','RETURNING','ARRIVED_AT_BRANCH','CONFIRMED','REVIEW_REQUIRED'].includes(status)||!Number.isFinite(Date.parse(at)))return fail();
 const originalFare=readMoney(offer.allocation.driverEarningEntitlement);
 const zero=moneyFromMinor(0);
 return {schemaVersion:1,caseId:'OEX:'+quoteHash({orderId:order.orderId,returnId:record.returnId}).slice(0,48),
  type:'COD_DELIVERY_EXCEPTION',orderId:order.orderId,assignmentAttempt:order.assignmentAttemptCounter,
  policyVersion:policy.version,policyDigest:policy.digest,status:status==='REQUESTED'?'DISPOSITION_REQUESTED':status==='CONFIRMED'?'SETTLEMENT_PENDING':status==='REVIEW_REQUIRED'?'MANUAL_REVIEW':'EVIDENCE_COLLECTION',
  allegedReason:record.reason,responsibility:record.exceptionResolution?.responsibility??'UNDETERMINED',
  custody:{state:status==='REQUESTED'?'WITH_DRIVER':status==='CONFIRMED'?'RETURNED_TO_MERCHANT':status==='REVIEW_REQUIRED'?(record.allItemsReceived===true&&record.condition!=='MISSING'?'RETURNED_TO_MERCHANT':'PARTIALLY_RETURNED_OR_DISPUTED'):status==='ARRIVED_AT_BRANCH'?'VERIFYING_RETURN':'RETURN_IN_TRANSIT',verified:status==='CONFIRMED'||status==='REVIEW_REQUIRED'&&record.allItemsReceived===true&&record.condition!=='MISSING',...(record.itemReceipt?{itemReceipt:record.itemReceipt}:{}),...(record.condition?{condition:record.condition}:{}),...(record.confirmedAt?{confirmedAt:record.confirmedAt}:{})},
  cash:{state:'UNPAID',actuallyCollected:zero,actuallyRefunded:zero},
  driverOriginalFare:{status:'REVIEW',basisAmount:originalFare,approvedAmount:null,paymentStatus:'NOT_APPROVED',requiresVerifiedAttempt:true,requiresResponsibilityDecision:true},
  driverReturnExtraFare:{status:'NOT_APPLICABLE',amount:zero},
  merchantCompensation:{status:'REVIEW',approvedAmount:null,paymentStatus:'NOT_APPROVED',requiresAgreementAndEvidence:true},
  createdAt:record.createdAt,updatedAt:at};
}
/** Merchant must not receive driver fare, customer evidence, funding or liability allocations. */
export function merchantReturnResolution(record:Row){
 const r=record.exceptionResolution;if(!r)return null;
 return {caseId:r.caseId,status:r.status,policyVersion:r.policyVersion,custody:r.custody,
  merchantCompensation:r.merchantCompensation,nextStep:r.custody?.verified?'اكتمل استلام الأصناف؛ مراجعة الحالة والتعويض مستقلة':r.status==='MANUAL_REVIEW'?'مراجعة استلام المرتجع والعهدة':'تقييم مستحق المطعم وفق الاتفاقية والأدلة',
  custodyClosureDoesNotSettleCompensation:true};
}
