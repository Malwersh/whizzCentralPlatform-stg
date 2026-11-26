'use strict';

const {createHash, randomUUID} = require('node:crypto');
const {GetCommand, TransactWriteCommand} = require('@aws-sdk/lib-dynamodb');
const {allowed} = require('../../../backend/staff-service/catalog');
const {change} = require('../../../backend/staff-service/merchant-control');
const {exact} = require('../../../backend/staff-service/dispatch-followup-core');
const audit = require('../../../backend/staff-service/audit-trail');

const businesses = 'wizz-production-Merchants';
const staff = 'wizz-production-PlatformStaff';
const lifecycle = 'wizz-production-AccountDeletion';
const fields = [
  'businessId', 'ownerId', 'cognitoUserId', 'regionId', 'status', 'isActive',
  'onboardingSchemaVersion', 'onboardingComplete', 'platformSuspended', 'ordersBlocked',
  'acceptingOrders', 'onlineStatus', 'operatingStatus', 'updatedAt', 'lastStatusUpdate',
  'orderPauseId', 'ordersPausedUntil', 'deletionRequestId', 'isDeleted', 'deletedAt',
  'lifecycleStatus', 'orderIntakeDeletionRequestId', 'orderIntakeTransferRequestId', 'orderIntakeTransferExpiresAt',
];
const actions = ['PAUSE_ORDERS', 'RESUME_ORDERS', 'SUSPEND', 'UNSUSPEND'];
const fail = (status, code) => { throw Object.assign(Error(code), {status}); };
const inScope = (actor, branch) => typeof branch?.regionId === 'string' &&
  allowed(actor, 'merchants.suspend', branch.regionId);
const eligible = branch => branch.status === 'approved' && !branch.isDeleted && branch.deletedAt == null &&
  branch.deletionRequestId == null && branch.orderIntakeDeletionRequestId == null &&
  !['closing', 'closed', 'deleting', 'deleted'].includes(String(branch.lifecycleStatus ?? '').toLowerCase());
const transferLock = (branch, at) => (branch.orderIntakeTransferRequestId != null ||
  branch.orderIntakeTransferExpiresAt !== undefined) &&
  !(Number.isSafeInteger(branch.orderIntakeTransferExpiresAt) && branch.orderIntakeTransferExpiresAt <= at);
const revision = branch => createHash('sha256')
  .update(JSON.stringify(fields.map(name => [name, Object.hasOwn(branch, name), branch[name]]))).digest('hex');

function snapshot(branch) {
  return {
    businessId: branch.businessId, platformSuspended: branch.platformSuspended === true,
    ordersBlocked: branch.ordersBlocked === true, acceptingOrders: branch.acceptingOrders === true,
    isActive: branch.isActive === true,
  };
}

function availableActions(branch) {
  return [
    branch.ordersBlocked === true ? 'RESUME_ORDERS' : 'PAUSE_ORDERS',
    branch.platformSuspended === true ? 'UNSUSPEND' : 'SUSPEND',
  ];
}

function controlView(actor, branch, at) {
  if (!inScope(actor, branch)) return null;
  return {
    revision: revision(branch),
    actions: eligible(branch) && !transferLock(branch, at) ? availableActions(branch) : [],
    reason: branch.platformControlReason ?? null,
    changedAt: branch.platformControlUpdatedAt ?? null,
  };
}

async function controlBranch(db, actor, input, now) {
  if (!allowed(actor, 'merchants.suspend')) fail(403, 'PERMISSION_REQUIRED');
  if (!input || Object.keys(input).sort().join(',') !== 'action,baseRevision,businessId,reason' ||
      typeof input.businessId !== 'string' || !/^[a-z0-9_-]{1,128}$/i.test(input.businessId) ||
      !actions.includes(input.action) || typeof input.baseRevision !== 'string' ||
      !/^[a-f0-9]{64}$/.test(input.baseRevision) || typeof input.reason !== 'string' ||
      input.reason.trim().length < 5 || input.reason.length > 1000) fail(400, 'INVALID_CONTROL_REQUEST');

  const Key = {businessId: input.businessId};
  const {Item: branch} = await db.send(new GetCommand({TableName: businesses, Key, ConsistentRead: true}));
  if (!inScope(actor, branch)) fail(404, 'BRANCH_UNAVAILABLE');
  if (!eligible(branch) || transferLock(branch, now())) fail(409, 'BRANCH_LIFECYCLE_LOCKED');
  if (typeof branch.ownerId !== 'string' || !branch.ownerId || branch.cognitoUserId !== branch.ownerId) {
    fail(409, 'BRANCH_LIFECYCLE_LOCKED');
  }
  if (revision(branch) !== input.baseRevision || !availableActions(branch).includes(input.action)) {
    fail(409, 'VERSION_OR_STATE_CONFLICT');
  }

  const at = new Date(now()).toISOString();
  const reason = input.reason.trim();
  const patch = {
    ...change(branch, input.action),
    // The restaurant explicitly opens reception after restrictions are lifted.
    acceptingOrders: false, onlineStatus: 'offline', operatingStatus: 'OFFLINE', lastStatusUpdate: at,
    updatedAt: at, platformControlUpdatedAt: at, platformControlUpdatedBy: actor.employeeId,
    platformControlReason: reason,
  };
  const {ConditionCheck: condition} = exact(businesses, Key, branch, fields);
  const names = {...condition.ExpressionAttributeNames, '#pauseId': 'orderPauseId', '#pauseUntil': 'ordersPausedUntil'};
  const values = {...condition.ExpressionAttributeValues};
  const set = Object.entries(patch).map(([name, value], index) => {
    names['#set' + index] = name;
    values[':set' + index] = value;
    return '#set' + index + '=:set' + index;
  });
  const actorKey = {pk: 'EMPLOYEE#' + actor.employeeId, sk: 'PROFILE'};
  const actorFields = ['employeeId', 'status', 'version', 'roles', 'scope', 'minimumAuthTime',
    'deletedAt', 'isDeleted', 'deletionRequestId'];
  const lifecycleChecks = ['ACCOUNT_LIFECYCLE#MERCHANT#' + branch.ownerId,
    'BUSINESS_LIFECYCLE#MERCHANT#' + branch.businessId].map(pk => ({
    ConditionCheck: {TableName: lifecycle, Key: {pk, sk: 'META'}, ConditionExpression: 'attribute_not_exists(pk)'},
  }));
  const after = snapshot({...branch, ...patch});
  const transaction = [
    exact(staff, actorKey, actor, actorFields), ...lifecycleChecks,
    {Update: {TableName: businesses, Key, ConditionExpression: condition.ConditionExpression,
      UpdateExpression: 'SET ' + set.join(', ') + ' REMOVE #pauseId, #pauseUntil',
      ExpressionAttributeNames: names, ExpressionAttributeValues: values}},
    audit.write(staff, actor, actor.employeeId, 'MERCHANT_' + input.action, snapshot(branch),
      {...after, reason}, randomUUID()),
  ];
  try {
    await db.send(new TransactWriteCommand({TransactItems: transaction}));
  } catch (error) {
    if (error.name === 'TransactionCanceledException') fail(409, 'VERSION_OR_STATE_CONFLICT');
    throw error;
  }
  return {saved: true, action: input.action, branch: after};
}

module.exports = {controlBranch, controlView, revision};
