'use strict';

const { isDeepStrictEqual } = require('node:util');
const { GetCommand, QueryCommand, ScanCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { financialRecord, ORDER_PII } = require('../../../backend/account-deletion/customer-cleanup');
const { exact } = require('../../../backend/account-deletion/cod-retention');
const { retentionSettings } = require('../../../backend/account-deletion/settings');
const { caseClosed } = require('../../../backend/account-deletion/customer-funding-closure-review');
const { error } = require('../../../backend/account-deletion/policy');
const { tables, terminalOrders } = require('./evidence.cjs');
const { customerExecutionChecks } = require('./customer-execution-scope.cjs');

const archiveTable = 'wizz-production-AccountDeletionFinancialArchive';
const ownerFields = ['userSub', 'userId', 'customerId'];
const priceFields = ['goodsSubtotal', 'serviceFee', 'packagingFee', 'deliveryFee', 'tax', 'tip', 'rounding', 'discount', 'total'];
const moneyFields = ['totalAmount', 'subtotal', 'total', 'deliveryFee', 'tax', 'discount'];
const textFields = ['orderId', 'storeId', 'businessId', 'status', 'paymentMethod', 'paymentStatus', 'currency',
  'createdAt', 'deliveredAt', 'completedAt', 'canceledAt'];

async function customerOrders(db, request, maxPages) {
  const names = Object.fromEntries(ownerFields.map((field, i) => ['#owner' + i, field]));
  const records = [];
  let cursor, pages = 0;
  do {
    const result = await db.send(new ScanCommand({
      TableName: tables.orders, ConsistentRead: true, Limit: 250, ExclusiveStartKey: cursor,
      FilterExpression: '#sk=:meta AND (' + Object.keys(names).map(name => name + '=:owner').join(' OR ') + ')',
      ExpressionAttributeNames: { ...names, '#sk': 'SK' },
      ExpressionAttributeValues: { ':meta': 'META', ':owner': request.subjectId },
    }));
    for (const order of result.Items ?? []) {
      if (order.PK !== 'ORDER#' + order.orderId || order.SK !== 'META' ||
          typeof order.orderId !== 'string' || !/^[A-Za-z0-9_.:-]{1,150}$/.test(order.orderId) ||
          !ownerFields.some(field => order[field] === request.subjectId) ||
          ownerFields.some(field => order[field] != null && order[field] !== request.subjectId)) throw error('INVALID_CLEANUP_SCOPE');
      if (order.legalHold || order.retentionHold) throw error('DOCUMENTED_RETENTION_HOLD');
      if (!terminalOrders.has(String(order.status).toLowerCase())) throw error('ACTIVE_ORDER_AFTER_LOCK');
      records.push(order);
    }
    cursor = result.LastEvaluatedKey;
    if (++pages >= maxPages && cursor) throw error('INVENTORY_INCOMPLETE');
  } while (cursor);

  return records;
}

async function archiveCustomerOrders({ db, request, job, clock = Date.now, maxPages = 100 }) {
  customerExecutionChecks(request, job, clock());
  if (!request.policyVersion || request.policyVersion !== job.policyVersion) throw error('RETENTION_POLICY_INVALID');
  const loadPolicy = retentionSettings({ db, table: tables.staff, environment: 'production' });
  const policy = await loadPolicy('CUSTOMER', request.policyVersion);
  if (policy.financialRetentionYears !== job.financialYears) throw error('RETENTION_POLICY_INVALID');

  const now = new Date(clock()).toISOString();
  const records = [];
  for (const order of await customerOrders(db, request, maxPages)) {
    if (order.codFinancialEvidence && (order.financialSnapshot || order.financialAcceptance)) {
      throw error('FINANCIAL_ARCHIVE_SOURCE_AMBIGUOUS');
    }
    // Another party may have redacted this shared order already. Its prior
    // financial evidence must be verified before deriving a new archive.
    if (order.codFinancialEvidence || order.financialOutcome && !order.financialSnapshot && !order.financialAcceptance) {
      throw error('FINANCIAL_ARCHIVE_SOURCE_REQUIRED');
    }
    if (textFields.some(field => order[field] != null && typeof order[field] !== 'string') ||
        moneyFields.some(field => order[field] != null && !Number.isSafeInteger(order[field])) ||
        !Number.isFinite(Date.parse(order.createdAt))) {
      throw error('FINANCIAL_RECORD_INVALID');
    }
    const key = { PK: order.PK, SK: order.SK };
    const record = financialRecord(order, 'order', job, now);
    if (order.pricing != null) {
      if (typeof order.pricing !== 'object' || Array.isArray(order.pricing)) throw error('FINANCIAL_RECORD_INVALID');
      const parts = priceFields.filter(field => order.pricing[field] !== undefined);
      if (parts.some(field => !Number.isSafeInteger(order.pricing[field]))) throw error('FINANCIAL_RECORD_INVALID');
      record.data.pricing = Object.fromEntries(parts.map(field => [field, order.pricing[field]]));
    }
    const archiveKey = { pk: 'REQUEST#' + request.requestId, sk: 'ORDER#' + JSON.stringify(key) };
    records.push({
      archiveKey, key, order,
      archive: { ...archiveKey, ...record, sourceTable: tables.orders, sourceKey: key },
    });
  }

  for (const { archiveKey, archive, order, key } of records) {
    const previous = (await db.send(new GetCommand({
      TableName: archiveTable, Key: archiveKey, ConsistentRead: true,
    }))).Item;
    if (previous) {
      if (!isDeepStrictEqual(previous, { ...archive, archivedAt: previous.archivedAt })) throw error('ARCHIVE_CONFLICT');
      continue;
    }
    const fields = [...ownerFields, ...priceFields, ...moneyFields, ...textFields,
      'pricing', 'rev', 'updatedAt', 'financialSnapshot', 'financialAcceptance',
      'financialOutcome', 'codFinancialEvidence', 'commercialPricing'];
    const snapshot = Object.fromEntries(['PK', 'SK', ...fields].map(field => [field, order[field]]));
    await db.send(new TransactWriteCommand({ TransactItems: [
      ...customerExecutionChecks(request, job, clock()),
      { ConditionCheck: {
        TableName: tables.staff, Key: { pk: 'OPERATIONAL_SETTINGS#ACCOUNT_DELETION', sk: 'VERSION#' + request.policyVersion },
        ConditionExpression: 'policyVersion=:policy AND #values.financialRetentionYears=:years AND attribute_exists(approvedAt) AND attribute_exists(approvedBy)',
        ExpressionAttributeNames: { '#values': 'values' },
        ExpressionAttributeValues: { ':policy': request.policyVersion, ':years': job.financialYears },
      } },
      { ConditionCheck: { TableName: tables.orders, Key: key, ...exact(snapshot) } },
      { Put: { TableName: archiveTable, Item: archive, ConditionExpression: 'attribute_not_exists(pk)' } },
    ] }));
  }
}

const locationAndContactFields = [
  'deliveryName', 'deliveryPhone', 'deliveryEmail', 'deliveryLocation', 'deliveryCoordinates',
  'customerPoint', 'dropoffPoint', 'dropoffAddress', 'dropoffInstructions',
];
const proofFields = ['financialSnapshot', 'financialAcceptance', 'codFinancialEvidence'];

const offerPrivateFields = new Set([
  ...ORDER_PII, ...locationAndContactFields, 'recipient', 'recipientAddress',
  'recipientName', 'recipientPhone', 'deliveryRoute', 'legacyPresentation',
]);

function hasCustomerOfferData(value) {
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([field, data]) =>
    data != null && (offerPrivateFields.has(field) || hasCustomerOfferData(data)));
}

const isFinancialException = order => ['cancelled','returned'].includes(order.status) &&
  (order.financialOutcome != null || proofFields.some(field => order[field] != null));

const redactableOfferContainers = new Set(['financialOffer', 'acceptedTerms', 'display', 'presentation']);

async function closedExceptionGuards(db, order, maxPages) {
  const { orderId, status } = order;
  if (status === 'delivered' && order.orderStatus === status &&
      order.returnStatus == null && order.returnCaseId == null &&
      order.cancellationStatus == null && order.cancellationRequestId == null) return { guards: [] };
  if (!['cancelled','returned'].includes(status) || order.orderStatus !== status) {
    throw error('DRIVER_OFFER_PRIVACY_CLEANUP_REQUIRED');
  }
  const guards = [];
  let cursor, closure;
  for (let page = 0; page < maxPages; page++) {
    const response = await db.send(new QueryCommand({
      TableName: tables.holds, ConsistentRead: true, Limit: 100, ExclusiveStartKey: cursor,
      KeyConditionExpression: 'orderId=:order', ExpressionAttributeValues: { ':order': orderId },
    }));
    for (const row of response.Items ?? []) {
      if (row.orderId !== orderId || typeof row.sk !== 'string') throw error('INVALID_CLEANUP_SCOPE');
      if (row.legalHold || row.retentionHold) throw error('DOCUMENTED_RETENTION_HOLD');
      if (row.status === 'ACTIVE' || row.correctionReview?.status === 'PENDING' ||
          row.appealReviewRequired || row.caseAppeals?.some(appeal => appeal.status === 'OPEN')) {
        throw error('ORDER_EXCEPTION_CLOSURE_REQUIRED');
      }
      const cancellation = ['CUSTOMER_CANCELLATION','MERCHANT_CANCELLATION'].includes(row.kind);
      const returned = row.kind === 'COD_RETURN_CASE';
      if (cancellation || returned || row.kind === 'CUSTOMER_CASH_REVIEW_CASE') {
        if (!caseClosed(row)) throw error('ORDER_EXCEPTION_CLOSURE_REQUIRED');
        const completed = typeof row.financialClosure?.actorId === 'string' &&
          Number.isFinite(Date.parse(row.financialClosure.closedAt));
        if (status === 'cancelled' && cancellation && row.state === 'CANCELLED' &&
            row.settlementStatus === 'RESOLVED' && completed) closure = row;
        if (status === 'returned' && returned && row.returnId === order.returnCaseId &&
            row.taskCompletion?.returnId === row.returnId && completed) closure = row;
        guards.push({ ConditionCheck: { TableName: tables.holds, Key: { orderId, sk: row.sk }, ...exact(row) } });
      }
    }
    cursor = response.LastEvaluatedKey;
    if (!cursor) {
      if (!closure) throw error('ORDER_EXCEPTION_CLOSURE_REQUIRED');
      return { guards, closure };
    }
  }
  throw error('INVENTORY_INCOMPLETE');
}

async function customerOfferUpdates(db, order, maxPages) {
  const { orderId } = order;
  const updates = [];
  let cursor;
  for (let page = 0; page < maxPages; page++) {
    const response = await db.send(new QueryCommand({
      TableName: tables.offers, ConsistentRead: true, Limit: 100, ExclusiveStartKey: cursor,
      KeyConditionExpression: 'orderId=:order', ExpressionAttributeValues: { ':order': orderId },
    }));
    for (const offer of response.Items ?? []) {
      if (offer.orderId !== orderId || typeof offer.SK !== 'string') throw error('INVALID_CLEANUP_SCOPE');
      if (offer.legalHold || offer.retentionHold) throw error('DOCUMENTED_RETENTION_HOLD');
      if (!hasCustomerOfferData(offer)) continue;
      const fields = Object.entries(offer).filter(([field, value]) =>
        value != null && (offerPrivateFields.has(field) || hasCustomerOfferData(value))).map(([field]) => field);
      if (fields.some(field => !offerPrivateFields.has(field) && !redactableOfferContainers.has(field))) {
        throw error('DRIVER_OFFER_PRIVACY_CLEANUP_REQUIRED');
      }
      const names = Object.fromEntries(fields.map((field, index) => ['#remove' + index, field]));
      const condition = exact(offer);
      updates.push({ Update: {
        TableName: tables.offers, Key: { orderId, SK: offer.SK },
        UpdateExpression: 'REMOVE ' + Object.keys(names).join(', '),
        ...condition, ExpressionAttributeNames: { ...condition.ExpressionAttributeNames, ...names },
      } });
      if (updates.length > 90) throw error('INVENTORY_INCOMPLETE');
    }
    cursor = response.LastEvaluatedKey;
    if (!cursor) return updates;
  }
  throw error('INVENTORY_INCOMPLETE');
}

function createCustomerOrderCleanup({
  preserveMerchantSettlementEvidence, readMerchantAccrualEvidence, verifyZeroMerchantException,
}) {
  if (typeof preserveMerchantSettlementEvidence !== 'function' ||
      typeof readMerchantAccrualEvidence !== 'function') throw error('SETTLEMENT_PROOF_ADAPTER_REQUIRED');

  const payableKey = orderId => ({ orderId, sk: 'MERCHANT_PAYABLE' });
  const get = async (db, TableName, Key) =>
    (await db.send(new GetCommand({ TableName, Key, ConsistentRead: true }))).Item;
  async function zeroMerchantGuard(db, order, closure) {
    if (!closure || typeof verifyZeroMerchantException !== 'function') throw error('ORDER_EXCEPTION_CLOSURE_REQUIRED');
    const Key = { orderId: order.orderId, sk: 'EXCEPTION_ENTITLEMENTS' };
    const journal = await get(db, tables.holds, Key);
    if (!journal || journal.legalHold || journal.retentionHold) throw error('ORDER_EXCEPTION_CLOSURE_REQUIRED');
    verifyZeroMerchantException(order, closure, journal);
    return { ConditionCheck: { TableName: tables.holds, Key, ...exact(journal) } };
  }

  return {
    async preflight({ db, request, maxPages = 100 }) {
      const orders = await customerOrders(db, request, maxPages);
      for (const order of orders) {
        const updates = await customerOfferUpdates(db, order, maxPages);
        if (updates.length || isFinancialException(order)) {
          const { closure } = await closedExceptionGuards(db, order, maxPages);
          if (closure && !await get(db, tables.holds, payableKey(order.orderId))) {
            await zeroMerchantGuard(db, order, closure);
            continue;
          }
          const source = await readMerchantAccrualEvidence(db, order.storeId ?? order.businessId, order.orderId);
          if (closure && source.payable.status !== 'PAID') throw error('ORDER_EXCEPTION_CLOSURE_REQUIRED');
        }
      }
    },
    archive: archiveCustomerOrders,
    async redact({ db, request, job, clock = Date.now, maxPages = 100 }) {
      customerExecutionChecks(request, job, clock());
      const orders = await customerOrders(db, request, maxPages);
      const inventory = new Map();
      for (const order of orders) inventory.set(order.orderId, await customerOfferUpdates(db, order, maxPages));
      for (const order of orders) {
        const offerUpdates = inventory.get(order.orderId);
        const key = { PK: order.PK, SK: order.SK };
        const archiveKey = { pk: 'REQUEST#' + request.requestId, sk: 'ORDER#' + JSON.stringify(key) };
        const archive = await get(db, archiveTable, archiveKey);
        if (!archive || archive.sourceTable !== tables.orders || !isDeepStrictEqual(archive.sourceKey, key) ||
            archive.requestId !== request.requestId || archive.policyVersion !== job.policyVersion) {
          throw error('FINANCIAL_ARCHIVE_SOURCE_REQUIRED');
        }
        const expected = financialRecord(order, 'order', job, archive.archivedAt);
        if (order.pricing != null) {
          const fields = priceFields.filter(field => order.pricing[field] !== undefined);
          expected.data.pricing = Object.fromEntries(fields.map(field => [field, order.pricing[field]]));
        }
        if (!isDeepStrictEqual(expected.data, archive.data)) throw error('ARCHIVE_CONFLICT');

        const payableSourceKey = payableKey(order.orderId);
        const payable = await get(db, tables.holds, payableSourceKey);
        const { guards, closure } = offerUpdates.length || isFinancialException(order)
          ? await closedExceptionGuards(db, order, maxPages) : { guards: [] };
        if (closure && payable && payable.status !== 'PAID') throw error('ORDER_EXCEPTION_CLOSURE_REQUIRED');
        if (payable) {
          const branchId = order.storeId ?? order.businessId;
          await preserveMerchantSettlementEvidence(db, branchId, order.orderId);
          const source = await readMerchantAccrualEvidence(db, branchId, order.orderId);
          if (!source.payable.settlementEvidence || !isDeepStrictEqual(source.order, order)) {
            throw error('FINANCIAL_ARCHIVE_SOURCE_REQUIRED');
          }
          guards.push({ ConditionCheck: { TableName: tables.holds, Key: payableSourceKey, ...exact(source.payable) } });
          guards.push({ ConditionCheck: { TableName: tables.holds, Key: source.outcomeKey, ...exact(source.outcome) } });
          if (source.accountingJournal) guards.push({ ConditionCheck: {
            TableName: tables.platform, Key: { pk: 'FULL_CASH_JOURNAL#' + order.orderId, sk: 'META' },
            ...exact(source.accountingJournal),
          } });
          if (source.cashAdjudicationJournal) guards.push({ ConditionCheck: {
            TableName: tables.holds, Key: { orderId: order.orderId, sk: 'CASH_ADJUDICATION_JOURNAL' },
            ...exact(source.cashAdjudicationJournal),
          } });

        } else {
          if (closure) guards.push(await zeroMerchantGuard(db, order, closure));
          else if (offerUpdates.length || order.financialOutcome || proofFields.some(field => order[field] != null)) {
            throw error('FINANCIAL_ARCHIVE_SOURCE_REQUIRED');
          }
          guards.push({ ConditionCheck: { TableName: tables.holds, Key: payableSourceKey,
            ConditionExpression: 'attribute_not_exists(orderId)' } });
        }

        const fields = [...new Set([...ORDER_PII, ...locationAndContactFields, ...proofFields])];
        const snapshot = Object.fromEntries([...new Set([...Object.keys(order), ...fields,
          'financialOutcome', 'accountDeletionRequestId'])].map(field => [field, order[field]]));
        const fence = exact(snapshot);
        const pricing = archive.data.pricing;
        const pricingNames = pricing ? { '#pricing': 'pricing' } : {};
        const pricingValues = pricing ? { ':pricing': pricing } : {};
        const names = Object.fromEntries(fields.map((field, index) => ['#remove' + index, field]));
        if (guards.length + offerUpdates.length + 4 > 100) throw error('INVENTORY_INCOMPLETE');
        await db.send(new TransactWriteCommand({ TransactItems: [
          ...customerExecutionChecks(request, job, clock()),
          { ConditionCheck: { TableName: archiveTable, Key: archiveKey, ...exact(archive) } },
          ...guards,
          ...offerUpdates,
          { Update: {
            TableName: tables.orders, Key: key,
            UpdateExpression: 'SET #request=:request' + (pricing ? ', #pricing=:pricing' : '') + ' REMOVE ' + Object.keys(names).join(', '),
            ConditionExpression: fence.ConditionExpression,
            ExpressionAttributeNames: { ...fence.ExpressionAttributeNames, ...names, ...pricingNames, '#request': 'accountDeletionRequestId' },
            ExpressionAttributeValues: { ...fence.ExpressionAttributeValues, ...pricingValues, ':request': request.requestId },
          } },
        ] }));
      }
    },
  };
}

module.exports = { archiveCustomerOrders, createCustomerOrderCleanup, closedExceptionGuards };
