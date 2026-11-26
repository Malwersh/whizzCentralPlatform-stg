'use strict';

const assert = require('node:assert/strict');
const {test} = require('node:test');
const {identities: {admin}} = require('../wallet-identity-bindings.json');
const {createApi, policyCatalog} = require('./api.cjs');

const P = '/staff/merchants/staff-policy';
const id = '11111111-1111-4111-8111-111111111111';
const now = Date.parse('2026-11-24T23:40:00Z');
const values = {enabledPermissions: policyCatalog.registry.map(capability => capability.id),
  roles: policyCatalog.presets.map(({pendingPermissions, ...role}) => role)};

function fixture({roles = ['merchant_staff_policy_manager'], allRegions = true, mfa = true, current = true, conflict = false} = {}) {
  const commands = [];
  const defaultProfile = {employeeId: id, roles, status: 'ACTIVE', scope: {allRegions}, version: 7};
  const db = {async send({input}) {
    commands.push(input);
    if (input.Key?.pk.startsWith('EMPLOYEE#')) return {Item: defaultProfile};
    if (input.Key) return {Item: current ? {version: 1, ...values} : undefined};
    if (input.IndexName || input.KeyConditionExpression) return {Items: [{version: 1, ...values, reason: 'إعداد السياسة'}]};
    if (input.TransactItems && conflict) throw Object.assign(Error('changed'), {name: 'TransactionCanceledException'});
    return {};
  }};
  const serve = createApi({db, now: () => now, verifyStaff: async token => {
    assert.equal(token, 'stub');
    return {sub: id, username: id, iss: 'https://cognito-idp.us-east-1.amazonaws.com/' + admin.poolId,
      client_id: admin.clientId, token_use: 'access', exp: now/1000 + 1200, auth_time: now/1000 - 4000};
  }, getStaff: async username => ({Username: username, Enabled: true, UserStatus: 'CONFIRMED',
    UserAttributes: [{Name: 'sub', Value: id}], UserMFASettingList: mfa ? ['SOFTWARE_TOKEN_MFA'] : []}),
  }, {ENVIRONMENT: 'production', AWS_REGION: 'us-east-1'});
  const call = async (resource = P, input, request = {}) => {
    const result = await serve({resource, requestContext: {stage: 'production'},
      headers: {Authorization: 'Bearer stub'}, httpMethod: input ? 'POST' : 'GET',
      body: input ? JSON.stringify(input) : undefined, ...request});
    return {status: result.statusCode, data: JSON.parse(result.body)};
  };
  return {commands, call};
}

test('production policy shows only delegated actions with available runtimes', async () => {
  const f = fixture();
  const result = await f.call();
  assert.equal(result.status, 200);
  assert.equal(result.data.canManage, true);
  assert.equal(result.data.current.version, 1);
  assert.equal(result.data.rolePresets.find(role => role.id === 'OPERATIONAL_EMPLOYEE').enabled, true);
  assert.ok(values.enabledPermissions.every(id => result.data.capabilities.some(cap => cap.id === id)));
  assert.equal(result.data.capabilities.filter(cap => cap.group === 'orders').length, 5);
  assert.equal(result.data.capabilities.filter(cap => cap.group === 'menu' || cap.group === 'hours').length, 8);
  assert.equal(result.data.capabilities.filter(cap => cap.group === 'discounts').length,5);
  assert.ok(!result.data.capabilities.some(cap => ['menu.publish', 'finance.approve'].includes(cap.id)));
});

test('production policy uses a valid MFA session and writes current, version, and audit atomically', async () => {
  const f = fixture();
  const next = structuredClone(values);
  next.enabledPermissions = next.enabledPermissions.filter(key => key !== 'finance.payout.receive');
  const result = await f.call(P+'/save', {baseVersion: 1, values: next, reason: 'إيقاف تأكيد الاستلام'});
  assert.equal(result.status, 200, JSON.stringify(result));
  assert.equal(result.data.current.version, 2);
  const transaction = f.commands.at(-1).TransactItems;
  assert.equal(transaction.length, 4);
  assert.equal(transaction[0].ConditionCheck.ExpressionAttributeValues[':version'], 7);
  assert.equal(transaction[2].Put.Item.sk, 'VERSION#000000000002');
  assert.equal(transaction[3].Put.Item.action, 'MERCHANT_STAFF_POLICY_SAVED');
  assert.deepEqual(result.data.current.roles, values.roles);
  assert.ok(transaction.every(operation => Object.values(operation)[0].TableName === 'wizz-production-PlatformStaff'));
});

test('regional, unrelated and non-MFA accounts cannot edit or read policy data', async () => {
  for (const restriction of [{roles: ['finance_approver']}, {allRegions: false}, {mfa: false}]) {
    const f = fixture(restriction);
    assert.equal((await f.call()).status, 403);
    assert.ok(f.commands.every(command => command.Key.pk.startsWith('EMPLOYEE#')));
  }
  const f = fixture();
  assert.equal((await f.call(P, undefined, {headers: {}})).status, 401);
  assert.equal((await f.call(P, undefined, {requestContext: {stage: 'staging'}})).status, 404);
  assert.deepEqual(f.commands, []);
});

test('unlaunched capabilities and competing writes fail without publishing more authority', async () => {
  const f = fixture();
  const expanded = {...values, enabledPermissions: [...values.enabledPermissions, 'menu.publish']};
  assert.equal((await f.call(P+'/save', {baseVersion: 1, values: expanded, reason: 'محاولة توسيع السياسة'})).status, 400);
  assert.ok(!f.commands.some(command => command.TransactItems));
  const competing = fixture({conflict: true});
  assert.equal((await competing.call(P+'/save', {baseVersion: 1, values, reason: 'حفظ أثناء تعديل آخر'})).status, 409);
});
