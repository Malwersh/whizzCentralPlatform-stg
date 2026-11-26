'use strict';

const { randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const wallet = '../../backend/wallet-service/';
const ready = require(wallet + 'test/helpers/full-cash-lifecycle-matrix-fixture.cjs');
const { createStaffOrderManagement } = require(wallet + 'dist/staffOrderManagement');
const { quoteHash } = require(wallet + 'dist/deliveryQuoteRecord');
const { createFinanceRollout } = require(wallet + 'dist/financeRollout');
const { exactCheck } = require(wallet + 'dist/driverFinancialTransaction');
const { financialOrderTables, financialDispatchTables } = require(wallet + 'dist/walletBindings');

const keys = {
  order: { PK:'ORDER#order1', SK:'META' },
  employee: { pk:'EMPLOYEE#staff1', sk:'PROFILE' },
  cancellation: { orderId:'order1', sk:'CUSTOMER_CANCELLATION' },
  funding: { orderId:'order1', sk:'FULL_CASH_FUNDING_COMMITMENT' },
  driverWallet: { walletId:'WALLET#DRIVER#driver1', sk:'META' },
  job: { orderId:'order1', SK:'METADATA' },
};

async function scenario(t) {
  const fixture = await ready({ platformGoodsDiscount:700, merchantShare:500, platformShare:500 });
  const staging = { ...financialDispatchTables(), ...financialOrderTables() };
  const allEnv = require('./order-financial-runtime.template.json').Resources.Function.Properties.Environment.Variables;
  const config={schemaVersion:1,accountId:'746727375268',region:'us-east-1',scopes:[]};
  const env = { ...Object.fromEntries(Object.entries(allEnv).filter(([,v]) => typeof v==='string')),
    STAGE:'production', AWS_REGION:'us-east-1', ENVIRONMENT:'production', PLATFORM_ENVIRONMENT:'production',
    FINANCE_GENERAL_RELEASE_MODE:'REQUIRED', FINANCE_ROLLOUT_CONFIG:JSON.stringify(config),
    FINANCE_ROLLOUT_SHA256:quoteHash(config) };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key,process.env[key]]));
  Object.assign(process.env,env);
  t.after(() => {
    for (const [key,value] of Object.entries(previous)) {
      if (value===undefined) delete process.env[key];
      else process.env[key]=value;
    }
  });
  const production = { ...financialDispatchTables(), ...financialOrderTables() };
  const names = new Map(Object.keys(staging).map(key => [production[key],staging[key]]));
  const translate = operation => {
    assert.match(operation.TableName,/^wizz-production-/);
    assert.ok(names.has(operation.TableName),operation.TableName);
    return { ...operation, TableName:names.get(operation.TableName) };
  };
  const db = { send(command) {
    const input = command.input;
    const mapped = input.TransactItems ? { ...input, TransactItems:input.TransactItems.map(item => {
      const [kind, operation] = Object.entries(item)[0];
      return { [kind]:translate(operation) };
    }) } : translate(input);
    return fixture.db.send(new command.constructor(mapped));
  }};
  const order = () => fixture.get(staging.orders,keys.order);
  const release='GENERAL_PRODUCTION_FULL_CASH_V1';
  const context={orderId:'order1',branchId:'branch1',customerSubjectId:'customer1'};
  Object.assign(order(),{
    status:'arrived_at_store', orderStatus:'arrived_at_store', paymentMethod:'COD',
    createdAt:new Date(fixture.time).toISOString(),userId:'customer1',userSub:'customer1',businessId:'branch1',
    financeRollout:{schemaVersion:2,scopeId:release,version:1,digest:quoteHash({release,version:1,orders:[context]})},
  });
  const employee = { ...keys.employee, employeeId:'staff1', roles:['operations'], status:'ACTIVE', scope:{allRegions:true}, version:1 };
  const actor = { kind:'STAFF', subjectId:'staff1' };
  fixture.put(staging.staff,employee);
  const rollout=createFinanceRollout({db,now:()=>fixture.time});
  const api = createStaffOrderManagement({ db:rollout.db, now:()=>fixture.time, rollout,
    authority:{ authenticate:async()=>actor, read:async()=>({employee}),
      assign:async()=>[exactCheck(production.staff,keys.employee,employee)] },
    enableFullCash:true, enableDeliveryFunding:true,
    operating:async()=>({ version:3, values:{reassignmentWindowSeconds:300,maximumWaves:4} }),
  });
  const data = { action:'UNASSIGN_REDISPATCH', orderId:'order1', offerId:order().financialAcceptance.offerId,
    attempt:1, reason:'تعذر استمرار السائق', idempotencyKey:randomUUID() };
  return { api, data, fixture, order, staging, get:(name,key)=>fixture.get(staging[name],key) };
}

test('staff release in production returns a funded order to search once', async t => {
  const { api, data, order, get, fixture } = await scenario(t);
  const funding = structuredClone(get('holds',keys.funding));
  const price = structuredClone(order().financialSnapshot);
  assert.equal((await api({action:'READ',orderId:'order1'})).item.canUnassign,true);
  const first = await api(data);
  assert.equal(first.holdReleased,true);
  assert.equal(order().status,'ready_for_pickup');
  assert.equal(order().driverId,null);
  assert.deepEqual(order().financialSnapshot,price);
  assert.deepEqual(get('holds',keys.funding),funding);
  assert.equal(get('wallets',keys.driverWallet).lockedBalance,0);
  assert.equal(get('jobs',keys.job).status,'searching');
  assert.deepEqual(get('jobs',keys.job).financialRedispatch,{
    waveNumber:2, excludeDriverIds:['driver1'], operationId:first.operationId,
  });
  const audits=[...fixture.rows.values()].filter(row=>row.action==='COD_STAFF_UNASSIGNED');
  assert.equal(audits.length,1);
  assert.equal(audits[0].actorId,'staff1');
  assert.equal(audits[0].reason,data.reason);
  const savedWallet=structuredClone(get('wallets',keys.driverWallet));
  assert.equal((await api(data)).replayed,true);
  assert.deepEqual(get('wallets',keys.driverWallet),savedWallet);
});

test('a pending cancellation or a cash review arriving before commit prevents unassignment', async t => {
  const { api, data, order, get, fixture, staging } = await scenario(t);
  const before=structuredClone(get('wallets',keys.driverWallet));
  fixture.beforeCommit=()=> { order().openPaymentClaimId='claim1'; };
  await assert.rejects(api(data),/COD_ASSIGNMENT_UNAVAILABLE/);
  assert.equal((await api({action:'READ',orderId:'order1'})).item.blocker,'ORDER_CASH_REVIEW_REQUIRED');
  delete order().openPaymentClaimId;
  fixture.beforeCommit=()=> fixture.put(staging.holds,{...keys.cancellation,state:'REQUESTED'});
  await assert.rejects(api(data),/COD_ASSIGNMENT_UNAVAILABLE/);
  assert.equal((await api({action:'READ',orderId:'order1'})).item.blocker,'ORDER_CANCELLATION_PENDING');
  assert.deepEqual(get('wallets',keys.driverWallet),before);
  assert.equal(order().driverId,'driver1');
});
