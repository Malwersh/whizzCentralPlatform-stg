import { buildDriverOffer, driverOfferView, prepareDriverOfferAcceptance, validateDriverOfferOrderSnapshot } from './driverOffer';
import { prepareFullCashSettlement, verifyFullCashSettlement, FULL_CASH_SETTLEMENT_MODEL } from './fullCashSettlement';
import { moneyFromMinor, toWholeIqdExact } from './money';
import { quoteCanonical, quoteHash } from './deliveryQuoteRecord';

type Row = Record<string, any>;
const fail = (code = 'INVALID_FULL_CASH_OFFER'): never => { throw Object.assign(Error(code), { code }); };
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const same = (a: unknown, b: unknown) => quoteCanonical(a) === quoteCanonical(b);
function freeze<T>(v: T): T { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
function exact(value: unknown, keys: string[]): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) return fail();
  return value as Row;
}

/** Pure immutable envelope for a future trusted writer. It is not a quotation
 * route, a verified payment, a budget commitment or permission to issue offers.
 * A missing model never upgrades an existing order to full-cash settlement. */
export function prepareFullCashOrderSnapshot(value: unknown) {
  const r = exact(value, ['order', 'deliveryFunding']), order = validateDriverOfferOrderSnapshot(copy(r.order));
  prepareFullCashSettlement({ settlementSchemaVersion: 1,
    base: { ...order.allocation, driverEarning: moneyFromMinor(0) }, deliveryFunding: r.deliveryFunding });
  const body = { schemaVersion: 3, kind: 'ORDER_FULL_CASH_SNAPSHOT', settlementModel: FULL_CASH_SETTLEMENT_MODEL,
    order, deliveryFunding: copy(r.deliveryFunding) };
  return freeze({ ...body, digest: quoteHash(body) });
}

/** Internal COD contract, not wired to live issuance. Reuses route, tariff,
 * identity, TTL and scope validation, then pins a separate settlement version.
 * PREPAID issuance remains closed until a trusted capture reader is integrated. */
export function buildFullCashOffer(value: unknown) {
  const r = exact(value, ['schemaVersion', 'base', 'deliveryFunding']);
  if (r.schemaVersion !== 3) return fail();
  const baseOffer = buildDriverOffer(r.base);
  if (baseOffer.allocation.paymentMethod !== 'COD') return fail('FULL_CASH_VERIFIED_PAYMENT_READER_REQUIRED');
  const snapshot = prepareFullCashOrderSnapshot({ order: baseOffer.source.order, deliveryFunding: r.deliveryFunding });
  const settlement = prepareFullCashSettlement({ settlementSchemaVersion: 1,
    base: { ...baseOffer.source.order.allocation, driverEarning: baseOffer.calculation.driverEarning },
    deliveryFunding: snapshot.deliveryFunding });
  const body = { schemaVersion: 3, kind: 'DRIVER_FULL_CASH_OFFER', settlementModel: FULL_CASH_SETTLEMENT_MODEL,
    baseOffer, financialSnapshot: snapshot, settlement };
  return freeze({ ...body, digest: quoteHash(body) });
}
export type FullCashOffer = ReturnType<typeof buildFullCashOffer>;
export function verifyFullCashOffer(value: unknown): FullCashOffer {
  const r = exact(value, ['schemaVersion', 'kind', 'settlementModel', 'baseOffer', 'financialSnapshot', 'settlement', 'digest']);
  const rebuilt = buildFullCashOffer({ schemaVersion: 3, base: r.baseOffer?.source, deliveryFunding: r.financialSnapshot?.deliveryFunding });
  if (!same(rebuilt, r)) return fail('FULL_CASH_OFFER_CHANGED');
  verifyFullCashSettlement(rebuilt.settlement);
  return rebuilt;
}
/** Driver-only allowlist; economics, platform liabilities and funding splits
 * stay server-side. The COD collection instruction is intentionally simple. */
export function fullCashOfferView(value: unknown, driverId: string, subjectId: string, at: string) {
  const offered = verifyFullCashOffer(value), view = driverOfferView(offered.baseOffer, driverId, subjectId, at);
  const a = offered.settlement.allocation;
  return freeze({ ...view, schemaVersion: 3, kind: offered.kind, settlementModel: offered.settlementModel,
    offerDigest: offered.digest, driverWalletHold: a.driverWalletHold, driverCashRetained: a.driverCashRetained,
    laterWalletEarningCredit: a.driverWalletEarningCredit, laterWalletTipCredit: a.driverWalletTipCredit,
    collectionRequired: true, customerCashToCollect: a.customerTotal });
}
/** Internal acceptance proposal only. A future transaction must verify the live
 * principal, snapshot/model, funding authorization, budgets, wallet and winner.
 * This never calls the legacy acceptance writer with the new hold amount. */
export function prepareFullCashOfferAcceptance(value: unknown) {
  const r = exact(value, ['offer', 'offerId', 'driverId', 'subjectId', 'assignmentId', 'assignmentVersion', 'order', 'deliveryFunding', 'at', 'policy']);
  const offered = verifyFullCashOffer(r.offer);
  fullCashOfferView(offered, r.driverId, r.subjectId, r.at);
  const snapshot = prepareFullCashOrderSnapshot({ order: r.order, deliveryFunding: r.deliveryFunding });
  if (!same(snapshot, offered.financialSnapshot)) return fail('FULL_CASH_SNAPSHOT_CHANGED');
  const { deliveryFunding: _funding, ...base } = r;
  const old = prepareDriverOfferAcceptance({ ...base, offer: offered.baseOffer });
  const a = offered.settlement.allocation;
  let walletAmounts;
  try { walletAmounts = { acceptanceHoldIqd: toWholeIqdExact(a.driverWalletHold),
    completionEarningCreditIqd: toWholeIqdExact(a.driverWalletEarningCredit), completionTipCreditIqd: toWholeIqdExact(a.driverWalletTipCredit) }; }
  catch { return fail('FULL_CASH_WALLET_PRECISION_UNSUPPORTED'); }
  return freeze(copy({ ...old, kind: 'FULL_CASH_ACCEPTANCE_PLAN',
    expected: { ...old.expected, digest: offered.digest, snapshotHash: snapshot.digest, settlementModel: offered.settlementModel },
    acceptedTerms: { ...old.acceptedTerms, schemaVersion: 3, settlementModel: offered.settlementModel,
      offerDigest: offered.digest, financialSnapshotDigest: snapshot.digest, settlementDigest: offered.settlement.digest,
      deliveryFunding: snapshot.deliveryFunding, allocation: a, driverWalletHold: a.driverWalletHold },
    legacyWalletAmounts: walletAmounts, requiresFullCashLifecycle: true, performsWrites: false }));
}
/** Integrity proof only; does not authorize progress or completion. */
export function verifyFullCashAssignment(order: Row, saved: Row, subjectId: string) {
  const offered = verifyFullCashOffer(saved?.financialOffer), b = offered.baseOffer, terms = order?.financialAcceptance;
  if (!terms || terms.schemaVersion !== 3 || terms.settlementModel !== FULL_CASH_SETTLEMENT_MODEL ||
      saved.responseStatus !== 'financial_accepted' || saved.isWinner !== true || order.driverId !== b.driverId ||
      b.driverSubjectId !== subjectId || order.orderId !== b.orderId || order.assignmentWaveNumber !== b.assignmentVersion ||
      saved.waveNumber !== b.assignmentVersion || !same(terms, saved.acceptedTerms) || !same(order.financialSnapshot, offered.financialSnapshot) ||
      order.merchantId !== b.source.order.merchantId || ![order.storeId, order.businessId].some(v => v === b.branchId) ||
      [order.storeId, order.businessId].some(v => v !== undefined && v !== b.branchId)) return fail('FULL_CASH_ASSIGNMENT_CONFLICT');
  const prepared = prepareFullCashOfferAcceptance({ offer: offered, offerId: b.offerId, driverId: b.driverId, subjectId,
    assignmentId: b.assignmentId, assignmentVersion: b.assignmentVersion, order: b.source.order,
    deliveryFunding: offered.financialSnapshot.deliveryFunding, at: terms.acceptedAt,
    policy: { version: b.policyVersion, enabledRuleVersions: [{ id: b.calculation.rule.id, version: b.calculation.rule.version, hash: b.ruleHash }] } });
  if (!same(prepared.acceptedTerms, terms)) return fail('FULL_CASH_ASSIGNMENT_CONFLICT');
  return offered;
}
