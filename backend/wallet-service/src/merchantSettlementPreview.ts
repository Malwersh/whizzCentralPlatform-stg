import {financialOfferSK} from './financialOfferKey';
import {MerchantStatementPeriod} from './merchantOpeningPeriod';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { deriveMerchantCodAccrual, summarizeMerchantAccruals, merchantAccrualReportingAmounts } from './merchantSettlementAccrual';
import { merchantSettlementPeriod, MerchantSettlementSchedule } from './merchantSettlementPeriod';
import { quoteEntityIdValid, quoteHash } from './deliveryQuoteRecord';
import { readMoney } from './money';
import { csvCell } from './walletStatement';
import {verifyMerchantPayoutJournal} from './merchantPayout';

type Row = Record<string, any>;
const fail = (code = 'MERCHANT_SETTLEMENT_PREVIEW_UNAVAILABLE'): never => { throw Object.assign(Error(code), { code }); };

/** Shared trusted-source read for previews and the transactional batch writer. */
export async function readMerchantAccrualEvidence(db: Pick<DynamoDBDocumentClient, 'send'>, branchId: string, orderId: string) {
  const get = async (table: string, key: Row): Promise<Row> => {
    const row = (await db.send(new GetCommand({ TableName: table, Key: key, ConsistentRead: true }))).Item;
    if (!row) return fail();
    return JSON.parse(JSON.stringify(row));
  };
  const order = await get('WizzOrders', { PK: 'ORDER#' + orderId, SK: 'META' });
  const cancellationUnassigned=order.status==='cancelled'&&!order.financialAcceptance&&order.financialSnapshot?.schemaVersion===3;
  if (order.orderId !== orderId || ![order.storeId, order.businessId].some(b => b === branchId) ||
      [order.storeId, order.businessId].some(b => b !== undefined && b !== branchId) ||
      !cancellationUnassigned&&(!quoteEntityIdValid(order.driverId) || !Number.isSafeInteger(order.assignmentWaveNumber) || order.assignmentWaveNumber < 1)) return fail();
  const [payable, acceptedOffer] = await Promise.all([
    get('staging-Holds', { orderId, sk: 'MERCHANT_PAYABLE' }),
    cancellationUnassigned?Promise.resolve({}):get('WaveOffers_staging', { orderId, SK: await financialOfferSK(db,orderId,order.driverId,order.assignmentWaveNumber) }),
  ]);
  const outcomeKey={orderId,sk:payable.kind==='MERCHANT_EXCEPTION_PAYABLE'?'EXCEPTION_ENTITLEMENTS':'FINANCIAL_OUTCOME'};
  const outcome=await get('staging-Holds',outcomeKey);
  const accountingJournal=outcome.schemaVersion===3?await get('staging-MerchantPlatform',{pk:'FULL_CASH_JOURNAL#'+orderId,sk:'META'}):undefined;
  const cashAdjudicationJournal=order.cashAdjudication?await get('staging-Holds',{orderId,sk:'CASH_ADJUDICATION_JOURNAL'}):undefined;
  let sourcePayable=payable;
  if(payable.status==='PAID'){
    const paidJournal=await get('staging-MerchantPlatform',{pk:'MERCHANT_PAYOUT_PAID#'+payable.paidPayoutId,sk:'META'});
    verifyMerchantPayoutJournal(paidJournal,branchId,payable);
    const {paidAt:_paidAt,paidPayoutId:_payout,...original}=payable;
    sourcePayable={...original,status:'LOCKED_PENDING_SETTLEMENT'};
  }
  return { order, outcome, outcomeKey, payable, acceptedOffer,...(cashAdjudicationJournal?{cashAdjudicationJournal}:{}),...(accountingJournal?{accountingJournal}:{}),
    accrual: deriveMerchantCodAccrual({ branchId, order, outcome, payable:sourcePayable, acceptedOffer,accountingJournal,cashAdjudicationJournal }) };
}

export function assembleMerchantSettlementPreview(branchId: string, period: MerchantStatementPeriod,
  accruals: ReturnType<typeof deriveMerchantCodAccrual>[]) {
  for (const accrual of accruals) {
    if (accrual.deliveredAt < period.fromUtc || accrual.deliveredAt >= period.untilExclusiveUtc) return fail('MERCHANT_ACCRUAL_OUTSIDE_PERIOD');
  }
  const summary = summarizeMerchantAccruals(branchId, accruals);
  const content = { schemaVersion: 1, kind: 'MERCHANT_SETTLEMENT_SELECTION_PREVIEW', branchId,
    period, accruals, summary, coverage: 'EXPLICIT_ORDER_SELECTION_ONLY',
    consistency: 'STRONG_ITEM_READS_NOT_ATOMIC_ACCOUNTING_SNAPSHOT',
    canReserve: false, canPay: false, walletMutationPerformed: false };
  return { ...content, previewId: 'MSV:' + quoteHash(content).slice(0, 48) };
}

/** Internal reader only; no route is registered. Both callbacks are trusted server
 * dependencies, never request parameters. Lists are explicit selections, not a
 * complete period query. Preview cannot reserve a payable or authorize payment.
 */
export function createMerchantSettlementPreviewReader(options: {
  db: Pick<DynamoDBDocumentClient, 'send'>;
  authorizeBranch: (branchId: string) => Promise<void>;
  readSchedule: (branchId: string) => Promise<MerchantSettlementSchedule | null>;
}) {
  return Object.freeze({ async preview(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.keys(value).sort().join(',') !== 'at,branchId,orderIds') return fail('INVALID_MERCHANT_SETTLEMENT_SELECTION');
    const request = value as Row;
    if (!quoteEntityIdValid(request.branchId) || !Array.isArray(request.orderIds) || !request.orderIds.length ||
        request.orderIds.length > 50 || request.orderIds.some((id: unknown) => !quoteEntityIdValid(id)) ||
        new Set(request.orderIds).size !== request.orderIds.length) return fail('INVALID_MERCHANT_SETTLEMENT_SELECTION');
    const branchId: string = request.branchId;
    await options.authorizeBranch(branchId);
    const schedule = await options.readSchedule(branchId);
    if (!schedule) return fail('MERCHANT_SETTLEMENT_SCHEDULE_REQUIRED');
    const period = merchantSettlementPeriod(schedule, request.at);
    const accruals: ReturnType<typeof deriveMerchantCodAccrual>[] = [];
    for (const orderId of [...request.orderIds].sort()) {
      accruals.push((await readMerchantAccrualEvidence(options.db, branchId, orderId)).accrual);
    }
    const preview = assembleMerchantSettlementPreview(branchId, period, accruals);
    // Revocation during I/O must not return the already-read financial data.
    await options.authorizeBranch(branchId);
    return preview;
  } });
}

/** Review/export artifact only. A downloadable preview is not a paid statement. */
export function exportMerchantSettlementPreview(preview: Awaited<ReturnType<ReturnType<typeof createMerchantSettlementPreviewReader>['preview']>>) {
  const { previewId, ...content } = preview;
  if (previewId !== 'MSV:' + quoteHash(content).slice(0, 48) || preview.canPay !== false || preview.canReserve !== false ||
      quoteHash(preview.summary) !== quoteHash(summarizeMerchantAccruals(preview.branchId, preview.accruals))) return fail();
  const includeDelivery=preview.accruals.some(a=>a.schemaVersion===2||[4,6].includes(a.schemaVersion));
  const deliveryFields=['referenceDeliveryFee','deliveryPromotionSubsidy','merchantDeliverySupport','platformDeliveryPromotionFunding','baselineDeliveryMargin','deliveryNetContribution'];
  const rows: unknown[][] = [
    ['report_type', preview.kind], ['branch_id', preview.branchId], ['preview_id', preview.previewId],
    ['coverage', preview.coverage], ['consistency', preview.consistency], ['payment_authorized', false],
    ['period_from_UTC_inclusive', preview.period.fromUtc], ['period_until_UTC_exclusive', preview.period.untilExclusiveUtc],
    ['period_timezone', preview.period.timezone], ['schedule_version', preview.period.scheduleVersion],
    ['source_set_digest', preview.summary.sourceSetDigest],
    ['order_id', 'accrual_id', 'delivered_at_UTC', 'agreement_id', 'agreement_version',
      'goods_gross_IQD', 'merchant_funded_discount_IQD', 'platform_funded_discount_IQD',
      'merchant_commission_IQD', 'merchant_other_charges_IQD', 'merchant_net_pending_IQD',
      'customer_service_fee_IQD', 'customer_delivery_fee_IQD', 'driver_tip_IQD',
      ...(includeDelivery?deliveryFields.map(k=>k+'_IQD'):[])],
  ];
  const iqd = (value: unknown) => {
    const n = BigInt(readMoney(value).minorAmount);
    if (n % 1000n) return fail();
    return Number(n / 1000n);
  };
  for (const a of preview.accruals) {
    const amounts=includeDelivery?merchantAccrualReportingAmounts(a):a.amounts;
    rows.push([a.orderId, a.accrualId, a.deliveredAt, a.agreement.id, a.agreement.version,
      ...['goodsGross', 'merchantFundedDiscount', 'platformFundedDiscount', 'merchantCommission', 'merchantOtherCharges',
        'merchantNet', 'customerServiceFee', 'customerDeliveryFee', 'driverTip'].map(key => iqd(amounts[key])),
      ...(includeDelivery?deliveryFields.map(k=>iqd(amounts[k])):[])]);
  }
  rows.push(['metric', 'total_IQD']);
  for (const [key, value] of Object.entries(preview.summary.amounts)) rows.push([key, iqd(value)]);
  const csv = '\ufeff' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
  if (Buffer.byteLength(csv) > 512000) return fail('MERCHANT_SETTLEMENT_PREVIEW_TOO_LARGE');
  return { csv, filename: `merchant-settlement-preview-${preview.previewId.slice(4)}.csv`, paymentAuthorized: false };
}
