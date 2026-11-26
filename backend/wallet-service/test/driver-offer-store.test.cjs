const {test}=require('node:test');
const assert=require('node:assert/strict');
const {GetCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {input,at}=require('./helpers/driver-offer-fixture.cjs');
const {buildDriverOffer:build}=require('../dist/driverOffer');
const {prepareDriverOfferFinancialSnapshot:envelope}=require('../dist/driverOfferOrderReader');
const {createStagingDriverOfferStore:store}=require('../dist/driverOfferStore');
const clone=structuredClone;
const rejects=(p,code)=>assert.rejects(p,e=>e.code===code);
function check(TableName,Key){return {ConditionCheck:{TableName,Key,ConditionExpression:'#v = :v',ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':v':1}}};}
function request(){return {offer:build(input()),waveNumber:1,guards:{
 assignment:check('WizzDispatchJobs_staging',{orderId:'order1',SK:'METADATA'}),
 driver:check('WhizzDrivers_staging',{driverId:'driver1'}),
 position:check('WizzDriverLiveState_staging',{driverId:'driver1'}),
 branch:check('WhizzMerchants_Businesses',{businessId:'branch1'}),
 policy:check('staging-PlatformStaff',{pk:'PRICING',sk:'CURRENT'}),
 deletions:[check('staging-AccountDeletion',{pk:'ACCOUNT_LIFECYCLE#DRIVER#driver1',sk:'META'})]}};}
function fixture(){
 let saved, order={PK:'ORDER#order1',SK:'META',orderId:'order1',storeId:'branch1',merchantId:'merchant1',status:'ready_for_pickup',financialSnapshot:envelope(input().order)};
 const calls=[]; let time=Date.parse(at), lose=false, conflict=false, unavailable=false, onOrder, cancellationReasons;
 const db={async send(c){calls.push(c);
  if(c instanceof GetCommand){
   if(c.input.TableName==='WizzDispatchJobs_staging')return {Item:{orderId:'order1',dispatchJobId:input().assignment.id}};
   if(c.input.TableName==='WaveOffers_staging'){if(unavailable)throw Error('private details');return {Item:clone(saved)};}
   if(c.input.TableName==='WizzOrders'){if(onOrder)onOrder();return {Item:clone(order)};}
   throw Error('unexpected read');
  }
  assert.ok(c instanceof TransactWriteCommand);
  const tx=c.input.TransactItems;
  assert.equal(tx.filter(o=>o.Put).length,1);
  assert.equal(tx.filter(o=>o.ConditionCheck?.TableName==='WizzOrders').length,1);
  // This mock simulates conditional failure before all writes, plus conditional put concurrency.
  if(conflict||saved){const error=Error('condition rejected');error.name='TransactionCanceledException';if(cancellationReasons)error.CancellationReasons=cancellationReasons;throw error;}
  saved=clone(tx.find(o=>o.Put).Put.Item);
  if(lose)throw Error('response lost after commit');
  return {};
 }};
 const service=store({db,now:()=>time});return {service,calls,get saved(){return saved;},set saved(v){saved=v;},get order(){return order;},
 set time(v){time=v;},set lose(v){lose=v;},set conflict(v){conflict=v;},set cancellationReasons(v){cancellationReasons=v;},set unavailable(v){unavailable=v;},set onOrder(v){onOrder=v;}};
}
const selector={orderId:'order1',driverId:'driver1',subjectId:'driver-sub',waveNumber:1};
test('issuance atomically stores proposal with strong order snapshot and required external guards; legacy cannot claim its key/status',async()=>{
 const f=fixture(),r=await f.service.save(request());assert.equal(r.replayed,false);assert.equal(r.acceptanceAndWalletWriteRequired,true);
 assert.equal(f.saved.SK,'FINANCIAL#driver1#WAVE#1');assert.notEqual(f.saved.SK,'driver1#WAVE#1');assert.equal(f.saved.responseStatus,'financial_pending');assert.equal(f.saved.isWinner,false);
 assert.equal(f.saved.ttl,undefined);assert.deepEqual(f.saved.financialOffer,request().offer);
 const tx=f.calls.find(c=>c instanceof TransactWriteCommand).input;
 assert.equal(tx.TransactItems.length,8);assert.equal(tx.ClientRequestToken.length,36);
 assert.ok(f.calls.filter(c=>c instanceof GetCommand).every(c=>c.input.ConsistentRead));
 assert.ok(!tx.TransactItems.some(o=>o.Update||o.Delete));
});
test('exact retry and recovery after lost commit response do not write or recalculate a second offer',async()=>{
 const f=fixture();f.lose=true;const r=await f.service.save(request());assert.equal(r.replayed,true);
 f.time=Date.parse('2026-10-15T13:00:00.000Z');const again=await f.service.save(request());assert.equal(again.replayed,true);
 assert.equal(f.calls.filter(c=>c instanceof TransactWriteCommand).length,1);
 await rejects(f.service.view(selector),'DRIVER_OFFER_EXPIRED');
});
test('same wave cannot be replaced by a changed offer, or reset after acceptance/expiry/decline',async()=>{
 const f=fixture();await f.service.save(request());const other=request();const changed=input('4000');other.offer=build(changed);
 await rejects(f.service.save(other),'DRIVER_OFFER_SAVE_CONFLICT');
 for(const status of ['accepted','expired','declined']){f.saved.responseStatus=status;await rejects(f.service.save(request()),'DRIVER_OFFER_SAVE_CONFLICT');}
 assert.equal(f.calls.filter(c=>c instanceof TransactWriteCommand).length,1);
});
test('concurrent identical saves converge on a single row without overwriting',async()=>{
 const f=fixture();const result=await Promise.all([f.service.save(request()),f.service.save(request())]);assert.equal(result.filter(v=>!v.replayed).length,1);assert.equal(result.filter(v=>v.replayed).length,1);
});
test('missing/malformed/mutating/foreign/duplicate guards are rejected before a transaction',async()=>{
 for(const mutate of [r=>delete r.guards.driver,r=>r.guards.deletions=[],r=>r.waveNumber=0,r=>r.extra=true,
  r=>r.guards.driver.ConditionCheck.Key.driverId='other',r=>r.guards.assignment.ConditionCheck.Key.orderId='other',
  r=>r.guards.assignment.ConditionCheck.TableName='prod',r=>r.guards.policy={Put:{TableName:'staging-PlatformStaff'}},
  r=>r.guards.policy.ConditionCheck.ConditionExpression='',r=>r.guards.deletions.push(clone(r.guards.deletions[0]))]){
  const f=fixture(),r=request();mutate(r);await rejects(f.service.save(r),'INVALID_DRIVER_OFFER_SAVE');assert.ok(!f.calls.some(c=>c instanceof TransactWriteCommand));
 }
});
test('order changes, assignment, missing snapshot and PREPAID never reach persistence',async()=>{
 for(const mutate of [o=>o.financialSnapshot=envelope({...input().order,revision:2}),o=>o.driverId='other',o=>delete o.financialSnapshot,
  o=>o.financialSnapshot=envelope(input('3000','PREPAID').order)]){
  const f=fixture();mutate(f.order);await assert.rejects(f.service.save(request()));assert.equal(f.saved,undefined);assert.ok(!f.calls.some(c=>c instanceof TransactWriteCommand));
 }
});
test('expiry is checked again after reads; stale guard conflicts cannot leave a partial row',async()=>{
 const f=fixture();f.onOrder=()=>{f.time=Date.parse(request().offer.expiresAt);};await rejects(f.service.save(request()),'DRIVER_OFFER_EXPIRED');assert.equal(f.saved,undefined);
 const c=fixture();c.conflict=true;await rejects(c.service.save(request()),'DRIVER_OFFER_SAVE_CONFLICT');assert.equal(c.saved,undefined);
});
test('read failure is explicit and never falls back to a successful issue',async()=>{
 const f=fixture();f.unavailable=true;await rejects(f.service.save(request()),'DRIVER_OFFER_SAVE_UNAVAILABLE');assert.ok(!f.calls.some(c=>c instanceof TransactWriteCommand));
});
test('driver view omits internal financial records, requires exact identity, pending state and current expiry',async()=>{
 const f=fixture();await f.service.save(request());const v=await f.service.view(selector);
 assert.equal(v.driverEarning.minorAmount,3000000);assert.equal(v.driverWalletHold.minorAmount,10500000);
 for(const field of ['financialOffer','source','driverSubjectId','ruleHash','allocation','policyVersion','merchantCommission'])assert.equal(v[field],undefined);
 await rejects(f.service.view({...selector,subjectId:'other'}),'DRIVER_OFFER_SCOPE_MISMATCH');
 await rejects(f.service.view({...selector,driverId:'../bad'}),'DRIVER_OFFER_NOT_AVAILABLE');
 f.saved.responseStatus='accepted';await rejects(f.service.view(selector),'DRIVER_OFFER_NOT_AVAILABLE');
});
test('input is detached before awaiting storage; corrupt persisted proposal cannot be displayed',async()=>{
 const f=fixture(),r=request(),pending=f.service.save(r);r.offer=build(input('4000'));r.guards.driver.ConditionCheck.Key.driverId='other';await pending;
 assert.equal(f.saved.financialOffer.calculation.driverEarning.minorAmount,3000000);
 f.saved.financialOffer.allocation.driverWalletHold.minorAmount=0;await rejects(f.service.view(selector),'INVALID_DRIVER_OFFER');
});
test('part 17 commercial snapshot feeds persisted driver offer without repricing confirmed customer amount',async()=>{
 const commercial=require('./helpers/commercial-source-fixture.cjs').fixture();
 const priced=await commercial.prepare(),source=input(),snapshot=priced.financialSnapshot.snapshot;
 source.order=snapshot;
 source.pickupRoute.destination=snapshot.branchPoint;
 source.deliveryRoute.origin=snapshot.branchPoint;
 source.deliveryRoute.destination=snapshot.customerPoint;
 const r=request();r.offer=build(source);r.guards.assignment.ConditionCheck.Key.orderId=snapshot.orderId;r.guards.branch.ConditionCheck.Key.businessId=snapshot.branchId;
 const f=fixture();Object.assign(f.order,{PK:'ORDER#'+snapshot.orderId,orderId:snapshot.orderId,storeId:snapshot.branchId,
  merchantId:snapshot.merchantId,financialSnapshot:priced.financialSnapshot});
 await f.service.save(r);
 const v=await f.service.view({...selector,orderId:snapshot.orderId});
 assert.deepEqual(v.customerCashToCollect,priced.calculation.customerTotal);
 assert.equal(v.customerCashToCollect.minorAmount,5000000);
 assert.equal(v.driverEarning.minorAmount,3000000);
 assert.equal(v.driverWalletHold.minorAmount,4000000);
 assert.equal(v.laterWalletEarningCredit.minorAmount,2000000);
 assert.equal(f.saved.financialOffer.source.order.merchantId,'org');
});
test('lifecycle absence guards can omit expression maps; transaction preserves that check',async()=>{
 const f=fixture(),r=request();r.guards.deletions=[{ConditionCheck:{TableName:'staging-AccountDeletion',Key:{pk:'ACCOUNT_LIFECYCLE#DRIVER#driver1',sk:'META'},ConditionExpression:'attribute_not_exists(pk)'}}];
 await f.service.save(r);
 const tx=f.calls.find(c=>c instanceof TransactWriteCommand).input.TransactItems;
 assert.equal(tx.find(v=>v.ConditionCheck?.TableName==='staging-AccountDeletion').ConditionCheck.ConditionExpression,'attribute_not_exists(pk)');
});

test('position retry classification requires exactly the isolated position fence and explicit cancellation reasons',async()=>{
 for(const indices of [[2],[1,2],[0],[3],[]]){const f=fixture();f.conflict=true;f.cancellationReasons=Array.from({length:8},(_,i)=>({Code:indices.includes(i)?'ConditionalCheckFailed':'None'}));await rejects(f.service.save(request()),indices.length===1&&indices[0]===2?'DRIVER_OFFER_POSITION_CONFLICT':'DRIVER_OFFER_SAVE_CONFLICT');assert.equal(f.saved,undefined);}
});
