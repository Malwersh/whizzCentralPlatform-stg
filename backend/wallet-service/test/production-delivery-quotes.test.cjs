const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { createRequire, wrap } = require('node:module');
const path = require('node:path');
const { test } = require('node:test');
const { runInThisContext } = require('node:vm');
const { fixture } = require('./helpers/delivery-quote-fixture.cjs');
const { checkoutTables } = require('../dist/checkoutTables');
const runtime = require('../dist/deliveryQuoteRuntime');

const source = path.resolve(__dirname, '../../../../wizzuser-stg/backend/src/production/customer-delivery-quotes.js');
const moduleScope = { exports: {} };
const relativeRequire = createRequire(source);
runInThisContext(wrap(readFileSync(source, 'utf8')), { filename: source })(
  moduleScope.exports,
  id => id === '../functions/delivery-quotes/runtime' ? runtime : relativeRequire(id),
  moduleScope, source, path.dirname(source),
);
const { createHandler } = moduleScope.exports;
const requestId = '12345678-1234-4123-8123-123456789abc';
const financial = require('../../../infrastructure/production/order-financial-runtime.template.json');
const variables = financial.Resources.Function.Properties.Environment.Variables;
const env = {
  ...Object.fromEntries(Object.entries(variables).filter(([, value]) => typeof value === 'string')),
  ENVIRONMENT: 'production',
  AWS_REGION: 'us-east-1',
  USERS_TABLE: 'wizz-production-Customers',
  USER_POOL_ID: variables.CUSTOMER_USER_POOL_ID,
  USER_POOL_CLIENT_ID: variables.CUSTOMER_CLIENT_ID,
  DELIVERY_OPERATIONS_MODE: 'CENTRAL',
  DELIVERY_QUOTE_MAX_PER_MINUTE: '5',
  MAPBOX_SECRET_ARN: 'arn:aws:secretsmanager:us-east-1:746727375268:secret:production/finance/mapbox/server-routing-aBc123',
};
const operations = {
  pk: 'OPERATIONAL_SETTINGS#DELIVERY_OPERATIONS',
  sk: 'CURRENT',
  version: 1,
  values: {
    quoteMaxPerCustomerPerMinute: 5,
    driverOfferTtlSeconds: 60,
    driverPositionMaxAgeSeconds: 120,
    reassignmentWindowSeconds: 300,
    maximumWaves: 4,
  },
};

function scenario() {
  const f = fixture();
  const tables = checkoutTables(env);
  f.extraLookup = (table, key) =>
    table === tables.policy && key?.pk === operations.pk ? operations : undefined;
  const token = 'header.' + Buffer.from(JSON.stringify({
    iss: 'https://cognito-idp.us-east-1.amazonaws.com/' + env.USER_POOL_ID,
    client_id: env.USER_POOL_CLIENT_ID, token_use: 'access', sub: 'sub1',
  })).toString('base64url') + '.signature';
  const services = {
    ...runtime,
    createStagingDeliveryQuotes: options => runtime.createStagingDeliveryQuotes({ ...options, now: () => f.time }),
    createStagingDeliveryQuoteRateLimiter: options => runtime.createStagingDeliveryQuoteRateLimiter({
      ...options, now: () => f.time,
    }),
    createStagingSecretDeliveryRouting: options => runtime.createStagingSecretDeliveryRouting({
      ...options, now: () => f.time,
      fetchImpl: async url => {
        assert.equal(url.hostname, 'api.mapbox.com');
        assert.equal(url.searchParams.get('access_token'), 'pk.fixture.signature');
        f.providerCalls++;
        return new Response(JSON.stringify({ code: 'Ok', routes: [{ distance: 2100, duration: 300 }] }));
      },
    }),
  };
  const credentials = [];
  const deps = {
    db: f.db, env, services,
    cognito: { send: async command => {
      assert.equal(command.input.AccessToken, token);
      return { Username: 'sub1', UserAttributes: [{ Name: 'sub', Value: 'sub1' }] };
    } },
    secrets: { send: async command => {
      credentials.push(command.input);
      return {
        ARN: env.MAPBOX_SECRET_ARN, VersionStages: ['AWSCURRENT'],
        SecretString: '{"accessToken":"pk.fixture.signature"}',
      };
    } },
  };
  const run = createHandler(deps);
  const event = {
    requestContext: { stage: 'production' }, resource: '/delivery-quotes', httpMethod: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'X-Customer-Id': 'u1' },
    body: JSON.stringify({ branchId: 'b1', addressId: 'a1', requestId }),
  };
  return { f, tables, credentials, deps, run, event };
}

test('production endpoint authenticates, calculates, saves and retrieves the same quote', async () => {
  const previous = process.env;
  process.env = env;
  try {
    const { run, event, credentials, f, tables } = scenario();
    const creation = await run(event);
    assert.equal(creation.statusCode, 200, creation.body);
    const result = JSON.parse(creation.body);
    assert.equal(result.quote.customerDeliveryFee.minorAmount, 3100000);
    const reading = await run({ ...event, httpMethod: 'GET', queryStringParameters: { quoteId: requestId } });
    assert.equal(reading.statusCode, 200, reading.body);
    assert.deepEqual(JSON.parse(reading.body), result);
    assert.deepEqual(credentials, [{ SecretId: env.MAPBOX_SECRET_ARN, VersionStage: 'AWSCURRENT' }]);
    assert.equal(f.providerCalls, 1);
    const writes = f.transactions.flatMap(transaction => transaction.TransactItems).filter(op => op.Put);
    assert.equal(writes.length, 2);
    assert.ok(writes.every(op => op.Put.TableName === tables.quotes));
    assert.ok(f.calls.every(call => call.TableName.startsWith('wizz-production-')));
  } finally {
    process.env = previous;
  }
});

test('foreign state, missing session and malformed input fail before requesting a road route', async () => {
  const previous = process.env;
  process.env = env;
  try {
    const { run, event, deps, f, credentials } = scenario();
    const wrongBinding = createHandler({ ...deps, env: { ...env, MAPBOX_SECRET_ARN: 'staging-secret' } });
    assert.equal((await wrongBinding(event)).statusCode, 503);
    assert.equal((await run({ ...event, requestContext: { stage: 'staging' } })).statusCode, 404);
    assert.equal((await run({ ...event, headers: {} })).statusCode, 401);
    assert.equal((await run({ ...event, body: '[]' })).statusCode, 400);
    assert.equal((await run({ ...event, body: JSON.stringify({ addressId: 'a1', branchId: 'b1', requestId, fee: 1 }) })).statusCode, 400);
    assert.equal((await run({ ...event, httpMethod: 'GET', queryStringParameters: { quoteId: requestId },
      multiValueQueryStringParameters: { quoteId: [requestId, requestId] } })).statusCode, 400);
    assert.equal(f.transactions.length, 0);
    assert.deepEqual(credentials, []);
  } finally {
    process.env = previous;
  }
});
