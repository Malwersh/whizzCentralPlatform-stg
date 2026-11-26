'use strict';

const { GetCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { exact } = require('../../../backend/account-deletion/cod-retention');
const { error } = require('../../../backend/account-deletion/policy');
const { tables } = require('./evidence.cjs');

async function finalizeMerchantBranch({ db, request, clock = Date.now }) {
  const { pk, sk, scope, subjectId, requestId, job, leaseOwner, version } = request;
  const branchId = scope?.id;
  if (request.actorType !== 'MERCHANT' || scope?.kind !== 'BUSINESS' || request.status !== 'PROCESSING' ||
      !branchId || !leaseOwner || job?.businessId !== branchId || job.subjectId !== subjectId ||
      job.requestId !== requestId || pk !== 'SUBJECT#MERCHANT#' + subjectId || sk !== 'REQUEST#' + requestId) {
    throw error('INVALID_CLEANUP_SCOPE');
  }
  const branchKey = { businessId: branchId };
  const walletId = 'WALLET#MERCHANT#' + branchId;
  const walletKey = { walletId, sk: 'META' };
  const markerKey = { pk: 'BUSINESS_LIFECYCLE#MERCHANT#' + branchId, sk: 'META' };
  const get = async (TableName, Key) => (await db.send(new GetCommand({ TableName, Key, ConsistentRead: true }))).Item;
  const [branch, wallet, marker] = await Promise.all([
    get(tables.branches, branchKey), get(tables.wallets, walletKey), get(tables.deletion, markerKey),
  ]);
  if (branch?.businessId !== branchId || branch.deletionRequestId !== requestId ||
      marker?.requestId !== requestId || marker.subjectId !== subjectId ||
      wallet?.deletionRequestId !== requestId || wallet.walletId !== walletId ||
      wallet.ownerId !== branchId || wallet.ownerType !== 'MERCHANT' || wallet.currency !== 'IQD' ||
      wallet.availableBalance !== 0 || wallet.lockedBalance !== 0) throw error('INVALID_CLEANUP_SCOPE');
  if ([branch, marker, wallet].some(row => row.legalHold || row.retentionHold)) throw error('DOCUMENTED_RETENTION_HOLD');
  if (branch.isDeleted === true && branch.lifecycleStatus === 'closed' && marker.state === 'CLOSED' &&
      wallet.status === 'CLOSED') return;
  if (branch.ownerId !== subjectId || branch.cognitoUserId !== subjectId || branch.acceptingOrders !== false ||
      marker.state !== 'CLOSING' || wallet.status !== 'SUSPENDED' || !Number.isSafeInteger(wallet.version)) {
    throw error('INVALID_CLEANUP_SCOPE');
  }
  const now = clock();
  const completedAt = new Date(now).toISOString();
  await db.send(new TransactWriteCommand({ TransactItems: [
    { ConditionCheck: { TableName: tables.deletion, Key: { pk, sk },
      ConditionExpression: 'leaseOwner=:lease AND leaseUntil>:now AND #version=:version AND #status=:processing',
      ExpressionAttributeNames: { '#version': 'version', '#status': 'status' },
      ExpressionAttributeValues: { ':lease': leaseOwner, ':now': Math.floor(now / 1000),
        ':version': version, ':processing': 'PROCESSING' } } },
    ...['branchAssets', 'branchMemberships', 'branchOrders', 'branchData'].map(step => ({
      ConditionCheck: { TableName: tables.deletion, Key: { pk, sk: 'STEP#' + requestId + '#' + step },
        ConditionExpression: 'requestId=:request AND #status=:done',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':request': requestId, ':done': 'COMPLETED' } },
    })),
    { Put: { TableName: tables.branches, ...exact(branch),
      Item: { ...branchKey, lifecycleStatus: 'closed', isDeleted: true, deletedAt: completedAt,
        acceptingOrders: false, isActive: false, isOnline: false, deletionRequestId: requestId } } },
    { Put: { TableName: tables.wallets, ...exact(wallet),
      Item: { ...wallet, status: 'CLOSED', version: wallet.version + 1, closedAt: completedAt } } },
    { Put: { TableName: tables.deletion, ...exact(marker), Item: { ...marker, state: 'CLOSED', completedAt } } },
  ] }));
}

module.exports = { finalizeMerchantBranch };
