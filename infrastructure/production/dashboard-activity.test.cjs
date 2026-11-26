'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {createHandler} = require('./dashboard-activity.cjs');
const {identities} = require('./wallet-identity-bindings.json');

const subject = 'f0000000-1000-4000-8000-000000000001';
const event = {
  httpMethod: 'GET', resource: '/staff/dashboard/activity',
  requestContext: {apiId: 'dashboard-api', stage: 'production'},
  headers: {Authorization: 'Bearer signed-access-token'},
};
const decode = response => JSON.parse(response.body);

function fixture({scope = {allRegions: true}, roles = ['platform_manager'], scan = query =>
  query.Select === 'COUNT' ? {Count: 0} : {Items: []}} = {}) {
  let clock = Date.parse('2026-11-25T20:59:59.000Z');
  const reads = [];
  const serve = createHandler({
    apiId: 'dashboard-api',
    now: () => clock,
    verifyStaff: async token => {
      assert.equal(token, 'signed-access-token');
      return {
        sub: subject, username: subject, token_use: 'access', client_id: identities.admin.clientId,
        iss: 'https://cognito-idp.us-east-1.amazonaws.com/' + identities.admin.poolId,
        auth_time: Math.floor(clock / 1000) - 3600, exp: Math.floor(clock / 1000) + 100,
      };
    },
    getStaff: async () => ({
      Enabled: true, UserStatus: 'CONFIRMED', Username: subject,
      UserAttributes: [{Name: 'sub', Value: subject}], UserMFASettingList: ['SOFTWARE_TOKEN_MFA'],
    }),
    db: {send: async (command, options) => {
      if (command.input.TableName === 'wizz-production-PlatformStaff') {
        assert.equal(command.input.ConsistentRead, true);
        assert.deepEqual(command.input.Key, {pk: 'EMPLOYEE#' + subject, sk: 'PROFILE'});
        return {Item: {employeeId: subject, status: 'ACTIVE', scope, roles, version: 1}};
      }
      assert.equal(command.input.Limit, 500);
      assert.ok(options.abortSignal);
      reads.push(command.input);
      return scan(command.input);
    }},
  });
  return {serve, reads, advance: ms => { clock += ms; }};
}

test('metrics require valid staff authorization and a global dashboard grant', async () => {
  const regional = fixture({scope: {allRegions: false, regionIds: ['region']}});
  const unauthorized = fixture({roles: ['merchant_reviewer']});
  assert.equal((await regional.serve(event)).statusCode, 403);
  assert.equal((await unauthorized.serve(event)).statusCode, 403);
  assert.equal((await regional.serve({...event, headers: {}})).statusCode, 401);
  assert.equal((await regional.serve({...event, httpMethod: 'POST'})).statusCode, 404);
  assert.equal(regional.reads.length + unauthorized.reads.length, 0);
});

test('concurrent views reuse a count and Baghdad midnight invalidates the cache', async () => {
  const {serve, reads, advance} = fixture();
  const responses = await Promise.all([serve(event), serve(event)]);
  assert.equal(responses[0].statusCode, 200);
  assert.deepEqual(decode(responses[0]), decode(responses[1]));
  assert.equal(reads.length, 6);
  assert.equal(reads[0].ExpressionAttributeValues[':start'], '2026-11-24T21:00:00.000Z');
  assert.equal(reads[0].ExpressionAttributeValues[':end'], '2026-11-25T21:00:00.000Z');
  advance(1000);
  const next = decode(await serve(event));
  assert.equal(reads.length, 12);
  assert.equal(reads[6].ExpressionAttributeValues[':start'], '2026-11-25T21:00:00.000Z');
  assert.equal(next.measuredAt, '2026-11-25T21:00:00.000Z');
  assert.deepEqual(next.metrics.drivers, {value: 0, complete: true});
});

test('counts continue after empty pages, mark incomplete scans and isolate failures', async () => {
  const {serve, reads} = fixture({scan: query => {
    if (query.TableName.endsWith('DriverLiveState')) throw Error('read failed');
    if (query.TableName.endsWith('Orders')) {
      return query.ExclusiveStartKey ? {Count: 2} : {Count: 0, LastEvaluatedKey: {PK: 'next', SK: 'META'}};
    }
    if (query.TableName.endsWith('Customers')) return {Count: 500, LastEvaluatedKey: {userId: 'next'}};
    return {Count: 0};
  }});
  const response = await serve(event);
  assert.equal(response.headers['Cache-Control'], 'no-store');
  assert.deepEqual(decode(response).metrics, {
    orders: {value: 2, complete: true},
    branches: {value: 0, complete: true},
    drivers: null,
    customers: {value: 4000, complete: false},
    offers: {value: 0, complete: true},
  });
  assert.equal(reads.length, 14);
});

test('support and revenue require their own permissions even with a dashboard grant', async () => {
  const {serve, reads} = fixture();
  const {metrics} = decode(await serve(event));
  assert.ok('offers' in metrics);
  assert.ok(!('support' in metrics) && !('revenue' in metrics));
  assert.ok(reads.every(query => !/SupportChatSessions|MerchantPlatform/.test(query.TableName)));
});

test('additional metrics count open conversations, eligible offers and signed posted revenue', async () => {
  const offer = {
    discountId: 'offer', status: 'active', type: 'percentage', value: 10,
    validFrom: '2026-11-25T18:00:00', validTo: '2026-11-26T01:00:00',
  };
  const line = (account, side, minorAmount) => ({
    account, side, amount: {currency: 'IQD', scale: 1000, moneySchemaVersion: 1, minorAmount},
  });
  const {serve, reads} = fixture({
    roles: ['platform_manager', 'support_supervisor', 'finance_viewer'],
    scan: query => {
      if (query.TableName.endsWith('SupportChatSessions')) {
        assert.equal(query.Select, 'COUNT');
        assert.deepEqual(query.ExpressionAttributeValues, {':waiting': 'waiting_for_agent', ':active': 'active'});
        return {Count: 2};
      }
      if (query.TableName.endsWith('PlatformDiscounts')) return {Items: [
        offer, {...offer, status: 'paused'}, {...offer, usage: 1, usageLimit: 1}, {...offer, sharedStopped: true},
      ]};
      if (query.TableName.endsWith('MerchantDiscounts')) return {Items: [
        offer, {...offer, validTo: '2026-11-25T23:59:59'}, {...offer, deletedAt: '2026-11-25'},
        {...offer, validFrom: '2026-11-26T00:00:00'}, {...offer, valid_from: '2026-11-25T01:00:00'},
      ]};
      if (query.TableName.endsWith('MerchantPlatform')) {
        assert.equal(query.Select, 'SPECIFIC_ATTRIBUTES');
        assert.deepEqual(query.ExpressionAttributeValues[':posted'], 'POSTED');
        assert.equal(query.ExpressionAttributeValues[':start'], '2026-11-24T21:00:00.000Z');
        return {Items: [{lines: [
          line('MERCHANT_COMMISSION_REVENUE', 'CREDIT', 1_000_000),
          line('SERVICE_FEE_REVENUE', 'CREDIT', 150_000),
          line('CASH_ROUNDING_SERVICE_ADJUSTMENT', 'DEBIT', 400),
          line('MERCHANT_PAYABLE', 'CREDIT', 9_000_000),
          line('PLATFORM_GOODS_PROMOTION_EXPENSE', 'DEBIT', 2_000_000),
        ]}]};
      }
      return {Count: 0};
    },
  });
  const {metrics} = decode(await serve(event));
  assert.deepEqual(metrics.support, {value: 2, complete: true});
  assert.deepEqual(metrics.offers, {value: 2, complete: true});
  assert.deepEqual(metrics.revenue, {value: 1_149_600, complete: true});
  assert.equal(reads.length, 8);
});

test('an unreadable offer source and invalid accounting amounts never become zero', async () => {
  const {serve} = fixture({
    roles: ['platform_manager', 'finance_viewer'],
    scan: query => {
      if (query.TableName.endsWith('MerchantDiscounts')) throw Error('Offer source unavailable');
      if (query.TableName.endsWith('MerchantPlatform')) return {Items: [{lines: [
        {account: 'SERVICE_FEE_REVENUE', side: 'CREDIT', amount: {currency: 'USD', minorAmount: 500}},
      ]}]};
      return {Count: 0, Items: []};
    },
  });
  const {metrics} = decode(await serve(event));
  assert.equal(metrics.offers, null);
  assert.equal(metrics.revenue, null);
  assert.deepEqual(metrics.orders, {value: 0, complete: true});
});
