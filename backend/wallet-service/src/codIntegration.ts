import { DynamoDBDocumentClient, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { COD_EVENT_KINDS, COD_INTEGRATION_QUEUE, codIntegrationEvent, codAcceptanceOperation, CodIntegrationInput } from './codIntegrationEvent';
import { equal, exactCheck, strongGet, updateChecked, FinancialRow as Row } from './driverFinancialTransaction';
import { resolveFinancialOffer } from './financialOfferVersion';
import { quoteHash } from './deliveryQuoteRecord';

const T = { events: 'staging-WalletLifecycle', holds: 'staging-Holds', orders: 'WizzOrders',
  drivers: 'WhizzDrivers_staging', deletion: 'staging-AccountDeletion',
  offers: 'WaveOffers_staging', notifications: 'staging-WalletNotifications', metrics: 'WizzDriverPerformanceMetrics_staging', audit: 'staging-AuditLog' };
const fail = (code = 'COD_INTEGRATION_PROOF_REQUIRED'): never => { throw Object.assign(Error(code), { code }); };
const timestamp = (value: number) => new Date(value).toISOString();

function checkedEvent(row: Row) {
  const contract = codIntegrationEvent(row as CodIntegrationInput).Put.Item;
  for (const key of ['operationId', 'integrationSchemaVersion', 'kind', 'financialOperationId', 'orderId', 'driverId', 'subjectId', 'branchId', 'offerId', 'attempt', 'waveNumber', 'createdAt']) {
    if (!equal(row[key], (contract as Row)[key])) return fail();
  }
  if (!Number.isSafeInteger(row.integrationAttempts) || row.integrationAttempts < 0 || row.integrationAttempts > 20) return fail();
  return row;
}

function checkedProof(event: Row, journal: Row | null, order: Row | null, enableDeliveryFunding=false,enableFullCash=false) {
  const fullCash=order?.financialSnapshot?.schemaVersion===3||journal?.schemaVersion===3;
  if(fullCash&&!enableFullCash)return fail();
  const funded=order?.financialSnapshot?.schemaVersion===2||journal?.acceptedTerms?.schemaVersion===2;
  if((journal?.schemaVersion===2&&!enableDeliveryFunding)||(funded&&journal?.schemaVersion!==2))return fail();
  if (!journal || !order || journal.orderId !== event.orderId || journal.driverId !== event.driverId ||
      journal.subjectId !== event.subjectId || journal.branchId !== event.branchId || journal.offerId !== event.offerId ||
      journal.attempt !== event.attempt || journal.operationId !== event.financialOperationId || journal.createdAt !== event.createdAt ||
      journal.receipt?.success !== true || journal.receipt.orderId !== event.orderId ||
      journal.receipt.operationId !== event.financialOperationId || order.orderId !== event.orderId ||
      ![order.storeId, order.businessId].some(v => v === event.branchId) ||
      [order.storeId, order.businessId].some(v => v != null && v !== event.branchId)) return fail();
  const expected = {
    COD_ACCEPTANCE_OUTBOX: ['FINANCIAL_DRIVER_OFFER', 'ACCEPTED', null],
    COD_COMPLETION_OUTBOX: [fullCash?'FULL_CASH_COMPLETION_JOURNAL':'COD_COMPLETION_JOURNAL', 'COMPLETED', 'delivered'],
    COD_RETURN_OUTBOX: ['COD_RETURN_JOURNAL', 'RETURNED', 'returned'],
    COD_CANCEL_OUTBOX: ['COD_CANCEL_JOURNAL', 'CANCELLED', 'cancelled'],
    COD_UNASSIGN_OUTBOX: ['COD_ASSIGNMENT_RELEASE', 'UNASSIGNED', null]
  }[event.kind as typeof COD_EVENT_KINDS[number]];
  if (!expected || journal.kind !== expected[0] || journal.outcome !== expected[1]) return fail();
  if (expected[2] && (order.financialOutcome !== event.financialOperationId || order.status !== expected[2])) return fail();
  // An old unassignment remains valid after a replacement wins. Never clear/rewrite the current assignment.
  if (event.kind === 'COD_UNASSIGN_OUTBOX' && (order.assignmentAttemptCounter < event.attempt ||
      journal.acceptedTerms?.offerId !== event.offerId || journal.receipt.kind !== 'COD_UNASSIGNED')) return fail();
}

function metricPlan(event: Row, previous: Row | null, at: string) {
  const key = { PK: 'DRIVER#' + event.driverId, SK: 'METRICS' }, acceptance = event.kind === 'COD_ACCEPTANCE_OUTBOX';
  if (previous && (previous.PK !== key.PK || previous.SK !== key.SK || previous.driverId != null && previous.driverId !== event.driverId)) return fail('COD_METRICS_UNAVAILABLE');
  const counters = ['totalTrips', 'totalCompleted', 'totalAccepted', 'financialAcceptedCount', 'financialCompletedCount'];
  for (const field of counters) {
    if (previous?.[field] !== undefined && (!Number.isSafeInteger(previous[field]) || previous[field] < 0 || previous[field] >= Number.MAX_SAFE_INTEGER)) return fail('COD_METRICS_UNAVAILABLE');
  }
  const initialized = previous?.financialMetricsVersion === 1;
  if (previous?.financialMetricsVersion !== undefined && !initialized || initialized &&
      (typeof previous!.financialLegacyBaselineComplete !== 'boolean' || previous!.financialAcceptedCount === undefined || previous!.financialCompletedCount === undefined)) return fail('COD_METRICS_UNAVAILABLE');
  if (!initialized && (previous?.financialAcceptedCount !== undefined || previous?.financialCompletedCount !== undefined)) return fail('COD_METRICS_UNAVAILABLE');
  if (!acceptance && !initialized) return fail('COD_METRICS_UNAVAILABLE');
  const legacyComplete = initialized ? previous!.financialLegacyBaselineComplete : !previous ||
    ['totalTrips', 'totalCompleted', 'totalAccepted'].every(k => previous[k] !== undefined) &&
    previous.totalAccepted >= previous.totalCompleted && previous.totalTrips >= previous.totalCompleted &&
    previous.completionRateStatus !== 'ACCEPTANCE_INTEGRATION_PENDING';
  const accepted = (previous?.totalAccepted ?? 0) + (acceptance ? 1 : 0);
  const completed = (previous?.totalCompleted ?? 0) + (acceptance ? 0 : 1), trips = (previous?.totalTrips ?? 0) + (acceptance ? 0 : 1);
  const financialAccepted = (previous?.financialAcceptedCount ?? 0) + (acceptance ? 1 : 0);
  const financialCompleted = (previous?.financialCompletedCount ?? 0) + (acceptance ? 0 : 1);
  if (financialCompleted > financialAccepted) return fail('COD_METRICS_UNAVAILABLE');
  const values: Row = { ':accepted': accepted, ':trips': trips, ':completed': completed, ':driver': event.driverId, ':at': at,
    ':fa': financialAccepted, ':fc': financialCompleted, ':version': 1, ':legacy': legacyComplete,
    ':basis': legacyComplete && accepted > 0 && completed <= accepted ? 'AVAILABLE' : 'LEGACY_METRICS_INCOMPLETE' };
  const fields: Row = { totalAccepted: ':accepted', totalTrips: ':trips', totalCompleted: ':completed', driverId: ':driver', updatedAt: ':at',
    financialAcceptedCount: ':fa', financialCompletedCount: ':fc', financialMetricsVersion: ':version',
    financialLegacyBaselineComplete: ':legacy', completionRateStatus: ':basis' };
  const last = acceptance ? 'lastAcceptedAt' : 'lastCompletedAt';
  values[':last'] = previous?.[last] && previous[last] > event.createdAt ? previous[last] : event.createdAt; fields[last] = ':last';
  const names: Row = {}, sets = Object.entries(fields).map(([field, value], i) => { names['#u' + i] = field; return '#u' + i + '=' + value; });
  names['#rate'] = 'completionRate';
  let expression = 'SET ' + sets.join(', ');
  if (values[':basis'] === 'AVAILABLE') { values[':rate'] = completed / accepted; expression += ', #rate=:rate'; }
  else expression += ' REMOVE #rate';
  const fence = previous ? exactCheck(T.metrics, key, previous, [...new Set([...Object.keys(previous), ...counters, 'financialMetricsVersion', 'financialLegacyBaselineComplete'])]) :
    { ConditionCheck: { TableName: T.metrics, Key: key, ConditionExpression: 'attribute_not_exists(PK)' } };
  return updateChecked(fence, expression, names, values);
}
function acceptanceProof(event: Row, record: Row | null, order: Row | null, enableDeliveryFunding=false,enableFullCash=false) {
  if (!record || !order || record.kind !== 'FINANCIAL_DRIVER_OFFER' || record.schemaVersion !== 2 || record.orderId !== event.orderId ||
      record.offerId !== event.offerId || record.driverId !== event.driverId || record.waveNumber !== event.waveNumber ||
      record.responseStatus !== 'financial_accepted' || record.isWinner !== true || record.financialReceipt?.success !== true ||
      record.financialReceipt.assignmentAttempt !== event.attempt || record.financialReceipt.acceptedAt !== event.createdAt || record.financialReceipt.orderId !== event.orderId ||
      record.financialReceipt.driverId !== event.driverId || record.financialReceipt.offerId !== event.offerId ||
      record.acceptedTerms?.acceptedAt !== event.createdAt || record.acceptedTerms?.offerId !== event.offerId ||
      event.financialOperationId !== codAcceptanceOperation(event.orderId, event.offerId, event.attempt) ||
      order.orderId !== event.orderId || order.assignmentAttemptCounter < event.attempt ||
      ![order.storeId, order.businessId].some(v => v === event.branchId) ||
      [order.storeId, order.businessId].some(v => v != null && v !== event.branchId)) return fail();
  let offer:Row;
  try{offer=resolveFinancialOffer(record.financialOffer,enableDeliveryFunding,enableFullCash);}catch{return fail();}
  if (!equal(offer.versionedOffer, record.financialOffer) || offer.driverId !== event.driverId || offer.driverSubjectId !== event.subjectId ||
      offer.branchId !== event.branchId || offer.offerId !== event.offerId || record.acceptedTerms.offerDigest !== offer.digest) return fail();
  if(offer.versionedOffer.schemaVersion===3&&(record.acceptedTerms.schemaVersion!==3||record.acceptedTerms.settlementModel!==offer.versionedOffer.settlementModel||!equal(record.acceptedTerms.allocation,offer.allocation)||!equal(record.acceptedTerms.deliveryFunding,offer.versionedOffer.financialSnapshot.deliveryFunding)||record.acceptedTerms.financialSnapshotDigest!==offer.snapshotHash||record.acceptedTerms.settlementDigest!==offer.versionedOffer.settlement.digest))return fail();
  if(offer.versionedOffer.schemaVersion===2&&(record.acceptedTerms.schemaVersion!==2||
    !equal(record.acceptedTerms.allocation,offer.allocation)||
    !equal(record.acceptedTerms.deliveryFunding,offer.versionedOffer.financialSnapshot.deliveryFunding)||
    record.acceptedTerms.financialSnapshotDigest!==offer.snapshotHash))return fail();
}

/** Internal DynamoDB-only integration. No wallet/ledger writes, hold operations, dispatch, HTTP or push sends. */
export function createStagingCodIntegration(options: { db: Pick<DynamoDBDocumentClient, 'send'>; now?: () => number; notificationDelivery?: 'HELD' | 'PENDING';enableDeliveryFunding?:boolean;enableFullCash?:boolean }) {
  const { db } = options, now = options.now ?? Date.now;
  const notificationDelivery = options.notificationDelivery ?? 'HELD';
  if (!['HELD','PENDING'].includes(notificationDelivery)) throw Error('INVALID_COD_NOTICE_DELIVERY');
  function finish(row: Row, status: string, values: Row = {}) {
    const check = exactCheck(T.events, { operationId: row.operationId }, row);
    const names: Row = { '#status': 'status', '#at': 'integratedAt', '#queue': 'queuePartition', '#next': 'nextAttemptAt' };
    const args: Row = { ':status': status, ':at': timestamp(now()) };
    const extra = Object.entries(values).map(([field, value], i) => {
      names['#x' + i] = field; args[':x' + i] = value; return '#x' + i + '=:x' + i;
    });
    if (status !== 'INTEGRATION_REVIEW_REQUIRED') names['#failure'] = 'integrationError';
    return updateChecked(check, 'SET #status=:status, #at=:at' + (extra.length ? ', ' + extra.join(', ') : '') + ' REMOVE #queue, #next' + (status !== 'INTEGRATION_REVIEW_REQUIRED' ? ', #failure' : ''), names, args);
  }
  async function processEvent(operationId: string) {
    if (typeof operationId !== 'string' || !/^(?:CDA|COD|CR|CA|FCS):[a-f0-9]{48}:EVENT$/.test(operationId)) return fail('INVALID_COD_INTEGRATION_EVENT');
    const saved = await strongGet(db, T.events, { operationId });
    if (!saved) return { missing: true };
    checkedEvent(saved);
    if (['INTEGRATED', 'SUPPRESSED_DELETION', 'INTEGRATION_REVIEW_REQUIRED'].includes(saved.status)) return { status: saved.status, replayed: true };
    if (saved.status !== 'PENDING_INTEGRATION' || saved.queuePartition !== COD_INTEGRATION_QUEUE ||
        !Number.isSafeInteger(saved.nextAttemptAt) || saved.nextAttemptAt < 0) return fail();
    if (saved.nextAttemptAt > Math.floor(now() / 1000)) return { deferred: true };
    try {
      const acceptance = saved.kind === 'COD_ACCEPTANCE_OUTBOX';
      const journalTable = acceptance ? T.offers : T.holds;
      const journalKey: Row = acceptance ? {orderId:saved.orderId,SK:`FINANCIAL#${saved.driverId}#WAVE#${saved.waveNumber}`} : { orderId: saved.orderId, sk: saved.kind === 'COD_UNASSIGN_OUTBOX' ? 'ASSIGNMENT_RELEASE#' + saved.attempt : 'FINANCIAL_OUTCOME' };
      const journal = await strongGet(db, journalTable, journalKey);
      const orderKey = { PK: 'ORDER#' + saved.orderId, SK: 'META' }, order = await strongGet(db, T.orders, orderKey);
      const driverKey = { driverId: saved.driverId }, driver = await strongGet(db, T.drivers, driverKey);
      const deletionGuards: Row[] = [];
      for (const pk of new Set(['ACCOUNT_LIFECYCLE#DRIVER#' + saved.driverId, 'ACCOUNT_LIFECYCLE#DRIVER#' + saved.subjectId, 'BUSINESS_LIFECYCLE#MERCHANT#' + saved.branchId])) {
        const key = { pk, sk: 'META' }, marker = await strongGet(db, T.deletion, key);
        if (marker) {
          await db.send(new TransactWriteCommand({ TransactItems: [finish(saved, 'SUPPRESSED_DELETION'), exactCheck(T.deletion, key, marker)] as any }));
          return { status: 'SUPPRESSED_DELETION' };
        }
        deletionGuards.push({ ConditionCheck: { TableName: T.deletion, Key: key, ConditionExpression: 'attribute_not_exists(pk)' } });
      }
      if (!driver || !order || driver.isDeleted === true || driver.deletedAt != null || driver.deletionRequestId != null ||
          order.isDeleted === true || order.deletedAt != null || order.deletionRequestId != null || order.deletionStatus != null) return fail('COD_INTEGRATION_PARTY_UNAVAILABLE');
      if ((driver.cognitoSub ?? driver.driverId) !== saved.subjectId) return fail();
      if (acceptance) acceptanceProof(saved, journal, order,options.enableDeliveryFunding===true,options.enableFullCash===true); else checkedProof(saved, journal, order,options.enableDeliveryFunding===true,options.enableFullCash===true);
      const notificationEventId = 'COD_EVENT:' + quoteHash({ operationId }).slice(0, 48), at = timestamp(now());
      const wording: Record<string, [string, string]> = {
        COD_COMPLETION_OUTBOX: ['تمت تسوية طلب التوصيل', 'افتح المحفظة لمراجعة حركة التسوية. الأجرة والإكرامية النقديتان لا تضافان مرة أخرى.'],
        COD_RETURN_OUTBOX: ['اكتملت عودة الأصناف', 'أكد الفرع الاستلام واكتملت المعالجة المالية للمحاولة. أي أجرة عودة تبقى للمراجعة.'],
        COD_CANCEL_OUTBOX: ['ألغي الطلب قبل الاستلام', 'اكتمل الإلغاء ومعالجته المالية. أي تعويض يبقى للمراجعة وفق السياسة.'],
        COD_UNASSIGN_OUTBOX: ['اكتمل فك إسناد الطلب', 'اكتملت المعالجة المالية لمحاولتك. هذا الإشعار لا يغير حالة إسناد الطلب الحالية.']
      };
      const ops: Row[] = [finish(saved, 'INTEGRATED', { ...(!acceptance ? { notificationEventId } : {}), integrationVersion: 1,
        metricsResult: acceptance ? 'ACCEPTANCE_COUNTED' : saved.kind === 'COD_COMPLETION_OUTBOX' ? 'COMPLETION_COUNTED' : 'NO_COUNTER_CHANGE' }),
        exactCheck(journalTable, journalKey, journal!), exactCheck(T.orders, orderKey, order, [...new Set([...Object.keys(order), 'deletedAt', 'deletionRequestId', 'deletionStatus', 'isDeleted'])]), exactCheck(T.drivers, driverKey, driver, [...new Set([...Object.keys(driver), 'cognitoSub', 'deletedAt', 'deletionRequestId', 'isDeleted'])]), ...deletionGuards,
        ...(!acceptance ? [{ Put: { TableName: T.notifications, Item: { eventId: notificationEventId, driverId: saved.subjectId, recipientApp: 'driver',
          type: 'wallet_cod_lifecycle', financialOperationId: saved.financialOperationId, orderId: saved.orderId, branchId: saved.branchId,
          financialEventKind: saved.kind, financialDriverId: saved.driverId, financialSubjectId: saved.subjectId,
          title: wording[saved.kind][0], body: wording[saved.kind][1], createdAt: at, deliveryStatus: notificationDelivery, nextAttemptAt: 0, attempts: 0 },
        ConditionExpression: 'attribute_not_exists(eventId)' } }] : []),
        { Put: { TableName: T.audit, Item: { datePartition: 'date#' + at.slice(0, 10).replace(/-/g, ''), sk: at + '#' + notificationEventId,
          logId: notificationEventId, action: 'COD_EVENT_INTEGRATED', orderId: saved.orderId, driverId: saved.driverId, subjectId: saved.subjectId, branchId: saved.branchId,
          financialOperationId: saved.financialOperationId, eventKind: saved.kind, createdAt: at }, ConditionExpression: 'attribute_not_exists(sk)' } }
      ];
      if (acceptance || saved.kind === 'COD_COMPLETION_OUTBOX') {
        if (!acceptance) {
          const acceptedKey = {operationId:codAcceptanceOperation(saved.orderId,saved.offerId,saved.attempt)+':EVENT'};
          const acceptedEvent = await strongGet(db,T.events,acceptedKey);
          if (!acceptedEvent || acceptedEvent.status !== 'INTEGRATED') return fail('COD_ACCEPTANCE_PENDING');
          checkedEvent(acceptedEvent);
          if (acceptedEvent.kind !== 'COD_ACCEPTANCE_OUTBOX' || acceptedEvent.driverId !== saved.driverId || acceptedEvent.subjectId !== saved.subjectId || acceptedEvent.metricsResult !== 'ACCEPTANCE_COUNTED') return fail();
          ops.push(exactCheck(T.events,acceptedKey,acceptedEvent));
        }
        const key = { PK: 'DRIVER#' + saved.driverId, SK: 'METRICS' };
        ops.push(metricPlan(saved, await strongGet(db, T.metrics, key), at));
      }
      await db.send(new TransactWriteCommand({ TransactItems: ops as any, ClientRequestToken: quoteHash(ops).slice(0, 36) }));
      return { status: 'INTEGRATED', ...(!acceptance ? { notificationEventId } : {}) };
    } catch (error: any) {
      // Codes only: never log request items, customer data, or cancellation messages.
      console.error('COD_INTEGRATION_FAILURE', JSON.stringify({
        name: String(error?.name ?? 'Unknown').replace(/[^A-Za-z0-9_]/g, '').slice(0, 80),
        code: String(error?.code ?? '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 80),
        reasons: Array.isArray(error?.CancellationReasons) ? error.CancellationReasons.map((r: any) => String(r?.Code ?? 'None').replace(/[^A-Za-z0-9_]/g, '').slice(0, 80)) : []
      }));
      const fresh = await strongGet(db, T.events, { operationId });
      if (fresh?.status === 'INTEGRATED') { checkedEvent(fresh); return { status: 'INTEGRATED', replayed: true }; }
      if (!equal(fresh, saved)) return { retry: true };
      const attempts = Math.min(20, saved.integrationAttempts + 1);
      const review = ['COD_INTEGRATION_PROOF_REQUIRED', 'COD_METRICS_UNAVAILABLE', 'COD_INTEGRATION_PARTY_UNAVAILABLE'].includes(error?.code) || attempts >= 20;
      const code = review ? error?.code ?? 'COD_INTEGRATION_ATTEMPTS_EXHAUSTED' : 'COD_INTEGRATION_RETRY';
      const op = review ? finish(saved, 'INTEGRATION_REVIEW_REQUIRED', { integrationAttempts: attempts, integrationError: code }) :
        updateChecked(exactCheck(T.events, { operationId }, saved), 'SET #attempts=:attempts, #next=:next, #error=:error',
          { '#attempts': 'integrationAttempts', '#next': 'nextAttemptAt', '#error': 'integrationError' },
          { ':attempts': attempts, ':next': Math.floor(now() / 1000) + Math.min(900, 15 * 2 ** Math.min(attempts, 6)), ':error': code });
      try { await db.send(new TransactWriteCommand({ TransactItems: [op] as any })); }
      catch (retryError: any) { if (retryError?.name !== 'TransactionCanceledException') throw retryError; }
      return { status: review ? 'INTEGRATION_REVIEW_REQUIRED' : 'PENDING_INTEGRATION' };
    }
  }
  async function run() {
    let cursor: Row | undefined, processed = 0, failed = 0, review = 0;
    for (let page = 0; page < 2; page++) {
      const result = await db.send(new QueryCommand({ TableName: T.events, IndexName: 'ByDue',
        KeyConditionExpression: '#queue=:queue AND #next <= :now', ExpressionAttributeNames: { '#queue': 'queuePartition', '#next': 'nextAttemptAt' },
        ExpressionAttributeValues: { ':queue': COD_INTEGRATION_QUEUE, ':now': Math.floor(now() / 1000) }, Limit: 25, ExclusiveStartKey: cursor }));
      for (const row of result.Items ?? []) {
        try { const result = await processEvent(row.operationId); if (result.status === 'INTEGRATION_REVIEW_REQUIRED') review++; }
        catch { failed++; /* Continue the batch; scheduler summary exposes unresolved entries. */ }
        processed++;
      }
      cursor = result.LastEvaluatedKey; if (!cursor) break;
    }
    return { processed, failed, review };
  }
  return Object.freeze({ processEvent, run });
}
