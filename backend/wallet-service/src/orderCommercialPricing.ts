import { Money, readMoney, moneyFromMinor, addMoney, subtractMoney, multiplyMoney } from './money';
import { allocateOrder } from './orderAllocation';
import { quoteEntityIdValid, quoteHash } from './deliveryQuoteRecord';

type Row = Record<string, any>;
export class CommercialPricingError extends Error {
  constructor(public readonly code: 'INVALID_COMMERCIAL_PRICING' | 'COMMERCIAL_TERMS_UNAVAILABLE' | 'DISCOUNT_FUNDING_MISMATCH') {
    super(code); this.name = 'CommercialPricingError';
  }
}
const fail = (code: CommercialPricingError['code'] = 'INVALID_COMMERCIAL_PRICING'): never => { throw new CommercialPricingError(code); };
function row(value: unknown, keys: string[]): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) return fail();
  return value as Row;
}
function id(v: unknown): string { if (!quoteEntityIdValid(v)) return fail(); return v; }
function integer(v: unknown, min = 1): number { if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min) return fail(); return v; }
function time(v: unknown): number {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)) return fail();
  const ms = Date.parse(v); if (!Number.isFinite(ms) || new Date(ms).toISOString() !== v) return fail(); return ms;
}
function amount(v: unknown): Money { const m = readMoney(v); if (m.minorAmount < 0) return fail(); return m; }
const zero = moneyFromMinor(0);
function charge(value: unknown, bases: Record<string, Money>) {
  const r = row(value, ['kind', 'basis', 'fixed', 'rate', 'rounding']);
  if (!['EXACT', 'TOWARD_ZERO', 'HALF_AWAY_FROM_ZERO'].includes(r.rounding)) return fail();
  if (r.kind === 'NONE') {
    if (r.basis !== null || r.fixed !== null || r.rate !== null || r.rounding !== 'EXACT') return fail();
    return { amount: zero, basis: null, basisAmount: null };
  }
  if (r.kind === 'FIXED') {
    if (r.basis !== null || r.rate !== null || r.rounding !== 'EXACT') return fail();
    return { amount: amount(r.fixed), basis: null, basisAmount: null };
  }
  if (r.kind !== 'PERCENT' || r.fixed !== null || !Object.prototype.hasOwnProperty.call(bases, r.basis)) return fail();
  const rate = row(r.rate, ['numerator', 'denominator']);
  integer(rate.numerator, 0); integer(rate.denominator);
  if (rate.numerator > rate.denominator) return fail();
  const basisAmount = bases[r.basis];
  return { amount: multiplyMoney(basisAmount, rate.numerator, rate.denominator, r.rounding), basis: r.basis, basisAmount };
}
/** Pure calculation of already-resolved commercial terms. Not a policy/approval/payment reader,
 * campaign eligibility engine, discount usage reservation, funding proof or financial writer.
 * Server adapters must verify each agreement/campaign source and fence their live versions.
 */
export function calculateOrderCommercialPricing(value: unknown) {
  try {
    const r = row(value, ['schemaVersion', 'at', 'branchId', 'merchantId', 'goodsGross', 'agreement', 'goodsDiscounts',
      'paymentMethod', 'customerDeliveryFee', 'driverTip', 'merchantOtherCharges', 'platformOtherCharges', 'thirdPartyOtherCharges']);
    if (r.schemaVersion !== 1 || Buffer.byteLength(JSON.stringify(r)) > 100000) return fail();
    const at = time(r.at), branchId = id(r.branchId), merchantId = id(r.merchantId), goodsGross = amount(r.goodsGross);
    const a = row(r.agreement, ['id', 'version', 'status', 'merchantId', 'branchId', 'effectiveFrom', 'effectiveTo', 'acceptedAt', 'approvedAt', 'commission', 'serviceFee']);
    id(a.id); integer(a.version);
    const start = time(a.effectiveFrom), end = a.effectiveTo === null ? Infinity : time(a.effectiveTo);
    if (a.status !== 'ACTIVE' || a.merchantId !== merchantId || (a.branchId !== null && a.branchId !== branchId) ||
        end <= start || at < start || at >= end || time(a.acceptedAt) > at || time(a.approvedAt) > at) return fail('COMMERCIAL_TERMS_UNAVAILABLE');
    if (!Array.isArray(r.goodsDiscounts) || r.goodsDiscounts.length > 20) return fail();
    let merchantGoodsDiscount = zero, platformGoodsDiscount = zero;
    const seen = new Set<string>();
    const discounts = r.goodsDiscounts.map((v: unknown) => {
      const d = row(v, ['id', 'version', 'target', 'amount', 'merchantShare', 'platformShare']);
      const discountId = id(d.id); integer(d.version);
      // No mixed versions of one campaign; delivery discounts and stacking require separate contracts.
      if (seen.has(discountId) || d.target !== 'GOODS') return fail(); seen.add(discountId);
      const discountAmount = amount(d.amount), merchantShare = amount(d.merchantShare), platformShare = amount(d.platformShare);
      if (addMoney(merchantShare, platformShare).minorAmount !== discountAmount.minorAmount) return fail('DISCOUNT_FUNDING_MISMATCH');
      merchantGoodsDiscount = addMoney(merchantGoodsDiscount, merchantShare); platformGoodsDiscount = addMoney(platformGoodsDiscount, platformShare);
      return { id: discountId, version: d.version, target: 'GOODS', amount: discountAmount, merchantShare, platformShare };
    });
    const afterMerchant = subtractMoney(goodsGross, merchantGoodsDiscount), customerGoods = subtractMoney(afterMerchant, platformGoodsDiscount);
    if (afterMerchant.minorAmount < 0 || customerGoods.minorAmount < 0) return fail('DISCOUNT_FUNDING_MISMATCH');
    // These bases never include tip, delivery, other charges or another charge (no recursive fee).
    const bases = { GOODS_GROSS: goodsGross, AFTER_MERCHANT_DISCOUNT: afterMerchant, CUSTOMER_GOODS_PAYMENT: customerGoods };
    const commission = charge(a.commission, bases), serviceFee = charge(a.serviceFee, bases);
    const allocationInput = { allocationSchemaVersion: 1 as const, paymentMethod: r.paymentMethod,
      goodsGross, merchantGoodsDiscount, platformGoodsDiscount, merchantCommission: commission.amount,
      serviceFee: serviceFee.amount, customerDeliveryFee: amount(r.customerDeliveryFee), driverTip: amount(r.driverTip),
      merchantOtherCharges: amount(r.merchantOtherCharges), platformOtherCharges: amount(r.platformOtherCharges), thirdPartyOtherCharges: amount(r.thirdPartyOtherCharges) };
    // Reuse the allocator's excess-commission and conservation checks. E is not inferred here.
    const allocation = allocateOrder({ ...allocationInput, driverEarning: zero });
    const result = { schemaVersion: 1, kind: 'COMMERCIAL_PRICING_PROPOSAL', at: r.at, branchId, merchantId,
      agreement: { id: a.id, version: a.version, hash: quoteHash(a), effectiveTo: a.effectiveTo },
      goodsDiscounts: discounts.sort((x, y) => x.id < y.id ? -1 : x.id > y.id ? 1 : 0),
      commission, serviceFee, allocationInput, customerTotal: allocation.customerTotal,
      merchantPayableOnSuccessfulDelivery: allocation.merchantPayable,
      platformGoodsDiscountFundingRequired: platformGoodsDiscount,
      performsWrites: false, requiresTrustedSourcesAndAtomicFences: true, provesFunding: false };
    return { ...result, digest: quoteHash(result) };
  } catch (e) { if (e instanceof CommercialPricingError) throw e; return fail(); }
}
