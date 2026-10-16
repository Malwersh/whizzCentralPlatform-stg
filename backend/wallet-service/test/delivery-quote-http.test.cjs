'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const sdk = require('@aws-sdk/lib-dynamodb');
const { fixture } = require('./helpers/delivery-quote-fixture.cjs');
const quoteRuntime = require('../dist/deliveryQuote');
const { createStagingDeliveryQuoteRateLimiter } = require('../dist/deliveryQuoteRateLimit');
const { createStagingDeliveryRouting } = require('../dist/regionCoverage');
const file = path.resolve(__dirname, '../../../../wizzuser-stg/backend/src/functions/delivery-quotes/index.js');
const { accountGuard } = require(path.resolve(path.dirname(file), '../create-order/account-guard'));
function setup() {
 const f = fixture(), exports = {}, env = { DELIVERY_QUOTES_ENABLED: 'true', AWS_REGION: 'us-east-1', ENVIRONMENT: 'staging',
  USERS_TABLE: 'WizzUser_users_staging', USER_POOL_ID: 'us-east-1_TpyyrVkEE', USER_POOL_CLIENT_ID: 'client',
  DELIVERY_QUOTE_MAX_PER_MINUTE: '2',
  MAPBOX_SECRET_ARN: 'arn:aws:secretsmanager:us-east-1:699561669180:secret:wizz/staging/maps/mapbox-ABCdef' };
 const rates = new Map();
 const rateDb = { send: async cmd => {
  if (cmd instanceof sdk.GetCommand) return { Item: structuredClone(rates.get(cmd.input.Key.pk)) };
  const actions = cmd.input.TransactItems;
  if (f.rateFailure || f.profile.deletionRequestId) throw Error('quota store unavailable');
  const row = actions[1].Put.Item; rates.set(row.pk, structuredClone(row)); return {};
 } };
 const modules = {
  '@aws-sdk/client-dynamodb': { DynamoDBClient: class {} },
  '@aws-sdk/lib-dynamodb': { ...sdk, DynamoDBDocumentClient: { from: () => f.db } },
  '@aws-sdk/client-secrets-manager': { SecretsManagerClient: class {} }, '../create-order/account-guard': { accountGuard },
  'aws-sdk': { CognitoIdentityServiceProvider: class { getUser() { return { promise: async () => {
    if (f.badToken) throw Object.assign(Error('bad'), { code: 'NotAuthorizedException' });
    return { Username: 'username', UserAttributes: [{ Name: 'sub', Value: 'sub1' }] };
  } }; } } },
  './runtime': { createStagingDeliveryQuoteRateLimiter: o => createStagingDeliveryQuoteRateLimiter({ ...o, db: rateDb, now: () => f.time }), DynamoDBClient: class {}, DynamoDBDocumentClient: { from: () => f.db }, GetCommand: sdk.GetCommand,
   SecretsManagerClient: class {}, GetUserCommand: class {},
   CognitoIdentityProviderClient: class { async send() {
     if (f.badToken) throw Object.assign(Error('bad'), { code: 'NotAuthorizedException' });
     return { Username: 'username', UserAttributes: [{ Name: 'sub', Value: 'sub1' }] };
   } }, createStagingDeliveryQuotes: o => quoteRuntime.createStagingDeliveryQuotes({ ...o, now: () => f.time }),
   createStagingSecretDeliveryRouting: o => createStagingDeliveryRouting({ db: o.db, getAccessToken: async () => 'synthetic',
    profile: o.profile, ttlSeconds: o.ttlSeconds, timeoutMs: 1000, now: () => f.time,
    fetchImpl: async () => { f.providerCalls++; return new Response(JSON.stringify({ code: 'Ok', routes: [{ distance: 2100, duration: 300 }] })); } }) }
 };
 vm.runInNewContext(fs.readFileSync(file, 'utf8'), { exports, process: { env }, Buffer, require: n => {
   assert.ok(n in modules, n); return modules[n];
 } });
 const claims = { sub: 'sub1', iss: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_TpyyrVkEE', token_use: 'access', client_id: 'client' };
 const headers = { Authorization: 'Bearer header.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.signature', 'X-Customer-Id': 'u1' };
 f.invoke = async (patch = {}) => { const response = await exports.handler({ httpMethod: 'POST', headers,
   body: JSON.stringify({ branchId: 'b1', addressId: 'a1', requestId: '12345678-1234-4123-8123-123456789abc' }), ...patch });
  return { ...response, json: JSON.parse(response.body) };
 };
 f.headers = headers; f.env = env; return f;
}
test('HTTP create/read use actual guard and quote service with fenced transactions, no secrets in reply', async () => {
 const f = setup(), first = await f.invoke(); assert.equal(first.statusCode, 200, first.body);
 assert.equal(first.json.quote.customerDeliveryFee.minorAmount, 3100000); assert.equal(f.saved.size, 1);
 const repeat = await f.invoke(); assert.equal(repeat.json.quote.quoteId, first.json.quote.quoteId); assert.equal(f.providerCalls, 1);
 const read = await f.invoke({ httpMethod: 'GET', queryStringParameters: { quoteId: first.json.quote.quoteId } });
 assert.equal(read.statusCode, 200); assert.equal(read.headers['Cache-Control'], 'no-store');
 for (const secret of ['fences', 'subjectId', 'binding', 'sub1', 'owner1', 'accessToken']) assert.ok(!read.body.includes(secret));
});
test('HTTP denies anonymous, invalid live token, foreign profile and guest before routing', async () => {
 for (const headers of [{}, { 'X-Customer-Id': 'u1' }, { ...setup().headers, 'X-Customer-Id': 'foreign' }, { ...setup().headers, 'X-Customer-Id': 'guest' }]) {
  const f = setup(), r = await f.invoke({ headers }); assert.ok([401, 403].includes(r.statusCode), r.body); assert.equal(f.providerCalls, 0);
 }
 const f = setup(); f.badToken = true; assert.equal((await f.invoke()).statusCode, 401); assert.equal(f.providerCalls, 0);
});
test('HTTP disabled or wrong environment does not read or call provider', async () => {
 for (const patch of [{ DELIVERY_QUOTES_ENABLED: 'false' }, { AWS_REGION: 'eu-west-1' }, { USERS_TABLE: 'prod-users' }]) {
  const f = setup(); Object.assign(f.env, patch); assert.equal((await f.invoke()).statusCode, 503);
  assert.equal(f.calls.length, 0); assert.equal(f.providerCalls, 0);
 }
});
test('HTTP rejects client-supplied price identity coordinates, malformed JSON, oversized body and bad read query', async () => {
 for (const body of ['{', 'x'.repeat(2049), JSON.stringify({ branchId: 'b1', addressId: 'a1', requestId: '12345678-1234-4123-8123-123456789abc', deliveryFee: 0 })]) {
  const f = setup(), r = await f.invoke({ body }); assert.equal(r.statusCode, 400); assert.equal(f.providerCalls, 0);
 }
 const f = setup(); assert.equal((await f.invoke({ httpMethod: 'GET', queryStringParameters: { quoteId: 'id', userId: 'foreign' } })).statusCode, 400);
});
test('HTTP expiry and reference changes force explicit renewal instead of silently recalculating', async () => {
 const f = setup(), first = await f.invoke(); f.time += 120001;
 const expired = await f.invoke({ httpMethod: 'GET', queryStringParameters: { quoteId: first.json.quote.quoteId } });
 assert.equal(expired.statusCode, 409); assert.equal(expired.json.code, 'QUOTE_EXPIRED'); assert.equal(f.providerCalls, 1);
 const other = setup(); await other.invoke(); other.branch.acceptingOrders = false;
 const invalidated = await other.invoke(); assert.equal(invalidated.statusCode, 409); assert.equal(invalidated.json.code, 'QUOTE_INVALIDATED');
});
test('HTTP sanitizes service failures and CORS does not grant data access', async () => {
 const f = setup(); f.failTable = 'staging-PlatformStaff'; const r = await f.invoke(); assert.equal(r.statusCode, 503);
 assert.ok(!r.body.includes('sensitive')); const cors = await f.invoke({ httpMethod: 'OPTIONS', headers: {} }); assert.equal(cors.statusCode, 204);
});
test('new Lambda loads from its package alone with bundled SDKs and stays closed by default', () => {
 const os = require('node:os'), { execFileSync } = require('node:child_process');
 const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'quote-http-package-'));
 try {
  fs.mkdirSync(path.join(folder, 'delivery-quotes'));
  fs.mkdirSync(path.join(folder, 'create-order'));
  for (const name of ['index.js', 'runtime.js']) fs.copyFileSync(path.join(path.dirname(file), name), path.join(folder, 'delivery-quotes', name));
  fs.copyFileSync(path.resolve(path.dirname(file), '../create-order/account-guard.js'), path.join(folder, 'create-order/account-guard.js'));
  const script = `require(${JSON.stringify(path.join(folder, 'delivery-quotes/index.js'))}).handler({httpMethod:'POST'}).then(r=>{if(r.statusCode!==503)process.exit(1)})`;
  execFileSync(process.execPath, ['-e', script], { cwd: folder, env: { AWS_REGION: 'us-east-1', DELIVERY_QUOTES_ENABLED: 'false' }, timeout: 10000 });
 } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test('HTTP quotas reject a fresh route with 429 but permit replay and GET at the limit', async () => {
 const f=setup();f.env.DELIVERY_QUOTE_MAX_PER_MINUTE='1';
 const first=await f.invoke();assert.equal(first.statusCode,200);
 assert.equal((await f.invoke()).statusCode,200);
 assert.equal((await f.invoke({httpMethod:'GET',queryStringParameters:{quoteId:first.json.quote.quoteId}})).statusCode,200);
 const body=JSON.stringify({branchId:'b1',addressId:'a1',requestId:'22345678-1234-4123-8123-123456789abc'});
 const limited=await f.invoke({body});assert.equal(limited.statusCode,429);assert.equal(limited.json.code,'QUOTE_RATE_LIMITED');
 assert.equal(Number(limited.headers['Retry-After']),limited.json.retryAfterSeconds);assert.equal(f.providerCalls,1);
 f.time+=60000;assert.equal((await f.invoke({body})).statusCode,200);assert.equal(f.providerCalls,2);
});
test('HTTP missing or invalid quota configuration and quota storage failure never call routing', async () => {
 for(const value of ['', '0', '121', '1.5', '1e1']) {const f=setup();f.env.DELIVERY_QUOTE_MAX_PER_MINUTE=value;
 assert.equal((await f.invoke()).statusCode,503);assert.equal(f.providerCalls,0);}
 const f=setup();f.rateFailure=true;const response=await f.invoke();assert.equal(response.statusCode,503);
 assert.equal(response.json.code,'QUOTE_SERVICE_UNAVAILABLE');assert.equal(f.providerCalls,0);
});
