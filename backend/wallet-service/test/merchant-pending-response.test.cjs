const {test}=require('node:test'),assert=require('node:assert/strict');const {setup}=require('./helpers/driver-financial-fixture.cjs');const {parseIqd:m}=require('../dist/money');const {createMerchantPendingResponse:create}=require('../dist/merchantPendingResponse');
function fixture(funded=false){const f=setup('3000',s=>{if(funded){s.order.allocation.platformGoodsDiscount=m('1000');s.order.confirmedCustomerTotal=m('13500');}}),at=new Date(f.time).toISOString(),o=f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'}),b=f.get('WhizzMerchants_Businesses',{businessId:'branch1'});Object.assign(o,{status:'pending',paymentMethod:'cash',paymentStatus:'pending',createdAt:at,merchantAcceptanceDeadlineAt:new Date(f.time+300000).toISOString(),merchantResponsePolicy:{schemaVersion:1,acceptanceSeconds:300,autoAccept:true,defaultPreparationMinutes:20},storeStatus:'branch1#pending#b1',holdId:null,holdAmount:0,holdStatus:'NONE',commercialPricing:{schemaVersion:1,agreement:{id:'agreement1',version:1},funding:{amount:m(funded?'1000':'0'),holdId:funded?'PROMO#order1':null,state:funded?'RESERVED_WITH_ORDER':'NOT_REQUIRED',policy:funded?{id:'fund1',version:1}:null}},deliveryQuote:{route:{durationSeconds:180}}});Object.assign(b,{isActive:true,acceptingOrders:true,orderReceptionSettings:{schemaVersion:1,autoAccept:true,defaultPreparationMinutes:20}});f.put('staging-WalletLifecycle',{operationId:'MERCHANT_RESPONSE#order1',kind:'MERCHANT_RESPONSE',merchantResponseSchemaVersion:1,orderId:'order1',branchId:'branch1',ownerId:'owner1',status:'PENDING',queuePartition:'MERCHANT_RESPONSE',nextAttemptAt:Math.floor(f.time/1000)});if(funded){f.put('staging-Wallets',{walletId:'WALLET#PLATFORM',sk:'META',ownerType:'PLATFORM',ownerId:'PLATFORM',currency:'IQD',status:'ACTIVE',availableBalance:5000,lockedBalance:1000,version:1});f.put('staging-Holds',{orderId:'order1',sk:'PROMOTION_FUNDING',walletId:'WALLET#PLATFORM',holdId:'PROMO#order1',amount:1000,status:'ACTIVE',purpose:'PLATFORM_GOODS_DISCOUNT',metadata:{agreementId:'agreement1',agreementVersion:1,fundingPolicy:{id:'fund1',version:1}}});}const engine=create({db:f.db,now:()=>f.time,authenticate:async()=>({kind:'SYSTEM',subjectId:'MERCHANT_RESPONSE_WORKER',businessId:'branch1',ownerId:'owner1',guards:[]})});return {f,o,b,engine};}
test('opt-in automatic acceptance stores preparation once without touching driver money',async()=>{const {f,o,engine}=fixture();const before=structuredClone(f.get('staging-Wallets',{walletId:'WALLET#DRIVER#driver1',sk:'META'}));assert.equal((await engine.run('order1','AUTO_ACCEPT')).status,'confirmed');assert.equal(f.get('WizzOrders',{PK:o.PK,SK:o.SK}).estimatedPreparationTime,20);assert.equal((await engine.run('order1','AUTO_ACCEPT')).replayed,true);assert.deepEqual(f.get('staging-Wallets',{walletId:'WALLET#DRIVER#driver1',sk:'META'}),before);});
test('unfunded timeout completes atomically without wallet or ledger writes',async()=>{const {f,engine}=fixture();f.time+=300000;await engine.run('order1','EXPIRE');assert.equal(f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'}).status,'expired');assert.equal(f.get('staging-Holds',{orderId:'order1',sk:'FINANCIAL_OUTCOME'}).journalLines.length,0);});
test('funded timeout releases platform promotion exactly once and balances journal',async()=>{const {f,engine}=fixture(true);f.time+=300000;await engine.run('order1','EXPIRE');const w=f.get('staging-Wallets',{walletId:'WALLET#PLATFORM',sk:'META'});assert.equal(w.availableBalance,6000);assert.equal(w.lockedBalance,0);const j=f.get('staging-Holds',{orderId:'order1',sk:'FINANCIAL_OUTCOME'});assert.equal(j.journalLines.reduce((s,r)=>s+r.delta,0),0);assert.equal((await engine.run('order1','EXPIRE')).replayed,true);assert.equal(w.version,2);});
test('before deadline cannot expire; after deadline cannot automatically accept',async()=>{const {f,engine}=fixture();await assert.rejects(engine.run('order1','EXPIRE'),{code:'MERCHANT_RESPONSE_NOT_DUE'});f.time+=300000;await assert.rejects(engine.run('order1','AUTO_ACCEPT'),{code:'MERCHANT_RESPONSE_NOT_DUE'});});
test('revoked auto acceptance and assigned money never fall through to timeout',async()=>{const {f,b,o,engine}=fixture();b.orderReceptionSettings.autoAccept=false;await assert.rejects(engine.run('order1','AUTO_ACCEPT'),{code:'MERCHANT_AUTO_ACCEPT_UNAVAILABLE'});o.financialAcceptance={schemaVersion:1};f.time+=300000;await assert.rejects(engine.run('order1','EXPIRE'),{code:'MERCHANT_RESPONSE_FINANCIAL_REVIEW_REQUIRED'});});
test('manual confirmation winning the race prevents expiration and promotion release',async()=>{const {f,engine}=fixture(true);f.time+=300000;f.beforeCommit=()=>{f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'}).status='confirmed';};await assert.rejects(engine.run('order1','EXPIRE'));assert.equal(f.get('staging-Wallets',{walletId:'WALLET#PLATFORM',sk:'META'}).lockedBalance,1000);assert.equal(f.get('staging-Holds',{orderId:'order1',sk:'FINANCIAL_OUTCOME'}),undefined);});

test('rejecting an already automatically accepted order never reports a successful rejection',async()=>{const {f,engine}=fixture();await engine.run('order1','AUTO_ACCEPT');const owner=create({db:f.db,now:()=>f.time,authenticate:async()=>({kind:'MERCHANT',subjectId:'owner1',ownerId:'owner1',businessId:'branch1',guards:[]})});await assert.rejects(owner.run('order1','REJECT','صنف غير متوفر'),{code:'ORDER_ALREADY_HANDLED'});assert.equal(f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'}).status,'confirmed');});

function reserveOffer(f,o){
 Object.assign(o,{userSub:'customer',offerSnapshot:{discountId:'discount',source:'MERCHANT'},offerUsageReservation:{schemaVersion:1,userSub:'customer',accountReserved:true,customerReserved:true,campaign:{id:'discount',source:'MERCHANT',createdAt:null}}});
 f.put('staging-WizzOfferJourney',{pk:'USER#customer',sk:'ORDERS',count:1,version:1,lastAt:f.time});
 f.put('staging-WizzOfferJourney',{pk:'USER#customer',sk:'OFFER#merchant#discount',count:1,version:1});
 f.put('WhizzMerchants_Discounts',{discountId:'discount',businessId:'branch1',usage_count:3});
}
function customerEngine(f,o,patch={},db=f.db){
 Object.assign(o,{userId:'user',userSub:'customer',isGuestOrder:false});
 f.put('WizzUser_users_staging',{userId:'user',cognitoSub:'customer',version:1});
 return create({db,now:()=>f.time,authenticate:async()=>({kind:'CUSTOMER',subjectId:'customer',customerId:'user',businessId:'branch1',ownerId:'owner1',
  guards:[{ConditionCheck:{TableName:'WizzUser_users_staging',Key:{userId:'user'},ConditionExpression:'#v=:v',ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':v':1}}}],...patch})});
}
test('financial customer cancellation releases promotion cash and coupon usage exactly once before acceptance',async()=>{
 const {f,o}=fixture(true);reserveOffer(f,o);const engine=customerEngine(f,o);
 assert.equal((await engine.run('order1','CUSTOMER_CANCEL','changed mind')).status,'cancelled');
 assert.equal(f.get('WizzOrders',{PK:o.PK,SK:o.SK}).canceledBy,'customer');
 assert.equal(f.get('staging-Wallets',{walletId:'WALLET#PLATFORM',sk:'META'}).lockedBalance,0);
 assert.equal(f.get('staging-WizzOfferJourney',{pk:'USER#customer',sk:'ORDERS'}).count,0);
 assert.equal((await engine.run('order1','CUSTOMER_CANCEL','changed mind')).replayed,true);
 await assert.rejects(engine.run('order1','CUSTOMER_CANCEL','different reason'),{code:'ORDER_ALREADY_HANDLED'});
 assert.equal(f.get('WhizzMerchants_Discounts',{discountId:'discount'}).usage_count,2);
});
test('customer cancellation drains existing finance scope and does not admit new orders',async()=>{
 const {createFinanceRollout}=require('../dist/financeRollout'),{scopeEnv,scopePin}=require('./helpers/finance-rollout-fixture.cjs');
 for(const subject of ['customer','foreign']){
  const {f,o}=fixture(true);let transaction;
  const db={send:async c=>{if(c.constructor.name==='TransactWriteCommand'){transaction=c.input;return {};}return f.db.send(c);}};
  const env=scopeEnv({mode:'DRAIN',until:'2020-01-01T00:00:00.000Z',orders:[{orderId:'order1',branchId:'branch1',customerSubjectId:subject}],drivers:[{driverId:'driver1',subjectId:'driver1'}]});
  o.financeRollout=scopePin(env,'order1');
  const rollout=createFinanceRollout({db,env,now:()=>f.time}),engine=customerEngine(f,o,{},rollout.db);
  if(subject==='foreign'){
   await assert.rejects(engine.run('order1','CUSTOMER_CANCEL','reason'),{code:'FINANCE_ROLLOUT_OUT_OF_SCOPE'});assert.equal(transaction,undefined);
  }else{
   await engine.run('order1','CUSTOMER_CANCEL','reason');
   const update=transaction.TransactItems.find(x=>x.Update?.TableName==='WizzOrders').Update;
   assert.ok(Object.values(update.ExpressionAttributeNames).includes('userSub'));
   assert.equal(update.ExpressionAttributeValues[':roll1'],'customer');
   assert.ok(!transaction.TransactItems.some(x=>x.Put?.TableName==='WizzOrders'));
  }
 }
});
test('customer authority cannot cancel foreign orders or invoke merchant/system actions',async()=>{
 for(const patch of [{subjectId:'foreign'},{customerId:'foreign'},{guards:[]}]){
  const {f,o}=fixture(true),engine=customerEngine(f,o,patch);
  await assert.rejects(engine.run('order1','CUSTOMER_CANCEL','reason'),{code:'MERCHANT_RESPONSE_UNAUTHORIZED'});
  assert.equal(o.status,'pending');
  assert.equal(f.get('staging-Wallets',{walletId:'WALLET#PLATFORM',sk:'META'}).lockedBalance,1000);
 }
 for(const mode of ['AUTO_ACCEPT','EXPIRE','REJECT']){
  const {f,o}=fixture();await assert.rejects(customerEngine(f,o).run('order1',mode),{code:'MERCHANT_RESPONSE_UNAUTHORIZED'});
 }
});
test('customer cancellation does not require automatic-accept policy but refuses recorded acceptance',async()=>{
 const {f,o}=fixture(),engine=customerEngine(f,o);
 delete o.merchantResponsePolicy;delete o.merchantAcceptanceDeadlineAt;
 await engine.run('order1','CUSTOMER_CANCEL','reason');
 const accepted=fixture(),other=customerEngine(accepted.f,accepted.o);accepted.o.confirmedAt='2026-01-01';
 await assert.rejects(other.run('order1','CUSTOMER_CANCEL','reason'),{code:'MERCHANT_RESPONSE_FINANCIAL_REVIEW_REQUIRED'});
});
test('accepted orders, profile revocation and timeout races cannot partially release customer cancellations',async()=>{
 for(const race of ['accepted','profile','timeout']){
  const {f,o}=fixture(true);reserveOffer(f,o);const engine=customerEngine(f,o);
  f.beforeCommit=()=>{
   if(race==='accepted')o.status='confirmed';
   if(race==='profile')f.get('WizzUser_users_staging',{userId:'user'}).version++;
   if(race==='timeout')f.get('staging-WalletLifecycle',{operationId:'MERCHANT_RESPONSE#order1'}).status='DONE';
  };
  await assert.rejects(engine.run('order1','CUSTOMER_CANCEL','reason'));
  assert.equal(f.get('staging-Wallets',{walletId:'WALLET#PLATFORM',sk:'META'}).lockedBalance,1000);
  assert.equal(f.get('WhizzMerchants_Discounts',{discountId:'discount'}).usage_count,3);
 }
 const {f,o}=fixture(),engine=customerEngine(f,o);o.status='confirmed';
 await assert.rejects(engine.run('order1','CUSTOMER_CANCEL','reason'),{code:'ORDER_ALREADY_HANDLED'});
});
test('merchant rejection and timeout restore coupon usage and first-order reservation in their financial transaction exactly once',async()=>{
 for(const mode of ['REJECT','EXPIRE']){
  const {f,o,engine}=fixture(true);reserveOffer(f,o);f.time+=300000;
  const actor=mode==='REJECT'?create({db:f.db,now:()=>f.time,authenticate:async()=>({kind:'MERCHANT',subjectId:'owner1',ownerId:'owner1',businessId:'branch1',guards:[]})}):engine;
  await actor.run('order1',mode);
  assert.equal(f.get('staging-WizzOfferJourney',{pk:'USER#customer',sk:'ORDERS'}).count,0);
  assert.equal(f.get('staging-WizzOfferJourney',{pk:'USER#customer',sk:'OFFER#merchant#discount'}).count,0);
  assert.equal(f.get('WhizzMerchants_Discounts',{discountId:'discount'}).usage_count,2);
  assert.equal(f.get('staging-Wallets',{walletId:'WALLET#PLATFORM',sk:'META'}).lockedBalance,0);
  assert.equal((await actor.run('order1',mode)).replayed,true);
  assert.equal(f.get('WhizzMerchants_Discounts',{discountId:'discount'}).usage_count,2);
 }
});
test('acceptance racing restoration rolls back coupon, account and promotion cash release together',async()=>{
 const {f,o,engine}=fixture(true);reserveOffer(f,o);f.time+=300000;
 f.beforeCommit=()=>{o.status='confirmed';};await assert.rejects(engine.run('order1','EXPIRE'));
 assert.equal(f.get('staging-WizzOfferJourney',{pk:'USER#customer',sk:'ORDERS'}).count,1);
 assert.equal(f.get('WhizzMerchants_Discounts',{discountId:'discount'}).usage_count,3);
 assert.equal(f.get('staging-Wallets',{walletId:'WALLET#PLATFORM',sk:'META'}).lockedBalance,1000);
});
