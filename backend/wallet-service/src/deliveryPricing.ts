import { Money, MoneyRounding, WholeIqdRounding, readWholeIqdRounding, quantizeWholeIqd, readMoney, moneyFromMinor, addMoney, subtractMoney, multiplyMoney } from './money';

/** Pure server calculation. Callers must authenticate rules, routes and scope before calling. */
export class PricingError extends Error {
  constructor(public readonly code: 'INVALID_PRICING' | 'NO_PRICING_RULE' | 'AMBIGUOUS_PRICING_RULE' | 'ROUTE_UNAVAILABLE' | 'OUTSIDE_DELIVERY_RANGE') {
    super(code);
    this.name = 'PricingError';
  }
}
type Row = Record<string, unknown>;
function fail(): never { throw new PricingError('INVALID_PRICING'); }
function row(value: unknown, keys: string[]): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const r = value as Row;
  if (Object.keys(r).some(k => !keys.includes(k)) || keys.some(k => !Object.prototype.hasOwnProperty.call(r, k))) return fail();
  return r;
}
function ruleRow(value: unknown, keys: string[]): Row {
  return row(value, [...keys, ...(value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'finalRounding') ? ['finalRounding'] : [])]);
}
function roundingPolicy(r: Row): WholeIqdRounding | undefined {
  if (!Object.prototype.hasOwnProperty.call(r, 'finalRounding')) return undefined;
  try { return readWholeIqdRounding(r.finalRounding); } catch { return fail(); }
}
function roundingLimits(policy: WholeIqdRounding | undefined, minimum: Money, maximum: Money) {
  if (policy && [minimum, maximum].some(m => BigInt(m.minorAmount) % (BigInt(policy.incrementIqd) * 1000n) !== 0n)) return fail();
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{1,150}$/.test(value)) return fail();
  return value;
}
function integer(value: unknown, min = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) return fail();
  return value;
}
function bool(value: unknown): boolean { if (typeof value !== 'boolean') return fail(); return value; }
function amount(value: unknown): Money {
  const m = readMoney(value);
  if (m.minorAmount < 0) return fail();
  return m;
}
function timestamp(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return fail();
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== value) return fail();
  return ms;
}
const zero = moneyFromMinor(0);
const scopeTypes = ['GLOBAL', 'GOVERNORATE', 'CITY', 'ZONE', 'MERCHANT', 'BRANCH'] as const;
type ScopeType = typeof scopeTypes[number];
function scope(value: unknown) {
  const s = row(value, ['type', 'id']);
  if (!scopeTypes.includes(s.type as ScopeType)) return fail();
  const id = text(s.id);
  if (s.type === 'GLOBAL' && id !== 'GLOBAL') return fail();
  return { type: s.type as ScopeType, id };
}
function context(value: unknown) {
  const c = row(value, ['branchId', 'merchantId', 'zoneId', 'cityId', 'governorateId', 'vehicleType']);
  return { branchId: text(c.branchId), merchantId: text(c.merchantId), zoneId: text(c.zoneId), cityId: text(c.cityId), governorateId: text(c.governorateId), vehicleType: text(c.vehicleType) };
}
function common(r: Row) {
  const version = integer(r.version, 1), s = scope(r.scope), priority = integer(r.priority);
  if (!['DRAFT', 'PUBLISHED', 'ARCHIVED'].includes(r.status as string)) return fail();
  const start = timestamp(r.effectiveFrom), end = r.effectiveTo === null ? Infinity : timestamp(r.effectiveTo);
  if (end <= start) return fail();
  const rounding = r.rounding as MoneyRounding;
  if (!['EXACT', 'TOWARD_ZERO', 'HALF_AWAY_FROM_ZERO'].includes(rounding)) return fail();
  if (r.vehicleType !== null) text(r.vehicleType);
  return { id: text(r.id), version, scope: s, priority, status: r.status, start, end, rounding, vehicleType: r.vehicleType, finalRounding: roundingPolicy(r) };
}
const commonKeys = ['id', 'version', 'scope', 'priority', 'status', 'effectiveFrom', 'effectiveTo', 'rounding', 'vehicleType'];
function surcharge(value: unknown) {
  const s = row(value, ['afterMeters', 'flat', 'perKm']);
  return { afterMeters: integer(s.afterMeters), flat: amount(s.flat), perKm: amount(s.perKm) };
}
function peaks(value: unknown) {
  if (!Array.isArray(value) || value.length > 100) return fail();
  const list = value.map(v => {
    const p = row(v, ['id', 'from', 'to', 'amount']);
    const start = timestamp(p.from), end = timestamp(p.to);
    if (end <= start) return fail();
    return { id: text(p.id), start, end, amount: amount(p.amount) };
  }).sort((a, b) => a.start - b.start);
  if (new Set(list.map(p => p.id)).size !== list.length || list.some((p, i) => i > 0 && p.start < list[i - 1].end)) return fail();
  return list;
}
function deliveryRule(value: unknown) {
  const r = ruleRow(value, [...commonKeys, 'base', 'perKm', 'tiers', 'longDistance', 'peaks', 'minimum', 'maximum', 'coverage', 'fallbackPolicyId']);
  const c = common(r), base = amount(r.base), perKm = amount(r.perKm);
  if (c.vehicleType !== null || !Array.isArray(r.tiers) || r.tiers.length > 100) return fail();
  let previous = 0;
  const tiers = r.tiers.map((value, i) => {
    const t = row(value, ['upToMeters', 'fee']);
    const upper = t.upToMeters === null ? Infinity : integer(t.upToMeters, 1);
    if (upper <= previous || (upper === Infinity && i !== (r.tiers as unknown[]).length - 1)) return fail();
    previous = upper;
    return { upToMeters: upper, fee: amount(t.fee) };
  });
  // A tier is a flat distance component; never add a second per-km component accidentally.
  if (tiers.length && perKm.minorAmount !== 0) return fail();
  const minimum = amount(r.minimum), maximum = amount(r.maximum);
  if (maximum.minorAmount < minimum.minorAmount) return fail();
  roundingLimits(c.finalRounding, minimum, maximum);
  const cov = row(r.coverage, ['enabled', 'maxRoadMeters', 'maxDurationSeconds', 'supportedZoneIds']);
  if (!Array.isArray(cov.supportedZoneIds) || !cov.supportedZoneIds.length || cov.supportedZoneIds.length > 1000) return fail();
  const zones = cov.supportedZoneIds.map(text);
  if (new Set(zones).size !== zones.length) return fail();
  if (r.fallbackPolicyId !== null) text(r.fallbackPolicyId);
  return { ...c, base, perKm, tiers, longDistance: surcharge(r.longDistance), peaks: peaks(r.peaks), minimum, maximum,
    coverage: { enabled: bool(cov.enabled), maxRoadMeters: integer(cov.maxRoadMeters, 1), maxDurationSeconds: integer(cov.maxDurationSeconds, 1), zones }, fallbackPolicyId: r.fallbackPolicyId };
}
function compensationRule(value: unknown) {
  const r = ruleRow(value, [...commonKeys, 'base', 'pickupPerKm', 'pickupIncludedMeters', 'deliveryPerKm', 'perMinute', 'longDistance', 'peaks', 'minimum', 'maximum', 'fallbackPolicyId']);
  const c = common(r), minimum = amount(r.minimum), maximum = amount(r.maximum);
  if (maximum.minorAmount < minimum.minorAmount) return fail();
  roundingLimits(c.finalRounding, minimum, maximum);
  if (r.fallbackPolicyId !== null) text(r.fallbackPolicyId);
  return { ...c, base: amount(r.base), pickupPerKm: amount(r.pickupPerKm), pickupIncludedMeters: integer(r.pickupIncludedMeters),
    deliveryPerKm: amount(r.deliveryPerKm), perMinute: amount(r.perMinute), longDistance: surcharge(r.longDistance), peaks: peaks(r.peaks), minimum, maximum, fallbackPolicyId: r.fallbackPolicyId };
}
function select<T extends ReturnType<typeof common>>(rules: T[], c: ReturnType<typeof context>, at: number): T {
  const ids: Record<ScopeType, string> = { GLOBAL: 'GLOBAL', GOVERNORATE: c.governorateId, CITY: c.cityId, ZONE: c.zoneId, MERCHANT: c.merchantId, BRANCH: c.branchId };
  // Zone is explicitly more specific than city. Same rank + priority is a configuration conflict.
  const matches = rules.filter(r => r.status === 'PUBLISHED' && r.start <= at && at < r.end && ids[r.scope.type] === r.scope.id && (r.vehicleType === null || r.vehicleType === c.vehicleType));
  matches.sort((a, b) => scopeTypes.indexOf(b.scope.type) - scopeTypes.indexOf(a.scope.type) || b.priority - a.priority);
  if (!matches.length) throw new PricingError('NO_PRICING_RULE');
  if (matches[1] && matches[0].scope.type === matches[1].scope.type && matches[0].priority === matches[1].priority) throw new PricingError('AMBIGUOUS_PRICING_RULE');
  return matches[0];
}
function readRules<T>(values: unknown, parse: (v: unknown) => T): T[] {
  if (!Array.isArray(values) || values.length > 1000) return fail();
  const rules = values.map(parse);
  const identities = values.map(v => `${(v as Row).id}:${(v as Row).version}`);
  if (new Set(identities).size !== identities.length) return fail();
  return rules;
}
function route(value: unknown, at: number, fallbackPolicyId: unknown) {
  const r = row(value, ['id', 'source', 'quality', 'fallbackPolicyId', 'distanceMeters', 'durationSeconds', 'measuredAt', 'expiresAt']);
  const measuredAt = timestamp(r.measuredAt), expiresAt = timestamp(r.expiresAt);
  text(r.id); text(r.source);
  if (measuredAt > at || expiresAt <= at || expiresAt <= measuredAt) throw new PricingError('ROUTE_UNAVAILABLE');
  if (r.quality !== 'ROAD' && r.quality !== 'ESTIMATED') return fail();
  if (r.quality === 'ROAD' && r.fallbackPolicyId !== null) return fail();
  if (r.quality === 'ESTIMATED' && (fallbackPolicyId === null || text(r.fallbackPolicyId) !== fallbackPolicyId)) throw new PricingError('ROUTE_UNAVAILABLE');
  return Object.freeze({ id: r.id as string, source: r.source as string, quality: r.quality as 'ROAD' | 'ESTIMATED', fallbackPolicyId: r.fallbackPolicyId,
    distanceMeters: integer(r.distanceMeters), durationSeconds: integer(r.durationSeconds), measuredAt: r.measuredAt as string, expiresAt: r.expiresAt as string });
}
function scaled(m: Money, count: number, units: number, rounding: MoneyRounding) { return multiplyMoney(m, count, units, rounding); }
function longPay(s: ReturnType<typeof surcharge>, meters: number, rounding: MoneyRounding) {
  return meters > s.afterMeters ? addMoney(s.flat, scaled(s.perKm, meters - s.afterMeters, 1000, rounding)) : zero;
}
function peakPay(list: ReturnType<typeof peaks>, at: number) { return list.find(p => p.start <= at && at < p.end)?.amount ?? zero; }
function clamp(m: Money, min: Money, max: Money) { return m.minorAmount < min.minorAmount ? min : m.minorAmount > max.minorAmount ? max : m; }
function reference(r: ReturnType<typeof common>) { return Object.freeze({ id: r.id, version: r.version, scope: Object.freeze({ ...r.scope }) }); }

/** Only the branch-to-customer leg is accepted here: driver location cannot increase this fee. */
export function calculateDeliveryFee(value: unknown) {
  const input = row(value, ['schemaVersion', 'at', 'context', 'rules', 'deliveryRoute', 'discount']);
  if (input.schemaVersion !== 1) return fail();
  const at = timestamp(input.at), c = context(input.context);
  const r = select(readRules(input.rules, deliveryRule), c, at), leg = route(input.deliveryRoute, at, r.fallbackPolicyId);
  if (!r.coverage.enabled || !r.coverage.zones.includes(c.zoneId) || leg.distanceMeters > r.coverage.maxRoadMeters || leg.durationSeconds > r.coverage.maxDurationSeconds) throw new PricingError('OUTSIDE_DELIVERY_RANGE');
  const tier = r.tiers.find(t => leg.distanceMeters <= t.upToMeters);
  if (r.tiers.length && !tier) throw new PricingError('OUTSIDE_DELIVERY_RANGE');
  const distance = tier?.fee ?? scaled(r.perKm, leg.distanceMeters, 1000, r.rounding);
  const longDistance = longPay(r.longDistance, leg.distanceMeters, r.rounding), peak = peakPay(r.peaks, at);
  const beforeLimits = addMoney(r.base, distance, longDistance, peak);
  const boundedFee = clamp(beforeLimits, r.minimum, r.maximum);
  const beforeDiscount = r.finalRounding ? quantizeWholeIqd(boundedFee, r.finalRounding) : boundedFee;
  let discount = zero, funding: Readonly<{ id: string; party: string }> | null = null;
  if (input.discount !== null) {
    const d = row(input.discount, ['id', 'fundingParty', 'amount']);
    const requested = amount(d.amount);
    // Preserve discount funding exactly. A sub-quantum delivery discount needs an explicit compatible rule.
    if (r.finalRounding && requested.minorAmount < beforeDiscount.minorAmount && BigInt(requested.minorAmount) % (BigInt(r.finalRounding.incrementIqd) * 1000n) !== 0n) return fail();
    if (!['PLATFORM', 'MERCHANT', 'THIRD_PARTY', 'SHARED'].includes(d.fundingParty as string)) return fail();
    funding = Object.freeze({ id: text(d.id), party: d.fundingParty as string });
    discount = requested.minorAmount > beforeDiscount.minorAmount ? beforeDiscount : requested;
  }
  return Object.freeze({ engineVersion: 'DELIVERY_PRICING_V1' as const, basis: 'CALCULATION_PROPOSAL' as const, rule: reference(r), deliveryRoute: leg,
    components: Object.freeze({ base: r.base, distance, longDistance, peak, beforeLimits, limitAdjustment: subtractMoney(boundedFee, beforeLimits), ...(r.finalRounding ? { finalRounding: r.finalRounding, finalRoundingAdjustment: subtractMoney(beforeDiscount, boundedFee) } : {}), beforeDiscount, discount }),
    customerDeliveryFee: subtractMoney(beforeDiscount, discount), discountFunding: funding, discountFundingAmount: discount });
}

/** E excludes tips and customer fee. No payment, hold or entitlement is written. */
export function calculateDriverEarning(value: unknown) {
  const input = row(value, ['schemaVersion', 'at', 'context', 'rules', 'pickupRoute', 'deliveryRoute']);
  if (input.schemaVersion !== 1) return fail();
  const at = timestamp(input.at), c = context(input.context), r = select(readRules(input.rules, compensationRule), c, at);
  const pickupRoute = route(input.pickupRoute, at, r.fallbackPolicyId), deliveryRoute = route(input.deliveryRoute, at, r.fallbackPolicyId);
  const pickup = scaled(r.pickupPerKm, Math.max(0, pickupRoute.distanceMeters - r.pickupIncludedMeters), 1000, r.rounding);
  const delivery = scaled(r.deliveryPerKm, deliveryRoute.distanceMeters, 1000, r.rounding);
  const seconds = BigInt(pickupRoute.durationSeconds) + BigInt(deliveryRoute.durationSeconds);
  const meters = BigInt(pickupRoute.distanceMeters) + BigInt(deliveryRoute.distanceMeters);
  if (seconds > BigInt(Number.MAX_SAFE_INTEGER) || meters > BigInt(Number.MAX_SAFE_INTEGER)) return fail();
  const time = scaled(r.perMinute, Number(seconds), 60, r.rounding);
  // Long-distance incentive uses delivery distance only; pickup is compensated separately.
  const longDistance = longPay(r.longDistance, deliveryRoute.distanceMeters, r.rounding), peak = peakPay(r.peaks, at);
  const beforeLimits = addMoney(r.base, pickup, delivery, time, longDistance, peak);
  const boundedEarning = clamp(beforeLimits, r.minimum, r.maximum);
  const driverEarning = r.finalRounding ? quantizeWholeIqd(boundedEarning, r.finalRounding) : boundedEarning;
  return Object.freeze({ engineVersion: 'DRIVER_COMPENSATION_V1' as const, basis: 'CALCULATION_PROPOSAL' as const, rule: reference(r), pickupRoute, deliveryRoute,
    totalDistanceMeters: Number(meters), totalDurationSeconds: Number(seconds),
    components: Object.freeze({ base: r.base, pickup, delivery, time, longDistance, peak, beforeLimits, limitAdjustment: subtractMoney(boundedEarning, beforeLimits), ...(r.finalRounding ? { finalRounding: r.finalRounding, finalRoundingAdjustment: subtractMoney(driverEarning, boundedEarning) } : {}) }), driverEarning });
}

/** Validate an entire centrally managed rule set without requiring a route or a matching rule. */
export function validatePricingRules(value: unknown) {
  const bundle = row(value, ['deliveryRules', 'driverRules']);
  const delivery = readRules(bundle.deliveryRules, deliveryRule);
  const driver = readRules(bundle.driverRules, compensationRule);
  for (const rules of [delivery, driver]) {
    for (let i = 0; i < rules.length; i++) for (let j = i + 1; j < rules.length; j++) {
      const a = rules[i], b = rules[j];
      if (a.status === 'ARCHIVED' || b.status === 'ARCHIVED') continue;
      if (a.scope.type === b.scope.type && a.scope.id === b.scope.id && a.priority === b.priority
        && (a.vehicleType === null || b.vehicleType === null || a.vehicleType === b.vehicleType)
        && a.start < b.end && b.start < a.end) throw new PricingError('AMBIGUOUS_PRICING_RULE');
    }
  }
  return JSON.parse(JSON.stringify(value)) as { deliveryRules: Row[]; driverRules: Row[] };
}
