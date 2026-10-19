import { verifyDeliveryFundedAssignment } from './deliveryFundedOffer';
import { verifyFinancialAssignment } from './financialAssignment';
import { quoteCanonical, quoteEntityIdValid, quoteHash } from './deliveryQuoteRecord';
import { Money, moneyFromMinor, readMoney, toWholeIqdExact } from './money';

type Row = Record<string, any>;
const amountFields = ['goodsGross', 'merchantFundedDiscount', 'platformFundedDiscount', 'merchantGoodsEntitlement',
  'merchantCommission', 'merchantOtherCharges', 'merchantNet', 'customerGoodsPayment', 'customerServiceFee',
  'customerDeliveryFee', 'driverEarning', 'driverTip', 'platformOtherCharges', 'platformNetContribution', 'customerTotal'];
const deliveryAmountFields=['merchantDeliverySupport','platformDeliveryPromotionFunding','referenceDeliveryFee','deliveryPromotionSubsidy','baselineDeliveryMargin','deliveryNetContribution'];
export class MerchantAccrualError extends Error {
  constructor(public readonly code: string) { super(code); this.name = 'MerchantAccrualError'; }
}
const fail = (code = 'MERCHANT_ACCRUAL_PROOF_REQUIRED'): never => { throw new MerchantAccrualError(code); };
const same = (a: unknown, b: unknown) => quoteCanonical(a) === quoteCanonical(b);
function whole(value: unknown): number {
  try { return toWholeIqdExact(readMoney(value)); } catch { return fail(); }
}
function integer(value: unknown, signed = false): number {
  if (!Number.isSafeInteger(value) || !signed && Number(value) < 0) return fail();
  return value as number;
}
function instant(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) return fail();
  return value;
}

/** Internal, pure evidence projection. Inputs must come from trusted consistent
 * reads, after caller authorization. A digest is not a signature or an entitlement
 * to spend. This function does not create a payable, unlock funds or permit payout.
 */
export function deriveMerchantCodAccrual(input: {
  branchId: string; order: Row; acceptedOffer: Row; outcome: Row; payable: Row;
}) {
  try {
    const { branchId, order, acceptedOffer, outcome, payable } = input;
    const orderId = order.orderId;
    if (![branchId, orderId, order.driverId, outcome.subjectId].every(quoteEntityIdValid) ||
        order.PK !== 'ORDER#' + orderId || order.SK !== 'META' || order.status !== 'delivered' ||
        order.orderStatus !== 'delivered' || order.cashCollected !== true ||
        order.returnStatus != null || order.returnCaseId != null || order.cancellationStatus != null ||
        order.cancellationRequestId != null || order.deletedAt != null || order.deletionRequestId != null || order.isDeleted === true) return fail();
    const deliveryFunded=outcome.schemaVersion===2;
    let offer:Row;
    if(deliveryFunded){const verified=verifyDeliveryFundedAssignment(order,acceptedOffer,outcome.subjectId);offer={...verified.baseOffer,digest:verified.digest,allocation:verified.allocation};}
    else offer=verifyFinancialAssignment(order, acceptedOffer, outcome.subjectId);
    const a = offer.allocation, goods = offer.source.order.allocation;
    const operationId = 'COD:' + quoteHash({ orderId }).slice(0, 48);
    if (offer.branchId !== branchId || outcome.orderId !== orderId || outcome.sk !== 'FINANCIAL_OUTCOME' ||
        outcome.kind !== 'COD_COMPLETION_JOURNAL' || outcome.schemaVersion !== (deliveryFunded?2:1) || outcome.outcome !== 'COMPLETED' ||
        outcome.branchId !== branchId || outcome.driverId !== order.driverId || outcome.operationId !== operationId ||
        order.financialOutcome !== operationId || outcome.attempt !== order.assignmentAttemptCounter ||
        outcome.offerId !== offer.offerId || outcome.offerDigest !== offer.digest || !same(outcome.allocation, a)) return fail();
    const deliveredAt = instant(outcome.createdAt);
    if (instant(order.deliveredAt) !== deliveredAt || instant(order.financialAcceptance.acceptedAt) > deliveredAt) return fail();
    const receipt = outcome.receipt;
    const H = whole(a.driverWalletHold), A = whole(a.driverWalletCreditTotal), M = whole(a.merchantPayable),
      PD = whole(a.platformGoodsDiscountFunding), DD=deliveryFunded?whole(a.platformDeliveryPromotionFunding):0, C = whole(a.customerTotal);
    if (!receipt || receipt.kind !== 'COD_COMPLETION' || receipt.success !== true || receipt.orderId !== orderId ||
        receipt.operationId !== operationId || receipt.deliveredAt !== deliveredAt || receipt.cashCollected !== true ||
        receipt.cashCollectedAmount !== C || receipt.capturedAmount !== H || receipt.holdCaptured !== (H > 0) ||
        order.cashCollectedAmount !== C || whole(a.thirdPartyPayable) !== 0) return fail();
    const agreement = order.commercialPricing?.agreement;
    if (!agreement || !quoteEntityIdValid(agreement.id) || !Number.isSafeInteger(agreement.version) || agreement.version < 1 ||
        typeof agreement.termsHash !== 'string' || !/^[a-f0-9]{64}$/.test(agreement.termsHash) ||
        payable.orderId !== orderId || payable.sk !== 'MERCHANT_PAYABLE' || payable.kind !== 'MERCHANT_ORDER_PAYABLE' ||
        payable.financialSchemaVersion !== (deliveryFunded?3:2) || payable.branchId !== branchId || payable.walletId !== 'WALLET#MERCHANT#' + branchId ||
        payable.status !== 'LOCKED_PENDING_SETTLEMENT' || payable.amount !== M || payable.operationId !== operationId ||
        payable.createdAt !== deliveredAt || !same(payable.agreement, agreement)) return fail();

    if(deliveryFunded&&(!same(payable.deliveryFunding,order.financialAcceptance.deliveryFunding)||!same(payable.merchantDeliverySupport,a.merchantDeliverySupport)))return fail();

    // Prove all funding buckets, not merely the merchant credit or a zero sum.
    const expected = new Map<string, number>();
    const expect = (wallet: string, bucket: string, delta: number) => {
      integer(delta, true); if (delta) expected.set(wallet + '|' + bucket, delta);
    };
    expect('WALLET#DRIVER#' + order.driverId, 'AVAILABLE', A);
    expect('WALLET#DRIVER#' + order.driverId, 'LOCKED', -H);
    expect(payable.walletId, 'LOCKED', M);
    const platformDelta = BigInt(H) + BigInt(PD) + BigInt(DD) - BigInt(M) - BigInt(A);
    if (platformDelta > BigInt(Number.MAX_SAFE_INTEGER) || platformDelta < BigInt(Number.MIN_SAFE_INTEGER)) return fail();
    expect('WALLET#PLATFORM', 'AVAILABLE', Number(platformDelta));
    expect('WALLET#PLATFORM', 'LOCKED', -(PD+DD));
    if (!Array.isArray(outcome.journalLines) || outcome.journalLines.length !== expected.size) return fail();
    let sum = 0n;
    for (const line of outcome.journalLines) {
      const key = line.walletId + '|' + line.balanceType;
      const delta = integer(line.delta, true), before = integer(line.balanceBefore), after = integer(line.balanceAfter);
      if (line.unit !== 'IQD_WHOLE' || !expected.has(key) || expected.get(key) !== delta ||
          BigInt(before) + BigInt(delta) !== BigInt(after)) return fail();
      expected.delete(key); sum += BigInt(delta);
    }
    if (expected.size || sum !== 0n) return fail();
    const amounts: Record<string, Money> = {
      goodsGross: readMoney(goods.goodsGross), merchantFundedDiscount: readMoney(goods.merchantGoodsDiscount),
      platformFundedDiscount: readMoney(goods.platformGoodsDiscount), merchantGoodsEntitlement: readMoney(a.merchantGoodsEntitlement),
      merchantCommission: readMoney(a.merchantCommission), merchantOtherCharges: readMoney(goods.merchantOtherCharges),
      merchantNet: readMoney(a.merchantPayable), customerGoodsPayment: readMoney(a.customerGoodsPayment),
      customerServiceFee: readMoney(goods.serviceFee), customerDeliveryFee: readMoney(goods.customerDeliveryFee),
      driverEarning: readMoney(a.driverEarningEntitlement), driverTip: readMoney(a.driverTipEntitlement),
      platformOtherCharges: readMoney(goods.platformOtherCharges),
      platformNetContribution: readMoney(a.platformNetContribution), customerTotal: readMoney(a.customerTotal),
    };
    if(deliveryFunded)for(const field of deliveryAmountFields)amounts[field]=readMoney(a[field]);
    for (const amount of Object.values(amounts)) whole(amount);
    const content = { schemaVersion: deliveryFunded?2:1, kind: 'MERCHANT_COD_ACCRUAL',
      accrualId: 'MACC:' + quoteHash({ branchId, orderId, operationId }).slice(0, 48), branchId, orderId,
      operationId, deliveredAt, currency: 'IQD', status: 'LOCKED_PENDING_SETTLEMENT',
      agreement: JSON.parse(JSON.stringify(agreement)), amounts,
      sourceDigests: { outcome: quoteHash(outcome), payable: quoteHash(payable), acceptedOffer: offer.digest },
      payoutAuthorized: false, walletMutationPerformed: false };
    return JSON.parse(JSON.stringify({ ...content, digest: quoteHash(content) })) as typeof content & { digest: string };
  } catch (error) {
    if (error instanceof MerchantAccrualError) throw error;
    return fail();
  }
}

/** Assemble only an explicit, complete source set supplied by an authorized
 * reader. Does not prove that a database scan/page covered a whole period.
 */
export function summarizeMerchantAccruals(branchId: string, accruals: ReturnType<typeof deriveMerchantCodAccrual>[]) {
  if (!quoteEntityIdValid(branchId)) return fail();
  const orders = new Set<string>(), ids = new Set<string>(), totals: Record<string, bigint> = {};
  const versions=new Set(accruals.map(r=>r.schemaVersion));
  if([...versions].some(v=>![1,2].includes(v)))return fail('MERCHANT_ACCRUAL_SET_INVALID');
  const mixed=versions.size>1, schema=mixed?3:(accruals[0]?.schemaVersion??1);
  for (const row of accruals) {
    const rowSchema=row.schemaVersion;
    const { digest, ...content } = row;
    if (row.kind !== 'MERCHANT_COD_ACCRUAL' || ![1,2].includes(rowSchema) || row.branchId !== branchId ||
        row.status !== 'LOCKED_PENDING_SETTLEMENT' || row.currency !== 'IQD' || row.payoutAuthorized !== false ||
        row.walletMutationPerformed !== false || quoteHash(content) !== digest ||
        orders.has(row.orderId) || ids.has(row.accrualId) ||
        !row.amounts || Object.keys(row.amounts).sort().join(',') !== [...amountFields,...(rowSchema===2?deliveryAmountFields:[])].sort().join(',')) return fail('MERCHANT_ACCRUAL_SET_INVALID');
    const m = Object.fromEntries(Object.entries(row.amounts).map(([key, value]) => [key, BigInt(readMoney(value).minorAmount)]));
    if (Object.entries(m).some(([key, value]) => !['platformNetContribution','baselineDeliveryMargin','deliveryNetContribution'].includes(key) && value < 0n) ||
        m.goodsGross - m.merchantFundedDiscount !== m.merchantGoodsEntitlement ||
        m.merchantGoodsEntitlement - m.platformFundedDiscount !== m.customerGoodsPayment ||
        m.merchantGoodsEntitlement - m.merchantCommission + m.merchantOtherCharges - (m.merchantDeliverySupport??0n) !== m.merchantNet ||
        m.customerGoodsPayment + m.customerServiceFee + m.customerDeliveryFee + m.driverTip + m.merchantOtherCharges + m.platformOtherCharges !== m.customerTotal ||
        m.merchantCommission + m.customerServiceFee + m.platformOtherCharges + m.customerDeliveryFee - m.driverEarning - m.platformFundedDiscount + (m.merchantDeliverySupport??0n) !== m.platformNetContribution) return fail('MERCHANT_ACCRUAL_SET_INVALID');
    if(rowSchema===2&&(m.referenceDeliveryFee-m.customerDeliveryFee!==m.deliveryPromotionSubsidy||m.merchantDeliverySupport+m.platformDeliveryPromotionFunding!==m.deliveryPromotionSubsidy||m.referenceDeliveryFee-m.driverEarning!==m.baselineDeliveryMargin||m.baselineDeliveryMargin-m.platformDeliveryPromotionFunding!==m.deliveryNetContribution))return fail('MERCHANT_ACCRUAL_SET_INVALID');
    orders.add(row.orderId); ids.add(row.accrualId);
    const reportingAmounts=mixed?{...row.amounts,...deliveryReportingAmounts(row)}:row.amounts;
    for (const [key, value] of Object.entries(reportingAmounts)) {
      const amount = readMoney(value); whole(amount);
      if (!totals[key]) totals[key] = 0n;
      totals[key] += BigInt(amount.minorAmount);
      if (totals[key] > BigInt(Number.MAX_SAFE_INTEGER) || totals[key] < BigInt(Number.MIN_SAFE_INTEGER)) return fail('MERCHANT_ACCRUAL_TOTAL_OVERFLOW');
    }
  }
  return { schemaVersion: schema, kind: 'MERCHANT_ACCRUAL_SET_SUMMARY', branchId, currency: 'IQD',
    ...(mixed?{sourceSchemaCounts:{v1:accruals.filter(a=>a.schemaVersion===1).length,v2:accruals.filter(a=>a.schemaVersion===2).length}}:{}),
    accrualCount: accruals.length, amounts: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, moneyFromMinor(Number(v))])),
    sourceSetDigest: quoteHash([...accruals].sort((a, b) => a.accrualId.localeCompare(b.accrualId)).map(a => a.digest)),
    basis: 'EXPLICIT_VERIFIED_ACCRUAL_SET_NOT_PERIOD_COVERAGE', payoutAuthorized: false };
}

// V1 explicitly has no delivery promotion. Its charged tariff is the reference;
// retain any signed operating margin rather than inventing subsidy or driver pay.
function deliveryReportingAmounts(row:ReturnType<typeof deriveMerchantCodAccrual>):Record<string,Money> {
 if(row.schemaVersion===2)return Object.fromEntries(deliveryAmountFields.map(k=>[k,readMoney(row.amounts[k])]));
 const margin=BigInt(readMoney(row.amounts.customerDeliveryFee).minorAmount)-BigInt(readMoney(row.amounts.driverEarning).minorAmount);
 if(margin>BigInt(Number.MAX_SAFE_INTEGER)||margin<BigInt(Number.MIN_SAFE_INTEGER))return fail('MERCHANT_ACCRUAL_TOTAL_OVERFLOW');
 return {merchantDeliverySupport:moneyFromMinor(0),platformDeliveryPromotionFunding:moneyFromMinor(0),
  referenceDeliveryFee:readMoney(row.amounts.customerDeliveryFee),deliveryPromotionSubsidy:moneyFromMinor(0),
  baselineDeliveryMargin:moneyFromMinor(Number(margin)),deliveryNetContribution:moneyFromMinor(Number(margin))};
}
/** Validated read-only reporting projection; never changes source accrual/digest. */
export function merchantAccrualReportingAmounts(row:ReturnType<typeof deriveMerchantCodAccrual>) {
 summarizeMerchantAccruals(row.branchId,[row]);
 return Object.fromEntries(Object.entries({...row.amounts,...deliveryReportingAmounts(row)}).map(([k,v])=>[k,readMoney(v)]));
}
