'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const {identities} = require('./wallet-identity-bindings.json');
const {environment} = require('./wallet-receipt-runtime.json');
const {createHandler} = require(process.env.PICKUP_ISSUES_BUNDLE);

Object.assign(process.env, environment, {
  AWS_REGION: 'us-east-1', OFFER_JOURNEY_TABLE: 'wizz-production-OfferJourney',
  PICKUP_DRIVER_API_ID: 'driver-api', PICKUP_STAFF_API_ID: 'staff-api',
});
for (const [role, entry] of Object.entries(identities)) {
  process.env[role.toUpperCase() + '_USER_POOL_ID'] = entry.poolId;
  process.env[role.toUpperCase() + '_CLIENT_ID'] = entry.clientId;
}

function accessToken(kind) {
  const identity = identities[kind];
  return 'test.' + Buffer.from(JSON.stringify({
    iss: 'https://cognito-idp.us-east-1.amazonaws.com/' + identity.poolId,
    client_id: identity.clientId, sub: kind, token_use: 'access', auth_time: Math.floor(Date.now()/1000) - 3600,
  })).toString('base64url') + '.test';
}

function fixture() {
  const order = {
    PK: 'ORDER#order', SK: 'META', orderId: 'order', orderNumber: 'ORD1792849495126',
    status: 'arrived_at_store', driverId: 'driver', financialAcceptance: {offerId: 'offer'},
    assignmentAttemptCounter: 1, pricing: {total: 8500}, items: [{name: 'حضّر الطلب'}],
  };
  const employee = {employeeId: 'admin', roles: ['bootstrap_admin'], status: 'ACTIVE', version: 1, scope: {allRegions: true}};
  const rows = new Map();
  const transactions = [];
  let failWrite = false;
  const rowKey = key => JSON.stringify(key);
  const cognito = {async send(command) {
    const {AccessToken, Username} = command.input;
    const sub = Username ?? JSON.parse(Buffer.from(AccessToken.split('.')[1], 'base64url')).sub;
    return {Username: sub, UserAttributes: [{Name:'sub',Value:sub}], Enabled:true,
      UserStatus:'CONFIRMED', UserMFASettingList:['SOFTWARE_TOKEN_MFA']};
  }};
  const db = {async send(command) {
    const input = command.input;
    assert.ok(input.TableName?.startsWith('wizz-production-') || input.TransactItems);
    switch (command.constructor.name) {
      case 'GetCommand':
        return {Item: structuredClone(input.Key.PK ? order :
          input.Key.pk === 'EMPLOYEE#admin' ? employee : rows.get(rowKey(input.Key)))};
      case 'QueryCommand':
        if (input.IndexName === 'GSI_OrderNumber') return {Items: [order]};
        assert.equal(input.ExpressionAttributeValues[':pk'], 'PICKUP_ISSUE_OPEN');
        return {Items: [...rows.values()].filter(item => item.pk === 'PICKUP_ISSUE_OPEN')};
      case 'TransactWriteCommand':
        transactions.push(input.TransactItems);
        assert.ok(input.TransactItems.every(item => Object.values(item)[0].TableName.startsWith('wizz-production-')));
        if (failWrite) throw Object.assign(Error('lost write'), {name:'TransactionCanceledException'});
        for (const operation of input.TransactItems) {
          if (operation.Update) {
            assert.match(operation.Update.ConditionExpression, /financialAcceptance.offerId/);
            assert.match(operation.Update.ConditionExpression, /attribute_not_exists\(deletedAt\)/);
            order.pickupIssueReports = [...(order.pickupIssueReports ?? []), ...operation.Update.ExpressionAttributeValues[':reports']];
          }
          if (operation.Put) {
            const {pk,sk} = operation.Put.Item;
            rows.set(rowKey({pk,sk}), structuredClone(operation.Put.Item));
          }
          if (operation.Delete) rows.delete(rowKey(operation.Delete.Key));
        }
        return {};
      default:
        assert.fail(command.constructor.name);
    }
  }};
  const handler = createHandler({db, cognito});
  async function send(kind, method, input, overrides = {}) {
    const driver = kind === 'driver';
    const result = await handler({
      requestContext: {stage:'production', apiId:driver?'driver-api':'staff-api'},
      resource: driver ? '/driver/orders/{orderId}/issue' : '/staff/pickup-issues',
      httpMethod: method, headers: {Authorization:'Bearer '+accessToken(kind)}, pathParameters:{orderId:'order'},
      ...(method === 'GET' ? {queryStringParameters:input} : {body:JSON.stringify(input)}), ...overrides,
    });
    return [result.statusCode, JSON.parse(result.body)];
  }
  return {order, employee, rows, transactions, send, fail() { failWrite = true; }};
}

const report = {issueType:'ItemUnavailable', issueSource:'Store', notes:'الصنف غير متاح', reportId:'report-123', offerId:'offer', attempt:1};

test('driver report atomically enters production staff queue and staff can document and close it', async () => {
  const fixtureData = fixture();
  const {order, send, transactions} = fixtureData;
  assert.equal((await send('admin','GET',{view:'queue'}))[1].items.length, 0);
  assert.equal((await send('driver','POST',report))[0], 200);
  assert.equal((await send('driver','POST',report))[1].replayed, true);
  assert.equal(transactions.length, 1);
  assert.equal(transactions[0][0].ConditionCheck.TableName, 'wizz-production-AccountDeletion');
  assert.equal((await send('admin','GET',{view:'queue'}))[1].items[0].status, 'OPEN');

  const decide = (action, expectedVersion, fields) => send('admin','POST',{
    action, expectedVersion, requestId:randomUUID(), reportId:report.reportId, orderId:order.orderId,
    reason:'تم توثيق الإجراء للمتابعة', ...fields,
  });
  assert.equal((await decide('CLAIM',0,{followUpMinutes:10}))[0], 200);
  const close = {resolution:'ORIGINAL_ORDER_CONTINUES', reference:'نتيجة موثقة مع الطرفين', originalOrderUnchanged:true};
  assert.equal((await decide('CLOSE',1,close))[0], 409);
  for (const [index, party] of ['DRIVER','MERCHANT'].entries()) {
    assert.equal((await decide('CONTACT',index+1,{party, channel:'PHONE',result:'REACHED',reference:'تم التواصل الفعلي'}))[0], 200);
  }
  const closed = await decide('CLOSE',3,close);
  assert.equal(closed[0], 200);
  assert.equal(closed[1].financialPosting, false);
  assert.equal((await send('admin','GET',{view:'queue'}))[1].items.length, 0);
  assert.equal((await send('admin','GET',{orderId:order.orderNumber}))[1].items[0].status, 'CLOSED');
  assert.equal(order.status, 'arrived_at_store');
  assert.equal(order.pricing.total, 8500);
  assert.ok(transactions.slice(1).flat().every(item => !item.Update));
});

test('rejects cross-environment credentials, stale assignments, and writes that fail atomically', async () => {
  const {transactions, send, fail} = fixture();
  assert.equal((await send('driver','POST',report,{headers:{Authorization:'Bearer '+accessToken('admin')}}))[0], 401);
  assert.equal((await send('driver','POST',report,{requestContext:{stage:'staging',apiId:'driver-api'}}))[0], 404);
  assert.equal((await send('driver','POST',{...report,attempt:2}))[0], 409);
  assert.equal(transactions.length, 0);
  fail();
  assert.equal((await send('driver','POST',report))[0], 409);
  assert.equal((await send('admin','GET',{view:'queue'}))[1].items.length, 0);
});
