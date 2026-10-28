import {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';
import {strongGet,exactCheck,equal,FinancialRow as Row} from './driverFinancialTransaction';
import {quoteHash} from './deliveryQuoteRecord';
import {codAcceptanceOperation} from './codIntegrationEvent';
import {resolveFinancialOffer} from './financialOfferVersion';
/** Read-only reconciliation before an explicit staff replacement search.
 * Never erase/expire an offer, refund money, infer release from elapsed time,
 * or abandon a pending integration. METADATA/order are fenced by the caller. */
export async function reconcilePriorFinancialSearch(v:{db:Pick<DynamoDBDocumentClient,'send'>;order:Row;job:Row;offers:Row[];rows:Row[];holds:Row[];at:string}){
 const {db,order,offers,rows,holds}=v,orderId=order.orderId,guards:Row[]=[];
 const blocked=(resultCode:string)=>({ready:false as const,resultCode,guards:[] as Row[]});
 if(!Number.isFinite(Date.parse(v.at))||order.pickedUpAt!=null||order.deliveredAt!=null||order.completedAt!=null||order.merchantHandover?.state==='HANDED_TO_DRIVER'||order.merchantHandover?.handedOverAt!=null||order.merchantHandover?.status==='HANDED_OVER')return blocked('GOODS_ALREADY_HANDED_OVER');
 const releases=holds.filter(h=>h.kind==='COD_ASSIGNMENT_RELEASE'),count=order.assignmentAttemptCounter??0;
 if(!Number.isSafeInteger(count)||count<0||count>50||releases.length!==count)return blocked('PRIOR_RELEASE_INVENTORY_REQUIRED');
 for(let attempt=1;attempt<=count;attempt++){
  const release=releases.find(h=>h.sk==='ASSIGNMENT_RELEASE#'+attempt);
  if(!release||release.orderId!==orderId||release.attempt!==attempt||release.outcome!=='UNASSIGNED'||release.branchId!==v.job.restaurantId||release.snapshotDigest!==quoteHash(order.financialSnapshot)||release.receipt?.kind!=='COD_UNASSIGNED'||release.receipt?.operationId!==release.operationId||release.receipt?.offerId!==release.offerId||release.receipt?.attempt!==attempt||release.releasedHold&&release.releasedHold.status!=='RELEASED')return blocked('PRIOR_RELEASE_PROOF_REQUIRED');
  const accepted=offers.find(o=>o.offerId===release.offerId);
  if(!accepted||accepted.responseStatus!=='financial_accepted'||accepted.driverId!==release.driverId||accepted.isWinner!==true)return blocked('PRIOR_RELEASE_OFFER_REQUIRED');
  for(const operation of [codAcceptanceOperation(orderId,release.offerId,attempt),release.operationId]){
   const k={operationId:operation+':EVENT'},event=await strongGet(db,'staging-WalletLifecycle',k);
   if(!event||event.status!=='INTEGRATED'||event.orderId!==orderId||event.driverId!==release.driverId||event.offerId!==release.offerId||event.attempt!==attempt)return blocked('PRIOR_FINANCIAL_INTEGRATION_PENDING');
   guards.push(exactCheck('staging-WalletLifecycle',k,event));
  }
  guards.push(exactCheck('staging-Holds',{orderId,sk:release.sk},release));
 }
 const currentHold=holds.find(h=>h.sk==='HOLD'),last=releases.find(h=>h.attempt===count);
 if(currentHold&&(currentHold.status!=='RELEASED'||!last||!equal(currentHold,last.releasedHold)))return blocked('PRIOR_GUARANTEE_RELEASE_PROOF_REQUIRED');
 const seen=new Set();
 for(const row of offers){
  let offer:Row;try{offer=resolveFinancialOffer(row.financialOffer,true,true);}catch{return blocked('PRIOR_OFFER_PROOF_REQUIRED');}
  if(row.kind!=='FINANCIAL_DRIVER_OFFER'||row.schemaVersion!==2||row.orderId!==orderId||row.offerId!==offer.offerId||row.driverId!==offer.driverId||row.dispatchJobId!==offer.assignmentId||row.waveNumber<1||row.expiresAt!==offer.expiresAt||seen.has(row.offerId))return blocked('PRIOR_OFFER_PROOF_REQUIRED');
  seen.add(row.offerId);
  const accepted=row.responseStatus==='financial_accepted';
  if(accepted){if(!releases.some(r=>r.offerId===row.offerId))return blocked('PRIOR_ACCEPTANCE_NOT_RELEASED');}
  else if(row.isWinner!==false||!['financial_pending','financial_declined','financial_expired'].includes(row.responseStatus)||!Number.isFinite(Date.parse(row.expiresAt))||Date.parse(row.expiresAt)>Date.parse(v.at))return blocked('PRIOR_OFFER_STILL_ACTIVE');
  guards.push(exactCheck('WaveOffers_staging',{orderId,SK:row.SK},row));
 }
 // Legacy response integration also refers to the original cycle; it must finish first.
 for(const row of rows.filter(r=>r.kind==='DISPATCH_RESPONSE_OUTBOX')){
  if(!['INTEGRATED','SUPPRESSED_DELETION'].includes(row.state))return blocked('RESPONSE_INTEGRATION_PENDING');
  guards.push(exactCheck('WizzDispatchJobs_staging',{orderId,SK:row.SK},row));
 }
 // Keep reconciliation in the same bounded atomic transaction as the restart.
 if(guards.length+rows.filter(r=>r.kind==='FINANCIAL_WAVE').length>65)return blocked('RETRY_INVENTORY_REQUIRES_EXTENDED_REVIEW');
 return {ready:true as const,guards};
}
