'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHandler } = require('./api.cjs');

function fixture() {
  const calls = [];
  const handler = createHandler({
    env: { ENVIRONMENT: 'production' },
    authenticateMerchant: async token => {
      assert.equal(token, 'session');
      return { subjectId: 'owner' };
    },
    customer: async (event, body) => {
      calls.push([event, body]);
      return { success: true, orderId: body.orderId, cancelled: false, cancellationStatus: 'REQUESTED' };
    },
    merchant: async (actor, event, body) => {
      calls.push([event, body, actor]);
      return { success: true, orderId: body.orderId, cancelled: true, cancellationStatus: 'CANCELLED' };
    },
  });
  const customer = { path: '/order/cancel', httpMethod: 'POST',
    headers: { authorization: 'Bearer session' }, requestContext: { stage: 'production' },
    body: JSON.stringify({ orderId: 'o-1', canceledBy: 'customer', reason: 'تغيّر العنوان',
      requestedBy: 'u-1', cancellationProtocolVersion: 1 }) };
  const merchant = { ...customer, path: '/auth/order-cancellation', httpMethod: 'GET',
    body: null, queryStringParameters: { businessId: 'branch', orderId: 'o-1' } };
  return { calls, handler, customer, merchant };
}

test('keeps a requested cancellation pending with the original bearer session', async () => {
  const f = fixture();
  const result = await f.handler(f.customer);
  assert.equal(result.statusCode, 200);
  assert.deepEqual(JSON.parse(result.body), {
    success: true, orderId: 'o-1', cancelled: false, cancellationStatus: 'REQUESTED',
  });
  assert.equal(f.calls[0][0].headers.Authorization, 'Bearer session');
});

test('reuses the authenticated merchant operation for reads and confirmations', async () => {
  const f = fixture();
  assert.equal((await f.handler(f.merchant)).statusCode, 200);
  const receipt = { ...f.merchant.queryStringParameters, requestId: 'CAN:a',
    expectedVersion: 1, preparationNotStarted: true };
  const result = await f.handler({ ...f.merchant, httpMethod: 'POST', body: JSON.stringify(receipt) });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(f.calls[1].slice(1), [receipt, { subjectId: 'owner' }]);
  assert.equal(JSON.parse(result.body).cancelled, true);
});

test('rejects missing credentials, foreign stages and unrelated workflows before delegation', async () => {
  const f = fixture();
  assert.equal((await f.handler({ ...f.customer, headers: {} })).statusCode, 401);
  assert.equal((await f.handler({ ...f.customer, requestContext: { stage: 'staging' } })).statusCode, 404);
  for (const extra of [{ workflow: 'CUSTOMER_CASH_REVIEW' }, { canceledBy: 'restaurant' }, { guestToken: 'guest' }]) {
    const body = JSON.stringify({ ...JSON.parse(f.customer.body), ...extra });
    assert.equal((await f.handler({ ...f.customer, body })).statusCode, 400);
  }
  assert.equal((await f.handler({ ...f.merchant, httpMethod: 'POST', body: '{"handover":true}' })).statusCode, 400);
  assert.equal(f.calls.length, 0);
});
