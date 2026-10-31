import { calculateDeliveryFee } from './deliveryPricing';
import { readDeliveryFundingPolicy, calculatePolicyDeliveryFunding } from './deliveryFundingPolicy';
import { Money, readMoney, moneyFromMinor, subtractMoney, multiplyMoney, quantizeWholeIqd } from './money';

export class DeliveryPromotionError extends Error {
  constructor(public readonly code: string) { super(code); this.name = 'DeliveryPromotionError'; }
}
const fail = (code = 'INVALID_DELIVERY_PROMOTION'): never => { throw new DeliveryPromotionError(code); };
function exact(v: unknown, keys: string[]): Record<string, any> {
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).sort().join(',') !== [...keys].sort().join(',')) return fail();
  return v as Record<string, any>;
}
function amount(v: unknown): Money { try { const m = readMoney(v); if (m.minorAmount < 0) return fail(); return m; } catch { return fail(); } }
/** Pure candidate calculation, NOT a trusted policy reader, approval or admission.
 * Caller must supply independently verified policy/cart/customer/usage facts and
 * atomically fence them and reserve budget before creating an order. No driver
 * earning input is accepted. Reuses route tariff and discount arithmetic engine.
 */
export function calculateDeliveryPromotionCandidate(value: unknown) {
  const override=!!value&&typeof value==='object'&&Object.prototype.hasOwnProperty.call(value,'referenceFee');
  const r = exact(value, ['pricingRequest', 'policy', 'eligibility',...(override?['referenceFee']:[])]);
  const request = exact(r.pricingRequest, ['schemaVersion', 'at', 'context', 'rules', 'deliveryRoute', 'discount']);
  if (request.discount !== null) return fail('DELIVERY_PROMOTION_STACKING_UNSUPPORTED');
  const base = calculateDeliveryFee(request), referenceFee = override?amount(r.referenceFee):base.customerDeliveryFee;
  const {policy, termsHash} = readDeliveryFundingPolicy(r.policy);
  const e = exact(r.eligibility, ['goodsGross', 'goodsAfterDiscounts', 'hasGoodsDiscount', 'isNewCustomer', 'customerUses']);
  const gross = amount(e.goodsGross), after = amount(e.goodsAfterDiscounts);
  if (after.minorAmount > gross.minorAmount || typeof e.hasGoodsDiscount !== 'boolean' || typeof e.isNewCustomer !== 'boolean' ||
      !Number.isSafeInteger(e.customerUses) || e.customerUses < 0 || (!e.hasGoodsDiscount && after.minorAmount !== gross.minorAmount)) return fail();
  if (policy.branchId !== request.context.branchId || policy.merchantId !== request.context.merchantId) return fail('DELIVERY_PROMOTION_SCOPE_MISMATCH');
  const at = Date.parse(request.at);
  const eligible = at >= Date.parse(policy.effectiveFrom) && at < Date.parse(policy.effectiveTo) &&
    policy.eligibility.regionIds.includes(request.context.zoneId) && base.deliveryRoute.distanceMeters <= policy.eligibility.maximumRoadMeters &&
    (policy.eligibility.minimumGoodsBasis === 'GOODS_GROSS' ? gross : after).minorAmount >= policy.eligibility.minimumGoods.minorAmount &&
    (policy.eligibility.audience === 'ALL' || e.isNewCustomer) &&
    (policy.eligibility.goodsDiscountStacking === 'ALLOW' || !e.hasGoodsDiscount) && e.customerUses < policy.limits.perCustomerUses;
  const pin = Object.freeze({policyId: policy.id, version: policy.version, termsHash});
  const fallback = (reason: string) => Object.freeze({applied: false as const, reason, policyPin: pin, calculation: base, funding: null});
  if (!eligible) return fallback('NOT_ELIGIBLE');
  const c = policy.customerRule;
  let discount: Money;
  switch (c.kind) {
    case 'NORMAL': return fallback('NORMAL_TARIFF');
    case 'FREE': discount = referenceFee; break;
    case 'FIXED_TARIFF':
      // Price increases require a real tariff agreement, not negative promotion funding.
      if (c.amount.minorAmount > referenceFee.minorAmount) return fail('FIXED_TARIFF_REQUIRES_TARIFF_PATH');
      discount = subtractMoney(referenceFee, c.amount); break;
    case 'CAPPED_PRICE': discount = moneyFromMinor(Math.max(0, referenceFee.minorAmount - c.amount.minorAmount)); break;
    case 'AMOUNT_OFF': discount = moneyFromMinor(Math.min(referenceFee.minorAmount, c.amount.minorAmount)); break;
    case 'PERCENT_OFF': {
      // Existing whole-IQD tariff quantum governs the customer-visible discount.
      const raw = multiplyMoney(referenceFee, c.numerator, c.denominator, 'TOWARD_ZERO');
      const bounded = moneyFromMinor(Math.min(raw.minorAmount, c.maximumDiscount.minorAmount));
      discount = base.components.finalRounding && base.components.finalRounding.mode !== 'CEILING' ? quantizeWholeIqd(bounded, {incrementIqd: base.components.finalRounding.incrementIqd, mode: 'TOWARD_ZERO'}) : bounded; break;
    }
    default: return fail();
  }
  if (discount.minorAmount === 0) return fallback('NO_DISCOUNT');
  const beforeRounding=subtractMoney(referenceFee,discount);
  const rounded=override&&base.components.finalRounding?quantizeWholeIqd(beforeRounding,base.components.finalRounding):beforeRounding;
  const charged=moneyFromMinor(Math.min(referenceFee.minorAmount,rounded.minorAmount));
  const calculation = override?{...base,customerDeliveryFee:charged,discountFundingAmount:subtractMoney(referenceFee,charged),components:{...base.components,beforeDiscount:referenceFee,requestedDiscount:discount,customerFeeBeforeFinalRounding:beforeRounding,promotionRoundingAdjustment:subtractMoney(charged,beforeRounding)}}:calculateDeliveryFee({...request, discount: {id: policy.id, fundingParty: policy.origin, amount: discount}});
  if (calculation.discountFundingAmount.minorAmount === 0) return fallback('NO_DISCOUNT');
  let funding;
  try { funding = calculatePolicyDeliveryFunding(policy, referenceFee, calculation.customerDeliveryFee); }
  catch (error) { if ((error as any)?.code === 'DELIVERY_FUNDING_CAP_EXCEEDED') return fallback('FUNDING_CAP_EXCEEDED'); throw error; }
  return Object.freeze({applied: true as const, reason: 'APPLIED', policyPin: pin, calculation, funding});
}
