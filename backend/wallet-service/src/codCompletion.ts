import {prepareMerchantAccrualIndex} from './merchantAccrualIndex';
import {settlePlatformBenefit} from './platformBenefits';
import { DynamoDBDocumentClient, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { codIntegrationEvent } from './codIntegrationEvent';
import { verifyDeliveryFundedAssignment } from './deliveryFundedOffer';
import { createStagingDeliveryCampaignBudget } from './deliveryCampaignBudget';
import { createStagingPlatformPromotionResolution } from './platformPromotionResolution';
import { verifyFinancialAssignment } from './financialAssignment';
import { quoteHash, quoteEntityIdValid } from './deliveryQuoteRecord';
import { readMoney, toWholeIqdExact } from './money';
import { detach, equal, strongGet, exactCheck, updateChecked, FinancialRow as Row } from './driverFinancialTransaction';

const T={orders:'WizzOrders',wallets:'staging-Wallets',holds:'staging-Holds',ledger:'staging-LedgerEntries',
 audit:'staging-AuditLog',lifecycle:'staging-WalletLifecycle',offers:'WaveOffers_staging',jobs:'WizzDispatchJobs_staging',
 driver:'WhizzDrivers_staging',live:'WizzDriverLiveState_staging',branch:'WhizzMerchants_Businesses',deletion:'staging-AccountDeletion'};
export class CodCompletionError extends Error {
 constructor(public readonly code:string){super(code);this.name='CodCompletionError';}
}
const fail=(code='COD_COMPLETION_CONFLICT'):never=>{throw new CodCompletionError(code);};
const whole=(v:unknown)=>toWholeIqdExact(readMoney(v));
const safe=(v:number)=>{if(!Number.isSafeInteger(v))return fail('COD_COMPLETION_PRECISION_UNSUPPORTED');return v;};
function set(check:Row,values:Row){
 const names:Row={},args:Row={};const parts=Object.entries(values).map(([k,v],i)=>{names['#u'+i]=k;args[':u'+i]=v;return '#u'+i+'=:u'+i;});
 return updateChecked(check,'SET '+parts.join(', '),names,args);
}
function wallet(row:Row|null,id:string,type:string,owner?:string):Row {
 if(!row||row.walletId!==id||row.sk!=='META'||row.ownerType!==type||(owner!==undefined&&row.ownerId!==owner)||row.status!=='ACTIVE'||row.currency!=='IQD'||row.deletionRequestId!=null||
 ![row.availableBalance,row.lockedBalance,row.version].every(Number.isSafeInteger)||row.availableBalance<0||row.lockedBalance<0||row.version<1||row.version>=Number.MAX_SAFE_INTEGER)return fail('COD_WALLET_UNAVAILABLE');
 safe(row.availableBalance+row.lockedBalance);return row;
}
/** Projection only; called inside the verified COD completion transaction. */
export function codCollectedPaymentFields(order:Row,at:string) {
 const fields:Row={paymentStatus:'captured',codCollectedAt:at};
 if(order.paymentStatus_gsi!==undefined){
  if(typeof order.paymentStatus_gsi!=='string'||!order.paymentStatus_gsi.startsWith('pending#')||order.paymentStatus_gsi.length<=8)throw Error('COD_PAYMENT_INDEX_INVALID');
  fields.paymentStatus_gsi='captured#'+order.paymentStatus_gsi.slice('pending#'.length);
 }
 return fields;
}
/** Verified current-assignment COD only. No client amounts, no generic capture/settle service, no payout.
 * Merchant entitlement is funded in its existing wallet LOCKED bucket and linked to an order line.
 * Authentication must validate the original live driver credential, not invocation/Gateway context.
 */
export function createStagingCodCompletion(options:{db:Pick<DynamoDBDocumentClient,'send'>;
 authenticateDriver:()=>Promise<{driverId:string;subjectId:string}>;now?:()=>number;enableDeliveryFunding?:boolean;enableFullCash?:boolean}) {
 const {db,authenticateDriver}=options,now=options.now??Date.now;
 return Object.freeze({async complete(value:unknown){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='cashCollected,orderId'||(value as Row).cashCollected!==true||!quoteEntityIdValid((value as Row).orderId))return fail('INVALID_COD_COMPLETION');
  const {orderId}=detach(value as Row),actor=detach(await authenticateDriver());
  if(!actor||![actor.driverId,actor.subjectId].every(quoteEntityIdValid))return fail('UNAUTHORIZED');
  const outcomeKey={orderId,sk:'FINANCIAL_OUTCOME'},operationId='COD:'+quoteHash({orderId}).slice(0,48);
  function prior(row:Row|null){
   if(!row)return null;
   if(row.kind!=='COD_COMPLETION_JOURNAL'||row.operationId!==operationId||row.driverId!==actor.driverId||row.subjectId!==actor.subjectId||row.outcome!=='COMPLETED'||row.receipt?.orderId!==orderId)return fail();
   return detach({...row.receipt,replayed:true});
  }
  const replay=prior(await strongGet(db,T.holds,outcomeKey));if(replay)return replay;
  try {
  const key={PK:'ORDER#'+orderId,SK:'META'},order=await strongGet(db,T.orders,key);
  if(!order||order.orderId!==orderId||order.driverId!==actor.driverId||
    !['picked_up','heading_to_customer','arrived_at_customer'].includes(order.status)||
    (order.orderStatus!==undefined&&!['assigned',order.status].includes(order.orderStatus))||(!Number.isSafeInteger(order.assignmentAttemptCounter)||order.assignmentAttemptCounter<1||order.assignmentAttemptCounter>1000)||
    order.deletionStatus!=null||order.deletedAt!=null||order.isDeleted===true||order.financialOutcome!=null||
    ['returnStatus','cancellationStatus','returnCaseId','cancellationRequestId'].some(k=>order[k]!=null))return fail();
  const terms=order.financialAcceptance;
  const deliveryFunded=terms?.schemaVersion===2;
  if(deliveryFunded&&options.enableDeliveryFunding!==true)return fail('DELIVERY_FUNDED_COMPLETION_DISABLED');
  if(!terms||![1,2].includes(terms.schemaVersion)||terms.paymentMethod!=='COD'||!Number.isSafeInteger(order.assignmentWaveNumber))return fail();
  const offerKey={orderId,SK:`FINANCIAL#${actor.driverId}#WAVE#${order.assignmentWaveNumber}`},saved=await strongGet(db,T.offers,offerKey);
  let offer:Row;
  if(deliveryFunded){const verified=verifyDeliveryFundedAssignment(order,saved!,actor.subjectId);offer={...verified.baseOffer,digest:verified.digest,allocation:verified.allocation};}
  else offer=verifyFinancialAssignment(order,saved,actor.subjectId);
  const a=offer.allocation,branchId=offer.branchId;
  if(order.deletionRequestId!=null)return fail();
  const agreement=order.commercialPricing?.agreement;
  if(!agreement||!quoteEntityIdValid(agreement.id)||!Number.isSafeInteger(agreement.version)||agreement.version<1||typeof agreement.termsHash!=='string'||!/^[a-f0-9]{64}$/.test(agreement.termsHash))return fail('COD_AGREEMENT_REQUIRED');
  // Current commercial writer supports no extra charges. Do not silently assign third-party liabilities.
  if(whole(a.thirdPartyPayable)!==0)return fail('COD_OTHER_CHARGES_UNSUPPORTED');
  const H=whole(a.driverWalletHold),A=whole(a.driverWalletCreditTotal),M=whole(a.merchantPayable),PD=whole(a.platformGoodsDiscountFunding),C=whole(a.customerTotal);
  if(whole(a.driverWalletTipCredit)!==0||!equal(terms.driverWalletHold,a.driverWalletHold)||!equal(terms.customerTotal,a.customerTotal)||
    order.holdAmount!==H||order.holdStatus!==(H?'ACTIVE':'NOT_REQUIRED'))return fail();
  const timestamp=new Date(now()).toISOString();
  if(Date.parse(terms.acceptedAt)>Date.parse(timestamp))return fail();
  const driver=await strongGet(db,T.driver,{driverId:actor.driverId}),branch=await strongGet(db,T.branch,{businessId:branchId});
  if(!driver||(driver.cognitoSub??driver.driverId)!==actor.subjectId||!['APPROVED','VERIFIED'].includes(driver.status)||
    driver.isSuspended===true||driver.isBanned===true||driver.isDeleted===true||driver.deletionRequestId!=null||driver.deletedAt!=null||
    !branch||branch.organizationId!==offer.source.order.merchantId||!quoteEntityIdValid(branch.ownerId)||branch.cognitoUserId!==branch.ownerId||branch.deletionRequestId!=null||branch.deletedAt!=null||branch.isDeleted===true)return fail('COD_PARTY_UNAVAILABLE');
  const liveKey={driverId:actor.driverId},live=await strongGet(db,T.live,liveKey),jobKey={orderId,SK:'METADATA'},job=await strongGet(db,T.jobs,jobKey);
  if(!live||live.currentOrderId!==orderId||live.activeOrdersCount!==1||!job||job.assignedDriverId!==actor.driverId||job.status!=='assigned'||job.dispatchJobId!==offer.assignmentId)return fail();
  const ops:Row[]=[exactCheck(T.offers,offerKey,saved!),exactCheck(T.driver,{driverId:actor.driverId},driver),exactCheck(T.branch,{businessId:branchId},branch)];
  if(order.platformBenefitReceipt?.target==='GOODS'){const benefit=await settlePlatformBenefit(db,{orderId,target:'GOODS',outcome:'CAPTURED'});if(benefit.replayed)return fail();ops.push(...benefit.operations);}
  for(const pk of new Set(['ACCOUNT_LIFECYCLE#DRIVER#'+actor.driverId,'ACCOUNT_LIFECYCLE#DRIVER#'+actor.subjectId,'BUSINESS_LIFECYCLE#MERCHANT#'+branchId,'ACCOUNT_LIFECYCLE#MERCHANT#'+branch.ownerId]))
   ops.push({ConditionCheck:{TableName:T.deletion,Key:{pk,sk:'META'},ConditionExpression:'attribute_not_exists(pk)'}});
  const walletIds=['WALLET#DRIVER#'+actor.driverId,'WALLET#MERCHANT#'+branchId,'WALLET#PLATFORM'];
  const wallets:Row[]=[];
  for(let i=0;i<3;i++)wallets.push(wallet(await strongGet(db,T.wallets,{walletId:walletIds[i],sk:'META'}),walletIds[i],['DRIVER','MERCHANT','PLATFORM'][i],i===0?actor.driverId:i===1?branchId:undefined));
  const [dw,mw,pw]=wallets,holdKey={orderId,sk:'HOLD'},hold=await strongGet(db,T.holds,holdKey);
  if(H){
   if(!hold||hold.financialSchemaVersion!==2||hold.status!=='ACTIVE'||hold.amount!==H||hold.walletId!==dw.walletId||hold.holdId!==order.holdId||
     hold.metadata?.offerId!==offer.offerId||hold.metadata?.offerDigest!==offer.digest||hold.metadata?.assignmentAttempt!==order.assignmentAttemptCounter||dw.lockedBalance<H)return fail();
   ops.push(set(exactCheck(T.holds,holdKey,hold),{status:'SETTLED',statusCreatedAt:'SETTLED#'+timestamp,updatedAt:timestamp,settledAt:timestamp,settlementOperationId:operationId}));
   const lifecycleKey={operationId:hold.holdId},lifecycle=await strongGet(db,T.lifecycle,lifecycleKey);
   if(!lifecycle||lifecycle.financialSchemaVersion!==2||lifecycle.orderId!==orderId||lifecycle.status!=='REVIEW_REQUIRED')return fail();
   ops.push(set(exactCheck(T.lifecycle,lifecycleKey,lifecycle),{status:'COMPLETED',action:'NONE',updatedAt:timestamp,lastError:null,settlementOperationId:operationId}));
  }else{
   if(order.holdId!==null||hold&&(hold.status!=='NOT_REQUIRED'||hold.amount!==0||hold.financialSchemaVersion!==2||hold.metadata?.assignmentAttempt!==order.assignmentAttemptCounter||hold.metadata?.offerDigest!==offer.digest))return fail();
   ops.push(hold?exactCheck(T.holds,holdKey,hold):{ConditionCheck:{TableName:T.holds,Key:holdKey,ConditionExpression:'attribute_not_exists(orderId)'}});
  }
  const deliveryFundingAmount=deliveryFunded?whole(a.platformDeliveryPromotionFunding):0;
  if(deliveryFunded){
   const funding=order.commercialPricing?.funding;
   if(PD&&(funding?.holdId!=='PROMO#'+orderId||funding?.state!=='RESERVED_WITH_ORDER'||whole(funding.amount)!==PD))return fail('COD_FUNDING_UNAVAILABLE');
   const resolution=await createStagingPlatformPromotionResolution({db}).prepare({orderId,operationId,outcome:'CAPTURED',at:timestamp,expected:[
    {kind:'GOODS',amount:a.platformGoodsDiscountFunding,metadata:{agreementId:agreement.id,agreementVersion:agreement.version,fundingPolicy:funding?.policy??null}},
    {kind:'DELIVERY',amount:a.platformDeliveryPromotionFunding,metadata:{policyPin:terms.deliveryFunding.policyPin}}]});
   if(resolution.replayed||resolution.walletDelta.available!==safe(PD+deliveryFundingAmount)||resolution.walletDelta.locked!==-safe(PD+deliveryFundingAmount))return fail();
   if(resolution.walletCheck&&!equal(resolution.walletCheck,exactCheck(T.wallets,{walletId:pw.walletId,sk:'META'},pw,[...new Set([...Object.keys(pw),'deletionRequestId'])])))return fail();
   ops.push(...resolution.operations);
   const campaign=await createStagingDeliveryCampaignBudget({db,now}).settle({orderId,outcome:'CAPTURED',expectedFunding:terms.deliveryFunding});
   if(campaign.replayed)return fail();
   ops.push(...campaign.operations);
  }else{
  const promoKey={orderId,sk:'PROMOTION_FUNDING'},promo=await strongGet(db,T.holds,promoKey);
  if(PD){
   const funding=order.commercialPricing?.funding;
   if(!promo||promo.status!=='ACTIVE'||promo.purpose!=='PLATFORM_GOODS_DISCOUNT'||promo.walletId!==pw.walletId||promo.amount!==PD||
    promo.holdId!=='PROMO#'+orderId||funding?.holdId!==promo.holdId||funding?.state!=='RESERVED_WITH_ORDER'||whole(funding.amount)!==PD||
    (agreement.id!==promo.metadata?.agreementId||agreement.version!==promo.metadata?.agreementVersion||!equal(funding.policy,promo.metadata?.fundingPolicy))||pw.lockedBalance<PD)return fail('COD_FUNDING_UNAVAILABLE');
   ops.push(set(exactCheck(T.holds,promoKey,promo),{status:'SETTLED',statusCreatedAt:'SETTLED#'+timestamp,updatedAt:timestamp,settlementOperationId:operationId}));
  }else{
   if(promo)return fail();
   ops.push({ConditionCheck:{TableName:T.holds,Key:promoKey,ConditionExpression:'attribute_not_exists(orderId)'}});
  }
  }
  const cashFunding=safe(PD+deliveryFundingAmount);
  const deltaPlatform=safe(H+cashFunding-M-A);
  // Each funding pool remains nonnegative; a negative margin uses actual available platform funds.
  if(safe(pw.availableBalance+deltaPlatform)<0)return fail('COD_FUNDING_UNAVAILABLE');
  const changes=[{w:dw,available:A,locked:-H},{w:mw,available:0,locked:M},{w:pw,available:deltaPlatform,locked:-cashFunding}];
  ops.push(...await prepareMerchantAccrualIndex(db,{branchId,orderId,operationId,deliveredAt:timestamp,merchantNetIqd:M,financialSchemaVersion:deliveryFunded?3:2}));
  const journalLines:Row[]=[];
  for(const {w,available,locked} of changes){
   const nextAvailable=safe(w.availableBalance+available),nextLocked=safe(w.lockedBalance+locked);safe(nextAvailable+nextLocked);
   if(nextAvailable<0||nextLocked<0)return fail('COD_FUNDING_UNAVAILABLE');
   const fence=exactCheck(T.wallets,{walletId:w.walletId,sk:'META'},w,[...new Set([...Object.keys(w),'deletionRequestId'])]);
   ops.push(available||locked?set(fence,{availableBalance:nextAvailable,lockedBalance:nextLocked,version:w.version+1,updatedAt:timestamp}):fence);
   for(const [bucket,delta,before] of [['AVAILABLE',available,w.availableBalance],['LOCKED',locked,w.lockedBalance]] as [string,number,number][]){
    if(!delta)continue;
    const line={walletId:w.walletId,balanceType:bucket,delta,unit:'IQD_WHOLE',balanceBefore:before,balanceAfter:safe(before+delta)};journalLines.push(line);
    ops.push({Put:{TableName:T.ledger,Item:{walletId:w.walletId,sk:`ts#${timestamp}#${bucket}#${operationId}`,transactionId:operationId,
     type:delta>0?'CREDIT':'DEBIT',category:'COD_COMPLETED',amount:delta,balanceBefore:before,balanceAfter:line.balanceAfter,
     relatedEntityId:orderId,relatedEntityType:'ORDER',createdAt:timestamp,metadata:{orderId,operationId,balanceType:bucket,financialSchemaVersion:deliveryFunded?3:2}},ConditionExpression:'attribute_not_exists(sk)'}});
   }
  }
  if(journalLines.reduce((s,r)=>s+BigInt(r.delta),0n)!==0n)return fail();
  const receipt={success:true,kind:'COD_COMPLETION',orderId,operationId,deliveredAt:timestamp,holdCaptured:H>0,capturedAmount:H,cashCollected:true,cashCollectedAmount:C,replayed:false};
  // Single terminal outcome key is shared by completion, return and cancellation writers.
  ops.push({Put:{TableName:T.holds,Item:{...outcomeKey,kind:'COD_COMPLETION_JOURNAL',schemaVersion:deliveryFunded?2:1,operationId,outcome:'COMPLETED',driverId:actor.driverId,subjectId:actor.subjectId,
   branchId,attempt:order.assignmentAttemptCounter,offerId:offer.offerId,offerDigest:offer.digest,allocation:a,journalLines,receipt,createdAt:timestamp},ConditionExpression:'attribute_not_exists(orderId)'}},
   {Put:{TableName:T.holds,Item:{orderId,sk:'MERCHANT_PAYABLE',kind:'MERCHANT_ORDER_PAYABLE',financialSchemaVersion:deliveryFunded?3:2,walletId:mw.walletId,branchId,
    amount:M,status:'LOCKED_PENDING_SETTLEMENT',operationId,agreement:order.commercialPricing?.agreement??null,...(deliveryFunded?{deliveryFunding:terms.deliveryFunding,merchantDeliverySupport:a.merchantDeliverySupport}:{}),createdAt:timestamp},ConditionExpression:'attribute_not_exists(orderId)'}},
   set(exactCheck(T.orders,key,order,[...new Set([...Object.keys(order),'financialOutcome','returnStatus','cancellationStatus','returnCaseId','cancellationRequestId','deletionStatus','deletionRequestId','deletedAt','isDeleted'])]),
    {status:'delivered',orderStatus:'delivered',deliveredAt:timestamp,updatedAt:timestamp,cashCollected:true,cashCollectedAmount:C,...codCollectedPaymentFields(order,timestamp),holdStatus:H?'SETTLED':'NOT_REQUIRED',walletFinancialStatus:'SETTLED',financialOutcome:operationId}),
   set(exactCheck(T.jobs,jobKey,job),{status:'completed',completedAt:timestamp}),
   set(exactCheck(T.live,liveKey,live),{status:live.isActive===true?'available':'offline',currentOrderId:null,activeOrdersCount:0,isSearching:false}),
   {Put:{TableName:T.audit,Item:{datePartition:'date#'+timestamp.slice(0,10).replace(/-/g,''),sk:timestamp+'#'+operationId,logId:operationId,
    action:'COD_ORDER_COMPLETED',actorId:actor.subjectId,orderId,branchId,operationId,createdAt:timestamp,cashEvidence:'DRIVER_DECLARATION',amount:C,currency:'IQD'},ConditionExpression:'attribute_not_exists(sk)'}},
   codIntegrationEvent({kind:'COD_COMPLETION_OUTBOX',financialOperationId:operationId,orderId,driverId:actor.driverId,subjectId:actor.subjectId,branchId,offerId:offer.offerId,attempt:order.assignmentAttemptCounter,waveNumber:order.assignmentWaveNumber,createdAt:timestamp}));
  if(ops.length>100||Buffer.byteLength(JSON.stringify(ops))>3500000)return fail('COD_COMPLETION_UNAVAILABLE');
  if(!equal(actor,await authenticateDriver()))return fail('UNAUTHORIZED');
  try{await db.send(new TransactWriteCommand({TransactItems:ops as any,ClientRequestToken:quoteHash(ops).slice(0,36)}));}
  catch{const recovered=prior(await strongGet(db,T.holds,outcomeKey));if(recovered)return recovered;return fail('COD_COMPLETION_UNAVAILABLE');}
  return receipt;
  }catch(error){const committed=prior(await strongGet(db,T.holds,outcomeKey));if(committed&&equal(actor,await authenticateDriver()))return committed;throw error;}
 }});
}
