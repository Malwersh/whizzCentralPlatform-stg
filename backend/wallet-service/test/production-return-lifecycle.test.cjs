'use strict';

const {randomUUID} = require('node:crypto');
const {test} = require('node:test');
const assert = require('node:assert/strict');
const ready = require('./helpers/full-cash-lifecycle-matrix-fixture.cjs');
const {quoteHash} = require('../dist/deliveryQuoteRecord');
const {exactCheck} = require('../dist/driverFinancialTransaction');
const {checkoutTables} = require('../dist/checkoutTables');
const {financialDispatchTables} = require('../dist/walletBindings');
const {createFinanceRollout} = require('../dist/financeRollout');
const {createOrderExceptionPolicy} = require('../dist/orderExceptionPolicy');
const {CASE_POLICY_DEFAULTS} = require('../dist/exceptionCasePolicy');
const {EXCEPTION_SETTINGS_DEFAULTS} = require('../dist/orderExceptionSettings');
const {RETURN_OPERATIONS_DEFAULTS} = require('../dist/returnOperationsPolicy');
const {createDeliveryAttempt} = require('../dist/deliveryAttempt');
const {createStagingCodReturn} = require('../dist/codReturn');
const {createReturnOperations} = require('../dist/returnOperations');
const {createReturnDisposition} = require('../dist/returnDisposition');
const {createExceptionCaseAdministration} = require('../dist/exceptionCaseAdministration');
const {route: testRoad} = require('./helpers/driver-offer-fixture.cjs');

const orderKey = {PK:'ORDER#order1',SK:'META'};
const caseKey = {orderId:'order1',sk:'RETURN#1'};
const employeeKey = {pk:'EMPLOYEE#staff1',sk:'PROFILE'};

async function scenario(t, goods) {
  const storage = await ready({merchantShare:500,platformShare:500});
  const order = () => storage.get('WizzOrders',orderKey);
  const checkout = checkoutTables({});
  const dispatch = financialDispatchTables({});
  const rollConfig = {schemaVersion:1,accountId:'746727375268',region:'us-east-1',scopes:[]};
  const template = require('../../../infrastructure/production/order-financial-runtime.template.json');
  const env = {
    ...Object.fromEntries(Object.entries(template.Resources.Function.Properties.Environment.Variables)
      .filter(([, value]) => typeof value === 'string')),
    ENVIRONMENT:'production',PLATFORM_ENVIRONMENT:'production',STAGE:'production',AWS_REGION:'us-east-1',
    FINANCE_GENERAL_RELEASE_MODE:'REQUIRED',FINANCIAL_SETTLEMENT_MODEL:'FULL_CASH_AT_DELIVERY_V1',
    RETURN_TASK_NOTIFICATIONS_MODE:'REQUIRED',WALLET_NOTIFICATIONS_TABLE:'wizz-production-WalletNotifications',
    FINANCE_ROLLOUT_CONFIG:JSON.stringify(rollConfig),FINANCE_ROLLOUT_SHA256:quoteHash(rollConfig),
  };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env,env);
  t.after(() => {
    for (const [key,value] of Object.entries(previous)) {
      if (value===undefined) delete process.env[key]; else process.env[key]=value;
    }
  });

  const tables = financialDispatchTables();
  const translation = new Map([
    ['wizz-production-WalletNotifications','staging-WalletNotifications'],
    ...Object.keys(tables).map(key => [tables[key],dispatch[key]]),
    ...Object.keys(checkout).map(key => [checkoutTables()[key],checkout[key]]),
  ]);
  const calls = [];
  function bind(operation) {
    assert.ok(translation.has(operation.TableName), 'unexpected table '+operation.TableName);
    calls.push(operation.TableName);
    return {...operation,TableName:translation.get(operation.TableName)};
  }
  const productionDb = {send(command) {
    const source = command.input;
    const input = source.TransactItems ? {...source,TransactItems:source.TransactItems.map(item => {
      const [kind, operation] = Object.entries(item)[0];
      return {[kind]:bind(operation)};
    })}:bind(source);
    return storage.db.send(new command.constructor(input));
  }};
  const roll = createFinanceRollout({db:productionDb,returns:true,now:()=>storage.time});
  const at = new Date(storage.time).toISOString();
  Object.assign(order(),{
    status:'arrived_at_customer',orderStatus:'arrived_at_customer',
    paymentMethod:'COD',createdAt:at,exceptionPolicy:createOrderExceptionPolicy(at),
    userId:'customer1',userSub:'customer1',businessId:'branch1',
    financeRollout:{schemaVersion:2,scopeId:'GENERAL_PRODUCTION_FULL_CASH_V1',version:1,digest:quoteHash({release:'GENERAL_PRODUCTION_FULL_CASH_V1',version:1,orders:[{orderId:'order1',branchId:'branch1',customerSubjectId:'customer1'}]})},
    items: goods,
  });
  const branch = storage.get('WhizzMerchants_Businesses',{businessId:'branch1'});
  Object.assign(branch, {isActive:true,operatingStatus:'AVAILABLE',
    openingHours:Array.from({length:7}, (_,day) => ({day,closed:false,periods:[{open:'00:00',close:'23:59'}]}))});
  for (const [name,values] of [
    ['ORDER_EXCEPTIONS',EXCEPTION_SETTINGS_DEFAULTS],
    ['RETURN_OPERATIONS',RETURN_OPERATIONS_DEFAULTS],
    ['ORDER_EXCEPTION_CASES',CASE_POLICY_DEFAULTS],
  ]) storage.put('staging-PlatformStaff',{pk:'OPERATIONAL_SETTINGS#'+name,sk:'CURRENT',version:1,policyVersion:name+'-v1',values});
  storage.put('staging-PlatformStaff',{...employeeKey,employeeId:'staff1',roles:['bootstrap_admin'],version:1,status:'ACTIVE',scope:{allRegions:true}});
  await roll.order('order1','DRAIN');
  const position = kind => ({
    ...order().financialSnapshot.order[kind+'Point'],accuracyMeters:5,capturedAt:new Date(storage.time).toISOString(),
  });
  const selector = {orderId:'order1',offerId:order().financialAcceptance.offerId,attempt:1};
  const basic = {db:roll.db,enableFullCash:true,enableDeliveryFunding:true,now:()=>storage.time};
  const asDriver=async()=>({kind:'DRIVER',subjectId:'driver1'});
  const asOwner=async()=>({kind:'MERCHANT_OWNER',subjectId:'owner1'});
  const asStaff=async()=>({kind:'STAFF',subjectId:'staff1'});
  const staffGuard=()=>exactCheck(tables.staff,employeeKey,storage.get('staging-PlatformStaff',employeeKey));
  const authority={authenticate:asStaff,operate:async()=>({guard:staffGuard()}),authorizeStaff:async()=>[staffGuard()]};
  const driver=createStagingCodReturn({...basic,authenticate:asDriver});
  const owner=createStagingCodReturn({...basic,authenticate:asOwner});
  const attempt=createDeliveryAttempt({...basic,authenticate:asDriver});
  const readiness=createReturnDisposition({...basic,authenticate:asOwner});
  const decide=createExceptionCaseAdministration({...basic,authority,productionReturns:true});
  const row=()=>storage.get('staging-Holds',caseKey);
  const wallet=()=>storage.get('staging-Wallets',{walletId:'WALLET#DRIVER#driver1',sk:'META'});
  return {storage,order,row,wallet,calls,selector,position,driver,owner,attempt,readiness,decide,basic,asDriver,asOwner};
}

test('production return runs contact, merchant consent, staff authorization, physical receipt and one release', async t => {
  const x=await scenario(t,[{lineId:'line1',name:'وجبة',quantity:2}]);
  const {storage,order,row,wallet,selector,position,driver,owner,attempt,readiness,decide}=x;
  const held=wallet().lockedBalance;
  assert.ok(held>0);
  await assert.rejects(driver.requestReturn({...selector,reason:'CUSTOMER_UNREACHABLE',cashCollected:false}));
  await attempt.start({...selector,position:position('customer')});
  for (let i=0;i<3;i++) {
    await attempt.contact({...selector,eventId:randomUUID(),channel:'CALL_INITIATED'});
    storage.time+=60000;
  }
  await assert.rejects(driver.requestReturn({...selector,reason:'CUSTOMER_UNREACHABLE',cashCollected:false}),/NO_RESPONSE_REQUIREMENTS_NOT_MET/);
  storage.time+=420000;
  const request=await driver.requestReturn({...selector,reason:'CUSTOMER_UNREACHABLE',cashCollected:false,position:position('customer')});
  assert.equal(request.status,'REQUESTED');
  assert.equal(wallet().lockedBalance,held);
  const staffDecision=()=>decide({
    orderId:selector.orderId,caseKey:caseKey.sk,caseId:row().exceptionResolution.caseId,expectedVersion:row().version,
    action:'AUTHORIZE_RETURN',reason:'تم تأكيد إمكانية إعادة الأصناف',returnFeasibleConfirmed:true,idempotencyKey:randomUUID(),
  });
  await assert.rejects(staffDecision(),/RETURN_BRANCH_READINESS_REQUIRED/);
  await readiness.recordReadiness({...selector,branchId:'branch1',returnId:request.returnId,
    expectedVersion:row().version,branchCanReceive:true,note:'الفرع مستعد لاستلام الأصناف'});
  assert.equal((await staffDecision()).status,'RETURNING');
  const trip={...selector,returnId:request.returnId};
  await assert.rejects(driver.arriveReturn({...trip,position:{...position('branch'),latitude:0}}),/ARRIVAL_OUTSIDE_RADIUS/);
  await driver.arriveReturn({...trip,position:position('branch')});
  const view=await owner.readReturn({...selector,branchId:'branch1'});
  assert.equal(view.status,'ARRIVED_AT_BRANCH');
  assert.equal(view.resolution.driverOriginalFare,undefined);
  const receipt={...trip,branchId:'branch1',expectedVersion:row().version,cashCollected:false,
    allItemsReceived:true,condition:'INTACT',driverResponsibility:'NONE',
    itemReceipts:view.itemManifest.lines.map(line=>({lineId:line.lineId,receivedQty:line.expectedQty,condition:'SEALED_INTACT'}))};
  assert.equal((await owner.confirmReceipt(receipt)).holdReleased,true);
  assert.equal((await owner.confirmReceipt(receipt)).replayed,true);
  assert.equal(order().status,'returned');
  assert.equal(wallet().lockedBalance,0);
  assert.equal(wallet().availableBalance,20000);
  assert.equal(row().exceptionResolution.status,'SETTLEMENT_PENDING');
  assert.equal(x.calls.filter(name=>name==='wizz-production-WalletNotifications').length,1);
  assert.ok(x.calls.length > 50 && x.calls.every(name=>name.startsWith('wizz-production-')));
});

test('production automatic authorization uses the owner consent and rejects an unrelated branch', async t => {
  const x=await scenario(t,[{lineId:'line1',name:'وجبة',quantity:2}]);
  const {storage,selector,row,position,basic,asDriver,asOwner}=x;
  const ownerOps=createReturnOperations({...basic,authenticate:asOwner});
  await assert.rejects(ownerOps.setAcceptance({...selector,branchId:'other',enabled:true}),/FORBIDDEN/);
  assert.equal((await ownerOps.setAcceptance({...selector,branchId:'branch1',enabled:true})).enabled,true);
  const returnRouter={async getRoute(a,b) {
    const result=testRoad('production-return',a,b);
    result.route.measuredAt=new Date(storage.time).toISOString();
    result.route.expiresAt=new Date(storage.time+60000).toISOString();
    return result;
  }};
  const driver=createStagingCodReturn({...basic,returnRouter,authenticate:asDriver});
  const req=await driver.requestReturn({...selector,reason:'CUSTOMER_REFUSED',cashCollected:false,position:position('customer')});
  assert.equal(req.status,'RETURNING');
  assert.equal(row().disposition.source,'AUTOMATIC_POLICY');
});
