const assert = require('node:assert/strict');
const { test } = require('node:test');
const { setup } = require('./helpers/quote-order-handler-fixture.cjs');
const { quoteHash } = require('../dist/deliveryQuoteRecord');

const template = require('../../../infrastructure/production/order-financial-runtime.template.json');
const lambdaEnv = template.Resources.Function.Properties.Environment.Variables;
const rollout = { schemaVersion: 1, accountId: '746727375268', region: 'us-east-1', scopes: [] };
const customer = require('../../../infrastructure/production/wallet-identity-bindings.json').identities.customer;
const cashPolicyKey = { pk: 'OPERATIONAL_SETTINGS#CASH_ROUNDING', sk: 'CURRENT' };
const production = {
  ...Object.fromEntries(Object.entries(lambdaEnv).filter(([,v])=>typeof v==='string')),
  STAGE: 'production', ENVIRONMENT: 'production', AWS_REGION: 'us-east-1',
  WIZZORDERS_TABLE: 'wizz-production-Orders', BUSINESSES_TABLE: 'wizz-production-Merchants',
  USERS_TABLE: 'wizz-production-Customers', ADDRESSES_TABLE: 'wizz-production-Addresses',
  USER_POOL_ID: customer.poolId, USER_POOL_CLIENT_ID: customer.clientId,
  DELIVERY_QUOTE_MODE: 'REQUIRED', COMMERCIAL_PRICING_MODE: 'REQUIRED',
  FINANCIAL_SETTLEMENT_MODEL: 'FULL_CASH_AT_DELIVERY_V1', FINANCE_GENERAL_RELEASE_MODE: 'REQUIRED',
  FINANCE_ROLLOUT_CONFIG: JSON.stringify(rollout), FINANCE_ROLLOUT_SHA256: quoteHash(rollout),
  MERCHANT_RESPONSE_MODE: 'REQUIRED', DELIVERY_PROMOTION_MODE: 'REQUIRED',
};

test('production checkout stores the order, quote consumption and merchant response in one transaction', async t => {
  const previous = process.env;
  process.env = { ...production };
  t.after(() => { process.env = previous; });
  const f = await setup('REQUIRED', false, { production: true });
  f.enableCommercial();
  f.env.CASH_ROUNDING_POLICY_MODE = 'REQUIRED';
  const cashRecord = {
    ...cashPolicyKey, version: 1,
    values: {
      schemaVersion: 1, enabled: true, incrementIqd: 250, mode: 'UP',
      minimumServiceFeeIqd: 250, minimumConflict: 'NEXT_COLLECTIBLE_TOTAL',
    },
  };
  f.commercialRecords.set('staging-PlatformStaff|' + JSON.stringify(cashPolicyKey), cashRecord);
  const preview = await f.invoke({ action: 'preview_commercial' });
  assert.equal(preview.statusCode, 200, JSON.stringify(preview.json));
  assert.equal(preview.json.commercial.customerTotal.minorAmount % 250000, 0);
  const accepted = { commercialConsent: {
    digest: preview.json.commercial.digest,
    customerTotalMinor: preview.json.commercial.customerTotal.minorAmount,
  } };
  const before = f.transactions.length;
  const order = await f.invoke(accepted);
  assert.equal(order.statusCode, 201, JSON.stringify(order.json));
  assert.equal(f.orders.size, 1);
  assert.equal(f.merchantEvents.size, 1);
  const savedOrder = [...f.orders.values()][0];
  assert.equal(savedOrder.commercialPricing.cashRounding.policy.version, cashRecord.version);
  assert.equal(savedOrder.commercialPricing.cashRounding.customerTotal.minorAmount,
    preview.json.commercial.customerTotal.minorAmount);
  const writes = f.transactions.slice(before).find(tx => tx.TransactItems.some(op => op.Put?.TableName === production.WIZZORDERS_TABLE));
  assert.ok(writes.TransactItems.some(op => op.Update?.TableName === 'wizz-production-DeliveryQuotes'));
  assert.ok(writes.TransactItems.some(op =>
    op.ConditionCheck?.TableName === 'wizz-production-PlatformStaff' &&
    op.ConditionCheck.Key.pk === cashPolicyKey.pk && op.ConditionCheck.Key.sk === cashPolicyKey.sk));
  assert.ok(writes.TransactItems.some(op => op.Put?.TableName === 'wizz-production-WalletLifecycle' &&
    op.Put.Item.kind === 'MERCHANT_RESPONSE' && op.Put.Item.orderId === order.json.orderId));
  assert.ok(writes.TransactItems.every(op => Object.values(op)[0].TableName.startsWith('wizz-production-')));
  assert.ok(f.productionReads.every(table => table.startsWith('wizz-production-')));
  const replay = await f.invoke(accepted);
  assert.equal(replay.statusCode, 200, JSON.stringify(replay.json));
  assert.equal(replay.json.orderId, order.json.orderId);
  assert.equal(f.merchantEvents.size, 1);
});

test('production transfer pause rejects confirmation without consuming the quote or scheduling a response', async t => {
  const previous = process.env;
  process.env = { ...production };
  t.after(() => { process.env = previous; });
  const f = await setup('REQUIRED', false, { production: true });
  f.enableCommercial();
  const preview = await f.invoke({ action: 'preview_commercial' });
  assert.equal(preview.statusCode, 200);
  const accepted = { commercialConsent: {
    digest: preview.json.commercial.digest,
    customerTotalMinor: preview.json.commercial.customerTotal.minorAmount,
  } };
  f.beforeTransaction = tx => {
    if (tx.TransactItems.some(op => op.Put?.TableName === production.WIZZORDERS_TABLE)) {
      f.branch.orderIntakeTransferExpiresAt = f.time + 60000;
    }
  };
  const result = await f.invoke(accepted);
  assert.equal(result.statusCode, 409, JSON.stringify(result.json));
  assert.equal(result.json.code, 'QUOTE_INVALIDATED');
  assert.equal(f.orders.size, 0);
  assert.equal(f.merchantEvents.size, 0);
  assert.equal([...f.saved.values()][0].consumption, undefined);
});

for (const restriction of ['ordersBlocked', 'platformSuspended']) {
  test(`production checkout catches ${restriction} set after preview`, async t => {
    const previous = process.env;
    process.env = { ...production };
    t.after(() => { process.env = previous; });
    const f = await setup('REQUIRED', false, { production: true });
    f.enableCommercial();
    const preview = await f.invoke({ action: 'preview_commercial' });
    assert.equal(preview.statusCode, 200);
    const accepted = { commercialConsent: {
      digest: preview.json.commercial.digest,
      customerTotalMinor: preview.json.commercial.customerTotal.minorAmount,
    } };
    f.beforeTransaction = tx => {
      if (tx.TransactItems.some(op => op.Put?.TableName === production.WIZZORDERS_TABLE)) {
        f.branch[restriction] = true;
      }
    };
    const result = await f.invoke(accepted);
    assert.equal(result.statusCode, 409, JSON.stringify(result.json));
    assert.equal(f.orders.size, 0);
    assert.equal(f.merchantEvents.size, 0);
    assert.equal([...f.saved.values()][0].consumption, undefined);
  });
}

test('production writer rejects a staging authentication binding before reading account data', async t => {
  const previous = process.env;
  process.env = { ...production };
  t.after(() => { process.env = previous; });
  const f = await setup('REQUIRED', false, { production: true });
  f.env.USER_POOL_ID = 'us-east-1_TpyyrVkEE';
  const result = await f.invoke();
  assert.equal(result.statusCode, 503);
  assert.equal(result.json.code, 'QUOTE_NOT_CONFIGURED');
  assert.deepEqual(f.productionReads, []);
  assert.equal(f.orders.size, 0);
});

test('production merchant worker rejects staging scheduler and stream events', async t => {
  const previous = process.env;
  process.env = { ...production, FINANCIAL_COD_ACCOUNT_ID: '746727375268' };
  t.after(() => { process.env = previous; });
  const { handler } = require('../dist/merchantResponseRuntime');
  await assert.rejects(handler({ source: 'aws.events', account: '699561669180', region: 'us-east-1',
    'detail-type': 'Scheduled Event' }), /INVALID_MERCHANT_RESPONSE_TRIGGER/);
  await assert.rejects(handler({ source: 'wizz.merchant-order-stream', orderId: 'order1' }),
    /INVALID_MERCHANT_RESPONSE_TRIGGER/);
  const result = await handler({ Records: [{
    eventName: 'INSERT', eventSource: 'aws:dynamodb',
    eventSourceARN: 'arn:aws:dynamodb:us-east-1:699561669180:table/WizzOrders/stream/example',
    dynamodb: { NewImage: { merchantResponsePolicy: { M: { schemaVersion: { N: '1' } } },
      orderId: { S: 'order1' } } },
  }] });
  assert.deepEqual(result, { processed: 0, review: 0, deferred: 0 });
});
