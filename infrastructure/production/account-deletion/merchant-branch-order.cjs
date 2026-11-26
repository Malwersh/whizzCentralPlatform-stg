'use strict';

const { isDeepStrictEqual } = require('node:util');
const { GetCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { exact } = require('../../../backend/account-deletion/cod-retention');
const { error } = require('../../../backend/account-deletion/policy');
const { tables } = require('./evidence.cjs');

const contactFields = ['merchantPhone', 'merchantEmail', 'businessPhone', 'businessEmail', 'businessAddress', 'storeAddress'];

async function redactMerchantBranchOrder({ db, settlement, request, orderId, clock = Date.now }) {
  const branchId = request.scope?.id;
  if (request.actorType !== 'MERCHANT' || request.scope?.kind !== 'BUSINESS' ||
      request.status !== 'PROCESSING' || !request.leaseOwner || request.job?.businessId !== branchId ||
      request.job?.requestId !== request.requestId || request.job?.subjectId !== request.subjectId ||
      request.pk !== 'SUBJECT#MERCHANT#' + request.subjectId || request.sk !== 'REQUEST#' + request.requestId) {
    throw error('INVALID_CLEANUP_SCOPE');
  }

  const orderKey = { PK: 'ORDER#' + orderId, SK: 'META' };
  const { Item: order } = await db.send(new GetCommand({ TableName: tables.orders, Key: orderKey, ConsistentRead: true }));
  const branches = [order?.storeId, order?.businessId, order?.restaurantId].filter(id => id != null);
  if (order?.orderId !== orderId || !branches.length || branches.some(id => id !== branchId)) throw error('INVALID_CLEANUP_SCOPE');
  if (order.legalHold || order.retentionHold) throw error('DOCUMENTED_RETENTION_HOLD');
  const fields = contactFields.filter(field => order[field] !== undefined);
  if (!fields.length) return;
  const { accrual, order: approvedOrder, payable, outcome, outcomeKey } = await settlement.readMerchantAccrualEvidence(db, branchId, orderId);
  if (!isDeepStrictEqual(approvedOrder, order)) throw error('ORDER_CHANGED');
  if (accrual.branchId !== branchId || accrual.orderId !== orderId || payable.status !== 'PAID') throw error('SETTLEMENT_REQUIRED');
  if (payable.legalHold || payable.retentionHold || outcome.legalHold || outcome.retentionHold) throw error('DOCUMENTED_RETENTION_HOLD');
  const guard = exact(approvedOrder, contactFields);
  const removals = Object.fromEntries(fields.map((field, index) => ['#remove' + index, field]));
  await db.send(new TransactWriteCommand({ TransactItems: [
    { ConditionCheck: { TableName: tables.deletion, Key: { pk: request.pk, sk: request.sk },
      ConditionExpression: 'leaseOwner=:lease AND leaseUntil>:now AND #version=:version AND #status=:processing',
      ExpressionAttributeNames: { '#version': 'version', '#status': 'status' },
      ExpressionAttributeValues: { ':lease': request.leaseOwner, ':now': Math.floor(clock() / 1000),
        ':version': request.version, ':processing': 'PROCESSING' } } },
    { ConditionCheck: { TableName: tables.branches, Key: { businessId: branchId },
      ConditionExpression: 'ownerId=:owner AND cognitoUserId=:owner AND deletionRequestId=:request AND (attribute_not_exists(legalHold) OR legalHold=:no) AND (attribute_not_exists(retentionHold) OR retentionHold=:no)',
      ExpressionAttributeValues: { ':owner': request.subjectId, ':request': request.requestId, ':no': false } } },
    { ConditionCheck: { TableName: tables.holds, Key: { orderId, sk: 'MERCHANT_PAYABLE' }, ...exact(payable) } },
    { ConditionCheck: { TableName: tables.holds, Key: outcomeKey, ...exact(outcome) } },
    { Update: { TableName: tables.orders, Key: orderKey, ...guard,
      UpdateExpression: 'REMOVE ' + Object.keys(removals).join(', '),
      ExpressionAttributeNames: { ...guard.ExpressionAttributeNames, ...removals } } },
  ] }));
}

module.exports = { redactMerchantBranchOrder };
