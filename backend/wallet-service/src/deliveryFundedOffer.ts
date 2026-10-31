import { buildDriverOffer, driverOfferView, prepareDriverOfferAcceptance, validateDriverOfferOrderSnapshot } from './driverOffer';
import { allocateDeliveryFundedOrder } from './deliveryFundedAllocation';
import { moneyFromMinor } from './money';
import { quoteHash, quoteCanonical } from './deliveryQuoteRecord';
type Row=Record<string,any>;
export class DeliveryFundedOfferError extends Error {
 constructor(public readonly code:string){super(code);this.name='DeliveryFundedOfferError';}
}
const fail=(code='INVALID_DELIVERY_FUNDED_OFFER'):never=>{throw new DeliveryFundedOfferError(code);};
const copy=<T>(v:T):T=>JSON.parse(JSON.stringify(v));
const same=(a:unknown,b:unknown)=>quoteCanonical(a)===quoteCanonical(b);
function exact(v:unknown,keys:string[]):Row {
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join(',')!==[...keys].sort().join(','))return fail();return v as Row;
}
function freeze<T>(v:T):T {if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;}
/** V2 immutable envelope over the existing validated V1 order, preserving all
 * driver/route/payment checks. A digest is not permission or a funding receipt.
 */
export function prepareDeliveryFundedFinancialSnapshot(value:unknown) {
 const r=exact(value,['order','deliveryFunding']),order=validateDriverOfferOrderSnapshot(copy(r.order));
 allocateDeliveryFundedOrder({allocationSchemaVersion:2,base:{...order.allocation,driverEarning:moneyFromMinor(0)},deliveryFunding:r.deliveryFunding});
 const content={schemaVersion:2,kind:'ORDER_DELIVERY_FUNDED_SNAPSHOT',order,deliveryFunding:copy(r.deliveryFunding)};
 return freeze({...content,digest:quoteHash(content)});
}
/** Reuses compensation engine, routes, TTL, payment and legacy offer validation.
 * Pure proposal; V1 issuers/writers intentionally cannot consume this envelope.
 */
export function buildDeliveryFundedOffer(value:unknown) {
 const r=exact(value,['schemaVersion','base','deliveryFunding']);if(r.schemaVersion!==2)return fail();
 const baseOffer=buildDriverOffer(r.base),snapshot=prepareDeliveryFundedFinancialSnapshot({order:baseOffer.source.order,deliveryFunding:r.deliveryFunding});
 const allocation=allocateDeliveryFundedOrder({allocationSchemaVersion:2,base:{...baseOffer.source.order.allocation,driverEarning:baseOffer.calculation.driverEarning},deliveryFunding:snapshot.deliveryFunding});
 const content={schemaVersion:2,kind:'DRIVER_DELIVERY_FUNDED_OFFER',baseOffer,financialSnapshot:snapshot,allocation};
 return freeze({...content,digest:quoteHash(content)});
}
function stored(value:unknown) {
 const r=exact(value,['schemaVersion','kind','baseOffer','financialSnapshot','allocation','digest']);
 const rebuilt=buildDeliveryFundedOffer({schemaVersion:2,base:r.baseOffer?.source,deliveryFunding:r.financialSnapshot?.deliveryFunding});
 if(!same(rebuilt,r))return fail('DELIVERY_FUNDED_OFFER_CHANGED');return rebuilt;
}
/** Driver allowlist remains unchanged; no platform/merchant funding terms leak. */
export function deliveryFundedOfferView(value:unknown,driverId:string,subjectId:string,at:string) {
 const offer=stored(value),view=driverOfferView(offer.baseOffer,driverId,subjectId,at);
 return freeze({...view,schemaVersion:2,kind:offer.kind,offerDigest:offer.digest});
}
/** Exact live order+funding snapshot must match issuance; changing current campaign
 * terms is irrelevant to this accepted order's immutable funding agreement.
 * No writes, wallet funding checks or winner selection are performed here.
 */
export function prepareDeliveryFundedOfferAcceptance(value:unknown) {
 const r=exact(value,['offer','offerId','driverId','subjectId','assignmentId','assignmentVersion','order','deliveryFunding','at','policy']),offer=stored(r.offer);
 deliveryFundedOfferView(offer,r.driverId,r.subjectId,r.at);
 const snapshot=prepareDeliveryFundedFinancialSnapshot({order:r.order,deliveryFunding:r.deliveryFunding});
 if(!same(snapshot,offer.financialSnapshot))return fail('DELIVERY_FUNDED_SNAPSHOT_CHANGED');
 const {deliveryFunding:_funding,...legacy}=r;
 const plan=prepareDriverOfferAcceptance({...legacy,offer:offer.baseOffer});
 return freeze(copy({...plan,kind:'DELIVERY_FUNDED_OFFER_ACCEPTANCE_PLAN',
  expected:{...plan.expected,digest:offer.digest,snapshotHash:snapshot.digest},
  acceptedTerms:{...plan.acceptedTerms,schemaVersion:2,offerDigest:offer.digest,allocation:offer.allocation,deliveryFunding:snapshot.deliveryFunding,financialSnapshotDigest:snapshot.digest},
  requiresDeliveryFundingLifecycle:true}));
}
/** Integrity proof only for a future authorized V2 writer, not a live state
 * transition. Does not weaken the existing V1 assignment verifier.
 */
export function verifyDeliveryFundedAssignment(order:Row,saved:Row,subjectId:string) {
 const offer=stored(saved?.financialOffer),b=offer.baseOffer,terms=order.financialAcceptance;
 if(!terms||terms.schemaVersion!==2||terms.paymentMethod!=='COD'||saved.responseStatus!=='financial_accepted'||saved.isWinner!==true||
  order.driverId!==b.driverId||subjectId!==b.driverSubjectId||order.orderId!==b.orderId||order.assignmentWaveNumber!==b.assignmentVersion||saved.waveNumber!==b.assignmentVersion||
  !same(terms,saved.acceptedTerms)||!same(order.financialSnapshot,offer.financialSnapshot)||order.merchantId!==b.source.order.merchantId||
  ![order.storeId,order.businessId].some(v=>v===b.branchId)||[order.storeId,order.businessId].some(v=>v!==undefined&&v!==b.branchId))return fail('DELIVERY_FUNDED_ASSIGNMENT_CONFLICT');
 const plan=prepareDeliveryFundedOfferAcceptance({offer,offerId:b.offerId,driverId:b.driverId,subjectId,assignmentId:b.assignmentId,assignmentVersion:b.assignmentVersion,order:b.source.order,deliveryFunding:offer.financialSnapshot.deliveryFunding,at:terms.acceptedAt,policy:{version:b.policyVersion,enabledRuleVersions:[{id:b.calculation.rule.id,version:b.calculation.rule.version,hash:b.ruleHash}]}});
 if(!same(plan.acceptedTerms,terms))return fail('DELIVERY_FUNDED_ASSIGNMENT_CONFLICT');
 return offer;
}
