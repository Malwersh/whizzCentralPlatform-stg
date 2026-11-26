'use strict';

const { GetCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { exact } = require('../../../backend/account-deletion/cod-retention');
const { error } = require('../../../backend/account-deletion/policy');
const { customerExecutionChecks, driverExecutionChecks } = require('./customer-execution-scope.cjs');
const { tables } = require('./evidence.cjs');

async function closeWallet(ownerType, checks, { db, request, job, clock = Date.now }) {
  checks(request, job, clock());
  const walletId = 'WALLET#' + ownerType + '#' + request.subjectId;
  const Key = { walletId, sk: 'META' };
  if (!Array.isArray(job.wallets) || job.wallets.length > 1 ||
      job.wallets.some(wallet => wallet.walletId !== walletId || wallet.source !== 'CORE')) {
    throw error('INVALID_CLEANUP_SCOPE');
  }
  const live = (await db.send(new GetCommand({ TableName: tables.wallets, Key, ConsistentRead: true }))).Item;
  if (!job.wallets.length && !live) return;
  if (!job.wallets.length || live?.ownerId !== request.subjectId || live.ownerType !== ownerType ||
      live.currency !== 'IQD' || live.deletionRequestId !== request.requestId ||
      live.availableBalance !== 0 || live.lockedBalance !== 0 ||
      !Number.isSafeInteger(live.version) || live.version < 1 ||
      live.legalHold || live.retentionHold) throw error('WALLET_CLOSURE_BLOCKED');
  if (live.status === 'CLOSED') return;
  if (live.status !== 'SUSPENDED') throw error('WALLET_CLOSURE_BLOCKED');
  const snapshot = Object.fromEntries([
    'walletId','sk','ownerId','ownerType','currency','deletionRequestId','availableBalance',
    'lockedBalance','version','status','legalHold','retentionHold',
  ].map(field => [field, live[field]]));
  const guard = exact(snapshot);
  await db.send(new TransactWriteCommand({ TransactItems: [
    ...checks(request, job, clock()),
    { Update: {
      TableName: tables.wallets, Key,
      ...guard,
      UpdateExpression: 'SET #status=:closed, closedAt=:at ADD #version :one',
      ExpressionAttributeNames: { ...guard.ExpressionAttributeNames, '#status':'status', '#version':'version' },
      ExpressionAttributeValues: {
        ...guard.ExpressionAttributeValues, ':closed':'CLOSED', ':at':new Date(clock()).toISOString(), ':one':1,
      },
    } },
  ] }));
}

const closeCustomerWallet = args => closeWallet('CUSTOMER', customerExecutionChecks, args);
const closeDriverWallet = args => closeWallet('DRIVER', driverExecutionChecks, args);

module.exports = { closeCustomerWallet, closeDriverWallet };
