'use strict';

const { GetCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { exact } = require('../../../backend/account-deletion/cod-retention');
const { blockers, error } = require('../../../backend/account-deletion/policy');
const { tables } = require('./evidence.cjs');

async function lockMerchantBranch({ db, request, evidence, manifest, clock = Date.now }) {
  const { subjectId, requestId, scope, leaseOwner, version } = request;
  const branchId = scope?.id;
  if (request.actorType !== 'MERCHANT' || scope?.kind !== 'BUSINESS' || !branchId || !leaseOwner ||
      request.pk !== 'SUBJECT#MERCHANT#' + subjectId || request.sk !== 'REQUEST#' + requestId ||
      manifest.subjectId !== subjectId || manifest.requestId !== requestId || manifest.businessId !== branchId) {
    throw error('INVALID_LOCK_CONTEXT');
  }
  if (blockers({ type: 'MERCHANT', sub: subjectId }, scope, evidence).length) throw error('SETTLEMENT_REQUIRED');

  const walletId = 'WALLET#MERCHANT#' + branchId;
  const branchKey = { businessId: branchId };
  const walletKey = { walletId, sk: 'META' };
  const now = clock();
  const get = async (TableName, Key) => (await db.send(new GetCommand({ TableName, Key, ConsistentRead: true }))).Item;
  const [branch, wallet] = await Promise.all([get(tables.branches, branchKey), get(tables.wallets, walletKey)]);
  if (branch?.businessId !== branchId || branch.ownerId !== subjectId || branch.cognitoUserId !== subjectId ||
      branch.deletedAt || branch.isDeleted || branch.deletionRequestId ||
      branch.orderIntakeDeletionRequestId !== requestId || branch.onboardingDraftId !== manifest.draftId) throw error('BRANCH_SCOPE_CHANGED');
  if (branch.legalHold || branch.retentionHold) throw error('DOCUMENTED_RETENTION_HOLD');
  const transferExpiry = branch.orderIntakeTransferExpiresAt;
  if (transferExpiry !== undefined && !(Number.isSafeInteger(transferExpiry) && transferExpiry <= now)) {
    throw error('OWNERSHIP_TRANSFER_IN_PROGRESS');
  }
  const expected = evidence.wallets;
  if (wallet ? expected.length !== 1 || expected[0].walletId !== walletId || expected[0].version !== wallet.version ||
      wallet.walletId !== walletId || wallet.ownerId !== branchId || wallet.ownerType !== 'MERCHANT' ||
      wallet.currency !== 'IQD' || wallet.status !== 'ACTIVE' || wallet.availableBalance !== 0 ||
      wallet.lockedBalance !== 0 || wallet.deletionRequestId : expected.length !== 0) throw error('SETTLEMENT_REQUIRED');

  const branchGuard = exact({
    ...branch,
    deletedAt: branch.deletedAt, isDeleted: branch.isDeleted, legalHold: branch.legalHold,
    onboardingDraftId: branch.onboardingDraftId, retentionHold: branch.retentionHold, deletionRequestId: branch.deletionRequestId,
    orderIntakeTransferExpiresAt: transferExpiry, orderIntakeTransferRequestId: branch.orderIntakeTransferRequestId,
  });
  const walletGuard = wallet ? exact({ ...wallet, deletionRequestId: wallet.deletionRequestId }) : null;
  const job = { ...manifest, profileIds: [branchId], walletIds: [walletId] };
  await db.send(new TransactWriteCommand({ TransactItems: [
    { Put: { TableName: tables.deletion, Item: { ...request, job, status: 'PROCESSING', blockers: [], version: version + 1 },
      ConditionExpression: '#version=:version AND leaseOwner=:lease AND leaseUntil>:now',
      ExpressionAttributeNames: { '#version': 'version' },
      ExpressionAttributeValues: { ':version': version, ':lease': leaseOwner, ':now': Math.floor(now / 1000) } } },
    { Put: { TableName: tables.deletion, Item: { pk: 'BUSINESS_LIFECYCLE#MERCHANT#' + branchId, sk: 'META',
      businessId: branchId, subjectId, requestId, state: 'CLOSING' }, ConditionExpression: 'attribute_not_exists(pk)' } },
    { Update: { TableName: tables.branches, Key: branchKey, ...branchGuard,
      UpdateExpression: 'SET #active=:no, #online=:no, acceptingOrders=:no, deletionRequestId=:request',
      ExpressionAttributeNames: { ...branchGuard.ExpressionAttributeNames, '#active': 'isActive', '#online': 'isOnline' },
      ExpressionAttributeValues: { ...branchGuard.ExpressionAttributeValues, ':no': false, ':request': requestId } } },
    wallet ? { Update: { TableName: tables.wallets, Key: walletKey, ...walletGuard,
      UpdateExpression: 'SET #status=:suspended, deletionRequestId=:request ADD #version :one',
      ExpressionAttributeNames: { ...walletGuard.ExpressionAttributeNames, '#status': 'status', '#version': 'version' },
      ExpressionAttributeValues: { ...walletGuard.ExpressionAttributeValues, ':suspended': 'SUSPENDED', ':request': requestId, ':one': 1 } } }
      : { Put: { TableName: tables.wallets, Item: { ...walletKey, ownerId: branchId, ownerType: 'MERCHANT', currency: 'IQD',
        status: 'SUSPENDED', availableBalance: 0, lockedBalance: 0, version: 1, deletionRequestId: requestId },
        ConditionExpression: 'attribute_not_exists(walletId)' } },
  ] }));
  return job;
}

module.exports = { lockMerchantBranch };
