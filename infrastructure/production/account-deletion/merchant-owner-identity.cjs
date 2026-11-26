'use strict';

const { GetCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { AdminGetUserCommand, AdminDisableUserCommand, AdminUserGlobalSignOutCommand,
  AdminDeleteUserCommand } = require('@aws-sdk/client-cognito-identity-provider');
const { error } = require('../../../backend/account-deletion/policy');
const { merchantPhoneClosureKey } = require('../phone-auth/merchant-phone-binding.cjs');
const { identities } = require('../wallet-identity-bindings.json');
const { tables } = require('./evidence.cjs');

const pool = identities.merchant.poolId;

async function closeMerchantOwnerIdentity({ db, cognito, request, step, clock = Date.now }) {
  const { actorType, scope, subjectId, requestId, job, pk, sk, leaseOwner, version } = request;
  if (actorType !== 'MERCHANT' || scope?.kind !== 'ACCOUNT' || scope.id !== subjectId ||
      request.status !== 'PROCESSING' || pk !== 'SUBJECT#MERCHANT#' + subjectId || sk !== 'REQUEST#' + requestId ||
      !leaseOwner || job?.subjectId !== subjectId || job.requestId !== requestId ||
      job.pool !== pool || typeof job.username !== 'string' || !job.username ||
      !['disableIdentity', 'identityClosure'].includes(step)) throw error('INVALID_CLEANUP_SCOPE');
  const get = async Key => (await db.send(new GetCommand({ TableName: tables.deletion, Key, ConsistentRead: true }))).Item;
  async function assertLease() {
    const [current, marker] = await Promise.all([
      get({ pk, sk }), get({ pk: 'ACCOUNT_LIFECYCLE#MERCHANT#' + subjectId, sk: 'META' }),
    ]);
    if (current?.leaseOwner !== leaseOwner || current.version !== version || current.status !== 'PROCESSING' ||
        current.leaseUntil <= Math.floor(clock() / 1000) || marker?.subjectId !== subjectId ||
        marker.requestId !== requestId || marker.state !== 'CLOSING') throw error('LEASE_LOST');
  }
  if (step === 'identityClosure') {
    for (const required of ['disableIdentity', 'memberships', 'personalData']) {
      const record = await get({ pk, sk: 'STEP#' + requestId + '#' + required });
      if (record?.status !== 'COMPLETED' || record.requestId !== requestId) throw error('CLEANUP_INCOMPLETE');
    }
  }
  await assertLease();
  const markerKey = { pk: 'ACCOUNT_LIFECYCLE#MERCHANT#' + subjectId, sk: 'META' };
  let phoneKey;
  if (step === 'identityClosure') {
    phoneKey = merchantPhoneClosureKey(job.phone);
    const marker = await get(markerKey);
    if (marker?.phoneReleased === true && marker.requestId === requestId) return;
    const reservation = await get(phoneKey);
    if (reservation?.requestId !== requestId || reservation.subjectId !== subjectId ||
        !Number.isSafeInteger(reservation.releaseAfter)) throw error('PHONE_RESERVATION_MISSING');
    if (reservation.releaseAfter > Math.floor(clock() / 1000)) throw error('PHONE_DRAIN_IN_PROGRESS');
  }
  const identity = { UserPoolId: pool, Username: job.username };
  let user;
  try { user = await cognito.send(new AdminGetUserCommand(identity)); }
  catch (cause) { if (cause.name !== 'UserNotFoundException' || step !== 'identityClosure') throw cause; }
  if (user && (user.Username !== job.username || user.UserAttributes?.find(item => item.Name === 'sub')?.Value !== subjectId ||
      user.UserAttributes?.find(item => item.Name === 'phone_number')?.Value !== job.phone)) {
    throw error('IDENTITY_GENERATION_CHANGED');
  }
  await assertLease();
  if (step === 'identityClosure') {
    if (user && user.Enabled !== false) throw error('IDENTITY_NOT_DISABLED');
    if (user) await cognito.send(new AdminDeleteUserCommand(identity));
    await db.send(new TransactWriteCommand({ TransactItems: [
      { ConditionCheck: { TableName: tables.deletion, Key: { pk, sk },
        ConditionExpression: 'leaseOwner=:lease AND #v=:version AND leaseUntil>:now',
        ExpressionAttributeNames: { '#v': 'version' },
        ExpressionAttributeValues: { ':lease': leaseOwner, ':version': version, ':now': Math.floor(clock() / 1000) } } },
      { Update: { TableName: tables.deletion, Key: markerKey, UpdateExpression: 'SET phoneReleased=:yes',
        ConditionExpression: 'subjectId=:subject AND requestId=:request',
        ExpressionAttributeValues: { ':yes': true, ':subject': subjectId, ':request': requestId } } },
      { Delete: { TableName: tables.deletion, Key: phoneKey, ConditionExpression: 'subjectId=:subject AND requestId=:request',
        ExpressionAttributeValues: { ':subject': subjectId, ':request': requestId } } },
    ] }));
    return;
  }
  if (user.Enabled) await cognito.send(new AdminDisableUserCommand(identity));
  await assertLease();
  await cognito.send(new AdminUserGlobalSignOutCommand(identity));
}

module.exports = { closeMerchantOwnerIdentity };
