'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { inventoryMerchantProductAssets } = require('./merchant-product-assets.cjs');
const { closeMerchantOwnerIdentity } = require('./merchant-owner-identity.cjs');

test('asset inventory separates shared files and unknown legacy URLs without writing', async () => {
  const prefix = 'merchants/branch/product-images/';
  const db = { async send(command) {
    assert.equal(command.constructor.name, 'ScanCommand');
    const table = command.input.TableName;
    if (table.endsWith('-Products')) return { Items: [{ businessId: 'branch', imageUrl: 'https://old.example/photo.jpg' }] };
    if (table.endsWith('-GlobalProducts')) return { Items: [{ imageUrl: '/media/' + prefix + 'shared.jpg' }] };
    return { Items: [] };
  } };
  const s3 = { async send(command) {
    assert.equal(command.constructor.name, 'ListObjectVersionsCommand');
    assert.equal(command.input.Prefix, prefix);
    return { Versions: [{ Key: prefix + 'shared.jpg', VersionId: 'a' }],
      DeleteMarkers: [{ Key: prefix + 'own.jpg', VersionId: 'b' }] };
  } };
  assert.deepEqual(await inventoryMerchantProductAssets({ db, s3, branchId: 'branch' }), {
    shared: [{ Key: prefix + 'shared.jpg', VersionId: 'a' }],
    exclusive: [{ Key: prefix + 'own.jpg', VersionId: 'b' }],
    legacyReferenceCount: 1,
  });
});

test('owner identity closure checks scope and completed cleanup before deleting', async () => {
  const subjectId = 'owner-sub', requestId = 'closure', calls = [];
  const request = { actorType: 'MERCHANT', scope: { kind: 'ACCOUNT', id: subjectId }, subjectId, requestId,
    pk: 'SUBJECT#MERCHANT#' + subjectId, sk: 'REQUEST#' + requestId, status: 'PROCESSING', version: 1,
    leaseOwner: 'lease', leaseUntil: 100, job: { subjectId, requestId, username: 'owner', pool: 'us-east-1_2sKZ4fGbZ', phone: '+9647800000000' } };
  let stepsDone = false, currentSub = subjectId;
  const db = { async send({ input: { Key } }) {
    if (!Key) return {};
    if (Key.pk.startsWith('MERCHANT_PHONE_CLOSURE')) return { Item: { subjectId, requestId, releaseAfter: 1 } };
    if (Key.pk.startsWith('ACCOUNT_LIFECYCLE')) return { Item: { subjectId, requestId, state: 'CLOSING' } };
    if (Key.sk.startsWith('STEP#')) return { Item: stepsDone ? { requestId, status: 'COMPLETED' } : undefined };
    return { Item: request };
  } };
  const cognito = { async send(command) {
    calls.push(command.constructor.name);
    return { Username: 'owner', Enabled: false, UserAttributes: [{ Name: 'sub', Value: currentSub }, { Name: 'phone_number', Value: request.job.phone }] };
  } };
  const args = { db, cognito, request, step: 'identityClosure', clock: () => 1000 };
  await assert.rejects(closeMerchantOwnerIdentity(args), { code: 'CLEANUP_INCOMPLETE' });
  assert.equal(calls.length, 0);
  stepsDone = true;
  currentSub = 'another-owner';
  await assert.rejects(closeMerchantOwnerIdentity(args), { code: 'IDENTITY_GENERATION_CHANGED' });
  currentSub = subjectId;
  await closeMerchantOwnerIdentity(args);
  assert.deepEqual(calls, ['AdminGetUserCommand', 'AdminGetUserCommand', 'AdminDeleteUserCommand']);
});

test('owner profile removal is scoped to the verified personal profile and respects holds', async () => {
  const { purgeMerchantOwnerProfile } = require('./merchant-owner-profile.cjs');
  const subjectId = 'owner-sub', requestId = 'closure', calls = [];
  const request = { actorType: 'MERCHANT', scope: { kind: 'ACCOUNT', id: subjectId }, subjectId, requestId,
    pk: 'SUBJECT#MERCHANT#' + subjectId, sk: 'REQUEST#' + requestId, status: 'PROCESSING', version: 1,
    leaseOwner: 'lease', job: { subjectId, requestId } };
  const profile = { pk: 'PERSON#' + subjectId, sk: 'PROFILE', subjectId, retentionHold: true };
  const db = { async send(command) {
    if (command.constructor.name === 'GetCommand') return { Item: profile };
    calls.push(command.input.TransactItems);
    return {};
  } };
  await assert.rejects(purgeMerchantOwnerProfile({ db, request }), { code: 'DOCUMENTED_RETENTION_HOLD' });
  assert.equal(calls.length, 0);
  profile.retentionHold = false;
  await purgeMerchantOwnerProfile({ db, request });
  assert.deepEqual(calls[0].filter(entry => entry.Delete).map(entry => entry.Delete.Key),
    [{ pk: 'PERSON#' + subjectId, sk: 'PROFILE' }]);
  assert.equal(calls[0].filter(entry => entry.ConditionCheck).length, 2);
});

test('product cleanup waits for an in-flight upload and deletes only exclusive versions after drain', async () => {
  const { purgeMerchantProductAssets } = require('./merchant-product-assets.cjs');
  const subjectId = 'owner', requestId = 'closure', businessId = 'branch';
  const request = { actorType: 'MERCHANT', scope: { kind: 'BUSINESS', id: businessId }, subjectId, requestId,
    pk: 'SUBJECT#MERCHANT#' + subjectId, sk: 'REQUEST#' + requestId, status: 'PROCESSING',
    version: 1, leaseOwner: 'lease', leaseUntil: 100, job: { subjectId, requestId, businessId } };
  const prefix = 'merchants/branch/product-images/';
  let active = true, legacy = true;
  const db = { async send(command) {
    const { Key, TableName } = command.input;
    if (command.constructor.name === 'QueryCommand') {
      return { Items: active ? [{ businessId, expiresAt: 50 }] : [{ businessId: 'sibling', expiresAt: 50 }] };
    }
    if (command.constructor.name === 'ScanCommand') {
      if (legacy && TableName.endsWith('-Products')) {
        return { Items: [{ businessId, imageUrl: 'https://legacy.example/unverified.jpg' }] };
      }
      return { Items: TableName.endsWith('-GlobalProducts') ? [{ imageUrl: '/media/' + prefix + 'shared.jpg' }] : [] };
    }
    if (Key.businessId) return { Item: { businessId, ownerId: subjectId, cognitoUserId: subjectId, deletionRequestId: requestId } };
    if (Key.pk.startsWith('BUSINESS_LIFECYCLE')) return { Item: { subjectId, requestId, state: 'CLOSING' } };
    return { Item: request };
  } };
  const calls = [];
  const s3 = { async send(command) {
    calls.push(command);
    return command.constructor.name === 'ListObjectVersionsCommand'
      ? { Versions: [{ Key: prefix + 'exclusive.jpg', VersionId: 'one' }, { Key: prefix + 'shared.jpg', VersionId: 'two' }] }
      : {};
  } };
  const args = { db, s3, request, clock: () => 1000 };
  await assert.rejects(purgeMerchantProductAssets(args), { code: 'EXTERNAL_WRITES_IN_PROGRESS' });
  assert.equal(calls.length, 0);
  active = false;
  await assert.rejects(purgeMerchantProductAssets(args), { code: 'ASSET_INVENTORY_REQUIRED' });
  assert.ok(calls.every(command => command.constructor.name === 'ListObjectVersionsCommand'));
  legacy = false;
  await purgeMerchantProductAssets(args);
  assert.deepEqual(calls.at(-1).input.Delete.Objects, [{ Key: prefix + 'exclusive.jpg', VersionId: 'one' }]);
});

test('merchant worker and scheduler refuse to start when production enrollment guards are unverified', async () => {
  const { createMerchantDeletionWorker } = require('./merchant-worker.cjs');
  const worker = createMerchantDeletionWorker({
    db: { send() { assert.fail('a gated worker must not access DynamoDB'); } },
    s3: {}, cognito: {}, settlement: { readMerchantAccrualEvidence() {} }, verifiedMutationGuards: true,
  });
  await assert.rejects(worker.process({}), { code: 'WORKER_NOT_ENABLED' });
  assert.throws(() => worker.sweep(), { code: 'WORKER_NOT_ENABLED' });
});
