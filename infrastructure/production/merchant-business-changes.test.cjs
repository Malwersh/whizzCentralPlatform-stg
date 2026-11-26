'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {GetCommand, QueryCommand, TransactWriteCommand} = require('@aws-sdk/lib-dynamodb');
const {createBusinessChanges} = require('./merchant-business-changes.cjs');

const sub = 'f0000000-1000-4000-8000-000000000001';
const staffId = 'f0000000-1000-4000-8000-000000000002';
const requestId = 'f0000000-1000-4000-8000-000000000003';
const businessId = 'business_approved';
const when = '2026-11-25T20:00:00.000Z';
const from = ['iq', 'najaf', 'district', 'from'];
const to = ['iq', 'najaf', 'district', 'to'];
const branch = {businessId, ownerId: sub, cognitoUserId: sub, status: 'approved',
  businessName: 'الاسم الأصلي', updatedAt: when, regionPath: from, regionId: from.at(-1),
  address: {fullAddress: 'العنوان الأصلي', latitude: 32, longitude: 44}};
const actor = {employeeId: staffId, status: 'ACTIVE', roles: ['merchant_reviewer'],
  scope: {allRegions: true}, version: 1};
const name = {businessId, requestId, baseUpdatedAt: when, kind: 'NAME', proposed: {businessName: 'الاسم الجديد'},
  reason: 'سبب التعديل'};
const location = {...name, kind: 'LOCATION', proposed: {regionPath: to, latitude: 32, longitude: 44, address: 'العنوان الجديد'}};
const approval = {requestId, baseVersion: 1, decision: 'APPROVE', reason: 'جرى التحقق من البيانات'};

function fixture() {
  const state = {branch: {...branch}, closing: false};
  const rows = new Map(), transactions = [], regionCalls = [];
  const db = {send: async command => {
    const {TableName, Key, TransactItems, ExpressionAttributeValues} = command.input;
    if (command instanceof GetCommand) {
      assert.equal(command.input.ConsistentRead, true);
      if (TableName.endsWith('-Merchants')) return {Item: state.branch};
      if (TableName.endsWith('-AccountDeletion')) return {Item: state.closing ? Key : undefined};
      return {Item: rows.get(Key.pk + '/' + Key.sk)};
    }
    if (command instanceof QueryCommand) {
      const prefix = ExpressionAttributeValues[':pk'] + '/CHANGE#';
      return {Items: [...rows].filter(([id]) => id.startsWith(prefix)).map(([, row]) => row)};
    }
    assert.ok(command instanceof TransactWriteCommand);
    transactions.push(TransactItems);
    if (state.closeBeforeCommit) {
      const fence = TransactItems.map(item => item.Update || item.ConditionCheck).find(item =>
        item?.TableName.endsWith('-Merchants') &&
        Object.values(item.ExpressionAttributeNames || {}).includes('orderIntakeDeletionRequestId'));
      assert.ok(fence, 'branch mutation must atomically check for concurrent closure intake');
      throw Object.assign(Error('concurrent closure'), {name:'TransactionCanceledException'});
    }
    for (const {Put} of TransactItems) if (Put?.Item.pk) rows.set(Put.Item.pk + '/' + Put.Item.sk, Put.Item);
    return {};
  }};
  const regions = {validate: async (...args) => {
    regionCalls.push(args);
    return {regionId: 'to', regionNames: ['العراق', 'النجف', 'القضاء', 'الناحية'],
      checks: [{ConditionCheck: {TableName: 'wizz-production-RegionsDerived', Key: {regionId: 'to'},
        ConditionExpression: 'version=:version', ExpressionAttributeValues: {':version': 1}}}]};
  }};
  return {service: createBusinessChanges({db, regions, now: () => Date.parse('2026-11-25T21:00:00.000Z')}),
    state, transactions, regionCalls, rows};
}

test('owner submits the same staging request contract without changing published data', async () => {
  const {service, transactions} = fixture();
  const initial = await service.owner(sub, 'GET', {businessId});
  assert.equal(initial.settings.address, branch.address.fullAddress);
  assert.equal(initial.baseUpdatedAt, when);
  assert.deepEqual(initial.items, []);
  const created = await service.owner(sub, 'POST', {}, name);
  assert.equal(created.request.status, 'PENDING');
  assert.ok(transactions[0].every(row => !row.Update));
  assert.equal(transactions[0].filter(row => row.ConditionCheck?.TableName.endsWith('AccountDeletion')).length, 2);
  assert.deepEqual(await service.owner(sub, 'POST', {}, name), created);
  assert.equal(transactions.length, 1);
  await assert.rejects(service.owner(sub, 'POST', {}, {...name, reason: 'سبب مختلف'}), {code: 'REQUEST_ID_CONFLICT'});
  await assert.rejects(service.owner(staffId, 'GET', {businessId}), {code: 'BUSINESS_UNAVAILABLE'});
});

test('approval atomically changes the registered name, queue, owner history and staff audit', async () => {
  const {service, transactions} = fixture();
  await service.owner(sub, 'POST', {}, name);
  const {items} = await service.staff(actor, 'GET', {});
  assert.equal(items[0].previous, branch.businessName);
  assert.equal(items[0].canReview, true);
  assert.equal(items[0].subjectId, undefined);
  const approved = await service.staff(actor, 'POST', {}, approval);
  assert.equal(approved.status, 'APPROVED');
  const write = transactions.at(-1);
  assert.equal(write.find(row => row.Update).Update.ExpressionAttributeValues[':v0'], name.proposed.businessName);
  assert.equal(write.find(row => row.Put?.Item.pk === 'AUDIT').Put.Item.reason, approval.reason);
  assert.ok(write.every(row => !JSON.stringify(row).includes('staging')));
  const current = await service.owner(sub, 'GET', {businessId});
  assert.equal(current.items[0].decisionReason, approval.reason);
  assert.equal(current.items[0].status, 'APPROVED');
  assert.deepEqual(await service.staff(actor, 'POST', {}, approval), approved);
  assert.equal(transactions.length, 2);
});

test('location is checked on submission and approval and requires scope at both ends', async () => {
  const {service, regionCalls, transactions} = fixture();
  await service.owner(sub, 'POST', {}, location);
  const local = {...actor, scope: {allRegions: false, regionIds: ['from']}};
  assert.deepEqual((await service.staff(local, 'GET', {})).items, []);
  await assert.rejects(service.staff(local, 'POST', {}, approval), {code: 'REQUEST_UNAVAILABLE'});
  const result = await service.staff(actor, 'POST', {}, approval);
  assert.equal(result.status, 'APPROVED');
  assert.deepEqual(regionCalls, [[to, 32, 44], [to, 32, 44]]);
  const tx = transactions.at(-1);
  assert.ok(tx.some(item => item.ConditionCheck?.TableName.endsWith('RegionsDerived')));
  const values = Object.values(tx.find(item => item.Update).Update.ExpressionAttributeValues);
  assert.ok(values.some(value => value?.fullAddress === 'العنوان الجديد'));
  assert.ok(values.includes('to'));
});

test('a closing branch cannot submit and a stale proposal can only be rejected', async () => {
  const {service, state, transactions} = fixture();
  state.closing = true;
  await assert.rejects(service.owner(sub, 'POST', {}, name), {code: 'BUSINESS_CLOSING'});
  state.closing = false;
  state.branch.orderIntakeDeletionRequestId = 'pending-closure';
  await assert.rejects(service.owner(sub, 'POST', {}, name));
  delete state.branch.orderIntakeDeletionRequestId;
  await assert.rejects(service.owner(sub, 'POST', {}, {...name, baseUpdatedAt: null}), {code: 'CHANGE_BASE_CONFLICT'});
  await service.owner(sub, 'POST', {}, name);
  state.branch.businessName = 'تغيير أحدث';
  await assert.rejects(service.staff(actor, 'POST', {}, approval), {code: 'CHANGE_BASE_CONFLICT'});
  assert.equal((await service.staff(actor, 'POST', {}, {...approval, decision: 'REJECT'})).status, 'REJECTED');
  assert.ok(transactions.at(-1).every(row => !row.Update));
});

test('branch approval fails atomically if closure intake wins the race', async () => {
  const {service,state,rows}=fixture();
  await service.owner(sub,'POST',{},name);
  state.closeBeforeCommit=true;
  const before=[...rows.values()];
  await assert.rejects(service.staff(actor,'POST',{},approval));
  assert.deepEqual([...rows.values()],before);
  assert.equal(state.branch.businessName,branch.businessName);
});
