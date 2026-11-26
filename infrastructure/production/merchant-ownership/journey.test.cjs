'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { DynamoDBClient, CreateTableCommand } = require('@aws-sdk/client-dynamodb');
const sdk = require('@aws-sdk/lib-dynamodb');
const { listOwnedBusinesses } = require('../merchant-branches/owned-businesses.cjs');
const { DynamoDBDocumentClient, DeleteCommand, GetCommand, PutCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { createHandler, path } = require('./api.cjs');
const { createHandler: createWorker } = require('./notice-worker.cjs');
const { identities } = require('../wallet-identity-bindings.json');
const { lifecycleRequests, lifecycleDecision } = require('../merchant-directory/lifecycle.cjs');
const { outbox, eventId, pending } = require('./notice-record.cjs');
const { write } = require('../../../backend/staff-service/audit-trail');

const testEndpoint = process.env.MERCHANT_OWNERSHIP_LOCAL_DDB;
const owner = 'aaaaaaaa-0000-0000-0000-000000000001';
const recipient = 'aaaaaaaa-0000-0000-0000-000000000002';
const requestId = 'aaaaaaaa-0000-0000-0000-000000000003';
const stranger = 'aaaaaaaa-0000-0000-0000-000000000004';
const employeeId = 'aaaaaaaa-0000-0000-0000-000000000005';
const organizationId = 'test-org';
const businessId = 'test-branch';
const phones = { [owner]: '+9647000000000', [recipient]: '+9647111111111', [stranger]: '+9647222222222' };
const people = Object.keys(phones);
const aware = Date.parse('2026-11-26T05:00:00Z');
const clock = () => aware;
const policy = { pk: 'OPERATIONAL_SETTINGS#MERCHANT_ONBOARDING', sk: 'CURRENT',
  version: 3, policyVersion: 'policy-3',
  values: { partnershipReady: true, termsVersion: 'terms-1', termsTextAr: 'اتفاقية الشراكة المعتمدة' } };
const actor = { status: 'ACTIVE', roles: ['merchant_reviewer', 'finance_approver'], scope: { allRegions: true }, employeeId };
const tableName = suffix => 'wizz-production-' + suffix;

test('production invites, consent, verification, final review, owner access and both completion notifications use the same persisted request', {
  skip: !testEndpoint && 'requires a disposable local DynamoDB instance',
}, async () => {
  assert.match(testEndpoint, /^http:\/\/127\.0\.0\.1:\d{4,5}$/);
  const client = new DynamoDBClient({ endpoint: testEndpoint, region: 'us-east-1',
    credentials: { accessKeyId: 'localtest', secretAccessKey: 'local-test' }, maxAttempts: 1 });
  const db = DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });
  const createTable = (name, keys, index) => client.send(new CreateTableCommand({
    TableName: tableName(name), BillingMode: 'PAY_PER_REQUEST',
    KeySchema: keys.map((key, i) => ({ AttributeName: key, KeyType: i ? 'RANGE' : 'HASH' })),
    AttributeDefinitions: [...keys, ...(index ? [index] : [])].map(key => ({ AttributeName: key, AttributeType: 'S' })),
    ...(index ? { GlobalSecondaryIndexes: [{ IndexName: index === 'ownerId' ? 'ownerId-index' : 'SubjectIdIndex',
      KeySchema: [{ AttributeName: index, KeyType: 'HASH' }], Projection: { ProjectionType: 'ALL' } }] } : {}),
  }));
  await Promise.all(Object.entries({
    MerchantPlatform: ['pk', 'sk'], AccountDeletion: ['pk', 'sk'], PlatformStaff: ['pk', 'sk'], Merchants: ['businessId'],
    WalletNotifications: ['eventId'], Wallets: ['walletId', 'sk'], Orders: ['PK', 'SK'], Holds: ['orderId', 'sk'],
    TopupRequests: ['topupId', 'sk'], IdempotencyKeys: ['idempotencyKey', 'sk'],
  }).map(([table, keys]) => createTable(table, keys, table === 'Merchants' ? 'ownerId' : undefined)).concat([createTable('PushDeviceTokens', ['token'], 'subjectId')]));
  const put = (table, Item) => db.send(new PutCommand({ TableName: tableName(table), Item }));
  const get = async (table, Key) => (await db.send(new GetCommand({ TableName: tableName(table), Key, ConsistentRead: true }))).Item;
  const branch = { businessId, organizationId, brandId: 'test-brand', ownerId: owner, cognitoUserId: owner,
    status: 'approved', businessName: 'مطعم الاختبار', updatedAt: new Date(clock()).toISOString(), acceptingOrders: true };
  await Promise.all([
    put('Merchants', branch),
    put('MerchantPlatform', { pk: 'PERSON#' + owner, sk: 'ORGANIZATION#' + organizationId, subjectId: owner, organizationId, version: 1 }),
    put('PlatformStaff', policy),
    put('PlatformStaff', { pk: 'EMPLOYEE#' + employeeId, sk: 'PROFILE', ...actor, version: 1 }),
    put('Merchants', { ...branch, businessId: 'unrelated-branch', organizationId: 'unrelated-org' }),
    put('MerchantPlatform', { pk: 'PERSON#' + owner, sk: 'BRAND#' + branch.brandId, brandId: branch.brandId,
      subjectId: owner, organizationId, version: 1 }),
    put('MerchantPlatform', { pk: 'MERCHANT_CORRECTIONS#' + businessId, sk: 'POSITION',
      kind: 'MERCHANT_CORRECTION_POSITION', branchId: businessId, ownerId: owner, version: 4,
      creditIqd: 1100, creditPaidIqd: 1100, debtIqd: 300, debtRecoveredIqd: 300 }),
    ...people.map(sub => put('MerchantPlatform', { pk: 'PERSON#' + sub, sk: 'PROFILE', subjectId: sub,
      phoneNumber: phones[sub], name: sub === recipient ? 'مالك جديد' : 'حساب تجريبي', version: 1 })),
    put('PushDeviceTokens', { token: 'personal-recipient-device', subjectId: recipient, app: 'merchant' }),
    put('PushDeviceTokens', { token: 'personal-owner-device', subjectId: owner, app: 'merchant' }),
    put('PushDeviceTokens', { token: 'BRANCH_DEVICE#shared', subjectId: recipient, app: 'merchant', branchDeviceId: 'device' }),
  ]);
  const { poolId, clientId } = identities.merchant;
  const claims = (sub, token_use) => ({ sub, token_use, iss: 'https://cognito-idp.us-east-1.amazonaws.com/' + poolId,
    ...(token_use === 'access' ? { client_id: clientId } : { aud: clientId }),
    exp: clock() / 1000 + 600, auth_time: clock() / 1000 - 3600 });
  const identity = sub => ({ Username: sub, Enabled: true, UserStatus: 'CONFIRMED',
    UserAttributes: [{ Name: 'sub', Value: sub }, { Name: 'phone_number', Value: phones[sub] },
      { Name: 'phone_number_verified', Value: 'true' }] });
  const sms = [];
  const api = createHandler({
    db, now: clock, verifyAccess: sub => claims(sub, 'access'), verifyId: sub => claims(sub, 'id'), getUser: identity,
    getIdentity: username => identity(people.find(sub => phones[sub] === username) || username),
    getSecret: () => ({ hmacKey: 'h'.repeat(64), apiKey: 'local-only' }),
    sendCode: (phone, code) => sms.push({ phone, code }),
    env: { ENVIRONMENT: 'production', AWS_REGION: 'us-east-1',
      OTP_SECRET_ARN: 'arn:aws:secretsmanager:us-east-1:746727375268:secret:wizz/production/merchant/otp-aabbcc' },
  });
  const call = async (sub, options = {}) => {
    const { input, query, status = 200, id = sub, stage = 'production' } = options;
    const response = await api({ resource: path, requestContext: { stage }, httpMethod: input ? 'POST' : 'GET',
      headers: sub ? { 'Access-Token': sub, Authorization: 'Bearer ' + id } : {},
      body: input ? JSON.stringify(input) : undefined, queryStringParameters: query });
    assert.equal(response.statusCode, status, response.body);
    return JSON.parse(response.body);
  };
  const act = (sub, action, fields = {}, status) => call(sub, { input: { action, organizationId, requestId, ...fields }, status });
  const query = { organizationId, requestId };
  const stream = 'local-stream';
  const sent = [];
  const worker = createWorker({ db, stream, clock, messaging: () => ({ send: data => sent.push(data) }) });
  const push = action => worker({ Records: [{ eventSource: 'aws:dynamodb', eventSourceARN: stream, eventName: 'INSERT',
    dynamodb: { SequenceNumber: '1', Keys: { eventId: { S: eventId(requestId, action) } } } }] },
  { getRemainingTimeInMillis: () => 30000 });

  await call(null, { status: 401 });
  await call(owner, { id: recipient, status: 401 });
  await call(owner, { stage: 'staging', status: 404 });
  const preview = await act(owner, 'PREVIEW_RECIPIENT', { businessId, recipientPhone: phones[recipient] });
  assert.equal(preview.recipient.name, 'مالك جديد');
  await act(owner, 'START', { recipientPhone: phones[recipient], expectedRecipientId: stranger }, 409);
  const candidate = { recipientPhone: phones[recipient], expectedRecipientId: recipient };
  await act(owner, 'START', candidate);
  await act(owner, 'START', candidate);
  assert.equal((await get('Merchants', { businessId })).orderIntakeTransferRequestId, requestId);
  assert.equal((await get('WalletNotifications', { eventId: eventId(requestId, 'ownership_invitation') })).deliveryStatus, pending);
  await call(stranger, { query, status: 404 });
  const list = await call(recipient, { query: { incoming: '1' } });
  assert.equal(list.invitations[0].branchNames[0], branch.businessName);
  await push('ownership_invitation');
  await push('ownership_invitation');
  assert.deepEqual(sent.map(notice => notice.token), ['personal-recipient-device']);
  assert.equal(sent[0].data.type, 'ownership_invitation');

  const details = await call(recipient, { query });
  const consent = { digest: details.request.digest, agreementVersion: details.agreement.version };
  await act(owner, 'ACCEPT', consent, 403);
  await act(recipient, 'ACCEPT', { ...consent, agreementVersion: 'stale-terms' }, 409);
  await act(recipient, 'ACCEPT', consent);
  await push('ownership_accepted');
  assert.deepEqual(sent.map(notice => notice.token), ['personal-recipient-device', 'personal-owner-device']);
  assert.equal((await lifecycleRequests(db, actor, {}, clock())).items[0].status, 'AWAITING_REVIEW');
  assert.equal((await lifecycleRequests(db, actor, query, clock())).blockers[0].code, 'TRANSFER_DESTINATION_VERIFICATION_REQUIRED');

  await act(owner, 'START_DESTINATION', {}, 403);
  const { destination } = await act(recipient, 'START_DESTINATION');
  assert.equal(sms[0].phone, phones[recipient]);
  assert.equal(destination.status, 'CODE_SENT');
  assert.equal(destination.code, undefined);
  await act(recipient, 'START_DESTINATION', {}, 429);
  await act(recipient, 'VERIFY_DESTINATION', { challengeId: destination.challengeId, code: sms[0].code });
  const ready = await lifecycleRequests(db, actor, query, clock());
  assert.equal(ready.canApproveSettlement, true);
  assert.equal(ready.blockers[0].code, 'TRANSFER_SETTLEMENT_APPROVAL_REQUIRED');
  const ctx = { db, guard: () => ({ConditionCheck: {
    TableName: tableName('PlatformStaff'), Key: { pk: 'EMPLOYEE#' + employeeId, sk: 'PROFILE' },
    ConditionExpression: '#v=:version', ExpressionAttributeNames: { '#v': 'version' },
    ExpressionAttributeValues: { ':version': 1 },
  }}), audit: (...args) => write(tableName('PlatformStaff'), actor, ...args) };
  const approved = await lifecycleDecision(ctx, actor, { ...query, decision: 'APPROVE_SETTLEMENT', reason: 'مطابقة هاتف التسويات',
    ...ready.settlementEvidence, baseVersion: ready.baseVersion }, clock);
  assert.equal(approved.settlement, 'APPROVED');

  const review = await lifecycleRequests(db, actor, query, clock());
  assert.equal(review.canApprove, true);
  const decision = { ...query, decision: 'APPROVE', reason: 'مراجعة نهائية مكتملة', baseVersion: review.baseVersion };
  const before = await listOwnedBusinesses({ db, sdk, sub: owner });
  assert.deepEqual(before.businesses.map(item => item.businessId).sort(), [businessId, 'unrelated-branch']);
  // A payable that appears after the reviewer opens the form must stop the commit.
  await put('Holds', { orderId: 'local-hold', sk: 'MERCHANT_PAYABLE',
    walletId: 'WALLET#MERCHANT#' + businessId, status: 'LOCKED_PENDING_SETTLEMENT' });
  await assert.rejects(lifecycleDecision(ctx, actor, decision, clock), { message: 'TRANSFER_FINANCIAL_BLOCKERS' });
  assert.equal((await get('Merchants', { businessId })).ownerId, owner);
  assert.equal((await get('Merchants', { businessId })).orderIntakeTransferRequestId, requestId);
  assert.equal(await get('WalletNotifications', { eventId: eventId(requestId, 'ownership_completed_new') }), undefined);
  await put('Holds', { orderId: 'local-hold', sk: 'MERCHANT_PAYABLE',
    walletId: 'WALLET#MERCHANT#' + businessId, status: 'RELEASED' });

  const closureKey={pk:'BUSINESS_LIFECYCLE#MERCHANT#'+businessId,sk:'META'};
  await put('AccountDeletion',{...closureKey,requestId:'closure-request',subjectId:owner,state:'CLOSING'});
  await assert.rejects(lifecycleDecision(ctx, actor, decision, clock));
  assert.equal((await get('Merchants',{businessId})).ownerId,owner);
  assert.equal((await get('AccountDeletion',closureKey)).state,'CLOSING');
  assert.equal(await get('WalletNotifications',{eventId:eventId(requestId,'ownership_completed_new')}),undefined);
  await db.send(new DeleteCommand({TableName:tableName('AccountDeletion'),Key:closureKey}));

  assert.deepEqual(await lifecycleDecision(ctx, actor, decision, clock), { status: 'COMPLETED' });
  assert.deepEqual(await lifecycleDecision(ctx, actor, decision, clock), { status: 'COMPLETED' });
  const transferred = await get('Merchants', { businessId });
  assert.equal(transferred.ownerId, recipient);
  assert.equal(transferred.cognitoUserId, recipient);
  assert.equal(transferred.orderIntakeTransferRequestId, undefined);
  assert.equal(transferred.orderIntakeTransferExpiresAt, undefined);
  assert.equal(transferred.acceptingOrders, true);
  const oldAccess = await listOwnedBusinesses({ db, sdk, sub: owner });
  const newAccess = await listOwnedBusinesses({ db, sdk, sub: recipient });
  assert.deepEqual(oldAccess.businesses.map(item => item.businessId), ['unrelated-branch']);
  assert.deepEqual(newAccess.businesses.map(item => item.businessId), [businessId]);
  const position = await get('MerchantPlatform', { pk: 'MERCHANT_CORRECTIONS#' + businessId, sk: 'POSITION' });
  assert.equal(position.ownerId, recipient);
  assert.equal(position.creditIqd, 1100);
  assert.equal(position.creditPaidIqd, 1100);
  for (const action of ['ownership_completed_previous', 'ownership_completed_new']) {
    assert.equal((await get('WalletNotifications', { eventId: eventId(requestId, action) })).deliveryStatus, pending);
    assert.deepEqual(await push(action), { batchItemFailures: [] });
    assert.deepEqual(await push(action), { batchItemFailures: [] });
  }
  assert.deepEqual(sent.slice(2).map(notice => notice.token), ['personal-owner-device', 'personal-recipient-device']);
  assert.notEqual(sent[2].notification.body, sent[3].notification.body);
  assert.deepEqual((await lifecycleRequests(db, actor, {}, clock())).items, []);
  const audit = await db.send(new QueryCommand({ TableName: tableName('PlatformStaff'),
    KeyConditionExpression: 'pk=:audit', ExpressionAttributeValues: { ':audit': 'AUDIT' } }));
  assert.deepEqual(audit.Items.map(row => row.action).sort(),
    ['MERCHANT_OWNERSHIP_SETTLEMENT_APPROVED', 'MERCHANT_OWNERSHIP_TRANSFER_APPROVED']);
});
