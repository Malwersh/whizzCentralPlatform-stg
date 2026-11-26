import { GetCommand, QueryCommand, DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { CANCELLATION_REVIEW_ACTIONS } from './exceptionCaseAdministration';
import { quoteEntityIdValid } from './deliveryQuoteRecord';
import { financialOrderTables } from './walletBindings';
import { CASE_OPEN_PARTITION } from './orderExceptionCaseIndex';
import { readOrderExceptionPolicy } from './orderExceptionPolicy';

const { allowed } = require('../../staff-service/catalog');
const caseKeys = ['CUSTOMER_CANCELLATION', 'MERCHANT_CANCELLATION'];
const validId = quoteEntityIdValid;
type Row = Record<string, any>;
type Database = Pick<DynamoDBDocumentClient, 'send'>;
const fail = (status: number, code: string): never => {
  throw Object.assign(new Error(code), {status, code});
};

export function createCancellationQueue(db: Database) {
  const tables = financialOrderTables();
  const get = async (TableName: string, Key: Row) =>
    (await db.send(new GetCommand({TableName, Key, ConsistentRead: true}))).Item;

  async function read(orderId: string, caseKey: string, employee: Row) {
    if (!validId(orderId) || !caseKeys.includes(caseKey)) return fail(400, 'INVALID_EXCEPTION_SELECTOR');
    const [order, record] = await Promise.all([
      get(tables.orders, {PK: 'ORDER#' + orderId, SK: 'META'}),
      get(tables.holds, {orderId, sk: caseKey}),
    ]);
    if (!order || !record || order.orderId !== orderId || order.deletedAt || order.isDeleted ||
        order.deletionRequestId || !readOrderExceptionPolicy(order) || record.orderId !== orderId ||
        record.kind !== caseKey || !validId(record.caseId) || !Number.isSafeInteger(record.version)) return null;
    const proof = record.merchantRetentionProof;
    const pending = record.kind === 'CUSTOMER_CANCELLATION' && record.state === 'REQUESTED';
    const pickedUp = order.pickedUpAt != null || order.merchantHandover?.state === 'HANDED_TO_DRIVER' ||
      ['picked_up','out_for_delivery','heading_to_customer','arrived_at_customer','delivered','completed','returned','cancelled','canceled'].includes(order.status);
    const canOperate = allowed(employee, 'orders.cancel') || allowed(employee, 'finance.approve');
    const actions = canOperate ? ['ADD_NOTE'] : [];
    if (canOperate && pending) {
      actions.push('REQUEST_EVIDENCE', 'DECLINE_CANCELLATION');
      if (proof?.goodsRetainedByBranch === true && proof.branchId === order.storeId && !pickedUp) {
        actions.push('CANCEL_BEFORE_PICKUP');
      }
    }
    return {
      orderId, orderNumber: order.orderNumber || null,
      branchName: order.storeName || order.restaurantName || order.businessName || 'متجر الطلب',
      orderStatus: order.status, caseKey, caseId: record.caseId, version: record.version,
      state: record.state, reason: record.reason, createdAt: record.createdAt, updatedAt: record.updatedAt,
      settlementPending: record.settlementStatus === 'REVIEW' && !record.financialClosure,
      canViewCompensation: allowed(employee, 'finance.read') && record.state === 'CANCELLED' &&
        order.status === 'cancelled' && order.financialSnapshot?.schemaVersion === 3 &&
        order.pickedUpAt == null && order.pickupAt == null && order.merchantHandover?.state !== 'HANDED_TO_DRIVER',
      canConfirmRetainedGoods: proof?.goodsRetainedByBranch === true,
      retention: proof ? {preparationState: proof.preparationState, note: proof.note, recordedAt: proof.recordedAt} : null,
      pickupRecorded: pickedUp,
      evidenceRequest: record.evidenceRequest?.reason ?? null,
      decision: record.decision ? {reason: record.decision.reason, at: record.decision.at} : null,
      notes: (record.adminNotes ?? []).map(({text, recordedAt}: Row) => ({text, recordedAt})),
      actions,
    };
  }

  async function list(query: Row, employee: Row) {
    if (Object.keys(query).some(k => !['order', 'cursor'].includes(k)) || query.order && query.cursor) {
      return fail(400, 'INVALID_EXCEPTION_SELECTOR');
    }
    if (query.order !== undefined) {
      if (!validId(query.order)) return fail(400, 'INVALID_EXCEPTION_SELECTOR');
      let orderId = query.order;
      if (/^ORD[0-9]{10,20}$/i.test(orderId)) {
        const result = await db.send(new QueryCommand({
          TableName: tables.orders, IndexName: 'GSI_OrderNumber',
          KeyConditionExpression: 'orderNumber = :number',
          ExpressionAttributeValues: {':number': orderId.toUpperCase()},
          ProjectionExpression: 'orderId, PK, SK', Limit: 2,
        }));
        const found = result.Items ?? [];
        if (found.length !== 1 || result.LastEvaluatedKey || found[0].SK !== 'META' ||
            found[0].PK !== 'ORDER#' + found[0].orderId || !validId(found[0].orderId)) return {items: []};
        orderId = found[0].orderId;
      }
      const items = await Promise.all(caseKeys.map(key => read(orderId, key, employee)));
      return {items: items.filter(Boolean)};
    }
    let cursor;
    if (query.cursor !== undefined) {
      try {
        if (typeof query.cursor !== 'string' || query.cursor.length > 2000) throw Error();
        const saved = JSON.parse(Buffer.from(query.cursor, 'base64url').toString());
        const key = saved.key;
        if (saved.actor !== employee.employeeId || saved.version !== employee.version ||
            Object.keys(key).sort().join(',') !== 'nextAttemptAt,operationId,queuePartition' ||
            key.queuePartition !== CASE_OPEN_PARTITION || typeof key.operationId !== 'string' ||
            !key.operationId.startsWith('EXCEPTION_CASE#') || !validId(key.operationId.slice('EXCEPTION_CASE#'.length)) ||
            !Number.isSafeInteger(key.nextAttemptAt)) throw Error();
        cursor = key;
      } catch { return fail(400, 'INVALID_CURSOR'); }
    }
    const result = await db.send(new QueryCommand({
      TableName: tables.lifecycle, IndexName: 'ByDue', Limit: 25, ExclusiveStartKey: cursor,
      KeyConditionExpression: 'queuePartition = :queue', FilterExpression: 'caseKey IN (:customer, :merchant)',
      ExpressionAttributeValues: {':queue': CASE_OPEN_PARTITION, ':customer': caseKeys[0], ':merchant': caseKeys[1]},
    }));
    const pointers = (result.Items ?? []).filter(pointer =>
      pointer.kind === 'ORDER_EXCEPTION_CASE_POINTER' && validId(pointer.orderId) &&
      caseKeys.includes(pointer.caseKey) && pointer.operationId === 'EXCEPTION_CASE#' + pointer.caseId);
    const views = await Promise.all(pointers.map(async pointer => {
      const item = await read(pointer.orderId, pointer.caseKey, employee);
      return item && item.caseId === pointer.caseId &&
        (item.state === 'REQUESTED' || item.settlementPending) ? item : null;
    }));
    const nextCursor = result.LastEvaluatedKey ? Buffer.from(JSON.stringify({
      actor: employee.employeeId, version: employee.version, key: result.LastEvaluatedKey,
    })).toString('base64url') : null;
    return {items: views.filter(Boolean), nextCursor};
  }
  return {list};
}

export function validateCancellationReviewAction(input: Row) {
  if (!input || Array.isArray(input) ||
      Object.keys(input).sort().join(',') !== 'action,caseId,caseKey,expectedVersion,idempotencyKey,orderId,reason' ||
      !caseKeys.includes(input.caseKey) || !CANCELLATION_REVIEW_ACTIONS.includes(input.action) ||
      !validId(input.caseId) || !validId(input.orderId) || !Number.isSafeInteger(input.expectedVersion) ||
      input.expectedVersion < 1 || typeof input.reason !== 'string' || input.reason.trim().length < 5 ||
      input.reason.length > (input.action === 'CANCEL_BEFORE_PICKUP' ? 1000 : 2000) ||
      typeof input.idempotencyKey !== 'string' ||
      !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(input.idempotencyKey)) {
    return fail(400, 'INVALID_EXCEPTION_CASE_ACTION');
  }
}
