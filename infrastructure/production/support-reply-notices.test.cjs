'use strict';

const assert = require('node:assert/strict');
const {test} = require('node:test');
const {createHandler} = require('./support-reply-notices.cjs');

const at = Date.parse('2026-11-24T21:00:00Z');
const eventId = 'CN:' + 'a'.repeat(64);
const stream = 'arn:aws:dynamodb:us-east-1:746727375268:table/wizz-production-WalletNotifications/stream/2026-11-24T20:00:00';
const customer = 'customer-one';
const device = {token: 'user-device', app: 'user', subjectId: customer, ttl: at/1000 + 60};
const notice = {
  eventId, type: 'support_reply', recipientApp: 'user', driverId: customer,
  orderId: 'order-one', sessionId: 'session-one', attempts: 1,
  title: 'private data', body: 'private text', createdAt: new Date(at).toISOString(),
};
const context = {getRemainingTimeInMillis: () => 30000};
const record = (id = eventId) => ({
  eventName: 'INSERT', eventSource: 'aws:dynamodb', eventSourceARN: stream,
  dynamodb: {Keys: {eventId: {S: id}}, SequenceNumber: '1'},
});
const scheduleEvent = {
  source: 'aws.events', account: '746727375268', region: 'us-east-1',
  'detail-type': 'Scheduled Event',
  resources: ['arn:aws:events:us-east-1:746727375268:rule/wizz-production-support-reply-notices'],
};
function fixture({locked = false, owner = customer, tokenOwner = customer, ttl = device.ttl, complaintCase, sessionCase = complaintCase} = {}) {
  const calls = [], sent = [];
  const item = complaintCase ? {...notice,type:'order_complaint_updated',target:'complaint',
    caseId:complaintCase,caseVersion:2} : notice;
  const client = {async send({input}) {
    calls.push(input);
    assert.match(input.TableName, /^wizz-production-/);
    if (input.IndexName === 'PendingDelivery') {
      assert.equal(input.ExpressionAttributeValues[':noticeType'], 'support_reply');
      return input.ExclusiveStartKey ? {Items: [{eventId}]} : {Items: [], LastEvaluatedKey: {eventId: 'other'}};
    }
    if (input.IndexName === 'SubjectIdIndex') {
      assert.equal(input.ExpressionAttributeValues[':driver'], customer);
      return {Items: [device, {...device, app: 'merchant', token: 'merchant-device'}]};
    }
    if (input.UpdateExpression) return input.ReturnValues ? {Attributes: item} : {};
    assert.equal(input.ConsistentRead, true);
    if (input.TableName.endsWith('Holds')) {
      assert.deepEqual(input.Key,{orderId:notice.orderId,sk:'CUSTOMER_POST_DELIVERY'});
      return {Item:{kind:'CUSTOMER_POST_DELIVERY_CASE',customerId:customer,caseId:complaintCase,
        supportSessionId:notice.sessionId,version:2}};
    }
    if (input.TableName.endsWith('SupportChatSessions')) {
      assert.equal(input.Key.sessionId, notice.sessionId);
      return {Item: {sessionId: notice.sessionId, userType: 'customer', orderId: notice.orderId, userId: owner, customerId: owner, complaintCaseId:sessionCase}};
    }
    if (input.TableName.endsWith('Customers')) return {Item: {userId: customer, cognitoSub: customer, isActive: true}};
    if (input.TableName.endsWith('PushDeviceTokens')) return {Item: {...device, subjectId: tokenOwner, ttl}};
    return locked ? {Item: {pk: input.Key.pk}} : {};
  }};
  const handler = createHandler({client, stream, clock: () => at, messaging: async () => ({
    send: async message => { sent.push(message); },
  })});
  return {handler, calls, sent};
}

test('only the current customer device receives a generic reply notification with a support link', async () => {
  const f = fixture();
  assert.deepEqual(await f.handler({Records: [record('PAYOUT#ignored'), record()]}, context), {batchItemFailures: []});
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].token, device.token);
  assert.equal(f.sent[0].data.sessionId, notice.sessionId);
  assert.equal(f.sent[0].data.action, 'open_support');
  assert.doesNotMatch(JSON.stringify(f.sent[0]), /private (text|data)/);
  assert.equal(f.calls.at(-1).ExpressionAttributeValues[':status'], 'SENT');
});

test('closed account and unrelated chat owner never receive a notification', async () => {
  for (const opts of [{locked:true}, {owner:'customer-other'}]) {
    const f = fixture(opts);
    await f.handler({Records: [record()]}, context);
    assert.equal(f.sent.length, 0);
    assert.equal(f.calls.at(-1).ExpressionAttributeValues[':status'], 'SUPPRESSED');
  }
});

test('scheduled retries pass unrelated pages and exclude expired or re-registered devices', async () => {
  for (const opts of [{tokenOwner:'customer-other'}, {ttl:at/1000}]) {
    const f = fixture(opts);
    assert.throws(() => f.handler({Records: [{...record(), eventSourceARN: 'foreign'}]}, context), /INVALID/);
    await f.handler(scheduleEvent, context);
    assert.equal(f.calls.filter(x => x.IndexName==='PendingDelivery').length, 2);
    assert.equal(f.sent.length, 0);
    assert.equal(f.calls.at(-1).ExpressionAttributeValues[':status'], 'PENDING');
  }
});

test('only the case-bound customer receives a complaint push that opens the order complaint', async () => {
  for (const sessionCase of ['OEX:bound','OEX:unrelated']) {
    const f=fixture({complaintCase:'OEX:bound',sessionCase});
    await f.handler({Records:[record()]},context);
    assert.equal(f.sent.length,sessionCase==='OEX:bound'?1:0);
    if (f.sent.length) {
      assert.equal(f.sent[0].data.action,'open_complaint');
      assert.equal(f.sent[0].data.orderId,notice.orderId);
      assert.doesNotMatch(JSON.stringify(f.sent[0]),/private (text|data)/);
    }
  }
});
