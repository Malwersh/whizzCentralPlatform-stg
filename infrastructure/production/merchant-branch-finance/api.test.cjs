'use strict';

const assert = require('node:assert/strict');
const {test} = require('node:test');
const {randomUUID} = require('node:crypto');
const {GetCommand, TransactWriteCommand} = require('../../../backend/wallet-service/node_modules/@aws-sdk/lib-dynamodb');
const {setup} = require('../../../backend/wallet-service/test/helpers/merchant-cashbox-250-fixture.cjs');
const {cashAccountingDeduplicate} = require('../../../backend/wallet-service/src/cashboxAccounting');
const {snapshotGrant} = require('../../../backend/staff-service/staff-permission-policy');
const {hash} = require('../../../backend/wallet-service/merchant-runtime/merchant-platform/branch-device-security');
const {identities: {merchant}} = require('../wallet-identity-bindings.json');
const {rolePresets, REGISTRY} = require('../../../backend/staff-service/staff-capabilities');
const {initialPolicy, enableDiscounts} = require('./policy.cjs');
const {createHandler, paths} = require('./api.cjs');

const T = 'staging-MerchantPlatform', branchId = 'branch1', pk = 'BRANCH#' + branchId;
const ownerId = '11111111-1111-4111-8111-111111111111';
const employeeId = '22222222-2222-4222-8222-222222222222';
const C = 'OPERATIONAL_SETTINGS#MERCHANT_STAFF_PERMISSIONS';
const env = {ENVIRONMENT: 'production', AWS_REGION: 'us-east-1', MERCHANT_STAFF_PERMISSION_MODE: 'CENTRAL'};
process.env.MERCHANT_STAFF_PERMISSION_MODE = 'CENTRAL';
process.env.COGNITO_CLIENT_ID = merchant.clientId;

function event(resource, headers, body, query, stage = 'production') {
  return {resource, headers, requestContext: {stage},
    ...(body ? {httpMethod: 'POST', body: JSON.stringify(body)} : {httpMethod: 'GET', queryStringParameters: query}),
  };
}

async function fixture() {
  const s = await setup();
  const stage = {
    Merchants: 'WhizzMerchants_Businesses', Orders: 'WizzOrders', WaveOffers: 'WaveOffers_staging',
    MerchantDiscounts: 'WhizzMerchants_Discounts',
  };
  const translated = item => {
    const match = /^wizz-production-([A-Za-z]+)$/.exec(item.TableName);
    assert.ok(match, 'isolated DynamoDB table required: ' + item.TableName);
    return {...item, TableName: stage[match[1]] ?? 'staging-' + match[1]};
  };
  const applied = [];
  const db = {async send(cmd) {
    const input = cmd.input;
    applied.push(input);
    if (cmd.constructor.name === 'GetCommand') return s.f.db.send(new GetCommand(translated(input)));
    if (cmd.constructor.name === 'QueryCommand') {
      const q = translated(input);
      if (q.TableName === stage.MerchantDiscounts) {
        assert.equal(q.IndexName,'BusinessIdIndex');
        assert.equal(q.ExpressionAttributeValues[':b'],branchId);
        return {Items:[...s.f.rows.values()].filter(row => row.discountId && row.businessId === branchId)
          .map(({discountId,businessId}) => ({discountId,businessId}))};
      }
      assert.equal(q.TableName, T);
      const v = q.ExpressionAttributeValues;
      const items = [...s.f.rows.values()].filter(row => row.pk === (v[':pk'] ?? v[':p']) &&
        row.sk.startsWith(v[':sk'] ?? v[':s'] ?? v[':prefix'] ?? ''));
      return {Items: structuredClone(items)};
    }
    if (cmd.constructor.name === 'TransactWriteCommand') return s.f.db.send(new TransactWriteCommand({
      ...input, TransactItems: input.TransactItems.map(op => Object.fromEntries(
        Object.entries(op).map(([key, item]) => [key, translated(item)]))),
    }));
    throw Error('Unexpected production command ' + cmd.constructor.name);
  }};
  const attrs = subject => [
    {Name: 'sub', Value: subject}, {Name: 'phone_number', Value: subject === ownerId ? '+9647700000001' : '+9647700000002'},
    {Name: 'phone_number_verified', Value: 'true'},
  ];
  const claim = (sub, use) => ({
    sub, token_use: use, iss: 'https://cognito-idp.us-east-1.amazonaws.com/' + merchant.poolId,
    [use === 'id' ? 'aud' : 'client_id']: merchant.clientId,
    exp: Math.floor(Date.now()/1000) + 900, auth_time: Math.floor(Date.now()/1000) - 30,
  });
  const deps = {db, deduplicate: cashAccountingDeduplicate,
    verifyAccess: async sub => claim(sub, 'access'), verifyId: async sub => claim(sub, 'id'),
    getUser: async sub => ({Username: sub, UserAttributes: attrs(sub)}),
    getIdentity: async sub => ({Username: sub, Enabled: true, UserStatus: 'CONFIRMED', UserAttributes: attrs(sub)}),
    cognito: {async send(command) {
      const input = command.input;
      if (command.constructor.name === 'InitiateAuthCommand') {
        assert.equal(input.ClientId, merchant.clientId);
        assert.equal(input.AuthParameters.USERNAME, ownerId);
        return {ChallengeName: 'CUSTOM_CHALLENGE', Session: 'owner-challenge'};
      }
      if (command.constructor.name === 'RespondToAuthChallengeCommand') {
        assert.equal(input.Session, 'owner-challenge');
        assert.equal(input.ChallengeResponses.USERNAME, ownerId);
        return {AuthenticationResult: {AccessToken: 'owner-proof'}};
      }
      assert.equal(input.AccessToken, 'owner-proof');
      return {Username: ownerId, UserAttributes: attrs(ownerId)};
    }},
  };
  const finance = createHandler(deps, 'finance', env), access = createHandler(deps, 'access', env);
  const request = async (handler, input, expected) => {
    const result = await handler(input);
    assert.equal(result.statusCode, expected, result.body);
    return JSON.parse(result.body);
  };
  const source = {version: 2, enabledPermissions: REGISTRY.filter(c => c.implemented).map(c => c.id),
    roles: rolePresets().map(r => ({...r, enabled: r.pendingPermissions.length === 0}))};
  const policy = initialPolicy(source);
  const canonicalOwner = s.owner;
  s.f.put('staging-PlatformStaff', {pk: C, sk: 'CURRENT', ...policy});
  const ownerHeaders = sub => ({Authorization: 'Bearer ' + sub, 'Access-Token': sub});
  const deviceHeaders = (token, session) => ({authorization: 'Bearer ' + token, ...(session ? {'x-staff-session': session} : {})});
  return {s, canonicalOwner, source, policy, applied, request, access, finance, ownerHeaders, deviceHeaders};
}

test('production registration and PIN create a scoped delegated finance session that locking invalidates', async () => {
  const f = await fixture();
  const {request, access, finance, ownerHeaders, deviceHeaders, s, policy} = f;
  s.f.put('WhizzMerchants_Businesses', {businessId: branchId, ownerId, cognitoUserId: ownerId, status: 'approved'});
  s.f.put(T, {pk: 'PERSON#' + employeeId, sk: 'PROFILE', subjectId: employeeId, name: 'موظف الاختبار', version: 1});
  assert.equal(policy.roles.find(role => role.id === 'OPERATIONAL_EMPLOYEE').enabled, false);
  const requestId = randomUUID();
  await request(access, event(paths.staff, ownerHeaders(ownerId), {
    action: 'invite', businessId: branchId, phoneNumber: '07700000002', requestId,
    grant: {roleId: 'FINANCIAL_EMPLOYEE', expectedPolicyVersion: policy.version},
  }), 200);
  await request(access, event(paths.staff, ownerHeaders(employeeId), {
    action: 'accept', businessId: branchId, requestId, baseVersion: 1,
  }), 200);
  await request(access, event(paths.devices, ownerHeaders(ownerId), {
    action: 'create_pairing', businessId: branchId, name: 'جهاز الاختبار',
  }), 403);
  const start = await request(access, event(paths.devices, ownerHeaders(ownerId), {
    action: 'pairing_phone_start', businessId: branchId, name: 'جهاز الاختبار',
  }), 200);
  assert.ok(start.maskedPhone.endsWith('0001'));
  const pair = await request(access, event(paths.devices, ownerHeaders(ownerId), {
    action: 'pairing_phone_confirm', businessId: branchId, name: 'جهاز الاختبار', session: start.session, code: '567843',
  }), 200);
  const device = await request(access, event(paths.devices, ownerHeaders(employeeId), {
    action: 'claim_pairing', businessId: branchId, pairingCode: pair.pairingCode,
  }), 200);
  await request(access, event(paths.devices, ownerHeaders(employeeId), {
    action: 'set_pin', businessId: branchId, deviceToken: device.deviceToken, pin: '483129',
  }), 200);
  const reception = await request(access, event(paths.session, deviceHeaders(device.deviceToken), {action: 'reception'}), 200);
  assert.equal(reception.staff[0].pinReady, true);
  assert.equal(reception.ordersEnabled, true);
  const unlocked = await request(access, event(paths.session, deviceHeaders(device.deviceToken), {
    action: 'unlock', subjectId: employeeId, pin: '483129',
  }), 200);
  const headers = deviceHeaders(device.deviceToken, unlocked.staffSession);
  const profile = await request(access, event(paths.session, headers, {action: 'profile'}), 200);
  assert.equal(profile.capabilities.readSettlements, true);
  assert.equal(profile.capabilities.readOrders, false);
  assert.equal(profile.capabilities.requestPayout, true);
  assert.equal(profile.capabilities.receivePayout, true);
  const transport = input => ({action: 'settlements', httpMethod: 'GET', input});
  const context = await request(finance, event(paths.finance, headers, transport({branchId, view: 'payout-context'})), 200);
  assert.equal(context.actor.subjectId, employeeId);
  await request(finance, event(paths.finance, headers, transport({branchId: 'other', view: 'payout-context'})), 403);
  await request(finance, event(paths.finance, headers, {action: 'settlements', httpMethod: 'POST', input: {
    branchId, action: 'APPROVE_PAYOUT',
  }}), 403);
  await request(access, event(paths.session, headers, {action: 'lock'}), 200);
  await request(finance, event(paths.finance, headers, transport({branchId, view: 'payout-context'})), 401);
  assert.ok(f.applied.some(cmd => cmd.TransactItems?.some(op =>
    op.Put?.Item.kind === 'MERCHANT_STAFF_SETTLEMENT_READ' && op.Put.Item.actorId === employeeId)));
});

test('the public device endpoint rejects undecorated or cross-environment calls without touching records', async () => {
  const f = await fixture();
  await f.request(f.access, event(paths.staff, {}, null, {view: 'memberships'}), 401);
  await f.request(f.finance, event(paths.finance, {}, {action: 'settlements'}), 401);
  await f.request(f.finance, event(paths.finance, {}, {action: 'settlements'}, undefined, 'staging'), 404);
  await f.request(f.access, event(paths.finance, {}, {action: 'settlements'}), 404);
  assert.deepEqual(f.applied, []);
});

test('delegated payouts can be requested and acknowledged once while the platform performs approval', async () => {
  const f = await fixture(), {s, policy, request, finance, deviceHeaders} = f;
  const did = randomUUID(), sid = randomUUID(), deviceProof = 'd'.repeat(43), sessionProof = 's'.repeat(43);
  const expiry = Math.floor(Date.now()/1000) + 120;
  const party = {pk, businessId: branchId, ownerId: s.owner, status: 'ACTIVE', version: 1};
  const grant = snapshotGrant({policy, registry: REGISTRY,
    roleId: 'FINANCIAL_EMPLOYEE', expectedPolicyVersion: policy.version, branchIds: [branchId]});
  s.f.put(T, {...party, sk: 'MEMBER#' + employeeId, subjectId: employeeId,
    membershipId: 'member-test', permissionSchema: 2, role: grant.roleId, grant});
  s.f.put(T, {...party, sk: 'DEVICE#' + did, deviceId: did, tokenHash: hash(deviceProof), expiresAt: expiry});
  s.f.put(T, {...party, sk: 'PIN#' + employeeId, subjectId: employeeId, membershipVersion: 1});
  s.f.put(T, {...party, sk: 'STAFF_SESSION#' + sid, subjectId: employeeId, sessionId: sid,
    membershipVersion: 1, pinVersion: 1, deviceId: did, deviceVersion: 1, membershipId: 'member-test',
    tokenHash: hash(sessionProof), expiresAt: expiry, maxExpiresAt: expiry + 10000});
  s.f.put(T, {pk: 'PERSON#' + employeeId, sk: 'PROFILE', subjectId: employeeId, name: 'الموظف المستلم', version: 1});
  const headers = deviceHeaders(branchId + ':' + did + ':' + deviceProof, sid + ':' + sessionProof);
  const employee = input => request(finance, event(paths.finance, headers, {
    action: 'settlements', httpMethod: 'POST', input,
  }), 200);
  const body = s.request();
  let {payout} = await employee(body);
  assert.equal(payout.requestActor.subjectId, employeeId);
  assert.equal((await employee(body)).payout.payoutId, payout.payoutId);
  s.role('STAFF');
  payout = (await s.act(payout, 'APPROVE_PAYOUT')).payout;
  payout = (await s.act(payout, 'BEGIN_PAYOUT')).payout;
  payout = (await s.act(payout, 'RECORD_PAYOUT_EXECUTION', {
    cashboxId: 'CASH-DESK-01', actualAmount: payout.amount.minorAmount / 1000, destinationConfirmed: true,
  })).payout;
  payout = (await employee({action: 'ACK_PAYOUT_RECEIPT', branchId, payoutId: payout.payoutId,
    version: payout.version, requestId: randomUUID(), accepted: true, receivedAmount: payout.amount.minorAmount / 1000})).payout;
  assert.equal(payout.receiptActor.subjectId, employeeId);
  assert.equal((await s.act(payout, 'RECONCILE_PAYOUT')).payout.status, 'PAID');
});

test('discount operations require the current paired session and explicit discount grants', async t => {
  const {s, policy, source, request, access, applied, deviceHeaders} = await fixture();
  const savedEnvironment = process.env.ENVIRONMENT;
  const savedRegion = process.env.AWS_REGION;
  process.env.ENVIRONMENT = 'production';
  process.env.AWS_REGION = 'us-east-1';
  t.after(() => {
    if (savedEnvironment === undefined) delete process.env.ENVIRONMENT;
    else process.env.ENVIRONMENT = savedEnvironment;
    if (savedRegion === undefined) delete process.env.AWS_REGION;
    else process.env.AWS_REGION = savedRegion;
  });
  const enabled = enableDiscounts(policy,source);
  assert.equal(enableDiscounts(enabled,source),enabled);
  const did=randomUUID(),sid=randomUUID(),deviceProof='d'.repeat(43),sessionProof='s'.repeat(43);
  const expiry=Math.floor(Date.now()/1000)+120;
  const party={pk,businessId:branchId,ownerId:s.owner,status:'ACTIVE',version:1};
  const manager=activePolicy => snapshotGrant({policy:activePolicy,registry:REGISTRY,
    roleId:'BRANCH_MANAGER',expectedPolicyVersion:activePolicy.version,branchIds:[branchId]});
  const member={...party,sk:'MEMBER#'+employeeId,subjectId:employeeId,
    membershipId:'member-test',role:'BRANCH_MANAGER',permissionSchema:2};
  s.f.put(T,{...member,grant:manager(policy)});
  s.f.put(T,{...party,sk:'DEVICE#'+did,deviceId:did,tokenHash:hash(deviceProof),expiresAt:expiry});
  s.f.put(T,{...party,sk:'PIN#'+employeeId,subjectId:employeeId,membershipVersion:1});
  s.f.put(T,{...party,sk:'STAFF_SESSION#'+sid,subjectId:employeeId,sessionId:sid,
    membershipVersion:1,pinVersion:1,deviceId:did,deviceVersion:1,membershipId:'member-test',
    tokenHash:hash(sessionProof),expiresAt:expiry,maxExpiresAt:expiry+10000});
  const token=branchId+':'+did+':'+deviceProof;
  const headers=deviceHeaders(token,sid+':'+sessionProof);
  const run=(input,expected=200) => request(access,event(paths.session,headers,input),expected);
  const listing={action:'discounts_list'};
  await request(access,event(paths.session,deviceHeaders(token),listing),401);
  s.f.put('staging-PlatformStaff',{pk:C,sk:'CURRENT',...enabled});
  await run(listing,403);
  assert.equal((await run({action:'profile'})).capabilities.readDiscounts,false);
  s.f.put(T,{...member,grant:manager(enabled)});
  const profile=await run({action:'profile'});
  assert.equal(profile.capabilities.readDiscounts,true);
  assert.equal(profile.capabilities.activateDiscounts,true);
  const create={action:'discounts_create',requestId:randomUUID(),data:{title:'عرض الفرع',
    type:'percentage',value:10,validFrom:'2020-01-01T00:00:00Z',validTo:'2099-01-01T00:00:00Z'}};
  const {discountId}=await run(create);
  assert.equal((await run(create)).replayed,true);
  const {discounts:[row]}=await run(listing);
  assert.equal(row.discountId,discountId);
  assert.equal(row.status,'inactive');
  await run({action:'discounts_status',requestId:randomUUID(),discountId,baseRevision:row.revision,active:true});
  const {discounts:[active]}=await run(listing);
  assert.equal(active.status,'active');
  s.f.put(T,{pk:'CAMPAIGN_SHARING_LOCK#MERCHANT#'+discountId,sk:'META'});
  const blocked=await run({action:'discounts_delete',requestId:randomUUID(),discountId,baseRevision:active.revision},409);
  assert.equal(blocked.code,'SHARED_DISCOUNT_DELETE_FORBIDDEN');
  const transaction=applied.find(cmd=>cmd.TransactItems?.some(op=>op.Put?.Item.discountId===discountId));
  assert.ok(transaction.TransactItems.some(op=>op.Put?.Item.action==='DISCOUNT_CREATED'&&op.Put.Item.actorId===employeeId));
  assert.ok(transaction.TransactItems.some(op=>op.ConditionCheck?.Key.sk==='CURRENT'));
  await run({action:'lock'});
  await run(listing,401);
});
