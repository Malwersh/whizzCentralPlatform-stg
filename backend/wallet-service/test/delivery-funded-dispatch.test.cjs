const {test}=require('node:test'),assert=require('node:assert/strict');
const {createStagingDriverOfferAcceptance:acceptance}=require('../dist/driverOfferAcceptance');
const {fixture}=require('./helpers/delivery-funded-dispatch-fixture.cjs');
const {createStagingDispatchCandidates:candidates}=require('../dist/dispatchCandidates');
test('funded cycle creation, pinned wave and replay preserve original funding and price',async()=>{
 const f=await fixture(),funds=f.funding(),snapshot=structuredClone(f.order().financialSnapshot);await f.create();await f.execute();
 assert.equal(f.job().dispatchCycle.engine,'FINANCIAL');assert.equal(f.out.length,2);assert.equal(f.out[0].message.offer.schemaVersion,2);
 assert.equal(f.funding(),funds);assert.deepEqual(f.order().financialSnapshot,snapshot);
 assert.equal((await f.create()).replayed,true);await f.execute();assert.equal(f.out.length,2);assert.equal(f.funding(),funds);
});
test('last V2 decline advances once through coordinator and next wave retains subsidy reservation',async()=>{
 const f=await fixture();await f.create();await f.execute();const funds=f.funding();
 assert.equal((await f.service('driver1').decline(f.selector('driver1'))).transition.action,'WAIT');
 const last=await f.service('driver2').decline(f.selector('driver2'));assert.equal(last.transition.waveNumber,2);
 const replay=await f.service('driver2').decline(f.selector('driver2'));assert.equal(replay.transition.intentId,last.transition.intentId);
 await f.execute();assert.equal(f.out.length,4);assert.equal(f.out.at(-1).message.waveNumber,2);assert.equal(f.funding(),funds);
});
test('V2 timeout expires prior proposals and advances without repricing or reserving campaign again',async()=>{
 const f=await fixture();await f.create();await f.execute();const funds=f.funding();f.time+=60000;
 // Fresh coordinates are needed only for producing the next wave, not pricing the accepted order.
 for(const id of ['driver1','driver2'])f.get('WizzDriverLiveState_staging',{driverId:id}).locationUpdatedAt=new Date(f.time).toISOString();
 await f.execute();assert.equal(f.job().currentWaveNumber,2);assert.equal(f.get('WaveOffers_staging',{orderId:'order1',SK:'FINANCIAL#driver1#WAVE#1'}).responseStatus,'financial_expired');assert.equal(f.funding(),funds);
});
test('one V2 pinned acceptance wins and coordinator stops while original campaign reservation remains single',async()=>{
 const f=await fixture();await f.create();await f.execute();const results=await Promise.allSettled(['driver1','driver2'].map(id=>f.service(id).accept(f.selector(id))));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.order().financialAcceptance.schemaVersion,2);
 assert.equal((await f.coordinator.plan({orderId:'order1',assignmentId:'dispatch1',source:'TIMEOUT'})).action,'STOP');
 assert.equal(f.get('staging-PlatformStaff',{pk:'DELIVERY_USAGE#delivery',sk:'CUSTOMER#customer'}).reservedUses,1);
});
test('capability off or altered original snapshot never downgrades to a legacy cycle',async()=>{
 const f=await fixture(false);await assert.rejects(f.create());assert.equal(f.job(),undefined);
 const g=await fixture();g.order().financialSnapshot.deliveryFunding.policyPin.policyId='foreign';await assert.rejects(g.create());assert.equal(g.job(),undefined);
});
test('actual candidate reader accepts original funded snapshot and uses captured selection rules',async()=>{
 const f=await fixture();await f.create();const plan=await f.coordinator.plan({orderId:'order1',assignmentId:'dispatch1',source:'START'});
 await f.coordinator.acquire({orderId:'order1',assignmentId:'dispatch1',intentId:plan.intentId,owner:'worker',leaseSeconds:10});
 const intent=f.get('WizzDispatchJobs_staging',{orderId:'order1',SK:'DISPATCH_TRANSITION#'+plan.intentId}),send=f.db.send;
 for(const id of ['driver1','driver2'])f.get('WizzDriverLiveState_staging',{driverId:id}).current_work_region_id='zone1';
 f.db.send=async c=>['QueryCommand','ScanCommand'].includes(c.constructor.name)?{Items:[{driverId:'driver1'},{driverId:'driver2'}]}:send(c);
 const result=await candidates({db:f.db,now:()=>f.time,enableDeliveryFunding:true})({job:f.job(),intent});
 assert.ok(result.length>0);assert.ok(result.every(id=>['driver1','driver2'].includes(id)));
 await assert.rejects(candidates({db:f.db,now:()=>f.time})({job:f.job(),intent}));
});
test('pinned funded winner completes with original shares and produces verified merchant accrual',async()=>{
 const f=await fixture();await f.create();await f.execute();await f.service('driver1').accept(f.selector('driver1'));
 const terms=structuredClone(f.order().financialAcceptance);f.order().status='arrived_at_customer';
 const {createStagingCodCompletion}=require('../dist/codCompletion'),{deriveMerchantCodAccrual}=require('../dist/merchantSettlementAccrual');
 await createStagingCodCompletion({db:f.db,now:()=>f.time,enableDeliveryFunding:true,authenticateDriver:async()=>({driverId:'driver1',subjectId:'driver1'})}).complete({orderId:'order1',cashCollected:true});
 const line=deriveMerchantCodAccrual({branchId:'branch1',order:f.order(),acceptedOffer:f.get('WaveOffers_staging',{orderId:'order1',SK:'FINANCIAL#driver1#WAVE#1'}),outcome:f.get('staging-Holds',{orderId:'order1',sk:'FINANCIAL_OUTCOME'}),payable:f.get('staging-Holds',{orderId:'order1',sk:'MERCHANT_PAYABLE'})});
 assert.equal(line.schemaVersion,2);assert.equal(line.amounts.merchantNet.minorAmount,terms.allocation.merchantPayable.minorAmount);
 assert.deepEqual(f.get('staging-PlatformStaff',{pk:'DELIVERY_RESERVATION#order1',sk:'META'}).policyPin,terms.deliveryFunding.policyPin);
 assert.equal(f.get('staging-PlatformStaff',{pk:'DELIVERY_USAGE#delivery',sk:'CUSTOMER#customer'}).completedUses,1);
});
test('snapshot race prevents cycle creation and foreign driver cannot decline a funded proposal',async()=>{
 const f=await fixture();f.beforeCommit=()=>{f.order().financialSnapshot.deliveryFunding.policyPin.policyId='foreign';};await assert.rejects(f.create());assert.equal(f.job(),undefined);
 const g=await fixture();await g.create();await g.execute();
 const foreign=acceptance({db:g.db,now:()=>g.time,enableDeliveryFunding:true,context:g.context,authenticateDriver:async()=>({driverId:'driver1',subjectId:'other'})});
 await assert.rejects(foreign.decline(g.selector('driver1')));assert.equal(g.get('WaveOffers_staging',{orderId:'order1',SK:'FINANCIAL#driver1#WAVE#1'}).responseStatus,'financial_pending');
});
