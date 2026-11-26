'use strict';

const { TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { AdminGetUserCommand } = require('@aws-sdk/client-cognito-identity-provider');
const { merchantPhoneClosureKey } = require('../phone-auth/merchant-phone-binding.cjs');
const { blockers, error } = require('../../../backend/account-deletion/policy');
const { identities } = require('../wallet-identity-bindings.json');
const { tables } = require('./evidence.cjs');

async function lockMerchantOwner({ db, cognito, request, facts, policy, clock = Date.now }) {
  const { actorType, scope, subjectId, requestId, leaseOwner, pk, sk, version } = request;
  if (actorType !== 'MERCHANT' || scope?.kind !== 'ACCOUNT' || scope.id !== subjectId || !leaseOwner ||
      pk !== 'SUBJECT#MERCHANT#' + subjectId || sk !== 'REQUEST#' + requestId) throw error('INVALID_LOCK_CONTEXT');
  if (blockers({ type: actorType, sub: subjectId }, scope, facts).length) throw error('SETTLEMENT_REQUIRED');
  const pool = identities.merchant.poolId;
  const user = await cognito.send(new AdminGetUserCommand({ UserPoolId: pool, Username: subjectId }));
  const attrs = Object.fromEntries((user.UserAttributes || []).map(({ Name, Value }) => [Name, Value]));
  if (attrs.sub !== subjectId || !user.Username || user.Enabled !== true || user.UserStatus !== 'CONFIRMED' ||
      attrs.phone_number_verified !== 'true' || !/^\+9647\d{9}$/.test(attrs.phone_number || '')) {
    throw error('IDENTITY_UNAVAILABLE');
  }
  const job = { subjectId, requestId, pool, username: user.Username, phone: attrs.phone_number,
    policyVersion: policy.retentionPolicyVersion };
  await db.send(new TransactWriteCommand({ TransactItems: [
    { ConditionCheck: { TableName: tables.deletion, Key: { pk, sk: 'ACTIVE#ACCOUNT#' + subjectId },
      ConditionExpression: 'requestId=:request', ExpressionAttributeValues: { ':request': requestId } } },
    { Put: { TableName: tables.deletion, Item: { ...request, job, status: 'PROCESSING', blockers: [], version: version + 1 },
      ConditionExpression: 'leaseOwner=:lease AND leaseUntil>:now AND #version=:version',
      ExpressionAttributeNames: { '#version': 'version' },
      ExpressionAttributeValues: { ':lease': leaseOwner, ':now': Math.floor(clock() / 1000), ':version': version } } },
    { Put: { TableName: tables.deletion, Item: { ...merchantPhoneClosureKey(job.phone), subjectId, requestId, releaseAfter: Math.floor(clock() / 1000) + 360 },
      ConditionExpression: 'attribute_not_exists(pk)' } },
    { Put: { TableName: tables.deletion, Item: { pk: 'ACCOUNT_LIFECYCLE#MERCHANT#' + subjectId, sk: 'META',
      subjectId, requestId, state: 'CLOSING' }, ConditionExpression: 'attribute_not_exists(pk)' } },
  ] }));
  return job;
}

module.exports = { lockMerchantOwner };
