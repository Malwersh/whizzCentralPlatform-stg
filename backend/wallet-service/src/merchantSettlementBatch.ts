import { DynamoDBDocumentClient, QueryCommand, TransactWriteCommand, TransactWriteCommandInput } from '@aws-sdk/lib-dynamodb';
import { assembleMerchantSettlementPreview, readMerchantAccrualEvidence } from './merchantSettlementPreview';
import { summarizeMerchantAccruals } from './merchantSettlementAccrual';
import { merchantSettlementPeriod, MerchantSettlementSchedule } from './merchantSettlementPeriod';
import { quoteCanonical, quoteEntityIdValid, quoteHash } from './deliveryQuoteRecord';
import { detach, exactCheck, strongGet, updateChecked } from './driverFinancialTransaction';

type Row = Record<string, any>;
type Guard = ReturnType<typeof exactCheck>;
const T = { records: 'staging-MerchantPlatform', holds: 'staging-Holds', orders: 'WizzOrders',
  offers: 'WaveOffers_staging', branches: 'WhizzMerchants_Businesses', deletion: 'staging-AccountDeletion', audit: 'staging-AuditLog' };
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const BATCH = /^MSB:[a-f0-9]{48}$/;
const PREVIEW = /^MSV:[a-f0-9]{48}$/;
const claims = ['settlementBatchId', 'settlementLineDigest', 'settlementClaimedAt'];
const orderFields = ['PK', 'SK', 'orderId', 'storeId', 'businessId', 'merchantId', 'driverId', 'status', 'orderStatus',
  'cashCollected', 'cashCollectedAmount', 'deliveredAt', 'financialSnapshot', 'financialAcceptance', 'financialOutcome',
  'commercialPricing', 'assignmentWaveNumber', 'assignmentAttemptCounter', 'returnStatus', 'returnCaseId',
  'cancellationStatus', 'cancellationRequestId', 'deletedAt', 'deletionRequestId', 'deletionStatus', 'isDeleted', 'rev', 'revision', 'version'];
export class MerchantSettlementBatchError extends Error {
  constructor(public readonly code: string) { super(code); this.name = 'MerchantSettlementBatchError'; }
}
const fail = (code = 'MERCHANT_SETTLEMENT_BATCH_UNAVAILABLE'): never => { throw new MerchantSettlementBatchError(code); };
const same = (a: unknown, b: unknown) => quoteCanonical(a) === quoteCanonical(b);
function instant(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) return fail('INVALID_SETTLEMENT_TIME');
  return value;
}
function scheduleKey(branchId: string) { return { pk: 'BRANCH#' + branchId, sk: 'SETTLEMENT_SCHEDULE#CURRENT' }; }
function partition(branchId: string) { return 'MERCHANT_SETTLEMENT#' + branchId; }
function batchKey(branchId: string, batchId: string, createdAt: string) { return { pk: partition(branchId), sk: 'BATCH#' + createdAt + '#' + batchId }; }
function lookupKey(branchId: string, batchId: string) { return { pk: partition(branchId), sk: 'INDEX#' + batchId }; }
function lineKey(branchId: string, batchId: string, orderId: string) { return { pk: partition(branchId), sk: 'LINE#' + batchId + '#' + orderId }; }
function markerKey(branchId: string, requestId: string) { return { pk: 'BRANCH#' + branchId, sk: 'SETTLEMENT_REQUEST#' + requestId }; }
function absent(TableName: string, Key: Row, field: string) {
  return { Put: { TableName, Item: Key, ConditionExpression: `attribute_not_exists(${field})` } };
}
function guardValid(guard: Guard) {
  const g = guard?.ConditionCheck;
  return g && Object.keys(guard).length === 1 &&
    [T.records, 'staging-PlatformStaff', T.branches, T.deletion].includes(g.TableName) &&
    g.Key && Object.keys(g.Key).length > 0 && typeof g.ConditionExpression === 'string' && g.ConditionExpression.length > 0;
}
function uniqueOperations(operations: Row[]) {
  const seen = new Set<string>();
  for (const op of operations) {
    const value = op.ConditionCheck || op.Update || op.Put;
    if (!value) return fail('INVALID_SETTLEMENT_TRANSACTION');
    const key = op.Put ? value.TableName === T.audit ? { datePartition: value.Item.datePartition, sk: value.Item.sk }
      : { pk: value.Item.pk, sk: value.Item.sk } : value.Key;
    const identity = quoteCanonical([value.TableName, key]);
    if (seen.has(identity)) return fail('DUPLICATE_SETTLEMENT_GUARD_TARGET');
    seen.add(identity);
  }
  if (operations.length > 100 || Buffer.byteLength(JSON.stringify(operations)) > 2 * 1024 * 1024) return fail('SETTLEMENT_TRANSACTION_TOO_LARGE');
}

export type SettlementBatchAuthority = { branchId: string; actorId: string; guards: Guard[] };

/** Internal Staging writer, deliberately not registered as an HTTP route.
 * Trusted dependencies must supply live CREATE/READ authorization and a pinned
 * schedule guard; none of those may originate from request JSON. Saved headers
 * and lines are append-only. No payout, wallet unlock, ledger or cancellation API.
 */
export function createMerchantSettlementBatchService(options: {
  db: Pick<DynamoDBDocumentClient, 'send'>;
  authorizeBranch: (branchId: string, action: 'CREATE' | 'READ') => Promise<SettlementBatchAuthority>;
  readSchedule: (branchId: string, at?: string) => Promise<{ schedule: MerchantSettlementSchedule; guard: Guard; guards?: Guard[]; agreementBinding?: { id: string; version: number; termsHash: string } } | null>;
  now?: () => number;
}) {
  const { db } = options;
  const now = options.now || Date.now;
  async function authority(branchId: string, action: 'CREATE' | 'READ') {
    const a = detach(await options.authorizeBranch(branchId, action));
    if (!a || a.branchId !== branchId || !quoteEntityIdValid(a.actorId) || !Array.isArray(a.guards) ||
        !a.guards.length || a.guards.length > 12 || a.guards.some(g => !guardValid(g))) return fail('SETTLEMENT_AUTHORIZATION_REQUIRED');
    return a;
  }
  async function stored(branchId: string, batchId: string) {
    const lookup = await strongGet(db, T.records, lookupKey(branchId, batchId));
    if (!lookup) return fail('SETTLEMENT_BATCH_NOT_FOUND');
    if (lookup.kind !== 'MERCHANT_SETTLEMENT_LOOKUP' || lookup.schemaVersion !== 1 || lookup.branchId !== branchId ||
        lookup.batchId !== batchId || !same(batchKey(branchId, batchId, instant(lookup.createdAt)), { pk: lookup.pk, sk: lookup.headerSk })) return fail('SETTLEMENT_BATCH_PROOF_INVALID');
    const key = { pk: lookup.pk, sk: lookup.headerSk }, header = await strongGet(db, T.records, key);
    if (!header) return fail('SETTLEMENT_BATCH_NOT_FOUND');
    validateHeader(branchId, header);
    if (header.batchId !== batchId || header.batchDigest !== lookup.batchDigest) return fail('SETTLEMENT_BATCH_PROOF_INVALID');
    const lines: Row[] = [], seen = new Set<string>();
    for (const reference of header.lineDigests) {
      if (!quoteEntityIdValid(reference.orderId) || seen.has(reference.orderId)) return fail('SETTLEMENT_BATCH_PROOF_INVALID');
      seen.add(reference.orderId);
      const expectedKey = lineKey(branchId, batchId, reference.orderId);
      const line = await strongGet(db, T.records, expectedKey);
      if (!line) return fail('SETTLEMENT_BATCH_PROOF_INVALID');
      const { pk: linePk, sk: lineSk, lineDigest, ...lineContent } = line;
      if (linePk !== expectedKey.pk || lineSk !== expectedKey.sk || line.kind !== 'MERCHANT_SETTLEMENT_LINE' ||
          line.schemaVersion !== 1 || line.batchId !== batchId || line.branchId !== branchId || line.orderId !== reference.orderId ||
          line.accrual?.orderId !== line.orderId || line.accrual?.branchId !== branchId ||
          lineDigest !== reference.digest || quoteHash(lineContent) !== lineDigest) return fail('SETTLEMENT_BATCH_PROOF_INVALID');
      lines.push(line);
    }
    if (!same(summarizeMerchantAccruals(branchId, lines.map(l => l.accrual)), header.summary)) return fail('SETTLEMENT_BATCH_PROOF_INVALID');
    return { header, lines };
  }
  function validateHeader(branchId: string, header: Row) {
    const { pk, sk, batchDigest, ...content } = header;
    const period = header.period;
    if (!BATCH.test(header.batchId || '') || !same({ pk, sk }, batchKey(branchId, header.batchId, instant(header.createdAt))) ||
        header.kind !== 'MERCHANT_SETTLEMENT_BATCH' || header.schemaVersion !== 1 || header.branchId !== branchId ||
        header.status !== 'FROZEN_PENDING_REVIEW' || header.payoutAuthorized !== false || header.walletMutationPerformed !== false ||
        !UUID.test(header.requestId || '') || header.batchId !== 'MSB:' + quoteHash({ branchId, requestId: header.requestId }).slice(0, 48) ||
        !quoteEntityIdValid(header.createdBy) || !PREVIEW.test(header.previewId || '') ||
        header.coverage !== 'EXPLICIT_ORDER_SELECTION_ONLY' || quoteHash(content) !== batchDigest ||
        !Array.isArray(header.lineDigests) || !header.lineDigests.length || header.lineDigests.length > 15 ||
        header.lineCount !== header.lineDigests.length || !period || header.createdAt < period.untilExclusiveUtc ||
        header.summary?.accrualCount !== header.lineCount || header.summary?.branchId !== branchId) return fail('SETTLEMENT_BATCH_PROOF_INVALID');
    const expectedPeriod = merchantSettlementPeriod({ schemaVersion: 1, version: period.scheduleVersion,
      timezone: period.timezone, frequency: period.frequency, anchorLocalDate: period.anchorLocalDate }, period.fromUtc);
    if (!same(period, expectedPeriod)) return fail('SETTLEMENT_BATCH_PROOF_INVALID');
    const seen = new Set<string>();
    for (const line of header.lineDigests) {
      if (!quoteEntityIdValid(line.orderId) || !/^[a-f0-9]{64}$/.test(line.digest || '') || seen.has(line.orderId)) return fail('SETTLEMENT_BATCH_PROOF_INVALID');
      seen.add(line.orderId);
    }
  }
  async function replay(request: Row, hash: string, actor: SettlementBatchAuthority) {
    const row = await strongGet(db, T.records, markerKey(request.branchId, request.requestId));
    if (!row) return null;
    if (row.kind !== 'MERCHANT_SETTLEMENT_REQUEST' || row.schemaVersion !== 1 || row.status !== 'COMMITTED' ||
        row.branchId !== request.branchId || row.requestId !== request.requestId || row.requestHash !== hash ||
        row.actorId !== actor.actorId || row.batchId !== 'MSB:' + quoteHash({ branchId: request.branchId, requestId: request.requestId }).slice(0, 48)) return fail('SETTLEMENT_REQUEST_CONFLICT');
    const saved = await stored(request.branchId, row.batchId);
    if (saved.header.batchDigest !== row.batchDigest || saved.header.requestHash !== hash ||
        saved.header.createdBy !== actor.actorId) return fail('SETTLEMENT_BATCH_PROOF_INVALID');
    const current = await authority(request.branchId, 'CREATE');
    if (current.actorId !== actor.actorId) return fail('SETTLEMENT_AUTHORIZATION_CHANGED');
    return { ...saved, replayed: true };
  }
  return Object.freeze({
    async create(value: unknown) {
      if (!value || typeof value !== 'object' || Array.isArray(value) ||
          Object.keys(value).sort().join(',') !== 'at,branchId,orderIds,previewId,requestId') return fail('INVALID_SETTLEMENT_BATCH_REQUEST');
      const request: Row = detach(value);
      if (!quoteEntityIdValid(request.branchId) || !UUID.test(request.requestId || '') || !PREVIEW.test(request.previewId || '') ||
          !Array.isArray(request.orderIds) || !request.orderIds.length || request.orderIds.length > 15 ||
          request.orderIds.some((v: unknown) => !quoteEntityIdValid(v)) || new Set(request.orderIds).size !== request.orderIds.length) return fail('INVALID_SETTLEMENT_BATCH_REQUEST');
      instant(request.at);
      request.orderIds.sort();
      const requestHash = quoteHash(request), actor = await authority(request.branchId, 'CREATE');
      const prior = await replay(request, requestHash, actor);
      if (prior) return prior;
      const schedule = detach(await options.readSchedule(request.branchId, request.at));
      if (!schedule || !guardValid(schedule.guard) || schedule.guard.ConditionCheck.TableName !== T.records ||
          !same(schedule.guard.ConditionCheck.Key, scheduleKey(request.branchId)) ||
          schedule.guards !== undefined && (!Array.isArray(schedule.guards) || schedule.guards.length > 4 || schedule.guards.some(g => !guardValid(g)))) return fail('SETTLEMENT_SCHEDULE_GUARD_REQUIRED');
      const period = merchantSettlementPeriod(schedule.schedule, request.at);
      const timestamp = instant(new Date(now()).toISOString());
      if (timestamp < period.untilExclusiveUtc) return fail('SETTLEMENT_PERIOD_STILL_OPEN');
      const branch = await strongGet(db, T.branches, { businessId: request.branchId });
      if (!branch || !quoteEntityIdValid(branch.ownerId) || branch.cognitoUserId !== branch.ownerId || branch.status !== 'approved' ||
          branch.deletionRequestId != null || branch.deletedAt != null || branch.isDeleted === true) return fail('SETTLEMENT_BRANCH_UNAVAILABLE');
      const evidence: Awaited<ReturnType<typeof readMerchantAccrualEvidence>>[] = [];
      for (const orderId of request.orderIds) {
        const source = await readMerchantAccrualEvidence(db, request.branchId, orderId);
        if (claims.some(k => Object.prototype.hasOwnProperty.call(source.payable, k))) return fail('MERCHANT_PAYABLE_ALREADY_IN_SETTLEMENT');
        if (schedule.agreementBinding && !same(source.accrual.agreement, schedule.agreementBinding)) return fail('SETTLEMENT_AGREEMENT_SCHEDULE_MISMATCH');
        if (source.order.merchantId !== branch.organizationId) return fail('SETTLEMENT_BRANCH_UNAVAILABLE');
        evidence.push(source);
      }
      const preview = assembleMerchantSettlementPreview(request.branchId, period, evidence.map(e => e.accrual));
      if (preview.previewId !== request.previewId) return fail('SETTLEMENT_PREVIEW_CHANGED');
      const batchId = 'MSB:' + quoteHash({ branchId: request.branchId, requestId: request.requestId }).slice(0, 48);
      const key = batchKey(request.branchId, batchId, timestamp);
      const lines = evidence.map(source => {
        const line = { schemaVersion: 1, kind: 'MERCHANT_SETTLEMENT_LINE', batchId, branchId: request.branchId,
          orderId: source.accrual.orderId, accrual: source.accrual };
        return { ...lineKey(request.branchId, batchId, line.orderId), ...line, lineDigest: quoteHash(line) };
      });
      const content = { schemaVersion: 1, kind: 'MERCHANT_SETTLEMENT_BATCH', batchId, branchId: request.branchId,
        requestId: request.requestId, requestHash, previewId: preview.previewId, period, summary: preview.summary,
        lineCount: lines.length, lineDigests: lines.map(l => ({ orderId: l.orderId, digest: l.lineDigest })),
        status: 'FROZEN_PENDING_REVIEW', coverage: 'EXPLICIT_ORDER_SELECTION_ONLY',
        createdAt: timestamp, createdBy: actor.actorId, payoutAuthorized: false, walletMutationPerformed: false,
        retentionClass: 'FINANCIAL_SETTLEMENT' };
      const header = { ...key, ...content, batchDigest: quoteHash(content) };
      const operations: Row[] = [...actor.guards, schedule.guard, ...(schedule.guards || []),
        exactCheck(T.branches, { businessId: request.branchId }, branch,
          ['businessId', 'ownerId', 'cognitoUserId', 'organizationId', 'status', 'deletionRequestId', 'deletedAt', 'isDeleted'])];
      for (const pk of ['BUSINESS_LIFECYCLE#MERCHANT#' + request.branchId, 'ACCOUNT_LIFECYCLE#MERCHANT#' + branch.ownerId]) {
        operations.push({ ConditionCheck: { TableName: T.deletion, Key: { pk, sk: 'META' }, ConditionExpression: 'attribute_not_exists(pk)' } });
      }
      for (const [index, source] of evidence.entries()) {
        const orderId = source.accrual.orderId;
        operations.push(exactCheck(T.orders, { PK: 'ORDER#' + orderId, SK: 'META' }, source.order, orderFields),
          exactCheck(T.offers, { orderId, SK: `FINANCIAL#${source.order.driverId}#WAVE#${source.order.assignmentWaveNumber}` }, source.acceptedOffer),
          exactCheck(T.holds, { orderId, sk: 'FINANCIAL_OUTCOME' }, source.outcome),
          updateChecked(exactCheck(T.holds, { orderId, sk: 'MERCHANT_PAYABLE' }, source.payable, [...Object.keys(source.payable), ...claims]),
            'SET #batch=:batch,#line=:line,#claimed=:claimed',
            { '#batch': 'settlementBatchId', '#line': 'settlementLineDigest', '#claimed': 'settlementClaimedAt' },
            { ':batch': batchId, ':line': lines[index].lineDigest, ':claimed': timestamp }),
          { Put: { ...absent(T.records, lines[index], 'pk').Put } });
      }
      operations.push({ Put: { ...absent(T.records, header, 'pk').Put } },
        { Put: { ...absent(T.records, { ...lookupKey(request.branchId, batchId), kind: 'MERCHANT_SETTLEMENT_LOOKUP', schemaVersion: 1,
          branchId: request.branchId, batchId, headerSk: header.sk, batchDigest: header.batchDigest, createdAt: timestamp,
          retentionClass: 'FINANCIAL_SETTLEMENT' }, 'pk').Put } },
        { Put: { ...absent(T.records, { ...markerKey(request.branchId, request.requestId), schemaVersion: 1,
          kind: 'MERCHANT_SETTLEMENT_REQUEST', status: 'COMMITTED', requestId: request.requestId, branchId: request.branchId,
          actorId: actor.actorId, requestHash, batchId, batchDigest: header.batchDigest, createdAt: timestamp,
          retentionClass: 'FINANCIAL_SETTLEMENT' }, 'pk').Put } },
        { Put: { TableName: T.audit, Item: { datePartition: 'date#' + timestamp.slice(0, 10).replace(/-/g, ''),
          sk: timestamp + '#' + batchId + '#MERCHANT_SETTLEMENT_FROZEN', action: 'MERCHANT_SETTLEMENT_FROZEN',
          actorId: actor.actorId, branchId: request.branchId, batchId, batchDigest: header.batchDigest,
          requestId: request.requestId, createdAt: timestamp, lineCount: lines.length,
          walletChanged: false, payoutAuthorized: false }, ConditionExpression: 'attribute_not_exists(sk)' } });
      uniqueOperations(operations);
      try {
        await db.send(new TransactWriteCommand({ TransactItems: operations as TransactWriteCommandInput['TransactItems'] }));
      } catch (error) {
        let committed: Awaited<ReturnType<typeof replay>>;
        try { committed = await replay(request, requestHash, actor); }
        catch (readError) {
          if (readError instanceof MerchantSettlementBatchError) throw readError;
          return fail('SETTLEMENT_OUTCOME_UNKNOWN_RETRY_SAME_REQUEST');
        }
        if (committed) return committed;
        await authority(request.branchId, 'CREATE');
        if (['ValidationException', 'AccessDeniedException', 'ResourceNotFoundException'].includes((error as Row)?.name)) return fail('SETTLEMENT_CONFIGURATION_UNAVAILABLE');
        return fail((error as Row)?.name === 'TransactionCanceledException' ? 'SETTLEMENT_SOURCE_CHANGED_OR_ALREADY_CLAIMED' : 'SETTLEMENT_OUTCOME_UNKNOWN_RETRY_SAME_REQUEST');
      }
      return { header, lines, replayed: false };
    },
    async read(value: unknown) {
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'batchId,branchId') return fail('INVALID_SETTLEMENT_BATCH_REQUEST');
      const request = detach(value as Row);
      if (!quoteEntityIdValid(request.branchId) || !BATCH.test(request.batchId || '')) return fail('INVALID_SETTLEMENT_BATCH_REQUEST');
      const before = await authority(request.branchId, 'READ');
      const saved = await stored(request.branchId, request.batchId);
      if ((await authority(request.branchId, 'READ')).actorId !== before.actorId) return fail('SETTLEMENT_AUTHORIZATION_CHANGED');
      return saved;
    },
    async list(value: unknown) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('INVALID_SETTLEMENT_BATCH_REQUEST');
      const request = detach(value as Row);
      if (Object.keys(request).sort().join(',') !== (request.cursor === undefined ? 'branchId,limit' : 'branchId,cursor,limit') ||
          !quoteEntityIdValid(request.branchId) || !Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > 50) return fail('INVALID_SETTLEMENT_BATCH_REQUEST');
      const a = await authority(request.branchId, 'READ');
      const validKey = (key: Row) => key && Object.keys(key).sort().join(',') === 'pk,sk' && key.pk === partition(request.branchId) &&
        typeof key.sk === 'string' && /^BATCH#\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z#MSB:[a-f0-9]{48}$/.test(key.sk);
      let cursor: Row | undefined;
      if (request.cursor !== undefined) {
        try {
          if (typeof request.cursor !== 'string' || request.cursor.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(request.cursor)) return fail('INVALID_SETTLEMENT_CURSOR');
          const parsed = JSON.parse(Buffer.from(request.cursor, 'base64url').toString('utf8'));
          if (Object.keys(parsed).sort().join(',') !== 'branchId,key,schemaVersion' || parsed.schemaVersion !== 1 || parsed.branchId !== request.branchId || !validKey(parsed.key)) return fail('INVALID_SETTLEMENT_CURSOR');
          cursor = parsed.key;
        } catch { return fail('INVALID_SETTLEMENT_CURSOR'); }
      }
      const page = await db.send(new QueryCommand({ TableName: T.records, KeyConditionExpression: 'pk=:pk AND begins_with(sk,:prefix)',
        ExpressionAttributeValues: { ':pk': partition(request.branchId), ':prefix': 'BATCH#' }, Limit: request.limit,
        ScanIndexForward: false, ConsistentRead: true, ...(cursor ? { ExclusiveStartKey: cursor } : {}) }));
      const rows = page.Items || [];
      if (rows.length > request.limit) return fail('SETTLEMENT_BATCH_PROOF_INVALID');
      const seen = new Set<string>();
      for (const row of rows) {
        validateHeader(request.branchId, row);
        if (seen.has(row.batchId)) return fail('SETTLEMENT_BATCH_PROOF_INVALID');
        seen.add(row.batchId);
      }
      const next = page.LastEvaluatedKey;
      if (next && !validKey(next)) return fail('SETTLEMENT_BATCH_PROOF_INVALID');
      if ((await authority(request.branchId, 'READ')).actorId !== a.actorId) return fail('SETTLEMENT_AUTHORIZATION_CHANGED');
      const items = rows.map(row => ({ batchId: row.batchId, batchDigest: row.batchDigest, branchId: row.branchId,
        status: row.status, createdAt: row.createdAt, createdBy: row.createdBy, period: row.period,
        lineCount: row.lineCount, summary: row.summary, coverage: row.coverage, payoutAuthorized: false }));
      return { items, coverage: 'PAGE_OF_SAVED_STATEMENTS_ONLY',
        nextCursor: next ? Buffer.from(JSON.stringify({ schemaVersion: 1, branchId: request.branchId, key: next })).toString('base64url') : null };
    },
  });
}
