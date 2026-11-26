'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createHash, randomUUID} = require('node:crypto');
const {GetCommand, TransactWriteCommand} = require('@aws-sdk/lib-dynamodb');
const {cashAccountingDeduplicate} = require('../../../backend/wallet-service/src/cashboxAccounting');
const {createHandler: createVerification, path: verificationPath, sessionTable} = require('../merchant-financial-session/api.cjs');
const {createHandler, paths, productionDb} = require('./api.cjs');
const {identities} = require('../wallet-identity-bindings.json');

const now = Date.parse('2026-11-24T15:00:00Z');
const ownerId = '3e04a35e-98d8-4328-8384-ad05db7b6ee1';
const employeeId = '00b4e70b-319e-4a83-a6d9-5bf08e112c1e';
const branchId = 'branch-merchant';
const deviceId = 'device_12345678901234567890123';
const platform = 'wizz-production-MerchantPlatform';
const env = {
  ENVIRONMENT: 'production', PLATFORM_ENVIRONMENT: 'production', AWS_REGION: 'us-east-1',
  PLATFORM_SESSION_POLICY: 'VALID_SESSION', FINANCIAL_SESSION_TABLE: sessionTable,
  OTP_SECRET_ARN: 'arn:aws:secretsmanager:us-east-1:746727375268:secret:wizz/production/merchant/otp-Ab12cD',
  WALLETS_TABLE: 'wizz-production-Wallets', LEDGER_TABLE: 'wizz-production-LedgerEntries',
  HOLDS_TABLE: 'wizz-production-Holds', TOPUP_REQUESTS_TABLE: 'wizz-production-TopupRequests',
  AUDIT_LOG_TABLE: 'wizz-production-AuditLog', IDEMPOTENCY_KEYS_TABLE: 'wizz-production-IdempotencyKeys',
  WALLET_LIFECYCLE_TABLE: 'wizz-production-WalletLifecycle', ORDERS_TABLE: 'wizz-production-Orders',
  ACCOUNT_DELETION_TABLE: 'wizz-production-AccountDeletion',
  MERCHANTS_TABLE: 'wizz-production-Merchants', STAFF_TABLE: 'wizz-production-PlatformStaff',
  DRIVER_LIVE_STATE_TABLE: 'wizz-production-DriverLiveState', DISPATCH_JOBS_TABLE: 'wizz-production-DispatchJobs',
  DRIVERS_TABLE: 'wizz-production-Drivers', WAVE_OFFERS_TABLE: 'wizz-production-WaveOffers',
  OFFER_JOURNEY_TABLE: 'wizz-production-OfferJourney', DELIVERY_QUOTES_TABLE: 'wizz-production-DeliveryQuotes',
};
for (const [key, value] of Object.entries(env)) process.env[key] = value;

const ownerHeaders = {Authorization: 'Bearer id', 'Access-Token': 'access'};
const staffHeaders = {Authorization: 'Bearer staff'};
const event = (resource, headers, input = {}, method = 'GET') => ({
  resource, httpMethod: method, headers, requestContext: {stage: 'production'},
  ...(method === 'GET' ? {queryStringParameters: input} : {body: JSON.stringify(input)}),
});

function fixture({roles = ['finance_viewer'], approvalLimit} = {}) {
  let otp, mfa = true, active = true;
  const rows = new Map();
  const operations = [];
  const key = (table, id) => table + JSON.stringify(Object.entries(id).sort());
  function put(table, id, row) {rows.set(key(table, id), row);}
  put('wizz-production-Merchants', {businessId: branchId}, {
    businessId: branchId, businessName: 'مطعم تجريبي', ownerId, cognitoUserId: ownerId,
    status: 'approved', version: 1,
  });
  put('wizz-production-PlatformStaff', {pk: 'EMPLOYEE#' + employeeId, sk: 'PROFILE'}, {
    employeeId, name: 'أمين صندوق الاختبار', version: 1, status: 'ACTIVE',
    roles, scope: {allRegions: true}, ...(approvalLimit === undefined ? {} : {approvalLimit}),
  });
  const coverage = {pk:'SYSTEM#MERCHANT_ACCRUAL_INDEX', sk:'COVERAGE', kind:'MERCHANT_ACCRUAL_INDEX_COVERAGE',
    schemaVersion: 1, status: 'COMPLETE'};
  put(platform, {pk: coverage.pk, sk: coverage.sk}, {
    ...coverage, digest: createHash('sha256').update(JSON.stringify(coverage, Object.keys(coverage).sort())).digest('hex'),
  });
  const db = {async send(command) {
    operations.push(command);
    const v = command.input;
    if (command.constructor.name === 'TransactWriteCommand') {
      for (const op of v.TransactItems) {
        const item = op.Put || op.ConditionCheck;
        assert.match(item.TableName, /^wizz-production-/);
        if (op.Put) put(item.TableName, {pk: item.Item.pk, sk: item.Item.sk}, item.Item);
      }
      return {};
    }
    assert.match(v.TableName, /^wizz-production-/);
    if (command.constructor.name === 'GetCommand') return {Item: rows.get(key(v.TableName, v.Key))};
    if (command.constructor.name === 'ScanCommand') {
      assert.equal(v.TableName, 'wizz-production-Merchants');
      return {Items: [rows.get(key(v.TableName, {businessId: branchId}))]};
    }
    if (command.constructor.name === 'QueryCommand') return {Items: []};
    throw Error('Unexpected command');
  }};
  const claim = (audience, sub, type) => {
    const {poolId, clientId} = identities[audience];
    return {
      sub, iss: 'https://cognito-idp.us-east-1.amazonaws.com/' + poolId, [type === 'id' ? 'aud' : 'client_id']: clientId,
      token_use: type, exp: now / 1000 + 3600, auth_time: now / 1000 - 900, username: 'username',
    };
  };
  const attributes = Object.entries({sub: ownerId, phone_number: '+9647800000000', phone_number_verified: 'true'})
    .map(([Name, Value]) => ({Name, Value}));
  const deps = {
    db, env, now: () => now, deduplicate: cashAccountingDeduplicate, deduplicateGuards: cashAccountingDeduplicate,
    verifyAccess: async token => {assert.equal(token, 'access'); return claim('merchant', ownerId, 'access');},
    verifyId: async token => {assert.equal(token, 'id'); return claim('merchant', ownerId, 'id');},
    verifyStaff: async token => {assert.equal(token, 'staff'); return claim('admin', employeeId, 'access');},
    getUser: async () => ({Username: 'username', UserAttributes: attributes}),
    getIdentity: async () => ({Username: 'username', UserStatus: 'CONFIRMED', Enabled: active, UserAttributes: attributes}),
    getStaff: async () => ({Username: 'username', UserStatus: 'CONFIRMED', Enabled: active,
      UserMFASettingList: mfa ? ['SOFTWARE_TOKEN_MFA'] : [], UserAttributes: [{Name: 'sub', Value: employeeId}]}),
    getSecret: async () => ({apiKey: 'mock', hmacKey: 'h'.repeat(32)}),
    sendCode: async (phone, code) => {assert.equal(phone, '+9647800000000'); otp = code;},
  };
  return {
    owner: createHandler(deps, 'owner', env),
    staff: createHandler(deps, 'staff', env),
    operations, denyMfa: () => {mfa = false;}, deactivate: () => {active = false;},
    async unlock() {
      const call = input => createVerification(deps)(event(verificationPath, ownerHeaders, {deviceId, branchId, ...input}, 'POST'));
      const challenge = await call({action: 'FINANCIAL_START'});
      assert.equal(challenge.statusCode, 200, challenge.body);
      const result = await call({action: 'FINANCIAL_UNLOCK', challengeId: JSON.parse(challenge.body).challengeId, code: otp});
      assert.equal(result.statusCode, 200, result.body);
      return {...ownerHeaders, 'X-Financial-Session': JSON.stringify({deviceId, token: JSON.parse(result.body).token})};
    },
  };
}

test('owner can open the production account with its verified financial session', async () => {
  const f = fixture();
  const query = {branchId, view: 'merchant-account', fromLocalDate: '2026-11-01', throughLocalDate: '2026-11-24'};
  const locked = await f.owner(event(paths.owner, ownerHeaders, query));
  assert.equal(locked.statusCode, 403);
  assert.equal(f.operations.length, 0);
  const headers = await f.unlock();
  const account = await f.owner(event(paths.owner, headers, query));
  assert.equal(account.statusCode, 200, account.body);
  assert.deepEqual(JSON.parse(account.body).items, []);
  f.deactivate();
  const revoked = await f.owner(event(paths.owner, headers, query));
  assert.equal(revoked.statusCode, 401, revoked.body);
});

test('staff can list branches and account data using the same verified admin session', async () => {
  const f = fixture();
  const result = await f.staff(event(paths.branches, staffHeaders));
  assert.equal(result.statusCode, 200, result.body);
  assert.deepEqual(JSON.parse(result.body), {items: [{businessId: branchId, businessName: 'مطعم تجريبي'}]});
  const schedule = await f.staff(event(paths.staff, staffHeaders, {branchId}));
  assert.equal(schedule.statusCode, 200, schedule.body);
  assert.equal(JSON.parse(schedule.body).current, null);
  f.denyMfa();
  assert.equal((await f.staff(event(paths.branches, staffHeaders))).statusCode, 403);
});

test('production routes reject staging paths, unrelated identities and caller-supplied session data', async () => {
  const f = fixture();
  const time = event(paths.owner, ownerHeaders, {branchId});
  assert.equal((await f.owner({...time, requestContext: {stage: 'staging'}})).statusCode, 404);
  assert.equal((await f.owner(event(paths.staff, ownerHeaders, {branchId}))).statusCode, 404);
  assert.equal((await f.staff(event(paths.staff, ownerHeaders, {branchId}))).statusCode, 401);
  assert.equal((await f.owner(event(paths.owner, ownerHeaders, {branchId, financialAccess: 'caller'}, 'POST'))).statusCode, 400);
  assert.equal(f.operations.length, 0);
});

test('production cashbook staff can approve their own opening and receipt within their approval limit', async () => {
  const f = fixture({roles:['finance_operator','finance_approver'], approvalLimit:1200});
  const branchId = 'COMPANY_CASHBOOK';
  const code = 'CASH-TEST';
  const post = (action, fields) => f.staff(event(paths.staff, staffHeaders, {
    action, branchId, code, ...fields, requestId: randomUUID(),
  }, 'POST'));
  async function expectSuccess(response) {
    const result = await response;
    assert.equal(result.statusCode, 200, result.body);
    return JSON.parse(result.body);
  }
  const account = () => expectSuccess(f.staff(event(paths.staff, staffHeaders, {branchId, code, view:'cash-account'})));
  await expectSuccess(post('CREATE_CASHBOX', {name:'صندوق الاختبار', location:'بغداد',
    reason:'تهيئة حساب الاختبار', custodianEmployeeId:employeeId, status:'ACTIVE'}));
  const request = (type, amountIqd, details) => expectSuccess(post('REQUEST_CASH_OPERATION', {
    type, amountIqd, counterparty:'الشركة', reason:'حركة اختبار موثقة', ...details,
  }));
  const opening = await request('OPENING', 1000, {reference:'OPEN-TEST', custodianEmployeeId:employeeId});
  assert.equal((await account()).balance, null);
  const approve = (operation, confirmedPhysicalOperation) => post('POST_CASH_OPERATION', {
    operationId:operation.operationId, version:operation.version, confirmedPhysicalOperation,
  });
  const refused = await approve(opening.operation, false);
  assert.equal(JSON.parse(refused.body).error, 'PAYOUT_CASH_OPERATION_INVALID');
  const bookedOpening = await expectSuccess(approve(opening.operation, true));
  assert.equal(bookedOpening.operation.requestedBy, employeeId);
  assert.equal(bookedOpening.operation.postedBy, employeeId);
  assert.equal((await account()).balance.balanceIqd, 1000);

  const receipt = await request('RECEIPT', 200, {reference:'BANK-TEST', account:'COMPANY_BANK'});
  assert.equal((await account()).balance.balanceIqd, 1000);
  const bookedReceipt = await expectSuccess(approve(receipt.operation, true));
  assert.equal(bookedReceipt.operation.postedBy, employeeId);
  assert.ok(bookedReceipt.operation.journalId);
  assert.equal((await account()).balance.balanceIqd, 1200);

  const large = await request('RECEIPT', 1201, {reference:'LARGE-TEST', account:'COMPANY_BANK'});
  const limited = await approve(large.operation, true);
  assert.equal(limited.statusCode, 403);
  assert.equal(JSON.parse(limited.body).error, 'PAYOUT_APPROVAL_LIMIT_OR_PERMISSION_REQUIRED');
  assert.equal((await account()).balance.balanceIqd, 1200);
});

test('production table names are resolved before atomic ownership guards are merged', async () => {
  const calls = [];
  const db = productionDb({send: command => {calls.push(command);}}, cashAccountingDeduplicate);
  for (const name of ['WizzDispatchJobs_staging', 'wizz-production-DispatchJobs']) {
    await db.send(new GetCommand({TableName: name, Key: {orderId: 'order-1', SK: 'METADATA'},
      ProjectionExpression: 'orderId,dispatchJobId,dispatchCycle'}));
    assert.equal(calls.pop().input.TableName, 'wizz-production-DispatchJobs');
  }
  const guard = name => ({ConditionCheck: {TableName: name, Key: {businessId: branchId}, ConditionExpression: 'attribute_exists(businessId)'}});
  await db.send(new TransactWriteCommand({TransactItems: [
    guard('WhizzMerchants_Businesses'), guard('wizz-production-Merchants'),
  ]}));
  assert.equal(calls[0].input.TransactItems.length, 1);
  assert.equal(calls[0].input.TransactItems[0].ConditionCheck.TableName, 'wizz-production-Merchants');
  assert.throws(() => db.send(new GetCommand({TableName: 'unexpected-environment', Key: {businessId: branchId}})),
    /SETTLEMENT_TABLE_NOT_CONFIGURED/);
});
