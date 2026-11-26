'use strict';

const { AdminDeleteUserCommand, AdminDisableUserCommand, AdminGetUserCommand,
  AdminUserGlobalSignOutCommand } = require('@aws-sdk/client-cognito-identity-provider');
const { GetCommand, ScanCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { customerPhoneClosureKey } = require('../../../backend/account-deletion/customer-phone-binding');
const { exact } = require('../../../backend/account-deletion/cod-retention');
const { error } = require('../../../backend/account-deletion/policy');
const { identities } = require('../wallet-identity-bindings.json');
const { tables } = require('./evidence.cjs');
const { customerExecutionChecks } = require('./customer-execution-scope.cjs');

const phoneAuthTable = 'wizz-production-CustomerPhoneAuth';
const phoneLinkTable = 'wizz-production-CustomerPhoneLink';
const poolId = identities.customer.poolId;
const customerSteps = ['disableIdentity', 'personalData', 'supportData', 'financialArchive',
  'orderPersonalData', 'verificationData', 'walletClosure', 'identityClosure'];
const terminalStep = 'identityClosure';
const { customerProfileAssetFields } = require('./customer-profile-fields.cjs');
const notFound = cause => cause.name === 'UserNotFoundException';

async function readIdentity(cognito, subjectId) {
  let user;
  try {
    user = await cognito.send(new AdminGetUserCommand({ UserPoolId: poolId, Username: subjectId }));
  } catch (cause) {
    if (notFound(cause)) return null;
    throw cause;
  }
  const attrs = user.UserAttributes || [];
  const attribute = field => {
    const matches = attrs.filter(value => value.Name === field);
    if (matches.length !== 1) throw error('CUSTOMER_IDENTITY_CHANGED');
    return matches[0].Value;
  };
  if (user.Username !== subjectId || attribute('sub') !== subjectId ||
      attribute('phone_number_verified') !== 'true' || user.UserStatus !== 'CONFIRMED' ||
      typeof user.Enabled !== 'boolean') throw error('CUSTOMER_IDENTITY_CHANGED');
  const phone = attribute('phone_number');
  customerPhoneClosureKey(phone);
  return { phone, username: user.Username, enabled: user.Enabled };
}

async function captureCustomerIdentity({ db, cognito, subjectId, profileIds }) {
  const identity = await readIdentity(cognito, subjectId);
  if (!identity?.enabled) throw error('CUSTOMER_IDENTITY_UNAVAILABLE');
  if (profileIds.length) {
    const profile = (await db.send(new GetCommand({
      TableName: tables.customer, Key: { userId: subjectId }, ConsistentRead: true,
    }))).Item;
    if (profile?.cognitoSub !== subjectId ||
        (profile.cognitoUsername && profile.cognitoUsername !== identity.username) ||
        (profile.phone && profile.phone !== identity.phone) || profile.phoneChangePending) {
      throw error('CUSTOMER_IDENTITY_CHANGED');
    }
    if (profile.legalHold || profile.retentionHold) throw error('DOCUMENTED_RETENTION_HOLD');
    if (customerProfileAssetFields.some(field => profile[field])) throw error('ASSET_INVENTORY_REQUIRED');
  }
  return { phone: identity.phone, username: identity.username };
}

function createCustomerIdentityCleanup({ db, cognito, clock = Date.now, maxPages = 100 }) {
  const get = async (TableName, Key) => (await db.send(new GetCommand({ TableName, Key, ConsistentRead: true }))).Item;
  async function transact(request, job, guard, actions = []) {
    const checks = customerExecutionChecks(request, job, clock());
    const liveRequest = checks[0].ConditionCheck;
    liveRequest.ConditionExpression += ' AND #job.#identity=:identity';
    liveRequest.ExpressionAttributeNames['#job'] = 'job';
    liveRequest.ExpressionAttributeNames['#identity'] = 'identity';
    liveRequest.ExpressionAttributeValues[':identity'] = job.identity;
    await db.send(new TransactWriteCommand({ TransactItems: [...checks, ...guard, ...actions] }));
  }

  async function closureState(request, job) {
    customerExecutionChecks(request, job, clock());
    if (job.identity?.username !== request.subjectId) throw error('CUSTOMER_IDENTITY_CHANGED');
    const phoneKey = customerPhoneClosureKey(job.identity.phone);
    const completedKey = { pk: request.pk, sk: 'IDENTITY_COMPLETE#' + request.requestId };
    const completed = await get(tables.deletion, completedKey);
    if (completed) {
      if (completed.requestId !== request.requestId || completed.subjectId !== request.subjectId) {
        throw error('INVALID_CLEANUP_SCOPE');
      }
      return { completed: true };
    }
    const barrier = await get(tables.deletion, phoneKey);
    if (barrier?.requestId !== request.requestId || barrier.subjectId !== request.subjectId ||
        !Number.isSafeInteger(barrier.lockedAt)) throw error('CUSTOMER_PHONE_CLOSURE_REQUIRED');
    const phoneGuard = {
      TableName: tables.deletion, Key: phoneKey,
      ...exact({ requestId: request.requestId, subjectId: request.subjectId, lockedAt: barrier.lockedAt }),
    };
    return { phoneGuard, completedKey, lockedAt: barrier.lockedAt };
  }

  async function current(request, job, state) {
    await transact(request, job, [{ ConditionCheck: state.phoneGuard }]);
    const user = await readIdentity(cognito, request.subjectId);
    if (user && user.phone !== job.identity.phone) throw error('CUSTOMER_IDENTITY_CHANGED');
    return user;
  }

  async function callCognito(Command, request, job, state) {
    await transact(request, job, [{ ConditionCheck: state.phoneGuard }]);
    try {
      await cognito.send(new Command({ UserPoolId: poolId, Username: request.subjectId }));
    } catch (cause) {
      if (!notFound(cause)) throw cause;
    }
  }

  async function deleteRecord(request, job, state, table, row, fields) {
    if (row.legalHold || row.retentionHold) throw error('DOCUMENTED_RETENTION_HOLD');
    if (typeof row.id !== 'string' || !row.id) throw error('VERIFICATION_INVENTORY_INVALID');
    const snapshot = Object.fromEntries(['id','legalHold','retentionHold',...fields].map(field => [field, row[field]]));
    await transact(request, job, [{ ConditionCheck: state.phoneGuard }], [
      { Delete: { TableName: table, Key: { id: row.id }, ...exact(snapshot) } },
    ]);
  }

  async function scan(TableName, FilterExpression, ExpressionAttributeValues, ExpressionAttributeNames) {
    const records = [];
    let cursor;
    for (let page = 0; page < maxPages; page++) {
      const result = await db.send(new ScanCommand({
        TableName, FilterExpression, ExpressionAttributeValues, ExpressionAttributeNames, ConsistentRead: true,
        Limit: 250, ExclusiveStartKey: cursor,
      }));
      records.push(...(result.Items || []));
      cursor = result.LastEvaluatedKey;
      if (!cursor) return records;
    }
    throw error('VERIFICATION_INVENTORY_INCOMPLETE');
  }

  return {
    async disable(request, job) {
      const state = await closureState(request, job);
      if (state.completed) return;
      const user = await current(request, job, state);
      if (!user) return;
      if (user.enabled) await callCognito(AdminDisableUserCommand, request, job, state);
      await callCognito(AdminUserGlobalSignOutCommand, request, job, state);
    },

    async purgeVerification(request, job) {
      const state = await closureState(request, job);
      if (state.completed) return;
      const user = await current(request, job, state);
      if (user?.enabled) throw error('CUSTOMER_IDENTITY_STILL_ENABLED');
      // A production enrollment invocation can hold a read for up to 25
      // seconds. Drain requests started before the phone barrier.
      if (Math.floor(clock() / 1000) < state.lockedAt + 60) throw error('PHONE_AUTH_WRITES_DRAINING');
      const { phone, username } = job.identity;
      const subjectId = request.subjectId;
      const [proofs, links, active, provision, login] = await Promise.all([
        scan(phoneAuthTable, '(#purpose=:otp AND #phone=:phone) OR (#purpose=:proof AND #username=:username)',
          { ':otp': 'customer-phone-otp', ':proof': 'login-proof', ':phone': phone, ':username': username },
          { '#purpose': 'purpose', '#phone': 'phone', '#username': 'username' }),
        scan(phoneLinkTable, 'subjectId=:subject OR #sub=:subject', { ':subject': subjectId }, { '#sub': 'sub' }),
        get(phoneAuthTable, { id: 'ACTIVE#' + phone }),
        get(phoneAuthTable, { id: 'PROVISION#' + phone }),
        get(phoneAuthTable, { id: 'LOGIN#' + username }),
      ]);
      if (provision && (provision.sub !== subjectId || provision.username !== username)) {
        throw error('VERIFICATION_IDENTITY_CHANGED');
      }
      for (const record of proofs) {
        if (record.purpose === 'customer-phone-otp' ? record.phone !== phone
          : record.purpose !== 'login-proof' || record.username !== username) throw error('VERIFICATION_IDENTITY_CHANGED');
      }
      for (const record of links) {
        if (record.subjectId !== subjectId && record.sub !== subjectId ||
            (record.subjectId && record.subjectId !== subjectId) || (record.sub && record.sub !== subjectId)) {
          throw error('VERIFICATION_IDENTITY_CHANGED');
        }
      }
      if ([...proofs, ...links, active, provision, login].some(record => record?.legalHold || record?.retentionHold)) {
        throw error('DOCUMENTED_RETENTION_HOLD');
      }
      for (const proof of proofs) await deleteRecord(request, job, state, phoneAuthTable, proof,
        ['purpose','phone','username','digest','expiresAt','used','attempts']);
      for (const link of links) await deleteRecord(request, job, state, phoneLinkTable, link,
        ['sub','subjectId','phone','digest','expiresAt']);
      if (active) await deleteRecord(request, job, state, phoneAuthTable, active, ['sessionId','expiresAt']);
      if (provision) await deleteRecord(request, job, state, phoneAuthTable, provision, ['sub','username','createdAt']);
      if (login) await deleteRecord(request, job, state, phoneAuthTable, login, ['proofId','expiresAt']);
    },

    async finish(request, job) {
      const state = await closureState(request, job);
      if (state.completed) return;
      const subjectId = request.subjectId;
      const requiredSteps = await Promise.all(customerSteps.filter(step => step !== terminalStep).map(async step => {
        const key = { pk: request.pk, sk: 'STEP#' + request.requestId + '#' + step };
        const row = await get(tables.deletion, key);
        if (row?.requestId !== request.requestId || row.step !== step || row.status !== 'COMPLETED') {
          throw error('CLEANUP_INCOMPLETE');
        }
        return { ConditionCheck: {
          TableName: tables.deletion, Key: key,
          ...exact({requestId:request.requestId, step, status:'COMPLETED'}),
        } };
      }));
      const profile = await get(tables.customer, { userId: subjectId });
      if (profile && (profile.cognitoSub !== subjectId || profile.deletionRequestId !== request.requestId ||
          profile.legalHold || profile.retentionHold || customerProfileAssetFields.some(field => profile[field]))) {
        throw error('CUSTOMER_PROFILE_CLOSURE_BLOCKED');
      }
      const profileKey = { userId: subjectId };
      const profileCondition = profile ? exact(Object.fromEntries(
        ['userId','cognitoSub','deletionRequestId','legalHold','retentionHold',...customerProfileAssetFields].map(field => [field,profile[field]])))
        : { ConditionExpression: 'attribute_not_exists(userId)' };
      const profileGuard = { ConditionCheck: { TableName: tables.customer, Key: profileKey, ...profileCondition } };
      const walletKey = { walletId: 'WALLET#CUSTOMER#' + subjectId, sk: 'META' };
      if (!Array.isArray(job.wallets) || job.wallets.length > 1 ||
          job.wallets.some(wallet => wallet.walletId !== walletKey.walletId || wallet.source !== 'CORE')) {
        throw error('INVALID_CLEANUP_SCOPE');
      }
      const wallet = await get(tables.wallets, walletKey);
      if (job.wallets.length !== Number(!!wallet) ||
          wallet && (wallet.ownerId !== subjectId || wallet.ownerType !== 'CUSTOMER' ||
          wallet.currency !== 'IQD' || wallet.status !== 'CLOSED' || wallet.deletionRequestId !== request.requestId ||
          wallet.availableBalance !== 0 || wallet.lockedBalance !== 0 || wallet.legalHold || wallet.retentionHold)) {
        throw error('WALLET_CLOSURE_BLOCKED');
      }
      const walletCondition = wallet ? exact(Object.fromEntries([
        'walletId','sk','ownerId','ownerType','currency','status','deletionRequestId','availableBalance','lockedBalance',
        'legalHold','retentionHold',
      ].map(field => [field, wallet[field]]))) : { ConditionExpression: 'attribute_not_exists(walletId)' };
      const walletGuard = { ConditionCheck: { TableName: tables.wallets, Key: walletKey, ...walletCondition } };
      const user = await current(request, job, state);
      if (user?.enabled) throw error('CUSTOMER_IDENTITY_STILL_ENABLED');
      await transact(request, job, [{ ConditionCheck: state.phoneGuard }, ...requiredSteps, profileGuard, walletGuard]);
      if (user) await callCognito(AdminDeleteUserCommand, request, job, state);
      await transact(request, job, [...requiredSteps, walletGuard], [
        { Delete: state.phoneGuard },
        ...(profile ? [{ Delete: profileGuard.ConditionCheck }] : [profileGuard]),
        { Put: { TableName: tables.deletion, Item: {
          ...state.completedKey, requestId: request.requestId, subjectId,
          completedAt: new Date(clock()).toISOString(),
        }, ConditionExpression: 'attribute_not_exists(pk)' } },
      ]);
    },
  };
}

module.exports = { captureCustomerIdentity, createCustomerIdentityCleanup, customerSteps };
