import { Money, readMoney, subtractMoney, moneyFromMinor, multiplyMoney } from './money';
export class DeliveryFundingError extends Error {
  constructor(public readonly code: string) { super(code); this.name = 'DeliveryFundingError'; }
}
const fail = (code = 'INVALID_DELIVERY_FUNDING'): never => { throw new DeliveryFundingError(code); };
function row(v: unknown, keys: string[]): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return fail();
  const r = v as Record<string, unknown>;
  if (Object.keys(r).length !== keys.length || keys.some(k => !Object.prototype.hasOwnProperty.call(r, k))) return fail();
  return r;
}
function amount(v: unknown): Money {
  try { const m = readMoney(v); if (m.minorAmount < 0) return fail(); return m; } catch { return fail(); }
}
function integer(v: unknown, min: number): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min) return fail(); return v;
}
/** Pure promotion allocation, not an approval/eligibility/budget or wallet writer.
 * referenceFee comes from the existing customer tariff, NOT driver earnings.
 * Trusted adapters must verify versioned consent, scope and budget atomically.
 */
export function allocateDeliveryFunding(value: unknown) {
  const r = row(value, ['schemaVersion', 'referenceFee', 'customerFee', 'funding']);
  if (r.schemaVersion !== 1) return fail();
  const referenceFee = amount(r.referenceFee), customerFee = amount(r.customerFee);
  if (customerFee.minorAmount > referenceFee.minorAmount) return fail('DELIVERY_PROMOTION_INCREASES_PRICE');
  const subsidy = subtractMoney(referenceFee, customerFee);
  if (!r.funding || typeof r.funding !== 'object') return fail();
  const kind = (r.funding as Record<string, unknown>).kind;
  let merchantShare: Money;
  if (kind === 'MERCHANT' || kind === 'PLATFORM') {
    row(r.funding, ['kind']); merchantShare = kind === 'MERCHANT' ? subsidy : moneyFromMinor(0);
  } else if (kind === 'SHARED_RATIO') {
    const f = row(r.funding, ['kind', 'merchantNumerator', 'denominator', 'merchantCap', 'platformCap']);
    const n = integer(f.merchantNumerator, 0), d = integer(f.denominator, 1);
    if (n > d) return fail();
    merchantShare = multiplyMoney(subsidy, n, d, 'TOWARD_ZERO');
    if (merchantShare.minorAmount > amount(f.merchantCap).minorAmount || subtractMoney(subsidy, merchantShare).minorAmount > amount(f.platformCap).minorAmount) return fail('DELIVERY_FUNDING_CAP_EXCEEDED');
  } else if (kind === 'CONTRIBUTION_THEN_REMAINDER') {
    const f = row(r.funding, ['kind', 'contributor', 'contribution', 'remainderCap']);
    if (f.contributor !== 'MERCHANT' && f.contributor !== 'PLATFORM') return fail();
    const contribution = moneyFromMinor(Math.min(amount(f.contribution).minorAmount, subsidy.minorAmount));
    const remainder = subtractMoney(subsidy, contribution);
    if (remainder.minorAmount > amount(f.remainderCap).minorAmount) return fail('DELIVERY_FUNDING_CAP_EXCEEDED');
    merchantShare = f.contributor === 'MERCHANT' ? contribution : remainder;
  } else return fail();
  return Object.freeze({ schemaVersion: 1, referenceFee, customerFee, subsidy,
    merchantShare, platformShare: subtractMoney(subsidy, merchantShare) });
}
