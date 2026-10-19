import { createStagingPlatformPromotionResolution } from './platformPromotionResolution';
import { createStagingDeliveryCampaignBudget } from './deliveryCampaignBudget';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { toWholeIqdExact, readMoney } from './money';
import { equal, strongGet, exactCheck, updateChecked, retainPlannedEvidence, FinancialRow as Row } from './driverFinancialTransaction';
const T={wallets:'staging-Wallets',holds:'staging-Holds',ledger:'staging-LedgerEntries',lifecycle:'staging-WalletLifecycle'};
const fail=():never=>{throw Object.assign(Error('COD_RELEASE_CONFLICT'),{code:'COD_RELEASE_CONFLICT'});};
const whole=(v:unknown)=>toWholeIqdExact(readMoney(v));
export function setFinancialFields(check:Row,values:Row){const names:Row={},args:Row={};const parts=Object.entries(values).map(([k,v],i)=>{names['#u'+i]=k;args[':u'+i]=v;return '#u'+i+'=:u'+i;});return updateChecked(check,'SET '+parts.join(', '),names,args);}
/** Shared release plan only; caller MUST atomically compose authorized order/attempt/final-outcome fences. */
export async function prepareCodRelease(db:Pick<DynamoDBDocumentClient,'send'>,order:Row,offer:Row,at:string,operationId:string,releasePromotion:boolean,enableDeliveryFunding=false,unacceptedDeliveryFunding?:Row){
 const deliveryFunding=unacceptedDeliveryFunding??order.financialAcceptance?.deliveryFunding;
 if(unacceptedDeliveryFunding&&(order.financialAcceptance!=null||order.driverId!=null||order.assignedDriverId!=null||order.financialSnapshot?.schemaVersion!==2||!equal(order.financialSnapshot.deliveryFunding,unacceptedDeliveryFunding)||!releasePromotion||whole(offer.allocation.driverWalletHold)!==0))return fail();
 const deliveryFunded=!!unacceptedDeliveryFunding||order.financialAcceptance?.schemaVersion===2;
 if(deliveryFunded&&!enableDeliveryFunding)return fail();
 const H=whole(offer.allocation.driverWalletHold),F=whole(offer.allocation.platformGoodsDiscountFunding),orderId=order.orderId;
 const holdKey={orderId,sk:'HOLD'},hold=await strongGet(db,T.holds,holdKey),ops:Row[]=[],journalLines:Row[]=[];
 if(order.holdAmount!==H||order.holdStatus!==(H?'ACTIVE':'NOT_REQUIRED'))return fail();
 if(H||hold){
  if(!hold||hold.financialSchemaVersion!==2||hold.status!==(H?'ACTIVE':'NOT_REQUIRED')||hold.holdId!==order.holdId||hold.amount!==H||hold.walletId!=='WALLET#DRIVER#'+order.driverId||
   hold.metadata?.assignmentAttempt!==order.assignmentAttemptCounter||hold.metadata?.offerId!==offer.offerId||hold.metadata?.offerDigest!==offer.digest)return fail();
  ops.push(setFinancialFields(exactCheck(T.holds,holdKey,hold),{status:'RELEASED',statusCreatedAt:'RELEASED#'+at,updatedAt:at,releaseOperationId:operationId}));
  if(H){
   const key={operationId:hold.holdId},lc=await strongGet(db,T.lifecycle,key);
   if(!lc||lc.orderId!==orderId||lc.walletId!==hold.walletId||lc.amount!==H||lc.financialSchemaVersion!==2||lc.status!=='REVIEW_REQUIRED')return fail();
   ops.push(setFinancialFields(exactCheck(T.lifecycle,key,lc),{status:'COMPLETED',action:'NONE',updatedAt:at,lastError:null,releaseOperationId:operationId}));
  }
 }else{if(order.holdId!==null)return fail();ops.push({ConditionCheck:{TableName:T.holds,Key:holdKey,ConditionExpression:'attribute_not_exists(orderId)'}});}
 let platformSnapshotCheck:Row|null=null;const DF=deliveryFunded?whole(offer.allocation.platformDeliveryPromotionFunding):0;
 if(deliveryFunded){
  const funding=order.commercialPricing?.funding,agreement=order.commercialPricing?.agreement;
  if(!agreement||F&&(funding?.state!=='RESERVED_WITH_ORDER'||funding.holdId!=='PROMO#'+orderId||whole(funding.amount)!==F))return fail();
  const resolution=await createStagingPlatformPromotionResolution({db}).prepare({orderId,operationId,outcome:'RELEASED',at,expected:[{kind:'GOODS',amount:offer.allocation.platformGoodsDiscountFunding,metadata:{agreementId:agreement.id,agreementVersion:agreement.version,fundingPolicy:funding?.policy??null}},{kind:'DELIVERY',amount:offer.allocation.platformDeliveryPromotionFunding,metadata:{policyPin:deliveryFunding.policyPin}}]});
  if(resolution.replayed||resolution.walletDelta.available!==F+DF)return fail();
  platformSnapshotCheck=resolution.walletCheck??null;
  const campaign=await createStagingDeliveryCampaignBudget({db}).settle({orderId,outcome:'RELEASED',expectedFunding:deliveryFunding});if(campaign.replayed)return fail();
  if(releasePromotion)ops.push(...resolution.operations,...campaign.operations);
  else {
   // Unassignment retains order funding/usage. Convert planned writes into their
   // original evidence predicates, never execute a terminal budget transition.
   ops.push(...retainPlannedEvidence([...resolution.operations.filter(o=>o.Update||o.ConditionCheck),...campaign.operations] as Row[]));
   if(platformSnapshotCheck)ops.push(platformSnapshotCheck);
  }
 }else{
 const promoKey={orderId,sk:'PROMOTION_FUNDING'},promo=await strongGet(db,T.holds,promoKey);
 if(F){
  const funding=order.commercialPricing?.funding,agreement=order.commercialPricing?.agreement;
  if(!promo||promo.status!=='ACTIVE'||promo.amount!==F||promo.walletId!=='WALLET#PLATFORM'||promo.holdId!=='PROMO#'+orderId||promo.purpose!=='PLATFORM_GOODS_DISCOUNT'||funding?.state!=='RESERVED_WITH_ORDER'||funding.holdId!==promo.holdId||whole(funding.amount)!==F||agreement?.id!==promo.metadata?.agreementId||agreement?.version!==promo.metadata?.agreementVersion||!equal(funding.policy,promo.metadata?.fundingPolicy))return fail();
  const check=exactCheck(T.holds,promoKey,promo);
  ops.push(releasePromotion?setFinancialFields(check,{status:'RELEASED',statusCreatedAt:'RELEASED#'+at,updatedAt:at,releaseOperationId:operationId}):check);
 }else{if(promo)return fail();ops.push({ConditionCheck:{TableName:T.holds,Key:promoKey,ConditionExpression:'attribute_not_exists(orderId)'}});}
 }
 for(const [walletId,amount,type,owner] of [['WALLET#DRIVER#'+order.driverId,H,'DRIVER',order.driverId],['WALLET#PLATFORM',releasePromotion?F+DF:0,'PLATFORM',null]] as [string,number,string,string|null][]){
  if(!amount)continue;
  const key={walletId,sk:'META'},w=await strongGet(db,T.wallets,key);
  if(!w||w.walletId!==walletId||w.sk!=='META'||w.ownerType!==type||(owner&&w.ownerId!==owner)||w.currency!=='IQD'||!['ACTIVE','SUSPENDED'].includes(w.status)||w.deletionRequestId!=null||![w.availableBalance,w.lockedBalance,w.version].every(Number.isSafeInteger)||w.availableBalance<0||w.lockedBalance<amount||w.version<1||w.version>=Number.MAX_SAFE_INTEGER||!Number.isSafeInteger(w.availableBalance+w.lockedBalance)||!Number.isSafeInteger(w.availableBalance+amount))return fail();
  const walletFence=exactCheck(T.wallets,key,w,[...new Set([...Object.keys(w),'deletionRequestId'])]);
  if(type==='PLATFORM'&&platformSnapshotCheck&&!equal(platformSnapshotCheck,walletFence))return fail();
  ops.push(setFinancialFields(walletFence,{availableBalance:w.availableBalance+amount,lockedBalance:w.lockedBalance-amount,version:w.version+1,updatedAt:at}));
  for(const bucket of ['AVAILABLE','LOCKED']){
   const delta=bucket==='AVAILABLE'?amount:-amount,before=bucket==='AVAILABLE'?w.availableBalance:w.lockedBalance;
   journalLines.push({walletId,balanceType:bucket,delta,balanceBefore:before,balanceAfter:before+delta,unit:'IQD_WHOLE'});
   ops.push({Put:{TableName:T.ledger,Item:{walletId,sk:`ts#${at}#${bucket}#${operationId}`,transactionId:operationId,type:delta>0?'CREDIT':'DEBIT',category:operationId.startsWith('CR:')?'COD_RETURN_RELEASED':'COD_ASSIGNMENT_RELEASED',amount:delta,balanceBefore:before,balanceAfter:before+delta,relatedEntityId:orderId,relatedEntityType:'ORDER',createdAt:at,metadata:{operationId,orderId,balanceType:bucket,financialSchemaVersion:deliveryFunded?3:2}},ConditionExpression:'attribute_not_exists(sk)'}});
  }
 }
 if(journalLines.reduce((s,r)=>s+BigInt(r.delta),0n)!==0n)return fail();
 return {operations:ops,journalLines,H,F,DF,hold};
}
