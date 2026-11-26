'use strict';

const { GetCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { exact } = require('../../../backend/account-deletion/cod-retention');
const { error } = require('../../../backend/account-deletion/policy');
const { tables } = require('./evidence.cjs');

async function purgeMerchantOwnerProfile({ db, request, clock = Date.now }) {
  const { subjectId, requestId, pk, sk, scope, job, leaseOwner, version } = request;
  if (request.actorType !== 'MERCHANT' || scope?.kind !== 'ACCOUNT' || scope.id !== subjectId ||
      request.status !== 'PROCESSING' || !leaseOwner || job?.subjectId !== subjectId ||
      job.requestId !== requestId || pk !== 'SUBJECT#MERCHANT#' + subjectId || sk !== 'REQUEST#' + requestId) {
    throw error('INVALID_CLEANUP_SCOPE');
  }
  const profileKey = { pk: 'PERSON#' + subjectId, sk: 'PROFILE' };
  const { Item: profile } = await db.send(new GetCommand({ TableName: tables.platform, Key: profileKey, ConsistentRead: true }));
  if (!profile) return;
  if (profile.subjectId !== subjectId) throw error('OWNERSHIP_MISMATCH');
  if (profile.legalHold || profile.retentionHold) throw error('DOCUMENTED_RETENTION_HOLD');
  await db.send(new TransactWriteCommand({ TransactItems: [
    { ConditionCheck: { TableName: tables.deletion, Key: { pk, sk },
      ConditionExpression: 'leaseOwner=:lease AND leaseUntil>:now AND #version=:version AND #status=:processing',
      ExpressionAttributeNames: { '#version': 'version', '#status': 'status' },
      ExpressionAttributeValues: { ':lease': leaseOwner, ':now': Math.floor(clock() / 1000),
        ':version': version, ':processing': 'PROCESSING' } } },
    { ConditionCheck: { TableName: tables.deletion, Key: { pk: 'ACCOUNT_LIFECYCLE#MERCHANT#' + subjectId, sk: 'META' },
      ConditionExpression: 'subjectId=:subject AND requestId=:request AND #state=:closing',
      ExpressionAttributeNames: { '#state': 'state' },
      ExpressionAttributeValues: { ':subject': subjectId, ':request': requestId, ':closing': 'CLOSING' } } },
    { Delete: { TableName: tables.platform, Key: profileKey, ...exact(profile) } },
  ] }));
}

module.exports = { purgeMerchantOwnerProfile };
