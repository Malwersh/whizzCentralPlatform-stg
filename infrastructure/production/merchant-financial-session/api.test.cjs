'use strict';

const assert = require('node:assert/strict');
const {test} = require('node:test');
const {createHandler, path, sessionTable} = require('./api.cjs');
const {identities} = require('../wallet-identity-bindings.json');

const owner = '11111111-1111-4111-8111-111111111111';
const phone = '+9647800000000';
const branch = 'branch-test';
const deviceId = 'device_12345678901234567890123';
const secret = 'arn:aws:secretsmanager:us-east-1:746727375268:secret:wizz/production/merchant/otp-test12';
const now = Date.parse('2026-11-24T18:00:00.000Z');
const issuer = 'https://cognito-idp.us-east-1.amazonaws.com/' + identities.merchant.poolId;
const client = identities.merchant.clientId;
const env = {ENVIRONMENT: 'production', AWS_REGION: 'us-east-1',
  FINANCIAL_SESSION_TABLE: sessionTable, OTP_SECRET_ARN: secret};
process.env.ENVIRONMENT = 'production';

function fixture({verified = true, apiKey = 'simulated-provider-key', envOverride = {}} = {}) {
  const rows = new Map();
  const transactions = [];
  const sent = [];
  let secretLoads = 0;
  const db = {async send(command) {
    const input = command.input;
    if (command.constructor.name === 'GetCommand') {
      if (input.TableName === 'wizz-production-Merchants') {
        if (input.Key.businessId !== branch) return {};
        return {Item: {businessId: branch, ownerId: owner, cognitoUserId: owner, status: 'approved'}};
      }
      if (input.TableName === 'wizz-production-AccountDeletion') return {};
      assert.equal(input.TableName, sessionTable);
      return {Item: rows.get(input.Key.pk + '/' + input.Key.sk)};
    }
    assert.equal(command.constructor.name, 'TransactWriteCommand');
    transactions.push(input.TransactItems);
    for (const {Put} of input.TransactItems) {
      if (!Put) continue;
      assert.equal(Put.TableName, sessionTable);
      rows.set(Put.Item.pk + '/' + Put.Item.sk, Put.Item);
    }
    return {};
  }};
  const attrs = Object.entries({sub: owner, phone_number: phone, phone_number_verified: String(verified)})
    .map(([Name, Value]) => ({Name, Value}));
  const handler = createHandler({
    db, now: () => now, env: {...env, ...envOverride}, deduplicateGuards: items => items,
    verifyAccess: async token => {
      if (token !== 'valid-access') throw Error('test: invalid access token');
      return {iss: issuer, sub: owner, client_id: client, token_use: 'access', exp: now / 1000 + 60};
    },
    verifyId: async token => ({iss: issuer, sub: token === 'valid-id' ? owner : 'another-owner',
      aud: client, token_use: 'id', exp: now / 1000 + 60}),
    getUser: async () => ({Username: 'merchant-test', UserAttributes: attrs}),
    getIdentity: async () => ({Username: 'merchant-test', Enabled: true, UserStatus: 'CONFIRMED', UserAttributes: attrs}),
    getSecret: async arn => {
      assert.equal(arn, secret);
      secretLoads++;
      return {apiKey, hmacKey: 'x'.repeat(64)};
    },
    sendCode: async (destination, code, key) => {
      assert.equal(key, apiKey);
      sent.push({destination, code});
    },
  });
  const post = (input, overrides = {}) => handler({
    resource: path, requestContext: {stage: 'production'}, httpMethod: 'POST',
    headers: {'access-token': 'valid-access', authorization: 'Bearer valid-id'},
    body: JSON.stringify(input), ...overrides,
  });
  return {post, sent, rows, transactions, secretLoads: () => secretLoads};
}

const startRequest = {action: 'FINANCIAL_START', branchId: branch, deviceId};

test('owner challenge writes only hashes, rate limits sends and supports financial session revocation', async () => {
  const f = fixture();
  const started = await f.post(startRequest);
  assert.equal(started.statusCode, 200, started.body);
  const challenge = JSON.parse(started.body);
  assert.equal(challenge.delivery, 'SENT');
  assert.equal(f.secretLoads(), 1);
  assert.deepEqual(Object.keys(challenge).sort(), ['challengeId','delivery','expiresAt','resendAfter']);
  assert.equal(f.sent[0].destination, phone);
  assert.match(f.sent[0].code, /^\d{6}$/);
  assert.equal((await f.post(startRequest)).statusCode, 429);

  const unlocked = await f.post({...startRequest, action: 'FINANCIAL_UNLOCK',
    challengeId: challenge.challengeId, code: f.sent[0].code});
  assert.equal(unlocked.statusCode, 200, unlocked.body);
  const sessionToken = JSON.parse(unlocked.body).token;
  for (const row of f.rows.values()) {
    assert.equal(row.token, undefined);
    assert.equal(row.code, undefined);
    assert.equal(row.phone, undefined);
  }
  const lock = await f.post({...startRequest, action: 'FINANCIAL_LOCK', token: sessionToken});
  assert.deepEqual(JSON.parse(lock.body), {locked: true});
  const session = [...f.rows.values()].find(row => row.sk === 'SESSION');
  assert.equal(session.expiresAt, 0);
  assert.equal(session.tokenHash, '');
  assert.deepEqual(f.transactions[0].slice(0, 3).map(item => item.ConditionCheck.TableName),
    ['wizz-production-Merchants','wizz-production-AccountDeletion','wizz-production-AccountDeletion']);
});

test('missing, foreign, mismatched and unverified credentials cannot dispatch a code', async () => {
  const f = fixture();
  assert.equal((await f.post(startRequest, {headers: {}})).statusCode, 401);
  assert.equal((await f.post(startRequest, {headers: {'access-token': 'fake', authorization: 'Bearer valid-id'}})).statusCode, 401);
  assert.equal((await f.post(startRequest, {headers: {'access-token': 'valid-access', authorization: 'Bearer foreign-id'}})).statusCode, 401);
  assert.equal((await f.post(startRequest, {requestContext: {stage: 'staging'}})).statusCode, 404);
  assert.equal((await f.post({...startRequest, branchId: 'foreign'})).statusCode, 403);
  assert.equal((await f.post({...startRequest, phone})).statusCode, 400);
  assert.equal((await f.post({...startRequest, action: 'REQUEST_PAYOUT'})).statusCode, 400);
  const disabled = fixture({verified: false});
  assert.equal((await disabled.post(startRequest)).statusCode, 403);
  assert.equal(f.transactions.length + disabled.transactions.length, 0);
  assert.equal(f.secretLoads() + disabled.secretLoads(), 0);
});

test('invalid production provider bindings fail before sessions are written', async () => {
  const other = fixture({envOverride: {OTP_SECRET_ARN: secret.replace('746727375268','699561669180')}});
  assert.equal((await other.post(startRequest)).statusCode, 503);
  assert.equal(other.secretLoads(), 0);
  const unconfigured = fixture({apiKey: ''});
  assert.equal((await unconfigured.post(startRequest)).statusCode, 503);
  assert.equal(unconfigured.transactions.length, 0);
  assert.equal(unconfigured.sent.length, 0);
});
