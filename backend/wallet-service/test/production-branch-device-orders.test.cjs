'use strict';

const assert = require('node:assert/strict');
const {test} = require('node:test');
const {createDeviceOrderAuthority} = require('../src/productionBranchDeviceOrders');
const {createProductionMerchantOrderResponses} = require('../src/productionMerchantOrderResponses');
const {quoteHash} = require('../src/deliveryQuoteRecord');
const {hash} = require('../merchant-runtime/merchant-platform/branch-device-security');
const {rolePresets, REGISTRY} = require('../../staff-service/staff-capabilities');
const {snapshotGrant} = require('../../staff-service/staff-permission-policy');
const {initialPolicy, enableOrders} = require('../../../infrastructure/production/merchant-branch-finance/policy.cjs');

const branchId = 'branch1', ownerId = 'owner1', subjectId = 'employee1';
const deviceId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const deviceSecret = 'd'.repeat(43), sessionSecret = 's'.repeat(43);
const pk = 'BRANCH#' + branchId;
const now = Date.now();
const expiresAt = Math.floor(now/1000) + 90;
const rollout = {schemaVersion:1,accountId:'746727375268',region:'us-east-1',scopes:[]};
const productionTemplate = require('../../../infrastructure/production/order-financial-runtime.template.json');
const binding = productionTemplate.Resources.Function.Properties.Environment.Variables;
const env = {
  ...Object.fromEntries(Object.entries(binding).filter(([, value]) => typeof value === 'string')),
  ENVIRONMENT: 'production', STAGE: 'production', AWS_REGION: 'us-east-1',
  FINANCIAL_COD_ACCOUNT_ID: '746727375268', MERCHANT_RESPONSE_MODE: 'REQUIRED',
  MERCHANT_STAFF_PERMISSION_MODE: 'CENTRAL',
  FINANCE_GENERAL_RELEASE_MODE:'REQUIRED', FINANCIAL_SETTLEMENT_MODEL:'FULL_CASH_AT_DELIVERY_V1',
  FINANCE_ROLLOUT_CONFIG:JSON.stringify(rollout), FINANCE_ROLLOUT_SHA256:quoteHash(rollout),
};
process.env.MERCHANT_STAFF_PERMISSION_MODE = 'CENTRAL';

function fixture({role = 'OPERATIONAL_EMPLOYEE', status = 'pending', sessionRevoked = false, revokeAtRead = false, financial = false} = {}) {
  const source = {version: 2, enabledPermissions: REGISTRY.filter(cap => cap.implemented).map(cap => cap.id),
    roles: rolePresets()};
  const before = initialPolicy(source);
  const policy = enableOrders(before, source);
  const grant = snapshotGrant({policy, registry: REGISTRY, roleId: role, branchIds: [branchId], expectedPolicyVersion: policy.version});
  const order = {PK:'ORDER#order1', SK:'META', orderId:'order1', businessId:branchId, storeId:branchId,
    status, orderStatus:status, storeStatus:branchId+'#'+status+'#b1', createdAt: new Date(now-1000).toISOString(),
    paymentMethod:'cash', paymentStatus:'pending', merchantAcceptanceDeadlineAt:new Date(now+300000).toISOString(),
    merchantResponsePolicy:{schemaVersion:1,acceptanceSeconds:300}, deliveryQuote:{route:{durationSeconds:180}},
    items:[{name:'وجبة'}], customerPhone:'private', financialAssignment:{privateField:'private'},
  };
  if (status === 'preparing') {
    order.financialSnapshot = {schemaVersion:3, settlementModel:'FULL_CASH_AT_DELIVERY_V1'};
    order.financeRollout = {schemaVersion:2, scopeId:'GENERAL_PRODUCTION_FULL_CASH_V1'};
  }
  if (financial) {
    const scopeId = 'GENERAL_PRODUCTION_FULL_CASH_V1';
    order.userSub = 'customer1';
    order.financialSnapshot = {schemaVersion:3, settlementModel:'FULL_CASH_AT_DELIVERY_V1'};
    order.financeRollout = {schemaVersion:2,scopeId,version:1,
      digest:quoteHash({release:scopeId,version:1,orders:[{orderId:order.orderId,branchId,customerSubjectId:order.userSub}]})};
  }
  const staffSession = {pk, sk:'STAFF_SESSION#'+sessionId, sessionId, businessId:branchId, ownerId, subjectId,
    deviceId, deviceVersion:1, membershipVersion:1, pinVersion:2, expiresAt, maxExpiresAt:expiresAt+3600,
    tokenHash:hash(sessionSecret), status:sessionRevoked ? 'LOCKED' : 'ACTIVE', version:1};
  const rows = {
    ['DEVICE#'+deviceId]: {pk, sk:'DEVICE#'+deviceId, deviceId, ownerId, businessId:branchId,
      tokenHash:hash(deviceSecret), expiresAt, status:'ACTIVE', version:1},
    ['MEMBER#'+subjectId]:{pk,sk:'MEMBER#'+subjectId,subjectId,ownerId,businessId:branchId,version:1,status:'ACTIVE',
      displayName:'موظف الفرع',permissionSchema:2,role,grant},
    ['PIN#'+subjectId]:{pk,sk:'PIN#'+subjectId,membershipVersion:1,version:2,status:'ACTIVE'},
    [staffSession.sk]:staffSession,
  };
  const queries = [], transactions = [];
  const db = {async send(command) {
    const input = command.input;
    if (input.TransactItems) {transactions.push(input.TransactItems); return {};}
    assert.ok(input.TableName.startsWith('wizz-production-'), input.TableName);
    if (input.IndexName) {queries.push(input); return {Items:[order,{...order, businessId:'other', storeId:'other'}]};}
    assert.equal(input.ConsistentRead, true);
    if (input.TableName.endsWith('-Orders')) {
      if (revokeAtRead) staffSession.status = 'LOCKED';
      return {Item:order};
    }
    if (['-AccountDeletion','-DispatchJobs'].some(suffix => input.TableName.endsWith(suffix))) return {};
    if (input.TableName.endsWith('-Merchants')) return {Item:{businessId:branchId,ownerId,cognitoUserId:ownerId,status:'approved',isActive:true}};
    if (input.TableName.endsWith('-PlatformStaff')) return {Item:policy};
    if (input.TableName.endsWith('-WalletLifecycle')) return {Item:{operationId:'MERCHANT_RESPONSE#order1',orderId:'order1',status:'PENDING'}};
    assert.equal(input.TableName, 'wizz-production-MerchantPlatform');
    return {Item:rows[input.Key.sk]};
  }};
  const handler = createProductionMerchantOrderResponses({db, authorizeDevice:createDeviceOrderAuthority(db,env,()=>now), env, now:()=>now});
  const event = (action, body, session = true, businessId = branchId) => {
    const route = action ? '/merchant/order/{orderId}/{action}' : '/merchant/orders/{businessId}';
    return {resource:'/branch-device'+route, requestContext:{stage:'production'}, httpMethod:action?'PUT':'GET',
      pathParameters: action ? {orderId:'order1',action} : {businessId},
      headers:{Authorization:'Bearer '+branchId+':'+deviceId+':'+deviceSecret,
        ...(session ? {'X-Staff-Session':sessionId+':'+sessionSecret} : {})},
      ...(body ? {body:JSON.stringify({businessId,...body})} : {})};
  };
  return {handler,event,transactions,queries,policy,before,source};
}

test('production reception exposes only minimal pending order data before employee PIN', async () => {
  const f = fixture();
  const reception = await f.handler({...f.event(null,null,false),queryStringParameters:{status:'delivered'}});
  assert.equal(reception.statusCode,200,reception.body);
  const [entry] = JSON.parse(reception.body).orders;
  assert.deepEqual(Object.keys(entry).sort(),['createdAt','orderId','status']);
  const detailed = await f.handler(f.event());
  assert.equal(detailed.statusCode,200,detailed.body);
  assert.deepEqual(JSON.parse(detailed.body).orders.map(x=>[x.items,x.customerPhone]),[[[{name:'وجبة'}],undefined]]);
  assert.equal(f.transactions.length,0);
});

test('only the authorized staff session can change an order, with the staff audit in the same transaction', async () => {
  for (const [action, body, status, expected] of [
    ['confirm',{estimatedPreparationTime:25},'pending','confirmed'],
    ['reject',{reason:'الصنف غير متوفر'},'pending','cancelled'],
    ['status',{status:'preparing'},'confirmed','preparing'],
    ['status',{status:'ready'},'preparing','ready_for_pickup'],
  ]) {
    const f = fixture({status});
    const response = await f.handler(f.event(action,body));
    assert.equal(response.statusCode,200,response.body);
    assert.equal(JSON.parse(response.body).status,expected);
    assert.equal(f.transactions.length,1);
    const tx = f.transactions[0];
    const audit = tx.find(item=>item.Put?.Item.sk?.startsWith('STAFF_AUDIT#OPERATIONS#')).Put.Item;
    assert.equal(audit.actorId,subjectId);
    assert.equal(audit.before.status,status);
    assert.equal(audit.after.status,expected);
    const guardKeys = tx.filter(x=>x.ConditionCheck).map(x=>x.ConditionCheck.Key.sk);
    for (const key of ['CURRENT','DEVICE#'+deviceId,'STAFF_SESSION#'+sessionId,'PIN#'+subjectId,'MEMBER#'+subjectId]) {
      assert.ok(guardKeys.includes(key),key);
    }
    assert.equal(tx.filter(x=>x.ConditionCheck?.Key.businessId===branchId).length,1);
  }
});

test('production full cash rollout accepts a paired employee response with an atomic audit', async () => {
  const f = fixture({financial:true});
  const response = await f.handler(f.event('confirm',{estimatedPreparationTime:25}));
  assert.equal(response.statusCode,200,response.body);
  assert.equal(f.transactions.length,1);
  assert.ok(f.transactions[0].some(item=>item.Put?.Item.action==='ORDER_STATUS_CHANGED'));
  assert.ok(f.transactions[0].some(item=>item.ConditionCheck?.Key.sk==='CURRENT'));
  assert.equal(f.transactions[0].some(item=>item.Update?.TableName==='wizz-production-Wallets'),false);
});

test('cross-branch requests, missing or revoked sessions and a finance-only grant make no writes', async () => {
  for (const [options, session, branch, expected] of [
    [{},false,branchId,401],
    [{},true,'other',403],
    [{role:'FINANCIAL_EMPLOYEE'},true,branchId,403],
    [{sessionRevoked:true},true,branchId,401],
    [{revokeAtRead:true,status:'confirmed'},true,branchId,401],
  ]) {
    const f = fixture(options);
    const response = await f.handler(f.event('status',{status:'preparing'},session,branch));
    assert.equal(response.statusCode,expected,response.body);
    assert.equal(f.transactions.length,0);
  }
});

test('order policy promotion preserves finance and is idempotent', () => {
  const {policy,before,source} = fixture();
  assert.deepEqual(policy.roles.find(r=>r.id==='FINANCIAL_EMPLOYEE'),before.roles.find(r=>r.id==='FINANCIAL_EMPLOYEE'));
  assert.equal(policy.version,before.version+1);
  assert.equal(enableOrders(policy,source),policy);
});
