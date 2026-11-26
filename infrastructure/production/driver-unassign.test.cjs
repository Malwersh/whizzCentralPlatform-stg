'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHandler } = require('./driver-unassign.cjs');
const ready = require('../../backend/wallet-service/test/helpers/full-cash-lifecycle-matrix-fixture.cjs');
const deployedFinance = process.env.WIZZ_UNASSIGN_LIVE_ARTIFACT;
const { createStagingCodReassignment } = deployedFinance
  ? require('../../scripts/load-live-lifecycle-219.cjs')(deployedFinance)
  : require('../../backend/wallet-service/dist/codReassignment');

const route = '/driver/orders/{orderId}/financial-unassign';
const request = (body, overrides = {}) => ({
  requestContext: { apiId: 'profile', stage: 'production' }, resource: route, httpMethod: 'POST',
  pathParameters: { orderId: 'order1' }, headers: { authorization: 'Bearer valid.dev.token' },
  body: JSON.stringify(body), ...overrides,
});
const base = { offerId: 'FINO:fixture', attempt: 1, cashCollected: false, reason: 'VehicleIssue' };

test('only the production profile route and the agreed request reach the financial host', async () => {
  const handler = createHandler({ apiId: 'profile', unassign: () => assert.fail('unexpected financial invocation') });
  for (const [data, overrides, status] of [
    [base, { requestContext: { apiId: 'other', stage: 'production' } }, 404],
    [base, { requestContext: { apiId: 'profile', stage: 'staging' } }, 404],
    [base, { headers: {} }, 401],
    [base, { multiValueHeaders: { Authorization: ['Bearer different.dev.token'] } }, 401],
    [{ ...base, driverId: 'other-driver' }, {}, 400],
    [{ ...base, orderId: 'different-order' }, {}, 400],
    [{ ...base, cashCollected: true }, {}, 400],
    [{ ...base, reason: 'invalid-reason' }, {}, 400],
    [base, { isBase64Encoded: true }, 400],
  ]) {
    assert.equal((await handler(request(data, overrides))).statusCode, status);
  }
});

test('a mismatched host receipt or an unauthenticated identity does not report success', async () => {
  const mismatched = createHandler({ apiId: 'profile', unassign: async () => ({
    success: true, kind: 'COD_UNASSIGNED', orderId: 'foreign-order', offerId: base.offerId,
    attempt: 1, operationId: 'CA:fixture', holdReleased: true, replayed: false,
  }) });
  assert.equal((await mismatched(request(base))).statusCode, 503);
  const forbidden = createHandler({ apiId: 'profile', unassign: async () => {
    throw Object.assign(Error('private diagnostic'), { statusCode: 401 });
  } });
  const result = await forbidden(request(base));
  assert.equal(result.statusCode, 401);
  assert.equal(JSON.parse(result.body).code, 'AUTH_REQUIRED');
  assert.doesNotMatch(result.body, /private diagnostic/);
});

test('full-cash unassignment releases the original hold once and preserves the order and funding for redispatch', async () => {
  const f = await ready({ platformGoodsDiscount: 700 });
  const orderKey = { PK: 'ORDER#order1', SK: 'META' };
  const jobKey = { orderId: 'order1', SK: 'METADATA' };
  const liveKey = { driverId: 'driver1' };
  const walletKey = { walletId: 'WALLET#DRIVER#driver1', sk: 'META' };
  const commitmentKey = { orderId: 'order1', sk: 'FULL_CASH_FUNDING_COMMITMENT' };
  const order = f.get('WizzOrders', orderKey);
  order.status = order.orderStatus = 'arrived_at_store';
  const funding = structuredClone(f.get('staging-Holds', commitmentKey));
  const price = structuredClone(order.financialSnapshot);
  const body = { ...base, offerId: order.financialAcceptance.offerId };
  let driverId = 'driver2';
  const unassign = createStagingCodReassignment({
    db: f.db, now: () => f.time, reassignmentWindowSeconds: 300, maximumWaves: 4,
    enableDeliveryFunding: true, enableFullCash: true,
    authenticate: async () => ({ kind: 'DRIVER', subjectId: driverId }),
  }).unassign;
  const handler = createHandler({ apiId: 'profile', unassign: async (input, token) => {
    assert.equal(token, 'valid.dev.token');
    return unassign(input);
  } });
  const foreign = await handler(request(body));
  assert.equal(foreign.statusCode, 403);
  assert.equal(f.get('WizzOrders', orderKey).driverId, 'driver1');
  driverId = 'driver1';
  f.get('WizzOrders', orderKey).merchantHandover = { state: 'HANDED_TO_DRIVER' };
  assert.equal((await handler(request(body))).statusCode, 409);
  delete f.get('WizzOrders', orderKey).merchantHandover;
  const first = await handler(request(body));
  assert.equal(first.statusCode, 200);
  const receipt = JSON.parse(first.body);
  assert.equal(receipt.replayed, false);
  assert.equal(receipt.holdReleased, true);
  assert.equal(f.get('WizzOrders', orderKey).status, 'ready_for_pickup');
  assert.deepEqual(f.get('WizzOrders', orderKey).financialSnapshot, price);
  assert.deepEqual(f.get('staging-Holds', commitmentKey), funding);
  assert.equal(f.get('WizzDriverLiveState_staging', liveKey).currentOrderId, null);
  assert.equal(f.get('staging-Wallets', walletKey).lockedBalance, 0);
  const job = f.get('WizzDispatchJobs_staging', jobKey);
  assert.equal(job.status, 'searching');
  assert.deepEqual(job.financialRedispatch, { waveNumber: 2, excludeDriverIds: ['driver1'], operationId: receipt.operationId });
  const savedWallet = structuredClone(f.get('staging-Wallets', walletKey));
  const retry = JSON.parse((await handler(request(body))).body);
  assert.equal(retry.replayed, true);
  assert.equal(retry.operationId, receipt.operationId);
  assert.deepEqual(f.get('staging-Wallets', walletKey), savedWallet);
});
