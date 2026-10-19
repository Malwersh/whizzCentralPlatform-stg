import { allocateDeliveryFunding } from './deliveryFunding';
import { moneyFromMinor, readMoney } from './money';
import { quoteEntityIdValid, quoteHash } from './deliveryQuoteRecord';

export class DeliveryFundingPolicyError extends Error {
  constructor(public readonly code: string) { super(code); this.name = 'DeliveryFundingPolicyError'; }
}
const fail = (code = 'INVALID_DELIVERY_FUNDING_POLICY'): never => { throw new DeliveryFundingPolicyError(code); };
function exact(v: unknown, keys: string[]): Record<string, any> {
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).sort().join(',') !== [...keys].sort().join(',')) return fail();
  return v as Record<string, any>;
}
function id(v: unknown): string { if (!quoteEntityIdValid(v)) return fail(); return v; }
function integer(v: unknown, min = 0): number { if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min) return fail(); return v; }
function time(v: unknown): number {
  if (typeof v !== 'string' || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString() !== v) return fail(); return Date.parse(v);
}
function money(v: unknown) { try { const m = readMoney(v); if (m.minorAmount < 0) return fail(); return m; } catch { return fail(); } }
function freeze<T>(v: T): T {
  if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v;
}
/** Content contract only. Never interprets a digest as authority or fabricates
 * consent. Existing authenticated commercial workflow must authorize publication.
 * No route calculation, wallet access, eligibility query or policy persistence.
 */
export function readDeliveryFundingPolicy(value: unknown) {
  try {
    const r = exact(value, ['schemaVersion', 'id', 'version', 'merchantId', 'branchId', 'origin', 'effectiveFrom', 'effectiveTo',
      'customerRule', 'funding', 'eligibility', 'limits', 'onUnavailable']);
    if (r.schemaVersion !== 1 || !['MERCHANT', 'PLATFORM', 'SHARED'].includes(r.origin) || r.onUnavailable !== 'NORMAL_TARIFF') return fail();
    id(r.id); integer(r.version, 1); id(r.merchantId); id(r.branchId);
    if (time(r.effectiveTo) <= time(r.effectiveFrom)) return fail();
    const c = r.customerRule;
    if (c?.kind === 'NORMAL' || c?.kind === 'FREE') exact(c, ['kind']);
    else if (['FIXED_TARIFF', 'CAPPED_PRICE', 'AMOUNT_OFF'].includes(c?.kind)) { exact(c, ['kind', 'amount']); money(c.amount); }
    else if (c?.kind === 'PERCENT_OFF') {
      exact(c, ['kind', 'numerator', 'denominator', 'maximumDiscount']);
      if (integer(c.numerator) > integer(c.denominator, 1)) return fail(); money(c.maximumDiscount);
    } else return fail();
    // Reuse allocator validation rather than maintain a second funding schema.
    allocateDeliveryFunding({schemaVersion: 1, referenceFee: moneyFromMinor(0), customerFee: moneyFromMinor(0), funding: r.funding});
    // A source-funded policy cannot silently make the other party liable.
    if ((r.origin === 'MERCHANT' && r.funding.kind !== 'MERCHANT') ||
        (r.origin === 'PLATFORM' && r.funding.kind !== 'PLATFORM') ||
        (r.origin === 'SHARED' && !['SHARED_RATIO', 'CONTRIBUTION_THEN_REMAINDER'].includes(r.funding.kind))) return fail();
    const e = exact(r.eligibility, ['regionIds', 'maximumRoadMeters', 'minimumGoods', 'minimumGoodsBasis', 'audience', 'goodsDiscountStacking']);
    if (!Array.isArray(e.regionIds) || !e.regionIds.length || e.regionIds.length > 100 || new Set(e.regionIds).size !== e.regionIds.length) return fail();
    e.regionIds.forEach(id); integer(e.maximumRoadMeters, 1); money(e.minimumGoods);
    if (!['GOODS_GROSS', 'AFTER_GOODS_DISCOUNTS'].includes(e.minimumGoodsBasis) ||
        !['ALL', 'NEW_CUSTOMER'].includes(e.audience) || !['ALLOW', 'DENY'].includes(e.goodsDiscountStacking)) return fail();
    const l = exact(r.limits, ['merchantPerOrder', 'platformPerOrder', 'merchantBudget', 'platformBudget', 'perCustomerUses']);
    for (const key of ['merchantPerOrder', 'platformPerOrder', 'merchantBudget', 'platformBudget']) money(l[key]);
    integer(l.perCustomerUses, 1);
    if (l.merchantPerOrder.minorAmount > l.merchantBudget.minorAmount || l.platformPerOrder.minorAmount > l.platformBudget.minorAmount ||
        (r.origin === 'MERCHANT' && l.platformBudget.minorAmount !== 0) || (r.origin === 'PLATFORM' && l.merchantBudget.minorAmount !== 0)) return fail();
    // Round-trip detaches caller-owned nested objects before immutable hashing.
    const policy = JSON.parse(JSON.stringify(r));
    return freeze({policy, termsHash: quoteHash(policy)});
  } catch (e) { if (e instanceof DeliveryFundingPolicyError) throw e; return fail(); }
}
/** Compare a stored workflow pin against exact current content. This is integrity
 * validation only: caller must separately verify actor, permissions and live state.
 */
export function assertDeliveryFundingPolicyPin(value: unknown, pin: unknown) {
  const resolved = readDeliveryFundingPolicy(value);
  const p = exact(pin, ['policyId', 'version', 'termsHash']);
  if (p.policyId !== resolved.policy.id || p.version !== resolved.policy.version || p.termsHash !== resolved.termsHash)
    return fail('DELIVERY_FUNDING_TERMS_CHANGED');
  return resolved;
}
/** Apply already-verified caps. Exceeding a budget is a resolver/admission error,
 * never an instruction to change the customer's confirmed price or payer.
 */
export function calculatePolicyDeliveryFunding(value: unknown, referenceFee: unknown, customerFee: unknown) {
  const {policy, termsHash} = readDeliveryFundingPolicy(value);
  const allocation = allocateDeliveryFunding({schemaVersion: 1, referenceFee, customerFee, funding: policy.funding});
  if (allocation.merchantShare.minorAmount > policy.limits.merchantPerOrder.minorAmount ||
      allocation.platformShare.minorAmount > policy.limits.platformPerOrder.minorAmount) return fail('DELIVERY_FUNDING_CAP_EXCEEDED');
  return freeze({policyPin: {policyId: policy.id, version: policy.version, termsHash}, allocation});
}
