import {financialOfferSK} from './financialOfferKey';
import {financialDispatchTables} from './walletBindings';
import {checkoutTables} from './checkoutTables';
import {MerchantStatementPeriod} from './merchantOpeningPeriod';
import { DynamoDBDocumentClient, GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { deriveMerchantCodAccrual, summarizeMerchantAccruals, merchantAccrualReportingAmounts } from './merchantSettlementAccrual';
import { merchantSettlementPeriod, MerchantSettlementSchedule } from './merchantSettlementPeriod';
import { quoteEntityIdValid, quoteHash } from './deliveryQuoteRecord';
import { readMoney } from './money';
import { csvCell } from './walletStatement';
import {verifyMerchantPayoutJournal} from './merchantPayout';
import { exactCheck, updateChecked } from './driverFinancialTransaction';

type Row = Record<string, any>;
const fail = (code = 'MERCHANT_SETTLEMENT_PREVIEW_UNAVAILABLE'): never => { throw Object.assign(Error(code), { code }); };

function baselinePayable(payable: Row) {
  const { settlementEvidence: _proof, settlementBatchId: _batch, settlementLineDigest: _line,
    settlementClaimedAt: _claim, paidAt: _paid, paidPayoutId: _payout, ...original } = payable;
  return { ...original, status: 'LOCKED_PENDING_SETTLEMENT' };
}

export const settlementOrderBindingFields = ['PK', 'SK', 'orderId', 'storeId', 'businessId',
  'merchantId', 'driverId', 'status', 'orderStatus', 'financialOutcome', 'deliveredAt',
  'returnStatus', 'returnCaseId', 'cancellationStatus', 'cancellationRequestId',
  'returnTaskCompletedAt', 'returnedAt', 'pickedUpAt', 'pickupAt', 'holdId', 'holdStatus',
  'cashCollected', 'cashCollectedAmount'];

function orderBinding(order: Row) {
  return quoteHash([...settlementOrderBindingFields.map(field => order[field] ?? null),
    order.merchantHandover?.state ?? null]);
}

/** Build a financial-only record from evidence verified by the ordinary reader. */
async function captureMerchantSettlementEvidence(
  db: Pick<DynamoDBDocumentClient, 'send'>, branchId: string, orderId: string,
) {
  const source = await readMerchantAccrualEvidence(db, branchId, orderId);
  const { digest: _digest, ...accrual } = source.accrual;
  const body = { schemaVersion: 1, orderBinding: orderBinding(source.order), accrual: {
    ...accrual, sourceDigests: { ...accrual.sourceDigests, payable: quoteHash(baselinePayable(source.payable)) },
  } };
  return { ...source, settlementEvidence: { ...body, digest: quoteHash(body) } };
}

/** Persist the proof only while all source rows still match the validated reads. */
export async function preserveMerchantSettlementEvidence(
  db: Pick<DynamoDBDocumentClient, 'send'>, branchId: string, orderId: string,
) {
  const source = await captureMerchantSettlementEvidence(db, branchId, orderId);
  if (source.payable.settlementEvidence !== undefined) return;
  const { orders, holds, offers } = financialDispatchTables();
  const platform = checkoutTables().platform;
  const orderFields = [...Object.keys(source.order), 'legalHold', 'retentionHold', 'deletedAt',
    'deletionRequestId', 'isDeleted', 'returnCaseId', 'cancellationRequestId', 'cashAdjudication'];
  if (source.order.legalHold || source.order.retentionHold) return fail('DOCUMENTED_RETENTION_HOLD');
  const payableKey = { orderId, sk: 'MERCHANT_PAYABLE' };
  const operations = [
    exactCheck(orders, { PK: 'ORDER#' + orderId, SK: 'META' }, source.order, [...new Set(orderFields)]),
    exactCheck(holds, source.outcomeKey, source.outcome),
    updateChecked(exactCheck(holds, payableKey, source.payable, [...Object.keys(source.payable), 'settlementEvidence']),
      'SET #proof=:proof', { '#proof': 'settlementEvidence' }, { ':proof': source.settlementEvidence }),
  ];
  if (source.acceptedOffer) operations.push(exactCheck(offers,
    { orderId, SK: source.acceptedOffer.SK }, source.acceptedOffer));
  if (source.accountingJournal) operations.push(exactCheck(platform,
    { pk: 'FULL_CASH_JOURNAL#' + orderId, sk: 'META' }, source.accountingJournal));
  if (source.cashAdjudicationJournal) operations.push(exactCheck(holds,
    { orderId, sk: 'CASH_ADJUDICATION_JOURNAL' }, source.cashAdjudicationJournal));
  await db.send(new TransactWriteCommand({ TransactItems: operations }));
}

export function verifyZeroMerchantException(order: Row, closure: Row, journal: Row) {
  const { digest, ...body } = journal;
  if (journal.kind !== 'ORDER_EXCEPTION_ENTITLEMENTS_JOURNAL' || journal.state !== 'POSTED' ||
      journal.sk !== 'EXCEPTION_ENTITLEMENTS' || journal.orderId !== order.orderId ||
      journal.branchId !== (order.storeId ?? order.businessId) ||
      journal.caseId !== (closure.caseId ?? closure.exceptionResolution?.caseId) ||
      journal.operationId !== closure.entitlementsPosted?.operationId ||
      digest !== closure.entitlementsPosted?.journalDigest || digest !== quoteHash(body) ||
      journal.merchantCompensationIqd !== 0 || closure.entitlementsPosted?.merchantCompensationIqd !== 0 ||
      (closure.merchantCompensation ?? closure.exceptionResolution?.merchantCompensation)?.paymentStatus !== 'ZERO_APPROVED' ||
      (order.status === 'cancelled' && journal.cancellationCompensation?.cancellationOperationId !== order.financialOutcome)) {
    return fail('ORDER_EXCEPTION_CLOSURE_REQUIRED');
  }
}

/** Shared trusted-source read for previews and the transactional batch writer. */
export async function readMerchantAccrualEvidence(db: Pick<DynamoDBDocumentClient, 'send'>, branchId: string, orderId: string) {
  const tables = financialDispatchTables();
  const merchantPlatform = checkoutTables().platform;
  const get = async (table: string, key: Row): Promise<Row> => {
    const row = (await db.send(new GetCommand({ TableName: table, Key: key, ConsistentRead: true }))).Item;
    if (!row) return fail();
    return JSON.parse(JSON.stringify(row));
  };
  const order = await get(tables.orders, { PK: 'ORDER#' + orderId, SK: 'META' });
  const payable = await get(tables.holds, { orderId, sk: 'MERCHANT_PAYABLE' });
  const archived = payable.settlementEvidence;
  const cancellationUnassigned=order.status==='cancelled'&&!order.financialAcceptance&&order.financialSnapshot?.schemaVersion===3;
  if (order.orderId !== orderId || ![order.storeId, order.businessId].some(b => b === branchId) ||
      [order.storeId, order.businessId].some(b => b !== undefined && b !== branchId) ||
      archived===undefined&&!cancellationUnassigned&&(!quoteEntityIdValid(order.driverId) || !Number.isSafeInteger(order.assignmentWaveNumber) || order.assignmentWaveNumber < 1)) return fail();
  const outcomeKey={orderId,sk:payable.kind==='MERCHANT_EXCEPTION_PAYABLE'?'EXCEPTION_ENTITLEMENTS':'FINANCIAL_OUTCOME'};
  const outcome=await get(tables.holds,outcomeKey);
  const accountingJournal=outcome.schemaVersion===3?await get(merchantPlatform,{pk:'FULL_CASH_JOURNAL#'+orderId,sk:'META'}):undefined;
  const cashAdjudicationJournal=(order.cashAdjudication||archived?.accrual?.sourceDigests?.cashAdjudicationJournal)?await get(tables.holds,{orderId,sk:'CASH_ADJUDICATION_JOURNAL'}):undefined;
  let sourcePayable=payable;
  if(payable.status==='PAID'){
    const paidJournal=await get(merchantPlatform,{pk:'MERCHANT_PAYOUT_PAID#'+payable.paidPayoutId,sk:'META'});
    verifyMerchantPayoutJournal(paidJournal,branchId,payable);
    const {paidAt:_paidAt,paidPayoutId:_payout,...original}=payable;
    sourcePayable={...original,status:'LOCKED_PENDING_SETTLEMENT'};
  }
  const common = { order, outcome, outcomeKey, payable,
    ...(cashAdjudicationJournal ? { cashAdjudicationJournal } : {}), ...(accountingJournal ? { accountingJournal } : {}) };
  if (archived !== undefined) {
    const { digest, ...body } = archived ?? {};
    const accrual = body.accrual;
    const evidence = accrual?.sourceDigests;
    if (body.schemaVersion !== 1 || quoteHash(body) !== digest || body.orderBinding !== orderBinding(order) || accrual?.branchId !== branchId ||
        accrual.orderId !== orderId || accrual.operationId !== outcome.operationId ||
        !['delivered', 'cancelled', 'returned'].includes(order.status) ||
        order.deletedAt != null || order.deletionRequestId != null || order.isDeleted === true ||
        !['LOCKED_PENDING_SETTLEMENT', 'PAID'].includes(payable.status) ||
        evidence?.payable !== quoteHash(baselinePayable(payable)) || evidence.outcome !== quoteHash(outcome) ||
        evidence.accountingJournal !== (accountingJournal ? quoteHash(accountingJournal) : undefined) ||
        evidence.cashAdjudicationJournal !== (cashAdjudicationJournal ? quoteHash(cashAdjudicationJournal) : undefined)) return fail();
    const { settlementEvidence: _proof, ...currentPayable } = sourcePayable;
    const content = { ...accrual, sourceDigests: { ...evidence, payable: quoteHash(currentPayable) } };
    const result = { ...content, digest: quoteHash(content) } as ReturnType<typeof deriveMerchantCodAccrual>;
    summarizeMerchantAccruals(branchId, [result]);
    return { ...common, acceptedOffer: undefined, accrual: result };
  }
  const acceptedOffer = cancellationUnassigned ? undefined :
    await get(tables.offers, { orderId, SK: await financialOfferSK(db,orderId,order.driverId,order.assignmentWaveNumber) });
  return { ...common, acceptedOffer,
    accrual: deriveMerchantCodAccrual({ branchId, order, outcome, payable:sourcePayable,
      acceptedOffer: acceptedOffer ?? {}, accountingJournal, cashAdjudicationJournal }) };
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
  readSchedule: (branchId: string, at: string) => Promise<MerchantSettlementSchedule | null>;
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
    const schedule = await options.readSchedule(branchId, request.at);
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
