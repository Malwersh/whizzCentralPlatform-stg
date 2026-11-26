'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const modules = path.resolve(__dirname, '../../../backend/wallet-service/node_modules');
const {createHandler} = process.env.REVIEW_BUNDLE
  ? require(process.env.REVIEW_BUNDLE)
  : bundleForTest();
const bindings = require('../wallet-identity-bindings.json');
const wallet = require('../wallet-receipt-runtime.json').environment;
const {createOrderExceptionPolicy} = require('../../../backend/wallet-service/dist/orderExceptionPolicy');
const {quoteHash} = require('../../../backend/wallet-service/dist/deliveryQuoteRecord');

function bundleForTest() {
  const { outputFiles } = require(path.join(modules, 'esbuild')).buildSync({
    entryPoints: [path.join(__dirname, 'index.cjs')], bundle: true, platform: 'node', format: 'cjs',
    nodePaths: [modules], write: false,
  });
  const moduleForTest = new Module(__filename, module);
  moduleForTest._compile(outputFiles[0].text, __filename);
  return moduleForTest.exports;
}

const config = {schemaVersion: 1, accountId: bindings.accountId, region: bindings.region, scopes: []};
Object.assign(process.env, wallet, {
  ENVIRONMENT: 'production', AWS_REGION: 'us-east-1',
  OFFER_JOURNEY_TABLE: 'wizz-production-OfferJourney',
  DISPATCH_JOBS_TABLE: 'wizz-production-DispatchJobs',
  DRIVER_LIVE_STATE_TABLE: 'wizz-production-DriverLiveState',
  WAVE_OFFERS_TABLE: 'wizz-production-WaveOffers',
  DELIVERY_QUOTES_TABLE: 'wizz-production-DeliveryQuotes',
  DRIVERS_TABLE: 'wizz-production-Drivers',
  MERCHANTS_TABLE: 'wizz-production-Merchants',
  FINANCE_GENERAL_RELEASE_MODE: 'REQUIRED',
  FINANCIAL_SETTLEMENT_MODEL: 'FULL_CASH_AT_DELIVERY_V1',
  FINANCE_ROLLOUT_CONFIG: JSON.stringify(config),
  FINANCE_ROLLOUT_SHA256: quoteHash(config),
});
for (const [name, identity] of Object.entries(bindings.identities)) {
  process.env[name.toUpperCase() + '_USER_POOL_ID'] = identity.poolId;
  process.env[name.toUpperCase() + '_CLIENT_ID'] = identity.clientId;
}
const subject = 'staff1';
const now = new Date().toISOString();
const identity = {
  sub: subject, client_id: bindings.identities.admin.clientId, token_use: 'access',
  iss: 'https://cognito-idp.us-east-1.amazonaws.com/' + bindings.identities.admin.poolId,
  auth_time: Math.floor(Date.now() / 1000),
};
const token = claims => 'header.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.signature';
const event = (claims = identity, overrides = {}) => ({
  resource: '/staff/order-cancellation', httpMethod: 'GET', requestContext: {stage: 'production'},
  headers: {Authorization: 'Bearer ' + token(claims)}, ...overrides,
});
const key = {operationId: 'EXCEPTION_CASE#OEX:case1', queuePartition: 'ORDER_EXCEPTIONS_OPEN', nextAttemptAt: 1};
const order = {
  PK: 'ORDER#order1', SK: 'META', userSub: 'customer1',
  orderId: 'order1', orderNumber: 'ORD1797982600000', status: 'preparing',
  storeId: 'branch1', storeName: 'فرع الاختبار', paymentMethod: 'cash',
  createdAt: now, exceptionPolicy: createOrderExceptionPolicy(now),
  financeRollout: {schemaVersion: 2, scopeId: 'GENERAL_PRODUCTION_FULL_CASH_V1', version: 1,
    digest: quoteHash({release: 'GENERAL_PRODUCTION_FULL_CASH_V1', version: 1,
      orders: [{orderId: 'order1', branchId: 'branch1', customerSubjectId: 'customer1'}]})},
};
const record = {
  orderId: 'order1', caseId: 'OEX:case1', kind: 'CUSTOMER_CANCELLATION', version: 1,
  state: 'REQUESTED', reason: 'طلب إلغاء تجريبي', createdAt: now,
};

function fixture({mfa = true, roles = ['operations'], global = true, proof = false} = {}) {
  const calls = [];
  const journals = new Map();
  const db = {async send({input}) {
    calls.push(input);
    if (input.TransactItems) {
      for (const item of input.TransactItems) {
        if (item.Put?.Item?.kind === 'ORDER_EXCEPTION_CASE_EVENT') {
          journals.set(item.Put.Item.sk, item.Put.Item);
        }
      }
      return {};
    }
    if (input.IndexName === 'ByDue') {
      return {Items: [{
        ...key, kind: 'ORDER_EXCEPTION_CASE_POINTER', orderId: 'order1',
        caseId: 'OEX:case1', caseKey: 'CUSTOMER_CANCELLATION',
      }], ...(!input.ExclusiveStartKey ? {LastEvaluatedKey: key} : {})};
    }
    if (input.IndexName === 'GSI_OrderNumber') return {Items: [{PK: 'ORDER#order1', SK: 'META', orderId: 'order1'}]};
    if (input.TableName === 'wizz-production-PlatformStaff') return {Item: {
      employeeId: subject, status: 'ACTIVE', minimumAuthTime: 0, version: 1,
      scope: {allRegions: global}, roles,
    }};
    if (input.Key.PK === 'ORDER#order1') return {Item: order};
    if (input.Key.sk === 'CUSTOMER_CANCELLATION') return {Item: {
      ...record, ...(proof ? {merchantRetentionProof: {
        goodsRetainedByBranch: true, branchId: 'branch1', ownerId: 'hidden-owner', note: 'الأصناف باقية',
      }} : {}),
    }};
    return {Item: journals.get(input.Key.sk)};
  }};
  const cognito = {async send({input}) {
    if (input.AccessToken) return {Username: 'staff1', UserAttributes: [{Name: 'sub', Value: subject}]};
    return {Username: 'staff1', Enabled: true, UserStatus: 'CONFIRMED',
      UserMFASettingList: mfa ? ['SOFTWARE_TOKEN_MFA'] : [],
      UserAttributes: [{Name: 'sub', Value: subject}]};
  }};
  return {calls, handle: createHandler({db, cognito})};
}

test('the production queue preserves proof gates, exposes no internal actor fields and resumes pagination', async () => {
  for (const proof of [false, true]) {
    const {handle, calls} = fixture({proof});
    const result = await handle(event());
    assert.equal(result.statusCode, 200, result.body);
    const {items: [item], nextCursor} = JSON.parse(result.body);
    assert.equal(item.state, 'REQUESTED');
    assert.equal(item.orderStatus, 'preparing');
    assert.equal(item.actions.includes('CANCEL_BEFORE_PICKUP'), proof);
    assert.equal(JSON.stringify(item).includes('hidden-owner'), false);
    const nextPage = await handle(event(identity, {queryStringParameters: {cursor: nextCursor}}));
    assert.equal(nextPage.statusCode, 200, nextPage.body);
    assert.equal(JSON.parse(nextPage.body).nextCursor, null);
    assert.ok(calls.every(call => call.TableName.startsWith('wizz-production-')));
    const search = await handle(event(identity, {queryStringParameters: {order: order.orderNumber}}));
    assert.equal(JSON.parse(search.body).items[0].orderId, 'order1');
    assert.ok(calls.some(call => call.IndexName === 'GSI_OrderNumber'));
  }
});

test('foreign pools, MFA failures and region-only staff cannot read global orders', async () => {
  const config = bindings.identities.customer;
  for (const [options, claims, status] of [
    [{}, {...identity, iss: 'https://cognito-idp.us-east-1.amazonaws.com/' + config.poolId}, 401],
    [{mfa: false}, identity, 401],
    [{global: false}, identity, 403],
  ]) {
    const {handle, calls} = fixture(options);
    assert.equal((await handle(event(claims))).statusCode, status);
    assert.equal(calls.some(call => call.IndexName), false);
  }
});

test('compensation requires finance authority and an unambiguous route before looking up the order', async () => {
  const selector = {view: 'compensation', orderId: 'order1', caseKey: 'CUSTOMER_CANCELLATION'};
  for (const scenario of [
    {roles: ['operations'], request: {queryStringParameters: selector}, status: 403},
    {roles: ['finance_viewer'], request: {queryStringParameters: selector,
      multiValueQueryStringParameters: {view: ['compensation', 'other']}}, status: 400},
    {roles: ['finance_viewer'], request: {httpMethod: 'POST', queryStringParameters: {view: 'compensation'},
      body: JSON.stringify({...selector, action: 'APPROVE'})}, status: 403},
  ]) {
    const {handle, calls} = fixture({roles: scenario.roles});
    assert.equal((await handle(event(identity, scenario.request))).statusCode, scenario.status);
    assert.ok(calls.every(call => call.TableName === 'wizz-production-PlatformStaff'));
  }
});

test('read-only reviewers cannot submit decisions, and unrelated commands never reach the order', async () => {
  const input = {
    orderId: 'order1', caseId: 'OEX:case1', caseKey: 'CUSTOMER_CANCELLATION', expectedVersion: 1,
    action: 'DECLINE_CANCELLATION', reason: 'مراجعة طلب تجريبية',
    idempotencyKey: 'ebf1d2f0-b42e-4daf-a218-4490bc766a0a',
  };
  for (const [roles, body, status] of [
    [['finance_viewer'], input, 403],
    [['operations'], {...input, action: 'EXECUTE_EXCEPTION_ENTITLEMENTS'}, 400],
    [['operations'], {...input, approvedBy: 'staff2'}, 400],
  ]) {
    const {handle, calls} = fixture({roles});
    assert.equal((await handle(event(identity, {httpMethod: 'POST', body: JSON.stringify(body)}))).statusCode, status);
    assert.ok(calls.every(call => call.TableName === 'wizz-production-PlatformStaff'));
  }
});

test('a production decline records exactly one fenced decision and leaves the order active', async () => {
  const {handle, calls} = fixture();
  const request = event(identity, {httpMethod: 'POST', body: JSON.stringify({
    orderId: 'order1', caseId: 'OEX:case1', caseKey: 'CUSTOMER_CANCELLATION', expectedVersion: 1,
    action: 'DECLINE_CANCELLATION', reason: 'مراجعة طلب تجريبية',
    idempotencyKey: 'ebf1d2f0-b42e-4daf-a218-4490bc766a0a',
  })});
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await handle(request);
    assert.equal(result.statusCode, 200, result.body);
    assert.equal(JSON.parse(result.body).action, 'DECLINE_CANCELLATION');
  }
  const [transaction] = calls.filter(call => call.TransactItems);
  assert.equal(calls.filter(call => call.TransactItems).length, 1);
  const items = transaction.TransactItems.map(item => item.Put || item.Update || item.ConditionCheck);
  assert.ok(items.every(item => item.TableName.startsWith('wizz-production-')));
  assert.ok(items.some(item => item.TableName === 'wizz-production-PlatformStaff'));
  const updates = transaction.TransactItems.filter(item => item.Update);
  assert.equal(updates.length, 1);
  const { Update: update } = updates[0];
  assert.equal(update.TableName, 'wizz-production-Orders');
  const [setFields] = update.UpdateExpression.split(' REMOVE ');
  assert.ok(!Object.entries(update.ExpressionAttributeNames).some(([name, value]) => value === 'status' && setFields.includes(name)));
  assert.ok(Object.values(update.ExpressionAttributeValues).some(value => value?.state === 'DECLINED'));
});
