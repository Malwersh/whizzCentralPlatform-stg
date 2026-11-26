import { calculateDriverEarning } from './deliveryPricing';
import { allocateOrder } from './orderAllocation';
import { moneyFromMinor, readMoney, toWholeIqdExact } from './money';
import { quoteCanonical, quoteHash } from './deliveryQuoteRecord';

type Row = Record<string, any>;
export class DriverOfferError extends Error {
  constructor(public readonly code: 'INVALID_DRIVER_OFFER' | 'DRIVER_OFFER_EXPIRED' | 'DRIVER_OFFER_SCOPE_MISMATCH' |
    'DRIVER_OFFER_SNAPSHOT_CHANGED' | 'DRIVER_OFFER_RULE_DISABLED' | 'DRIVER_OFFER_WALLET_PRECISION_UNSUPPORTED') {
    super(code); this.name = 'DriverOfferError';
  }
}
const fail = (code: DriverOfferError['code'] = 'INVALID_DRIVER_OFFER'): never => { throw new DriverOfferError(code); };
function row(value: unknown, keys: string[]): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const r = value as Row;
  if (Object.keys(r).sort().join(',') !== [...keys].sort().join(',')) return fail();
  return r;
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{1,150}$/.test(value)) return fail();
  return value;
}
function integer(value: unknown, min = 1, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) return fail();
  return value;
}
function time(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return fail();
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== value) return fail();
  return ms;
}
function point(value: unknown) {
  const p = row(value, ['latitude', 'longitude']);
  if (typeof p.latitude !== 'number' || !Number.isFinite(p.latitude) || Math.abs(p.latitude) > 90 ||
      typeof p.longitude !== 'number' || !Number.isFinite(p.longitude) || Math.abs(p.longitude) > 180) return fail();
  return { latitude: p.latitude, longitude: p.longitude };
}
const equal = (a: unknown, b: unknown) => quoteCanonical(a) === quoteCanonical(b);
function boundRoute(value: unknown): Row {
  const r = row(value, ['schemaVersion', 'origin', 'destination', 'profile', 'normalization', 'route']);
  if (r.schemaVersion !== 1 || !['driving', 'driving-traffic'].includes(r.profile) || r.normalization !== 'CEIL_METERS_SECONDS_V1') return fail();
  // Only a server ROAD route is supported in this first offer contract; no straight-line estimate.
  if (r.route?.quality !== 'ROAD' || r.route.fallbackPolicyId !== null || r.route.source !== 'MAPBOX_DIRECTIONS_V5') return fail();
  return { ...r, origin: point(r.origin), destination: point(r.destination) };
}
export function validateDriverOfferOrderSnapshot(value: unknown): Row {
  const o = row(value, ['snapshotId', 'revision', 'orderId', 'branchId', 'merchantId', 'zoneId', 'cityId', 'governorateId',
    'branchPoint', 'customerPoint', 'confirmedCustomerTotal', 'allocation', 'paymentEvidence']);
  for (const field of ['snapshotId', 'orderId', 'branchId', 'merchantId', 'zoneId', 'cityId', 'governorateId']) id(o[field]);
  integer(o.revision);
  const a = row(o.allocation, ['allocationSchemaVersion', 'paymentMethod', 'goodsGross', 'merchantGoodsDiscount',
    'platformGoodsDiscount', 'merchantCommission', 'serviceFee', 'customerDeliveryFee', 'driverTip',
    'merchantOtherCharges', 'platformOtherCharges', 'thirdPartyOtherCharges']);
  // Validates all components through the existing allocator. E is computed only by the compensation engine.
  const allocation = allocateOrder({ ...a, driverEarning: moneyFromMinor(0) });
  const total = readMoney(o.confirmedCustomerTotal);
  if (!equal(total, allocation.customerTotal)) return fail();
  if (a.paymentMethod === 'PREPAID') {
    const payment = row(o.paymentEvidence, ['reference', 'verifiedAt', 'amount']);
    id(payment.reference); time(payment.verifiedAt);
    if (!equal(readMoney(payment.amount), total)) return fail();
  } else if (o.paymentEvidence !== null) return fail();
  return { ...o, branchPoint: point(o.branchPoint), customerPoint: point(o.customerPoint), confirmedCustomerTotal: total };
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));

/** Internal pure contract, NOT an HTTP body parser or proof of identity, payment, routing or funding.
 * The future server reader must authenticate the driver and read/fence the full financial snapshot,
 * assignment, position, policy and routes. The current delivery-fee-only Quote cannot supply this input.
 */
export function buildDriverOffer(value: unknown) {
  const input = row(value, ['schemaVersion', 'offerId', 'assignment', 'driver', 'order', 'policy', 'pickupRoute', 'deliveryRoute', 'at', 'ttlSeconds']);
  if (input.schemaVersion !== 1 || Buffer.byteLength(JSON.stringify(input)) > 200000) return fail();
  // Detach input before retaining any calculation, route or financial terms.
  const source = copy(input), at = time(source.at), ttl = integer(source.ttlSeconds, 1, 900);
  id(source.offerId);
  const assignment = row(source.assignment, ['id', 'version', 'expiresAt']); id(assignment.id); integer(assignment.version);
  const driver = row(source.driver, ['id', 'subjectId', 'vehicleType', 'positionVersion', 'point', 'observedAt', 'expiresAt']);
  for (const name of ['id', 'subjectId', 'vehicleType']) id(driver[name]); integer(driver.positionVersion);
  if (time(driver.observedAt) > at || time(driver.expiresAt) <= at) return fail('DRIVER_OFFER_EXPIRED');
  const order = validateDriverOfferOrderSnapshot(source.order), policy = row(source.policy, ['version', 'rules']); integer(policy.version);
  if (order.paymentEvidence && time(order.paymentEvidence.verifiedAt) > at) return fail();
  const pickupRoute = boundRoute(source.pickupRoute), deliveryRoute = boundRoute(source.deliveryRoute);
  if (pickupRoute.profile !== deliveryRoute.profile || !equal(point(driver.point), pickupRoute.origin) ||
      !equal(pickupRoute.destination, order.branchPoint) || !equal(deliveryRoute.origin, order.branchPoint) ||
      !equal(deliveryRoute.destination, order.customerPoint)) return fail('DRIVER_OFFER_SCOPE_MISMATCH');
  const context = { branchId: order.branchId, merchantId: order.merchantId, zoneId: order.zoneId,
    cityId: order.cityId, governorateId: order.governorateId, vehicleType: driver.vehicleType };
  const calculation = calculateDriverEarning({ schemaVersion: 1, at: source.at, context, rules: policy.rules,
    pickupRoute: pickupRoute.route, deliveryRoute: deliveryRoute.route });
  const selectedRule = policy.rules.find((r: Row) => r.id === calculation.rule.id && r.version === calculation.rule.version);
  const expiresAt = Math.min(at + ttl * 1000, time(assignment.expiresAt), time(driver.expiresAt),
    time(pickupRoute.route.expiresAt), time(deliveryRoute.route.expiresAt),
    selectedRule.effectiveTo === null ? Infinity : time(selectedRule.effectiveTo));
  if (expiresAt <= at) return fail('DRIVER_OFFER_EXPIRED');
  const allocation = allocateOrder({ ...order.allocation, driverEarning: calculation.driverEarning });
  // Driver distance and E never reprice the customer's confirmed D or total.
  if (!equal(allocation.customerTotal, order.confirmedCustomerTotal)) return fail();
  const content = { schemaVersion: 1 as const, kind: 'DRIVER_OFFER_PROPOSAL' as const, offerId: source.offerId,
    createdAt: source.at, expiresAt: new Date(expiresAt).toISOString(), driverId: driver.id, driverSubjectId: driver.subjectId,
    orderId: order.orderId, branchId: order.branchId, assignmentId: assignment.id, assignmentVersion: assignment.version,
    snapshotId: order.snapshotId, orderRevision: order.revision, snapshotHash: quoteHash(order), policyVersion: policy.version,
    ruleHash: quoteHash(selectedRule), calculation, allocation, source };
  return freeze({ ...content, digest: quoteHash(content) });
}
export type DriverOffer = ReturnType<typeof buildDriverOffer>;

/** Validate a server-loaded saved proposal without recalculating at today's rates. Hashes detect
 * inconsistency only, not hostile storage rewriting. This function performs no acceptance or money write.
 */
function storedOffer(value: unknown): DriverOffer {
  try {
    const offered = value as DriverOffer, rebuilt = buildDriverOffer(offered?.source);
    if (!equal(rebuilt, offered)) return fail();
    return rebuilt;
  } catch { return fail(); }
}

/** Allowlist for the assigned driver's eventual API. Omits subject, commission, rule set and financial source. */
export function driverOfferView(value: unknown, driverId: string, subjectId: string, at: string) {
  const offer = storedOffer(value), ms = time(at);
  if (offer.driverId !== id(driverId) || offer.driverSubjectId !== id(subjectId)) return fail('DRIVER_OFFER_SCOPE_MISMATCH');
  if (ms < time(offer.createdAt) || ms >= time(offer.expiresAt)) return fail('DRIVER_OFFER_EXPIRED');
  const a = offer.allocation, c = offer.calculation;
  return freeze(copy({ schemaVersion: 1, kind: offer.kind, offerId: offer.offerId, offerDigest: offer.digest, waveNumber: offer.assignmentVersion, orderId: offer.orderId, branchId: offer.branchId,
    createdAt: offer.createdAt, expiresAt: offer.expiresAt, pickupLocation: offer.source.order.branchPoint,
    deliveryZoneId: offer.source.order.zoneId, paymentMethod: a.paymentMethod,
    pickupDistanceMeters: c.pickupRoute.distanceMeters, pickupDurationSeconds: c.pickupRoute.durationSeconds,
    deliveryDistanceMeters: c.deliveryRoute.distanceMeters, deliveryDurationSeconds: c.deliveryRoute.durationSeconds,
    totalDistanceMeters: c.totalDistanceMeters, totalDurationSeconds: c.totalDurationSeconds,
    earningComponents: { base: c.components.base, pickup: c.components.pickup, delivery: c.components.delivery,
      time: c.components.time, longDistance: c.components.longDistance, peak: c.components.peak, limitAdjustment: c.components.limitAdjustment },
    driverEarning: c.driverEarning, driverTip: a.driverTipEntitlement, driverTotalEntitlement: a.driverTotalEntitlement,
    customerCashToCollect: a.paymentMethod === 'COD' ? a.customerTotal : moneyFromMinor(0),
    driverWalletHold: a.driverWalletHold, driverCashRetained: a.driverCashRetained,
    laterWalletEarningCredit: a.driverWalletEarningCredit, laterWalletTipCredit: a.driverWalletTipCredit,
    walletCreditsRequireConfirmedCompletionAndFunding: true }));
}

/** Prepare terms to persist with the eventual atomic winner+assignment+hold transaction. Caller must
 * supply live server authorization and fences; this plan is not a successful acceptance or a wallet operation.
 */
export function prepareDriverOfferAcceptance(value: unknown) {
  const input = row(value, ['offer', 'offerId', 'driverId', 'subjectId', 'assignmentId', 'assignmentVersion', 'order', 'at', 'policy']);
  const offer = storedOffer(input.offer);
  driverOfferView(offer, id(input.driverId), id(input.subjectId), input.at);
  if (offer.offerId !== id(input.offerId) || offer.assignmentId !== id(input.assignmentId) || offer.assignmentVersion !== integer(input.assignmentVersion)) return fail('DRIVER_OFFER_SCOPE_MISMATCH');
  const currentOrder = validateDriverOfferOrderSnapshot(input.order);
  if (quoteHash(currentOrder) !== offer.snapshotHash) return fail('DRIVER_OFFER_SNAPSHOT_CHANGED');
  if (currentOrder.paymentEvidence && time(currentOrder.paymentEvidence.verifiedAt) > time(input.at)) return fail();
  const policy = row(input.policy, ['version', 'enabledRuleVersions']); integer(policy.version);
  if (policy.version < offer.policyVersion || !Array.isArray(policy.enabledRuleVersions) || policy.enabledRuleVersions.length > 1000) return fail('DRIVER_OFFER_RULE_DISABLED');
  const enabled = policy.enabledRuleVersions.map((v: unknown) => {
    const r = row(v, ['id', 'version', 'hash']); id(r.id); integer(r.version);
    if (typeof r.hash !== 'string' || !/^[a-f0-9]{64}$/.test(r.hash)) return fail();
    return r;
  });
  if (new Set(enabled.map((r: Row) => r.id + ':' + r.version)).size !== enabled.length) return fail();
  if (!enabled.some((r: Row) => r.id === offer.calculation.rule.id && r.version === offer.calculation.rule.version && r.hash === offer.ruleHash)) return fail('DRIVER_OFFER_RULE_DISABLED');
  const a = offer.allocation;
  let walletAmounts;
  try { walletAmounts = { acceptanceHoldIqd: toWholeIqdExact(a.driverWalletHold), completionEarningCreditIqd: toWholeIqdExact(a.driverWalletEarningCredit),
    completionTipCreditIqd: toWholeIqdExact(a.driverWalletTipCredit) }; }
  catch { return fail('DRIVER_OFFER_WALLET_PRECISION_UNSUPPORTED'); }
  return freeze(copy({ kind: 'DRIVER_OFFER_ACCEPTANCE_PLAN', performsWrites: false,
    expected: { offerId: offer.offerId, digest: offer.digest, responseStatus: 'pending', assignmentId: offer.assignmentId,
      assignmentVersion: offer.assignmentVersion, orderId: offer.orderId, orderRevision: offer.orderRevision,
      snapshotHash: offer.snapshotHash, driverId: offer.driverId, driverSubjectId: offer.driverSubjectId,
      policyVersion: policy.version, expiresAt: offer.expiresAt },
    acceptedTerms: { schemaVersion: 1, offerId: offer.offerId, offerDigest: offer.digest, rule: offer.calculation.rule,
      ruleHash: offer.ruleHash, offeredPolicyVersion: offer.policyVersion, acceptedAt: input.at, paymentMethod: a.paymentMethod,
      customerTotal: a.customerTotal, customerDeliveryFee: currentOrder.allocation.customerDeliveryFee,
      driverEarning: a.driverEarningEntitlement, driverTip: a.driverTipEntitlement,
      driverWalletHold: a.driverWalletHold, allocation: a, calculation: offer.calculation },
    legacyWalletAmounts: walletAmounts, financialWriterAndFundingChecksRequired: true }));
}
