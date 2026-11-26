const assert = require('node:assert/strict');
const {test} = require('node:test');
const {createHandler} = require('./merchant-payout-notices.cjs');

const now = Date.parse('2026-11-24T21:00:00Z');
const eventId = 'MERCHANT_PAYOUT_NOTICE#' + 'a'.repeat(64);
const stream = 'arn:aws:dynamodb:us-east-1:746727375268:table/wizz-production-WalletNotifications/stream/2026-11-24T20:00:00';
const scheduleEvent = {
  source: 'aws.events', account: '746727375268', region: 'us-east-1',
  'detail-type': 'Scheduled Event',
  resources: ['arn:aws:events:us-east-1:746727375268:rule/wizz-production-merchant-payout-notices'],
};
const context = {getRemainingTimeInMillis: () => 30000};
const record = (id = eventId) => ({
  eventName: 'INSERT', eventSource: 'aws:dynamodb', eventSourceARN: stream,
  dynamodb: {Keys: {eventId: {S: id}}, SequenceNumber: '1'},
});

function fixture({liveVersion = 2, enabled = true} = {}) {
  const calls = [], sent = [];
  const payoutId = 'MPO:' + 'a'.repeat(48);
  const notice = {
    type: 'merchant_payout_updated', recipientApp: 'merchant', driverId: 'owner', branchId: 'branch',
    payoutVersion: 2, payoutStatus: 'PAID', payoutId, eventId, attempts: 1,
    createdAt: new Date(now).toISOString(), title: 'private amount', body: 'private details',
  };
  const token = {token: 'device-token', subjectId: 'owner', app: 'merchant', ttl: now / 1000 + 60};
  const client = {async send({input}) {
    calls.push(input);
    assert.match(input.TableName, /^wizz-production-/);
    if (input.IndexName === 'PendingDelivery') {
      assert.match(input.FilterExpression, /begins_with\(eventId, :prefix\).*recipientApp/);
      return input.ExclusiveStartKey ? {Items: [{eventId}]} : {Items: [], LastEvaluatedKey: {eventId: 'other'}};
    }
    if (input.IndexName === 'SubjectIdIndex') return {Items: [token, {...token, token: 'driver-token', app: 'driver'}]};
    if (input.UpdateExpression) return input.ReturnValues ? {Attributes: notice} : {};
    assert.equal(input.ConsistentRead, true);
    if (input.TableName.endsWith('PushDeviceTokens')) return {Item: token};
    if (input.Key.pk?.startsWith('MERCHANT_FINANCIAL_PUSH#')) return {Item: {subjectId: 'owner', branchId: 'branch', enabled}};
    if (input.Key.pk?.startsWith('MERCHANT_PAYOUT#')) return {Item: {ownerId: 'owner', branchId: 'branch', version: liveVersion, status: 'PAID'}};
    if (input.TableName.endsWith('Merchants')) return {Item: {ownerId: 'owner', cognitoUserId: 'owner', status: 'approved'}};
    return {};
  }};
  const handler = createHandler({client, stream, clock: () => now, messaging: async () => ({
    send: async message => { sent.push(message); },
  })});
  return {handler, calls, sent, payoutId};
}

test('production streams deliver only generic payout notices on the opted-in owner device', async () => {
  const f = fixture();
  assert.deepEqual(await f.handler({Records: [record('TOPUP#unrelated'), record()]}, context), {batchItemFailures: []});
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].token, 'device-token');
  assert.deepEqual(f.sent[0].data, {
    type: 'merchant_payout_updated', eventId, driverId: 'owner', branchId: 'branch', payoutId: f.payoutId,
    action: 'open_wallet',
  });
  assert.doesNotMatch(JSON.stringify(f.sent[0]), /private (amount|details)/);
  assert.match(f.calls[0].ConditionExpression, /#type = :payout AND recipientApp = :merchant/);
  assert.equal(f.calls.at(-1).ExpressionAttributeValues[':status'], 'SENT');
});

test('production rejects foreign triggers and keeps other event types outside the payout worker', async () => {
  const f = fixture();
  assert.throws(() => f.handler({Records: [{...record(), eventSourceARN: 'staging-stream'}]}, context), /INVALID/);
  assert.throws(() => f.handler({...scheduleEvent, account: '699561669180'}, context), /INVALID/);
  await f.handler({Records: [record('TOPUP#unrelated')]}, context);
  assert.deepEqual(f.calls, []);
});

test('production retries page past unrelated rows and suppress stale or disabled notifications', async () => {
  for (const conditions of [{enabled: false}, {liveVersion: 3}]) {
    const f = fixture(conditions);
    await f.handler(scheduleEvent, context);
    assert.equal(f.calls.filter(call => call.IndexName === 'PendingDelivery').length, 2);
    assert.deepEqual(f.sent, []);
    assert.equal(f.calls.at(-1).ExpressionAttributeValues[':status'], 'UNDELIVERABLE');
  }
});
