import {verifyDeliveryFundingComposition} from './deliveryFundingComposition';
import { allocateOrder } from './orderAllocation';
import { Money, readMoney, moneyFromMinor, addMoney, subtractMoney } from './money';
import { quoteEntityIdValid } from './deliveryQuoteRecord';
type Row = Record<string, any>;
export class DeliveryFundedAllocationError extends Error {
  constructor(public readonly code:string) {super(code);this.name='DeliveryFundedAllocationError';}
}
const fail=(code='INVALID_DELIVERY_FUNDED_ALLOCATION'):never=>{throw new DeliveryFundedAllocationError(code);};
function exact(v:unknown,keys:string[]):Row {
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join(',')!==[...keys].sort().join(','))return fail();return v as Row;
}
function amount(v:unknown):Money {const m=readMoney(v);if(m.minorAmount<0)return fail();return m;}
const positive=(m:Money)=>m.minorAmount>0?m:moneyFromMinor(0);
/** Explicit V2 pure proposal. Reuses V1 goods/commission/customer/driver math;
 * never passes delivery subsidies off as a goods discount. Does not authenticate
 * a funding pin, prove liquidity, reserve/capture a hold or authorize settlement.
 * Legacy snapshot readers must keep rejecting it until V2 lifecycle support exists.
 */
export function allocateDeliveryFundedOrder(value:unknown) {
 try {
  const r=exact(value,['allocationSchemaVersion','base','deliveryFunding']);if(r.allocationSchemaVersion!==2)return fail();
  const composite=r.deliveryFunding?.allocation?.schemaVersion===3;
  if(composite)verifyDeliveryFundingComposition(r.deliveryFunding);
  const funding=exact(r.deliveryFunding,['policyPin','allocation',...(composite?['components']:[])]),pin=exact(funding.policyPin,['policyId','version','termsHash']);
  if(!(quoteEntityIdValid(pin.policyId)||typeof pin.policyId==='string'&&pin.policyId.startsWith('PLATFORM_BENEFIT#')&&quoteEntityIdValid(pin.policyId.slice('PLATFORM_BENEFIT#'.length)))||!Number.isSafeInteger(pin.version)||pin.version<1||typeof pin.termsHash!=='string'||!/^[a-f0-9]{64}$/.test(pin.termsHash))return fail();
  const a=exact(funding.allocation,['schemaVersion','referenceFee','customerFee','subsidy','merchantShare','platformShare']);if(![1,2,3].includes(a.schemaVersion))return fail();
  const referenceFee=amount(a.referenceFee),customerFee=amount(a.customerFee),subsidy=amount(a.subsidy),merchantShare=amount(a.merchantShare),platformShare=amount(a.platformShare);
  if((a.schemaVersion===3?subsidy.minorAmount:a.schemaVersion===2?Math.max(0,referenceFee.minorAmount-customerFee.minorAmount):subtractMoney(referenceFee,customerFee).minorAmount)!==subsidy.minorAmount||addMoney(merchantShare,platformShare).minorAmount!==subsidy.minorAmount)return fail('DELIVERY_FUNDING_MISMATCH');
  const base=allocateOrder(r.base);
  if(readMoney(r.base.customerDeliveryFee).minorAmount!==customerFee.minorAmount)return fail('DELIVERY_FUNDING_MISMATCH');
  const merchantPayable=subtractMoney(base.merchantPayable,merchantShare);
  if(merchantPayable.minorAmount<0)return fail('MERCHANT_DELIVERY_SUPPORT_EXCEEDS_PAYABLE');
  const baselineDeliveryMargin=subtractMoney([2,3].includes(a.schemaVersion)?addMoney(customerFee,subsidy):referenceFee,base.driverEarningEntitlement);
  const deliveryNetContribution=subtractMoney(baselineDeliveryMargin,platformShare);
  const platformNetContribution=addMoney(base.platformNetContribution,merchantShare);
  // Customer cash is allocated exactly once. Platform contribution is signed and
  // already includes platform goods and delivery funding: do NOT subtract again.
  const sum=addMoney(merchantPayable,base.driverTotalEntitlement,base.thirdPartyPayable,platformNetContribution);
  if(sum.minorAmount!==base.customerTotal.minorAmount)return fail('DELIVERY_ALLOCATION_UNBALANCED');
  const netDeliverySubsidy=positive(subtractMoney(base.deliverySubsidy,merchantShare));
  const retained={policyId:pin.policyId,version:pin.version,termsHash:pin.termsHash};
  return Object.freeze({...base,ruleVersion:'ORDER_ALLOCATION_V2_DELIVERY_FUNDING' as const,
   merchantPayableBeforeDeliverySupport:base.merchantPayable,merchantPayable,
   merchantDeliverySupport:merchantShare,platformDeliveryPromotionFunding:platformShare,
   platformPromotionCashReservation:addMoney(base.platformGoodsDiscountFunding,platformShare),
   referenceDeliveryFee:referenceFee,customerDeliveryFee:customerFee,deliveryPromotionSubsidy:subsidy,
   baselineDeliveryMargin,platformBaselineDeliverySubsidy:positive(subtractMoney(moneyFromMinor(0),baselineDeliveryMargin)),
   deliveryNetContribution,grossDeliveryShortfall:base.deliverySubsidy,deliverySubsidy:netDeliverySubsidy,
   platformSubsidy:addMoney(netDeliverySubsidy,base.platformGoodsDiscountFunding),platformNetContribution,
   deliveryFundingPin:Object.freeze(retained)});
 }catch(e){if(e instanceof DeliveryFundedAllocationError)throw e;return fail();}
}
