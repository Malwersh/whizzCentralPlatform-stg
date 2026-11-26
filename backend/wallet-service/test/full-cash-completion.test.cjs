'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {setup}=require('./helpers/driver-financial-fixture.cjs');
const {input,at}=require('./helpers/driver-offer-fixture.cjs');
const {fromWholeIqd:m}=require('../dist/money');
const {buildFullCashOffer:build,prepareFullCashOfferAcceptance:accept}=require('../dist/fullCashOffer');
const {createFullCashCompletion:create}=require('../dist/fullCashCompletion');
function fixture(earning=2750,commission=1575,cashMode=null){const f=setup();const base=input(String(earning));base.driver.subjectId='driver1';Object.assign(base.order.allocation,{goodsGross:m(10500),merchantGoodsDiscount:m(1050),merchantCommission:m(commission),customerDeliveryFee:m(1500),driverTip:m(500)});base.order.confirmedCustomerTotal=m(11950);let cashRounding=null;if(cashMode){cashRounding=require('../dist/cashRounding').calculateCashRounding({policy:{schemaVersion:1,enabled:true,incrementIqd:250,mode:cashMode,minimumServiceFeeIqd:250,minimumConflict:'NEXT_COLLECTIBLE_TOTAL'},version:1,paymentMethod:'COD',customerTotal:m(11750),baseServiceFee:m(300)});base.order.allocation.serviceFee=cashRounding.serviceFee;base.order.confirmedCustomerTotal=cashRounding.customerTotal;}const deliveryFunding={policyPin:{policyId:'policy1',version:1,termsHash:'a'.repeat(64)},allocation:{schemaVersion:1,referenceFee:m(2500),customerFee:m(1500),subsidy:m(1000),merchantShare:m(0),platformShare:m(1000)}};const offer=build({schemaVersion:3,base,deliveryFunding}),b=offer.baseOffer;const plan=accept({offer,offerId:b.offerId,driverId:'driver1',subjectId:'driver1',assignmentId:b.assignmentId,assignmentVersion:1,order:base.order,deliveryFunding,at,policy:{version:1,enabledRuleVersions:[{id:b.calculation.rule.id,version:b.calculation.rule.version,hash:b.ruleHash}]}});const H=plan.legacyWalletAmounts.acceptanceHoldIqd;
f.put('WizzOrders',{PK:'ORDER#order1',SK:'META',orderId:'order1',storeId:'branch1',merchantId:'merchant1',driverId:'driver1',status:'arrived_at_customer',orderStatus:'arrived_at_customer',financialSnapshot:offer.financialSnapshot,financialAcceptance:plan.acceptedTerms,assignmentWaveNumber:1,assignmentAttemptCounter:1,holdId:H?'hold1':null,holdAmount:H,holdStatus:H?'ACTIVE':'NOT_REQUIRED',paymentStatus:'pending',paymentStatus_gsi:'pending#b1',commercialPricing:{...(cashRounding?{cashRounding}:{}),agreement:{id:'agreement1',version:1,termsHash:'a'.repeat(64)}}});f.put('WaveOffers_staging',{orderId:'order1',SK:'FINANCIAL#driver1#WAVE#1',driverId:'driver1',waveNumber:1,financialOffer:offer,responseStatus:'financial_accepted',isWinner:true,acceptedTerms:plan.acceptedTerms});f.put('staging-Holds',{orderId:'order1',sk:'HOLD',holdId:H?'hold1':null,financialSchemaVersion:4,settlementModel:offer.settlementModel,status:H?'ACTIVE':'NOT_REQUIRED',walletId:'WALLET#DRIVER#driver1',amount:H,metadata:{offerDigest:offer.digest,assignmentAttempt:1}});f.put('staging-Holds',{orderId:'order1',sk:'FULL_CASH_FUNDING_COMMITMENT',kind:'FULL_CASH_FUNDING_COMMITMENT',settlementModel:offer.settlementModel,status:'COMMITTED',snapshotDigest:offer.financialSnapshot.digest,deliveryFunding,...(cashRounding?{cashRounding}:{}),platformGoodsFunding:m(0)});f.put('staging-Wallets',{walletId:'WALLET#DRIVER#driver1',sk:'META',ownerType:'DRIVER',ownerId:'driver1',currency:'IQD',status:'ACTIVE',availableBalance:20000-H,lockedBalance:H,version:2});f.put('staging-Wallets',{walletId:'WALLET#MERCHANT#branch1',sk:'META',ownerType:'MERCHANT',ownerId:'branch1',currency:'IQD',status:'ACTIVE',availableBalance:100,lockedBalance:10,version:1});f.put('WizzDispatchJobs_staging',{orderId:'order1',SK:'METADATA',dispatchJobId:'dispatch1',assignedDriverId:'driver1',status:'assigned'});f.put('WizzDriverLiveState_staging',{driverId:'driver1',isActive:true,currentOrderId:'order1',activeOrdersCount:1,status:'busy'});require('./helpers/full-cash-budget-fixture.cjs')(f,'order1',deliveryFunding);if(H)f.put('staging-WalletLifecycle',{operationId:'hold1',kind:'FULL_CASH_HOLD',financialSchemaVersion:4,status:'FULL_CASH_PENDING_COMPLETION',orderId:'order1',amount:H,walletId:'WALLET#DRIVER#driver1'});f.time=Date.parse(at)+30000;f.complete=(options={})=>create({db:f.db,enabled:true,now:()=>f.time,authenticateDriver:async()=>({driverId:'driver1',subjectId:'driver1'}),...options}).complete({orderId:'order1',cashCollected:true});return f;}
const wallet=(f,id)=>f.get('staging-Wallets',{walletId:id,sk:'META'});
test('new-model completion atomically posts liabilities, signed position and wallets without a platform wallet',async()=>{const f=fixture(),r=await f.complete();assert.equal(r.retainedCash,3250);assert.equal(r.driverWalletCredit,0);assert.equal(r.settledCollateral,8700);assert.equal(wallet(f,'WALLET#DRIVER#driver1').lockedBalance,0);assert.equal(wallet(f,'WALLET#DRIVER#driver1').availableBalance,11300);assert.equal(wallet(f,'WALLET#MERCHANT#branch1').lockedBalance,7885);assert.equal(f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'}).paymentStatus,'captured');const j=f.get('staging-MerchantPlatform',{pk:'FULL_CASH_JOURNAL#order1',sk:'META'});assert.equal(j.status,'POSTED');assert.equal(j.debit.minorAmount,j.credit.minorAmount);assert.equal(j.funding.platformNetContribution.minorAmount,825000);assert.equal(f.calls.some(c=>c.input.Key?.walletId==='WALLET#PLATFORM'),false);const before=JSON.stringify([...f.rows]);assert.equal((await f.complete()).replayed,true);assert.equal(JSON.stringify([...f.rows]),before);});
test('negative contribution records exact funding obligation and preserves full merchant rights',async()=>{const f=fixture(4000);await f.complete();const j=f.get('staging-MerchantPlatform',{pk:'FULL_CASH_JOURNAL#order1',sk:'META'});assert.equal(j.funding.platformNetFundingObligation.minorAmount,425000);assert.equal(f.get('staging-Holds',{orderId:'order1',sk:'MERCHANT_PAYABLE'}).amount,7875);assert.ok(j.walletLines.every(x=>x.balanceAfter>=0));});
test('closed capability, missing budget, legacy funding and mixed model never write any money',async()=>{for(const change of [f=>f.get('staging-Holds',{orderId:'order1',sk:'HOLD'}).financialSchemaVersion=2,f=>f.get('staging-Holds',{orderId:'order1',sk:'FULL_CASH_FUNDING_COMMITMENT'}).status='REVOKED',f=>f.put('staging-Holds',{orderId:'order1',sk:'DELIVERY_PROMOTION_FUNDING',status:'ACTIVE'}),f=>f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'}).financialAcceptance.schemaVersion=2]){const f=fixture();change(f);const before=JSON.stringify([...f.rows]);await assert.rejects(f.complete());assert.equal(JSON.stringify([...f.rows]),before);}const f=fixture();await assert.rejects(f.complete({enabled:false}),/DISABLED/);assert.equal(f.calls.length,0);});
test('revoked party, deletion fence, assignment mismatch and changed authorization fail closed',async()=>{for(const change of [f=>f.get('WhizzDrivers_staging',{driverId:'driver1'}).isSuspended=true,f=>f.put('staging-AccountDeletion',{pk:'BUSINESS_LIFECYCLE#MERCHANT#branch1',sk:'META'}),f=>f.get('WizzDispatchJobs_staging',{orderId:'order1',SK:'METADATA'}).assignedDriverId='driver2',f=>f.get('staging-Wallets',{walletId:'WALLET#DRIVER#driver1',sk:'META'}).lockedBalance=0]){const f=fixture();change(f);const before=JSON.stringify([...f.rows]);await assert.rejects(f.complete());assert.equal(JSON.stringify([...f.rows]),before);}const f=fixture();let n=0;await assert.rejects(f.complete({authenticateDriver:async()=>({driverId:'driver1',subjectId:++n===1?'driver1':'other'})}),/UNAUTHORIZED/);});
test('conditional source races reject the whole transaction without a partial journal or payable',async()=>{const f=fixture();f.beforeCommit=()=>{f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'}).status='cancelled';};await assert.rejects(f.complete(),/CONFLICT_OR_UNKNOWN/);assert.equal(wallet(f,'WALLET#DRIVER#driver1').lockedBalance,8700);assert.equal(f.get('staging-Holds',{orderId:'order1',sk:'MERCHANT_PAYABLE'}),undefined);assert.equal(f.get('staging-MerchantPlatform',{pk:'FULL_CASH_JOURNAL#order1',sk:'META'}),undefined);});
test('lost transaction response recovers the durable outcome with no duplicate journal or charge',async()=>{const f=fixture(),db={async send(c){const r=await f.db.send(c);if(c.constructor.name==='TransactWriteCommand')throw Error('reply lost');return r;}};const r=await f.complete({db});assert.equal(r.replayed,true);assert.equal(f.get('staging-Holds',{orderId:'order1',sk:'MERCHANT_PAYABLE'}).amount,7875);assert.equal([...f.rows.values()].filter(x=>x.kind==='FULL_CASH_ACCOUNTING_JOURNAL').length,1);});

test('zero-net full-cash completion records discoverable source atomically without zero wallet lines or invented credit',async()=>{const f=fixture(2750,9450);await f.complete();const p=f.get('staging-Holds',{orderId:'order1',sk:'MERCHANT_PAYABLE'});assert.equal(p.amount,0);const rows=[...f.rows.values()].filter(r=>r.kind==='MERCHANT_ACCRUAL_INDEX_ENTRY');assert.equal(rows.length,1);assert.equal(rows[0].merchantNetIqd,0);assert.equal(rows[0].financialSchemaVersion,4);assert.equal(wallet(f,'WALLET#MERCHANT#branch1').lockedBalance,10);assert.ok(f.get('staging-MerchantPlatform',{pk:'FULL_CASH_JOURNAL#order1',sk:'META'}).walletLines.every(l=>l.delta!==0));await require('../dist/merchantSettlementPreview').readMerchantAccrualEvidence(f.db,'branch1','order1');const before=JSON.stringify([...f.rows]);await f.complete();assert.equal(JSON.stringify([...f.rows]),before);});

for(const mode of ['UP','DOWN'])test('cash rounding '+mode+' posts once with complete evidence and balanced company journal',async()=>{const f=fixture(2750,1575,mode),before=f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'}).commercialPricing.cashRounding;await f.complete();const j=f.get('staging-MerchantPlatform',{pk:'FULL_CASH_JOURNAL#order1',sk:'META'});assert.deepEqual(j.cashRounding,before);assert.equal(j.debit.minorAmount,j.credit.minorAmount);assert.equal(j.lines.find(l=>l.account==='SERVICE_FEE_REVENUE').amount.minorAmount,300000);assert.equal(f.get('staging-Holds',{orderId:'order1',sk:'MERCHANT_PAYABLE'}).amount,7875);const rows=JSON.stringify([...f.rows]);assert.equal((await f.complete()).replayed,true);assert.equal(JSON.stringify([...f.rows]),rows);});

test('delivery with photo proof preserves exact SS condition, posts once and retains proof',async()=>{
 const f=fixture();const order=f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'});
 order.deliveryProofIds=new Set(['photo1']);order.deliveryProofs=[{proofId:'photo1',key:'private-proof'}];
 const db={send:async c=>{
  if(c.constructor.name==='TransactWriteCommand'){
   const update=c.input.TransactItems.find(x=>x.Update?.TableName==='WizzOrders').Update;
   const alias=Object.entries(update.ExpressionAttributeNames).find(([,v])=>v==='deliveryProofIds')[0];
   const value=update.ExpressionAttributeValues[':v'+alias.slice(2)];
   assert.ok(value instanceof Set,'DynamoDB SS must never be compared with a JSON map');
   assert.deepEqual([...value],['photo1']);
  }
  return f.db.send(c);
 }};
 await f.complete({db});
 assert.deepEqual([...f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'}).deliveryProofIds],['photo1']);
 assert.equal((await f.complete({db})).replayed,true);
 assert.equal([...f.rows.values()].filter(x=>x.kind==='FULL_CASH_ACCOUNTING_JOURNAL').length,1);
});

test('photo delivery reaches final database transport through rollout guard with SS intact',async()=>{
 const f=fixture();const order=f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'});
 order.userSub='customer1';
 const {scopeEnv,scopePin}=require('./helpers/finance-rollout-fixture.cjs');
 const env=scopeEnv({orders:[{orderId:'order1',branchId:'branch1',customerSubjectId:order.userSub}],drivers:[{driverId:'driver1',subjectId:'driver1'}]});
 env.FINANCE_GENERAL_RELEASE_MODE='REQUIRED';env.FINANCIAL_SETTLEMENT_MODEL='FULL_CASH_AT_DELIVERY_V1';
 order.financeRollout=scopePin(env,'order1');order.deliveryProofIds=new Set(['photo1']);order.deliveryProofs=[{proofId:'photo1',key:'private-proof'}];
 let transported=0;
 const raw={send:async c=>{
  if(c.constructor.name==='TransactWriteCommand'){
   const u=c.input.TransactItems.find(x=>x.Update?.TableName==='WizzOrders').Update;
   const alias=Object.entries(u.ExpressionAttributeNames).find(([,v])=>v==='deliveryProofIds')[0];
   const value=u.ExpressionAttributeValues[':v'+alias.slice(2)];
   assert.ok(value instanceof Set,'final database transport lost photo SS after rollout wrapping');
   assert.deepEqual(require('@aws-sdk/util-dynamodb').marshall({proofs:value}).proofs,{SS:['photo1']});
   assert.match(u.ConditionExpression,/#roll/);transported++;
  }
  return f.db.send(c);
 }};
 const rollout=require('../dist/financeRollout').createFinanceRollout({db:raw,env,now:()=>Date.parse(at)});
 await rollout.order('order1','DRAIN');
 await f.complete({db:rollout.db});
 assert.equal(transported,1);
 assert.equal((await f.complete({db:rollout.db})).replayed,true);
 assert.equal(transported,1);
 assert.deepEqual([...f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'}).deliveryProofIds],['photo1']);
});

test('production settlement posts and reads merchant accrual using only isolated tables', async t => {
  const f = fixture();
  const { financialDispatchTables } = require('../dist/walletBindings');
  const { checkoutTables } = require('../dist/checkoutTables');
  const { quoteHash } = require('../dist/deliveryQuoteRecord');
  const { createFinanceRollout } = require('../dist/financeRollout');
  const { readMerchantAccrualEvidence, preserveMerchantSettlementEvidence } = require('../dist/merchantSettlementPreview');
  const template = require('../../../infrastructure/production/order-financial-runtime.template.json');
  const config = { schemaVersion: 1, accountId: '746727375268', region: 'us-east-1', scopes: [] };
  const env = {
    ...Object.fromEntries(Object.entries(template.Resources.Function.Properties.Environment.Variables)
      .filter(([, value]) => typeof value === 'string')),
    ENVIRONMENT: 'production', STAGE: 'production', AWS_REGION: 'us-east-1',
    FINANCE_GENERAL_RELEASE_MODE: 'REQUIRED',
    FINANCE_ROLLOUT_CONFIG: JSON.stringify(config), FINANCE_ROLLOUT_SHA256: quoteHash(config),
  };
  const original = process.env;
  process.env = env;
  t.after(() => { process.env = original; });

  const tables = financialDispatchTables(env);
  const oldTables = financialDispatchTables({});
  const bindings = new Map(Object.keys(tables).map(role => [tables[role], oldTables[role]]));
  const platform = checkoutTables(env).platform;
  bindings.set(platform, checkoutTables({}).platform);

  const customerSubjectId = 'customer1';
  const orderId = 'order1';
  const branchId = 'branch1';
  const key = { PK: 'ORDER#' + orderId, SK: 'META' };
  const order = f.get(oldTables.orders, key);
  order.userSub = customerSubjectId;
  const release = 'GENERAL_PRODUCTION_FULL_CASH_V1';
  order.financeRollout = { schemaVersion: 2, scopeId: release, version: 1,
    digest: quoteHash({ release, version: 1, orders: [{ orderId, branchId, customerSubjectId }] }) };

  const operations = [];
  const translate = op => {
    assert.ok(bindings.has(op.TableName), 'unexpected store ' + op.TableName);
    operations.push(op);
    return { ...op, TableName: bindings.get(op.TableName) };
  };
  const db = { send(command) {
    const q = command.input;
    if (!q.TransactItems) return f.db.send(new command.constructor(translate(q)));
    const TransactItems = q.TransactItems.map(item => {
      const [[kind, op]] = Object.entries(item);
      return { [kind]: translate(op) };
    });
    return f.db.send(new command.constructor({ ...q, TransactItems }));
  } };

  const guarded = createFinanceRollout({ db, env, completion: true });
  await guarded.order(orderId, 'DRAIN');
  const { GetCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
  await assert.rejects(guarded.db.send(new GetCommand({ TableName: platform,
    Key: { pk: 'MERCHANT_ACCRUAL#other-branch', sk: 'HEAD' } })), /OUT_OF_SCOPE/);
  await assert.rejects(guarded.db.send(new TransactWriteCommand({ TransactItems: [
    { Put: { TableName: platform,
      Item: { pk: 'FULL_CASH_JOURNAL#order1', sk: 'META', kind: 'FULL_CASH_ACCOUNTING_JOURNAL',
        orderId, branchId: 'other-branch' } } },
  ] })), /OUT_OF_SCOPE/);

  const { createProductionDriverTrip } = require('../dist/productionDriverTrip');
  const readOrder = async () => {
    const row = f.get(oldTables.orders, key);
    return { status: row.status, financialAssignment: { offerId: row.financialAcceptance.offerId,
      attempt: row.assignmentAttemptCounter } };
  };
  const trip = createProductionDriverTrip({ db, now: () => f.time, readOrder });
  const driver = { driverId: 'driver1', subjectId: 'driver1' };
  order.status = order.orderStatus = 'assigned';
  await assert.rejects(trip('pickup', orderId, {}, driver, async () => driver), /ACTIVE_ASSIGNMENT_CHANGED/);
  const foreign = { driverId: 'driver2', subjectId: 'driver2' };
  await assert.rejects(trip('start-heading', orderId, {}, foreign, async () => foreign), /ORDER_NOT_FOUND/);
  for (const [action,status,timeField] of [
    ['start-heading','heading_to_store','startHeadingToStoreAt'], ['arrive-store','arrived_at_store','arrivedAtStoreAt'],
    ['pickup','picked_up','pickedUpAt'], ['start-heading-to-customer','heading_to_customer','startHeadingToCustomerAt'],
    ['arrive-customer','arrived_at_customer','arrivedAtCustomerAt'],
  ]) {
    assert.equal((await trip(action, orderId, {}, driver, async () => driver)).status, status);
    const timestamp = f.get(oldTables.orders,key)[timeField];
    assert.equal(timestamp, new Date(f.time).toISOString());
    f.time += 1000;
    assert.equal((await trip(action, orderId, {}, driver, async () => driver)).status, status);
    assert.equal(f.get(oldTables.orders,key)[timeField], timestamp);
  }
  await assert.rejects(trip('deliver', orderId, {cashCollected:true,cashAmount:1}, driver, async () => driver),
    /COD_CASH_CONFIRMATION_MISMATCH/);
  const receipt = await trip('deliver', orderId, {cashCollected:true,cashAmount:11950}, driver, async () => driver);
  assert.equal(receipt.success, true);
  assert.equal(f.get(oldTables.orders, key).status, 'delivered');
  const evidence = await readMerchantAccrualEvidence(db, branchId, orderId);
  assert.equal(evidence.payable.amount, 7875);
  assert.equal(evidence.accountingJournal.status, 'POSTED');
  assert.equal(evidence.accountingJournal.debit.minorAmount, evidence.accountingJournal.credit.minorAmount);
  assert.equal(f.get(oldTables.live, { driverId: 'driver1' }).currentOrderId, null);
  assert.ok(operations.some(op => op.TableName === platform && op.Item?.kind === 'MERCHANT_ACCRUAL_INDEX_ENTRY'));
  assert.ok(operations.some(op => op.TableName === tables.lifecycle && op.Item?.kind === 'COD_COMPLETION_OUTBOX'));
  assert.ok(operations.every(op => op.TableName.startsWith('wizz-production-')));
  assert.equal((await trip('deliver', orderId, {cashCollected:true,cashAmount:11950}, driver, async () => driver)).replayed, true);
  const delivered = f.get(oldTables.orders, key);
  const { ORDER_PII, financialRecord } = require('../../account-deletion/customer-cleanup');
  const archive = financialRecord(delivered, 'order', {
    requestId: 'deletion-request', financialYears: 7, policyVersion: 1,
  }, new Date(f.time).toISOString());
  assert.doesNotMatch(JSON.stringify(archive.data), /customerPoint|latitude|longitude/);
  for (const field of ORDER_PII) delete delivered[field];
  assert.deepEqual((await readMerchantAccrualEvidence(db, branchId, orderId)).accrual, evidence.accrual);
  const { financialSnapshot, financialAcceptance } = delivered;
  delete delivered.financialSnapshot;
  delete delivered.financialAcceptance;
  delivered.codFinancialEvidence = archive.data.codFinancialEvidence;
  await assert.rejects(readMerchantAccrualEvidence(db, branchId, orderId), /MERCHANT_ACCRUAL_PROOF_REQUIRED/);
  Object.assign(delivered, { financialSnapshot, financialAcceptance });
  await preserveMerchantSettlementEvidence(db, branchId, orderId);
  const redacted = f.get(oldTables.orders, key);
  delete redacted.financialSnapshot;
  delete redacted.financialAcceptance;
  assert.deepEqual((await readMerchantAccrualEvidence(db, branchId, orderId)).accrual, evidence.accrual);


});
