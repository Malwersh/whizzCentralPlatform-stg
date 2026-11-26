'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createApi, tables } = require('./api.cjs');
const { identities } = require('../wallet-identity-bindings.json');
const STAFF = 'wizz-production-PlatformStaff';
const actorId = 'aaaaaaaa-0000-0000-0000-000000000001';
const ownerId = 'aaaaaaaa-0000-0000-0000-000000000002';
const draftId = 'aaaaaaaa-0000-0000-0000-000000000003';
const requestId = 'aaaaaaaa-0000-0000-0000-000000000004';
const assetId = 'aaaaaaaa-0000-0000-0000-000000000005';
const submittedAt = '2026-11-24T10:00:00.000Z';
const queueKey = submittedAt + '#' + requestId;
const person = 'PERSON#' + ownerId;
const path = '/staff/merchants';
const testRegion = 'region-4';

function fixture(roles = ['merchant_reviewer'], regionIds = [testRegion]) {
  const rows = new Map();
  const transactions = [];
  const key = (table, value) => table + JSON.stringify(value);
  const put = (table, index, data) => rows.set(key(table, index), { ...index, ...data });
  const read = (table, index) => rows.get(key(table, index));
  const writeTransaction = items => {
    transactions.push(items);
    for (const op of items) {
      if (!op.Put) continue;
      const { Item, TableName } = op.Put;
      const tableKey = Item.pk ? { pk: Item.pk, sk: Item.sk } : { businessId: Item.businessId };
      put(TableName, tableKey, Item);
    }
  };
  const db = {
    async send(command) {
      const { TableName, Key, TransactItems } = command.input;
      if (command.constructor.name === 'GetCommand') return { Item: read(TableName, Key) };
      if (command.constructor.name === 'QueryCommand') {
        return { Items: [...rows.values()].filter(row => row.pk === 'REVIEW#MERCHANT') };
      }
      if (command.constructor.name === 'ScanCommand') {
        return { Items: [...rows.entries()].filter(([k]) => k.startsWith(TableName)).map(([, row]) => row) };
      }
      assert.equal(command.constructor.name, 'TransactWriteCommand');
      assert.ok(TransactItems.every(op => (op.Put || op.ConditionCheck || op.Update).TableName.startsWith('wizz-production-')));
      writeTransaction(TransactItems);
      return {};
    },
  };
  put(STAFF, { pk: 'EMPLOYEE#' + actorId, sk: 'PROFILE' }, {
    employeeId: actorId, status: 'ACTIVE', roles, version: 2,
    scope: { allRegions: regionIds === null, regionIds: regionIds || [] },
  });
  put(tables.platform, { pk: 'REVIEW#MERCHANT', sk: queueKey }, {
    requestId, draftId, subjectId: ownerId, regionId: testRegion, draftVersion: 2, status: 'SUBMITTED',
  });
  const agreement = { version: 'terms-1', textAr: 'اتفاقية الشراكة المعتمدة', acceptedAt: submittedAt, subjectId: ownerId };
  put(STAFF, { pk: 'OPERATIONAL_SETTINGS#MERCHANT_ONBOARDING', sk: 'VERSION#3' }, {
    policyVersion: 3, values: { partnershipReady: true, termsVersion: agreement.version, termsTextAr: agreement.textAr,
      types: [{ id: 'RESTAURANT', labelAr: 'مطعم', labelEn: 'Restaurant' }] },
  });
  const submission = { requestId, draftVersion: 1, submittedAt, agreement };
  put(tables.platform, { pk: person, sk: 'SUBMISSION#' + requestId }, { ...submission, subjectId: ownerId, draftId });
  put(tables.platform, { pk: person, sk: 'PROFILE' }, { name: 'حساب الاختبار' });
  put(tables.platform, { pk: person, sk: 'DRAFT#' + draftId }, {
    subjectId: ownerId, draftId, reviewStatus: 'SUBMITTED', version: 2, regionId: testRegion,
    regionPath: ['region-1', 'region-2', 'region-3', testRegion], regionNames: ['العراق', 'النجف', 'المناذرة', 'مركز المناذرة'],
    name: 'فرع الاختبار', businessTypeId: 'RESTAURANT', model: 'FOOD', organizationId: 'organization-1', brandId: 'brand-1',
    address: 'عنوان فرع الاختبار', configVersion: 3, latitude: 32, longitude: 44, submission,
    registrationCertificateAssetId: assetId,
  });
  put(tables.platform, { pk: person, sk: 'ASSET#' + assetId }, {
    assetId, subjectId: ownerId, draftId, kind: 'REGISTRATION_CERTIFICATE', status: 'READY',
    contentType: 'application/pdf', sha256: 'a'.repeat(64), key: 'persons/' + ownerId + '/drafts/' + draftId + '/' + assetId,
  });
  const { clientId, poolId } = identities.admin;
  const now = () => Date.parse('2026-11-24T11:00:00Z');
  const api = createApi({
    db, now, verifyAccess: async token => {
      if (token !== 'test') throw new Error();
      return { sub: actorId, username: 'test', token_use: 'access', client_id: clientId,
        iss: 'https://cognito-idp.us-east-1.amazonaws.com/' + poolId, exp: now() / 1000 + 20, auth_time: now() / 1000 - 20 };
    },
    liveIdentity: async () => ({ Enabled: true, UserStatus: 'CONFIRMED', UserMFASettingList: ['SOFTWARE_TOKEN_MFA'],
      UserAttributes: [{ Name: 'sub', Value: actorId }] }),
    signDocument: async asset => 'https://example.com/' + asset.assetId,
    regions: { validate: async () => ({ regionId: testRegion, checks: [] }) },
  });
  return {
    call: (route, method = 'GET', body, query, token = 'test') => api({
      path: path + route, httpMethod: method, requestContext: { stage: 'production' },
      headers: token ? { Authorization: 'Bearer ' + token } : {}, body: body && JSON.stringify(body),
      queryStringParameters: query,
    }),
    put, read, transactions,
  };
}
const input = decision => ({ decision, queueKey, baseVersion: 2, reason: 'تمت مراجعة الطلب' });

const controlledBranch = {
  businessId: 'business_reviewed', ownerId, cognitoUserId: ownerId, status: 'approved',
  regionId: testRegion, isActive: true, onboardingSchemaVersion: 2, onboardingComplete: true,
  acceptingOrders: true, updatedAt: submittedAt,
};

test('operational control uses the same staff session and atomically fences branch, lifecycle and audit', async () => {
  const f = fixture();
  const {businessId} = controlledBranch;
  f.put(tables.businesses, {businessId}, controlledBranch);
  const {control} = JSON.parse((await f.call('/branch', 'GET', null, {businessId})).body);
  assert.deepEqual(control.actions, ['PAUSE_ORDERS','SUSPEND']);
  const command = {businessId, action:'PAUSE_ORDERS', baseRevision:control.revision, reason:'إيقاف مؤقت للمراجعة'};
  const blocked = await f.call('/control', 'POST', command, undefined, null);
  assert.equal(blocked.statusCode, 401);
  const result = await f.call('/control', 'POST', command);
  assert.equal(result.statusCode, 200, result.body);
  assert.deepEqual(JSON.parse(result.body).branch,
    {businessId, platformSuspended:false, ordersBlocked:true, acceptingOrders:false, isActive:true});
  const tx = f.transactions[0];
  assert.equal(tx.length, 5);
  assert.ok(tx.some(op => op.ConditionCheck?.Key.pk === 'EMPLOYEE#' + actorId));
  assert.ok(tx.some(op => op.ConditionCheck?.Key.pk === 'BUSINESS_LIFECYCLE#MERCHANT#' + businessId));
  assert.ok(tx.some(op => op.ConditionCheck?.Key.pk === 'ACCOUNT_LIFECYCLE#MERCHANT#' + ownerId));
  const update = tx.find(op => op.Update).Update;
  assert.match(update.UpdateExpression, /REMOVE #pauseId, #pauseUntil/);
  assert.ok(Object.values(update.ExpressionAttributeNames).includes('lastStatusUpdate'));
  assert.ok(!Object.values(update.ExpressionAttributeNames).includes('commercialAgreementId'));
  assert.equal(tx.find(op => op.Put).Put.Item.reason, command.reason);
});

test('control rejects stale states, missing rights and ownership-transfer or deletion locks', async () => {
  const reviewer = fixture();
  const {businessId} = controlledBranch;
  reviewer.put(tables.businesses, {businessId}, controlledBranch);
  const read = async () => JSON.parse((await reviewer.call('/branch','GET',null,{businessId})).body).control;
  const {revision: baseRevision} = await read();
  const input = {businessId, action:'SUSPEND', baseRevision, reason:'إيقاف مؤقت للمراجعة'};
  reviewer.put(tables.businesses, {businessId}, {...controlledBranch, lastStatusUpdate: 'newer'});
  assert.equal((await reviewer.call('/control','POST',input)).statusCode, 409);
  for (const lock of [{orderIntakeTransferRequestId: 'pending'}, {orderIntakeDeletionRequestId: 'pending'}]) {
    reviewer.put(tables.businesses, {businessId}, {...controlledBranch, ...lock});
    const state = await read();
    assert.deepEqual(state.actions, []);
    assert.equal(JSON.parse((await reviewer.call('/control','POST',{...input,baseRevision:state.revision})).body).error,
      'BRANCH_LIFECYCLE_LOCKED');
  }
  for (const [roles, regions, code] of [
    [['merchant_manager'], [testRegion], 403],
    [['merchant_reviewer'], ['elsewhere'], 404],
  ]) {
    const staff = fixture(roles, regions);
    staff.put(tables.businesses, {businessId}, controlledBranch);
    assert.equal((await staff.call('/control','POST',input)).statusCode, code);
    assert.equal(staff.transactions.length, 0);
  }
  assert.equal(reviewer.transactions.length, 0);
});

test('production review verifies the original submission and creates exactly one offline owner branch', async () => {
  const f = fixture(['bootstrap_admin'], null);
  const queue = JSON.parse((await f.call('/applications')).body);
  assert.equal(queue.items.length, 1);
  assert.equal(queue.items[0].name, 'فرع الاختبار');
  assert.equal(queue.items[0].subjectId, undefined);
  const response = await f.call('/applications/review', 'POST', input('APPROVE'));
  assert.equal(response.statusCode, 200, response.body);
  const { businessId } = JSON.parse(response.body);
  const created = f.read(tables.businesses, { businessId });
  assert.equal(created.ownerId, ownerId);
  assert.equal(created.isActive, false);
  assert.equal(created.operatingStatus, 'OFFLINE');
  assert.equal(created.onboardingComplete, false);
  assert.equal(f.transactions[0].some(x => x.ConditionCheck?.Key.sk === 'SUBMISSION#' + requestId), true);
  assert.equal(f.transactions[0].some(x => x.ConditionCheck?.Key.sk === 'ASSET#' + assetId), true);
  assert.deepEqual(JSON.parse((await f.call('/applications/review', 'POST', input('APPROVE'))).body), {
    businessId, status: 'APPROVED',
  });
  assert.equal(f.transactions.length, 1);
  assert.equal(JSON.parse((await f.call('/branch', 'GET', null, { businessId })).body).agreement.status, 'UNASSIGNED');
  assert.equal(JSON.parse((await f.call('/directory')).body).items.length, 1);
  assert.equal(JSON.parse((await f.call('/applications')).body).items.length, 0);
});

test('document access and decisions obey the staff region and privilege', async () => {
  const reviewer = fixture();
  const link = await reviewer.call('/application-asset', 'GET', null, { queueKey, assetId });
  assert.equal(link.statusCode, 200, link.body);
  assert.equal(reviewer.transactions[0].some(x => x.Put?.Item.action === 'MERCHANT_APPLICATION_DOCUMENT_VIEWED'), true);
  assert.equal((await reviewer.call('/applications', 'GET', null, null, null)).statusCode, 401);
  const f = fixture(['merchant_reviewer'], ['other']);
  assert.equal((await f.call('/application-asset', 'GET', null, { queueKey, assetId })).statusCode, 404);
  assert.equal((await f.call('/applications/review', 'POST', input('APPROVE'))).statusCode, 404);
  const editor = fixture(['merchant_manager']);
  assert.equal((await editor.call('/applications/review', 'POST', input('APPROVE'))).statusCode, 403);
  assert.equal(editor.transactions.length, 0);
});

test('a request for corrections retains original terms and creates no branch', async () => {
  const f = fixture();
  const result = await f.call('/applications/review', 'POST', input('NEEDS_INFORMATION'));
  assert.equal(result.statusCode, 200, result.body);
  assert.equal(f.read(tables.platform, { pk: person, sk: 'DRAFT#' + draftId }).review.reason, 'تمت مراجعة الطلب');
  assert.equal(f.transactions[0].some(x => x.Put?.TableName === tables.businesses), false);
});

test('lifecycle queue lists production ownership requests and the current settlement verification blocker', async () => {
  const f = fixture(['merchant_reviewer', 'finance_approver'], null);
  const { businessId } = controlledBranch;
  const organizationId = 'organization-1';
  const expiresAt = Date.parse('2026-11-25T13:00:00Z');
  f.put(tables.businesses, { businessId }, { ...controlledBranch, organizationId, businessName: 'فرع تجريبي',
    orderIntakeTransferRequestId: requestId, orderIntakeTransferExpiresAt: expiresAt });
  const key = { pk: 'ORGANIZATION#' + organizationId, sk: 'OWNERSHIP_TRANSFER' };
  const transfer = { organizationId, requestId, ownerId, recipientId: draftId, branchIds: [businessId],
    expiresAt, createdAt: Date.parse(submittedAt), status: 'AWAITING_REVIEW', digest: 'scope' };
  f.put(tables.platform, key, transfer);
  f.put('wizz-production-Wallets', { walletId: 'WALLET#MERCHANT#' + businessId, sk: 'META' },
    { status: 'ACTIVE', version: 1, ownerId: businessId, ownerType: 'MERCHANT', availableBalance: 12000, lockedBalance: 5000 });
  f.put('wizz-production-Orders', { PK: 'ORDER#1', SK: 'META' }, { businessId, status: 'confirmed' });
  const queue = await f.call('/lifecycle');
  assert.equal(queue.statusCode, 200, queue.body);
  const listed = JSON.parse(queue.body);
  assert.deepEqual(listed.available, { ownership: true, closure: true });
  assert.equal(listed.items[0].name, 'فرع تجريبي');
  assert.equal(listed.items[0].ownerId, undefined);
  assert.equal(listed.items[0].recipientId, undefined);
  const detail = await f.call('/lifecycle', 'GET', null, { organizationId, requestId });
  assert.equal(detail.statusCode, 200, detail.body);
  const data = JSON.parse(detail.body);
  assert.deepEqual(data.blockers, [{ code: 'TRANSFER_DESTINATION_VERIFICATION_REQUIRED' }]);
  assert.deepEqual(data.branches[0].blockers, [
    { code: 'ACTIVE_ORDERS', count: 1 }, { code: 'WALLET_BALANCE', amount: 12000 },
    { code: 'WALLET_LOCKED', amount: 5000 },
  ]);
  f.put(tables.platform, { pk: 'PERSON#' + draftId, sk: 'PROFILE' },
    { subjectId: draftId, version: 2, phoneNumber: 'private' });
  f.put(tables.platform, { pk: key.pk, sk: 'OWNERSHIP_TRANSFER_DESTINATION#' + requestId },
    { kind: 'OWNERSHIP_TRANSFER_DESTINATION', status: 'VERIFIED', requestId, recipientId: draftId,
      scopeDigest: transfer.digest, profileVersion: 2, version: 1, expiresAt });
  const verified = JSON.parse((await f.call('/lifecycle', 'GET', null, { organizationId, requestId })).body);
  assert.deepEqual(verified.blockers, [{ code: 'TRANSFER_SETTLEMENT_APPROVAL_REQUIRED' }]);
  assert.equal(verified.phoneNumber, undefined);
  assert.equal(f.transactions.length, 0);
});

test('closure queue restricts records and private data to global audit or finance permissions', async () => {
  const f = fixture(['auditor'], null);
  const businessId = controlledBranch.businessId;
  f.put(tables.businesses, { businessId }, { ...controlledBranch, businessName: 'فرع الإغلاق' });
  const request = { actorType: 'MERCHANT', requestId, subjectId: ownerId, status: 'PENDING_SETTLEMENT',
    scope: { kind: 'BUSINESS', id: businessId }, blockers: [
      { code: 'LOCKED_BALANCE', amount: 121000, walletId: 'private', action: 'RESOLVE_ORDER_HOLDS' },
    ] };
  f.put(tables.lifecycle, { pk: 'SUBJECT#MERCHANT#' + ownerId, sk: 'REQUEST#' + requestId }, request);
  f.put(tables.lifecycle, { pk: 'SUBJECT#CUSTOMER#' + ownerId, sk: 'REQUEST#' + requestId },
    { ...request, actorType: 'CUSTOMER' });
  const response = await f.call('/lifecycle');
  assert.equal(response.statusCode, 200, response.body);
  const page = JSON.parse(response.body);
  assert.deepEqual(page.available, { ownership: false, closure: true });
  assert.deepEqual(page.items, [{ kind: 'closure', requestId, scope: 'BUSINESS', businessId, name: 'فرع الإغلاق',
    status: 'PENDING_SETTLEMENT', blockers: [{ code: 'LOCKED_BALANCE', amount: 121000, action: 'RESOLVE_ORDER_HOLDS' }] }]);
  assert.equal((await f.call('/lifecycle', 'GET', null, {kind: 'ownership'})).statusCode, 403);
  assert.equal((await f.call('/lifecycle', 'GET', null, {kind: 'closure', cursor: 'broken'})).statusCode, 400);
  assert.equal((await f.call('/lifecycle', 'GET', null, null, null)).statusCode, 401);
  assert.equal((await f.call('/lifecycle', 'POST', request)).statusCode, 404);
  for (const denied of [fixture(), fixture(['merchant_reviewer'], null), fixture(['auditor'])]) {
    assert.equal((await denied.call('/lifecycle', 'GET', null, { kind: 'closure' })).statusCode, 403);
  }
});

test('destination approval uses the reviewed proof version and records the decision atomically', async () => {
  const f = fixture(['merchant_reviewer', 'finance_approver'], null);
  const organizationId = 'organization-1', pk = 'ORGANIZATION#' + organizationId;
  const expiresAt = Date.parse('2026-11-25T13:00:00Z');
  const key = { pk, sk: 'OWNERSHIP_TRANSFER' };
  f.put(tables.platform, key, { organizationId, requestId, ownerId, recipientId: draftId,
    branchIds: ['branch-1'], expiresAt, status: 'AWAITING_REVIEW', digest: 'scope', version: 2 });
  const profile = { subjectId: draftId, phoneNumber: '+9647000000000', version: 3 };
  f.put(tables.platform, { pk: 'PERSON#' + draftId, sk: 'PROFILE' }, profile);
  const input = { decision: 'APPROVE_SETTLEMENT', organizationId, requestId, baseVersion: 2,
    profileVersion: 3, proofVersion: 4, reason: 'طابقنا هاتف التسويات' };
  const call = data => f.call('/lifecycle/decision', 'POST', data);
  assert.equal((await call(input)).statusCode, 409);
  const proof = { kind: 'OWNERSHIP_TRANSFER_DESTINATION', status: 'VERIFIED', requestId, recipientId: draftId,
    scopeDigest: 'scope', profileVersion: 3, version: 4, expiresAt };
  f.put(tables.platform, { pk, sk: 'OWNERSHIP_TRANSFER_DESTINATION#' + requestId }, proof);
  const view = JSON.parse((await f.call('/lifecycle', 'GET', null, { organizationId, requestId })).body);
  assert.equal(view.canApproveSettlement, true);
  assert.equal(view.maskedPhone, '••••0000');
  assert.deepEqual(view.settlementEvidence, { profileVersion: 3, proofVersion: 4 });
  assert.equal((await call({ ...input, proofVersion: 3 })).statusCode, 409);
  assert.equal((await call({ ...input, baseVersion: 1 })).statusCode, 409);
  assert.equal(f.transactions.length, 0);
  const result = await call(input);
  assert.equal(result.statusCode, 200, result.body);
  assert.deepEqual(JSON.parse(result.body), { status: 'AWAITING_REVIEW', settlement: 'APPROVED' });
  const tx = f.transactions[0];
  assert.equal(tx.length, 6);
  assert.ok(tx.some(op => op.ConditionCheck?.Key.sk === 'OWNERSHIP_TRANSFER_DESTINATION#' + requestId));
  assert.ok(tx.some(op => op.Put?.Item.action === 'MERCHANT_OWNERSHIP_SETTLEMENT_APPROVED' && op.Put.Item.reason === input.reason));
  assert.equal(f.read(tables.platform, key).status, 'AWAITING_REVIEW');
  assert.equal((await call(input)).statusCode, 200);
  assert.equal(f.transactions.length, 1);
});

test('ownership rejection is limited to global nonparticipant reviewers and releases only matching transfer locks', async () => {
  const organizationId = 'organization-1';
  const key = { pk: 'ORGANIZATION#' + organizationId, sk: 'OWNERSHIP_TRANSFER' };
  const decision = { decision: 'REJECT', organizationId, requestId, reason: 'طلب المالك مراجعة نطاق الفروع', baseVersion: 2 };
  const row = { organizationId, requestId, ownerId, recipientId: draftId,
    branchIds: ['branch-1', 'branch-2'], expiresAt: Date.parse('2026-11-25T13:00:00Z'), status: 'AWAITING_REVIEW', version: 2 };
  const f = fixture(['merchant_reviewer'], null);
  f.put(tables.platform, key, row);
  const call = data => f.call('/lifecycle/decision', 'POST', data);
  assert.equal((await call({ ...decision, decision: 'APPROVE_SETTLEMENT', profileVersion: 1, proofVersion: 1 })).statusCode, 403);
  assert.equal((await f.call('/lifecycle/decision', 'POST', decision, null, null)).statusCode, 401);
  assert.equal((await call({ ...decision, reason: 'لا' })).statusCode, 400);
  f.put(tables.platform, key, { ...row, recipientId: actorId });
  assert.equal((await call(decision)).statusCode, 403);
  f.put(tables.platform, key, { ...row, status: 'AWAITING_RECIPIENT' });
  assert.equal((await call(decision)).statusCode, 409);
  f.put(tables.platform, key, row);
  const result = await call(decision);
  assert.equal(result.statusCode, 200, result.body);
  assert.deepEqual(JSON.parse(result.body), { status: 'REJECTED' });
  const tx = f.transactions[0];
  assert.ok(tx.some(op => op.Put?.Item.action === 'MERCHANT_OWNERSHIP_TRANSFER_REJECTED'));
  const releases = tx.filter(op => op.Update?.TableName === tables.businesses).map(op => op.Update);
  assert.deepEqual(releases.map(({ Key }) => Key.businessId), ['branch-1', 'branch-2']);
  assert.ok(releases.every(update => update.UpdateExpression === 'REMOVE orderIntakeTransferRequestId, orderIntakeTransferExpiresAt' &&
    update.ExpressionAttributeValues[':request'] === requestId && update.ExpressionAttributeValues[':expires'] === row.expiresAt));
  assert.equal((await fixture().call('/lifecycle/decision', 'POST', decision)).statusCode, 403);
});
