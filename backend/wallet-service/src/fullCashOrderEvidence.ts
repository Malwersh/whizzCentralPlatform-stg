import {verifyCashRoundingEvidence} from './cashRounding';
import {prepareFullCashOrderSnapshot} from './fullCashOffer';
import {verifyGoodsPromotionExposure} from './goodsPromotionExposure';
import {quoteCanonical} from './deliveryQuoteRecord';
import {readMoney} from './money';
type Row=Record<string,any>;
const fail=():never=>{throw Object.assign(Error('INVALID_QUOTE_ORDER'),{code:'INVALID_QUOTE_ORDER'});};
const same=(a:any,b:any)=>quoteCanonical(a)===quoteCanonical(b);
export function hasBenefitOrderEvidence(operations:Row[],order:Row,subjectId:string,target:'GOODS'|'DELIVERY',amountMinor:number,funding?:Row){
 const receipt=target==='DELIVERY'?order.platformDeliveryBenefitReceipt??order.platformBenefitReceipt:order.platformBenefitReceipt;
 if(receipt?.schemaVersion!==1||receipt.target!==target||typeof receipt.campaignId!=='string')return false;
 const writes=operations.filter(x=>x.Put?.TableName==='staging-WizzOfferJourney').map(x=>x.Put);
 const hold=writes.find(x=>x.Item?.pk==='BENEFIT_ORDER#'+order.orderId&&x.Item?.sk===target);
 const grant=writes.find(x=>x.Item?.pk==='USER#'+subjectId&&x.Item?.sk==='BENEFIT#'+receipt.campaignId);
 return !!hold&&!!grant&&hold.ConditionExpression==='attribute_not_exists(pk)'&&typeof grant.ConditionExpression==='string'&&
  hold.Item.orderId===order.orderId&&hold.Item.target===target&&hold.Item.sub===subjectId&&hold.Item.campaignId===receipt.campaignId&&hold.Item.status==='RESERVED'&&hold.Item.version===1&&hold.Item.amountMinor===amountMinor&&
  grant.Item.revoked===false&&Number.isSafeInteger(grant.Item.version)&&grant.Item.version>0&&Number.isSafeInteger(grant.Item.reservedUses)&&grant.Item.reservedUses>0&&Number.isSafeInteger(grant.Item.usedUses)&&grant.Item.usedUses>=0&&Number.isSafeInteger(grant.Item.grantedUses)&&grant.Item.reservedUses+grant.Item.usedUses<=grant.Item.grantedUses&&
  (target!=='DELIVERY'||same(hold.Item.deliveryFunding,funding)&&receipt.termsHash===funding?.policyPin?.termsHash&&funding?.policyPin?.policyId==='PLATFORM_BENEFIT#'+receipt.campaignId);
}
/** Verify the same full-cash commitment contract as the published writer before consuming a quote. */
export function verifyFullCashOrderEvidence(order:Row,operations:Row[],deliveryFunding:Row|undefined,subjectId:string){
 const snapshot=prepareFullCashOrderSnapshot({order:order.financialSnapshot.order,deliveryFunding:deliveryFunding??null});
 const commitment=operations.find(x=>x.Put?.TableName==='staging-Holds'&&x.Put.Item?.orderId===order.orderId&&x.Put.Item?.sk==='FULL_CASH_FUNDING_COMMITMENT')?.Put?.Item;
 if(snapshot.order.orderId!==order.orderId||snapshot.order.branchId!==order.storeId||snapshot.order.merchantId!==order.merchantId||snapshot.order.confirmedCustomerTotal.minorAmount!==order.pricing?.total||snapshot.order.allocation.paymentMethod!=='COD'||!same(snapshot,order.financialSnapshot)||!commitment||commitment.kind!=='FULL_CASH_FUNDING_COMMITMENT'||commitment.settlementModel!=='FULL_CASH_AT_DELIVERY_V1'||commitment.branchId!==order.storeId||commitment.merchantId!==order.merchantId||commitment.status!=='COMMITTED'||commitment.snapshotDigest!==snapshot.digest||!same(commitment.deliveryFunding,deliveryFunding??null)||!same(commitment.platformGoodsFunding,snapshot.order.allocation.platformGoodsDiscount)||operations.some(x=>x.Update?.TableName==='staging-Wallets'||x.Put?.TableName==='staging-Holds'&&['PROMOTION_FUNDING','DELIVERY_PROMOTION_FUNDING'].includes(x.Put.Item?.sk)))return fail();
 if(commitment.cashRounding||order.commercialPricing?.cashRounding){
  const cash=verifyCashRoundingEvidence(commitment.cashRounding);
  if(!same(cash,order.commercialPricing?.cashRounding)||cash.customerTotal.minorAmount!==snapshot.order.confirmedCustomerTotal.minorAmount||cash.serviceFee.minorAmount!==snapshot.order.allocation.serviceFee.minorAmount)return fail();
 }
 const amount=readMoney(snapshot.order.allocation.platformGoodsDiscount).minorAmount;
 if(amount>0){
  const exposure=verifyGoodsPromotionExposure(commitment.goodsExposure,snapshot.order.allocation.platformGoodsDiscount);
  if(!same(exposure,order.commercialPricing?.funding?.exposure))return fail();
  if(exposure.schemaVersion===2&&(!hasBenefitOrderEvidence(operations,order,subjectId,'GOODS',amount)||order.platformBenefitReceipt?.campaignId!==exposure.campaignId))return fail();
 }
 return snapshot;
}
