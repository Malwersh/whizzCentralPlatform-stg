const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./helpers/delivery-funded-driver-fixture.cjs');
const {createStagingCodIntegration:create}=require('../dist/codIntegration');
const {createStagingCodCompletion}=require('../dist/codCompletion');
const metric={PK:'DRIVER#driver1',SK:'METRICS'};
const event=f=>[...f.rows.values()].find(r=>r.kind==='COD_ACCEPTANCE_OUTBOX');
const worker=(f,enabled=true)=>create({db:f.db,now:()=>f.time,enableDeliveryFunding:enabled});
test('V2 real wave acceptance and completion integrate metrics once without touching money',async()=>{
 const f=await fixture();await f.run();await f.accept();const a=event(f);
 const before=[...f.rows.entries()].filter(([k])=>/^(staging-Wallets|staging-LedgerEntries)\|/.test(k)).map(([k,v])=>[k,structuredClone(v)]);
 assert.equal((await worker(f).processEvent(a.operationId)).status,'INTEGRATED');
 assert.equal(f.get('WizzDriverPerformanceMetrics_staging',metric).totalAccepted,1);
 assert.equal((await worker(f).processEvent(a.operationId)).replayed,true);
 assert.deepEqual([...f.rows.entries()].filter(([k])=>/^(staging-Wallets|staging-LedgerEntries)\|/.test(k)),before);
 const order=f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'});order.status='arrived_at_customer';
 const r=await createStagingCodCompletion({db:f.db,now:()=>f.time,enableDeliveryFunding:true,authenticateDriver:async()=>({driverId:'driver1',subjectId:'driver1'})}).complete({orderId:'order1',cashCollected:true});
 assert.equal((await worker(f).processEvent(r.operationId+':EVENT')).status,'INTEGRATED');
 assert.equal(f.get('WizzDriverPerformanceMetrics_staging',metric).totalCompleted,1);
 assert.equal((await worker(f).processEvent(r.operationId+':EVENT')).replayed,true);
});
test('V2 acceptance disabled or altered offer cannot count a trip',async()=>{
 for(const corrupt of [false,true]){
  const f=await fixture();await f.run();await f.accept();
  if(corrupt)f.get('WaveOffers_staging',{orderId:'order1',SK:'FINANCIAL#driver1#WAVE#1'}).financialOffer.digest='0'.repeat(64);
  assert.equal((await worker(f,corrupt).processEvent(event(f).operationId)).status,'INTEGRATION_REVIEW_REQUIRED');
  assert.equal(f.get('WizzDriverPerformanceMetrics_staging',metric),undefined);
 }
});
test('V2 before-pickup cancellation integrates a notice without increasing completed trips',async()=>{
 const f=await fixture();await f.run();await f.accept();await worker(f).processEvent(event(f).operationId);
 const order=f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'});order.status='arrived_at_store';
 const {createStagingCodReassignment}=require('../dist/codReassignment');
 const r=await createStagingCodReassignment({db:f.db,now:()=>f.time,reassignmentWindowSeconds:120,enableDeliveryFunding:true,authenticate:async()=>({kind:'MERCHANT_OWNER',subjectId:'owner1'})}).cancelBeforePickup({orderId:'order1',branchId:'branch1',offerId:order.financialAcceptance.offerId,attempt:1,goodsRetainedByBranch:true,cashCollected:false});
 assert.equal((await worker(f).processEvent(r.operationId+':EVENT')).status,'INTEGRATED');
 assert.equal(f.get('WizzDriverPerformanceMetrics_staging',metric).totalCompleted,0);
 assert.equal([...f.rows.values()].filter(r=>r.type==='wallet_cod_lifecycle').length,1);
});
test('altered V2 accepted funding terms cannot authorize integration',async()=>{
 const f=await fixture();await f.run();await f.accept();
 f.get('WaveOffers_staging',{orderId:'order1',SK:'FINANCIAL#driver1#WAVE#1'}).acceptedTerms.deliveryFunding.policyPin.policyId='foreign';
 assert.equal((await worker(f).processEvent(event(f).operationId)).status,'INTEGRATION_REVIEW_REQUIRED');
 assert.equal(f.get('WizzDriverPerformanceMetrics_staging',metric),undefined);
});
