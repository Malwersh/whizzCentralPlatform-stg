const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./helpers/dispatch-cycle-fixture.cjs');
const {createStagingDispatchCoordinator}=require('../dist/dispatchCoordinator');
const {createStagingDriverFinancialWave}=require('../dist/driverFinancialWave');
const jobKey={orderId:'order1',SK:'METADATA'},orderKey={PK:'ORDER#order1',SK:'META'};
async function setup(engine='LEGACY'){
 const f=fixture(engine);await f.create();f.coordinator=createStagingDispatchCoordinator({db:f.db,now:()=>f.time});
 f.plan=source=>f.coordinator.plan({orderId:'order1',assignmentId:'dispatch1',source:source??'TIMEOUT'});
 f.intent=()=>f.get('WizzDispatchJobs_staging',{orderId:'order1',SK:'DISPATCH_TRANSITION#'+f.job().dispatchTransition.id});
 f.acquire=(owner='worker1',leaseSeconds=10)=>f.coordinator.acquire({orderId:'order1',assignmentId:'dispatch1',intentId:f.intent().intentId,owner,leaseSeconds});
 f.fence=(owner,leaseVersion)=>f.coordinator.executionFence({orderId:'order1',assignmentId:'dispatch1',intentId:f.intent().intentId,owner,leaseVersion});
 f.ready=async statuses=>{
  await f.acquire();const intent=f.intent();
  if(engine==='FINANCIAL'){
   const wave=createStagingDriverFinancialWave({db:f.db,context:f.context,pinnedTransitionId:intent.intentId,now:()=>f.time,sendOffer:async()=>{},operating:{...f.job().dispatchCycle.policy,condition:null}});
   await wave.run({orderId:'order1',branchId:'branch1',waveNumber:intent.waveNumber,driverIds:['driver1','driver2']});
  }else{
   f.job().currentWaveNumber=intent.waveNumber;
   f.put('WizzDispatchJobs_staging',{orderId:'order1',SK:'LEGACY_WAVE#'+intent.waveNumber,kind:'DISPATCH_WAVE',state:'READY',assignmentId:'dispatch1',branchId:'branch1',cycleDigest:f.job().dispatchCycle.digest,driverIds:['driver1','driver2']});
   for(const driverId of ['driver1','driver2'])f.put('WaveOffers_staging',{orderId:'order1',SK:driverId+'#WAVE#'+intent.waveNumber,driverId,waveNumber:intent.waveNumber,dispatchJobId:'dispatch1',dispatchCycleId:f.job().dispatchCycle.id,responseStatus:'pending',expiresAt:intent.waveDeadline});
  }
  // Seed the acknowledgement a future durable executor must write. This is not
  // an implementation of that executor or evidence of delivered notifications.
  Object.assign(intent,{state:'APPLIED',appliedAt:new Date(f.time).toISOString(),leaseVersion:1});
  for(const [i,driverId]of ['driver1','driver2'].entries())if(statuses){const key=engine==='FINANCIAL'?`FINANCIAL#${driverId}#WAVE#${intent.waveNumber}`:`${driverId}#WAVE#${intent.waveNumber}`;f.get('WaveOffers_staging',{orderId:'order1',SK:key}).responseStatus=statuses[i];}
 };
 return f;
}
test('timeout and decline concurrently claim one immutable transition, retries return the same pending intent',async()=>{
 const f=await setup(),results=await Promise.all([f.plan('TIMEOUT'),f.plan('DECLINE')]);assert.equal(results.filter(r=>r.claimed).length,1);assert.equal(results[0].intentId,results[1].intentId);const saved=structuredClone(f.intent());f.time+=1000;assert.equal((await f.plan()).claimed,false);assert.deepEqual(f.intent(),saved);assert.equal(f.job().currentWaveNumber,0);
});
test('a lost transaction acknowledgement returns the durable intent without another transition',async()=>{
 const f=await setup(),send=f.db.send;let once=false;f.db.send=async c=>{const r=await send(c);if(c.input.TransactItems&&!once){once=true;throw Error('reply lost');}return r;};const r=await f.plan();assert.equal(r.claimed,false);assert.equal((await f.plan()).intentId,r.intentId);assert.equal(f.intent().sequence,1);
});
test('concurrent execution claims have one lease owner; expired leases fence out the old executor',async()=>{
 const f=await setup();await f.plan();const r=await Promise.all([f.acquire('a'),f.acquire('b')]);assert.equal(r.filter(x=>x.acquired).length,1);const winner=r[0].acquired?'a':'b',loser=winner==='a'?'b':'a';assert.equal((await f.acquire(winner)).replayed,true);assert.equal((await f.fence(winner,1)).requiresAtomicComposition,true);
 f.time+=10000;assert.equal((await f.acquire(loser)).leaseVersion,2);await assert.rejects(f.fence(winner,1),/DISPATCH_LEASE_EXPIRED/);assert.equal((await f.fence(loser,2)).intent.leaseOwner,loser);
});
test('pending preparation expires into review once, cancels the lease and never moves funds',async()=>{
 const f=await setup();await f.plan();await f.acquire();const original=structuredClone(f.intent()),before=[...f.rows].filter(([k])=>/^(staging-Wallets|staging-LedgerEntries|staging-Holds)\|/.test(k));f.time=Date.parse(original.waveDeadline);
 const r=await f.plan();assert.equal(r.action,'REVIEW');assert.equal(f.job().status,'no_driver_available');assert.equal(f.get('WizzOrders',orderKey).status,'ready_for_pickup');assert.equal(f.get('WizzOrders',orderKey).financialSearch.reason,'PREPARATION_DEADLINE');assert.equal(f.get('WizzDispatchJobs_staging',{orderId:'order1',SK:original.SK}).state,'CANCELLED');assert.equal((await f.plan()).intentId,r.intentId);await assert.rejects(f.acquire());assert.deepEqual([...f.rows].filter(([k])=>/^(staging-Wallets|staging-LedgerEntries|staging-Holds)\|/.test(k)),before);
});
test('ready waves use actual stored offer deadlines and atomically expire the prior offers before the next intent',async()=>{
 for(const engine of ['LEGACY','FINANCIAL']){const f=await setup(engine);await f.plan();await f.ready();assert.equal((await f.plan()).action,'WAIT');f.time=Date.parse(f.intent().waveDeadline);const r=await f.plan();assert.equal(r.waveNumber,2);const priorOffers=[...f.rows].filter(([k,v])=>k.startsWith('WaveOffers_staging|')&&v.waveNumber===1).map(([,v])=>v);assert(priorOffers.every(v=>v.responseStatus===(engine==='FINANCIAL'?'financial_expired':'expired')));}
});
test('all declined and empty waves advance through the same policy and the fourth rule retains ALL',async()=>{
 const f=await setup();for(let n=1;n<=3;n++){const r=await f.plan('DECLINE');assert.equal(r.waveNumber,n);await f.ready(['rejected','rejected']);}
 const fourth=await f.plan('DECLINE');assert.equal(fourth.waveNumber,4);assert.equal(f.intent().rule.recipients,'ALL');
 await f.ready(['rejected','rejected']);const review=await f.plan();assert.equal(review.action,'REVIEW');assert.equal(f.get('WizzOrders',orderKey).financialSearch.reason,'MAX_WAVES_REACHED');
 const g=await setup();await g.plan();await g.ready();const wave=g.get('WizzDispatchJobs_staging',{orderId:'order1',SK:'LEGACY_WAVE#1'});wave.driverIds=[];assert.equal((await g.plan()).waveNumber,2);
});
test('assignment, order completion, deletion and changed proof prevent competing transition writes',async()=>{
 for(const race of ['assign','terminal','delete','offer']){const f=await setup();await f.plan();await f.ready(['rejected','rejected']);const saved=structuredClone(f.intent());f.beforeCommit=()=>{
  if(race==='assign'){f.job().status='assigned';f.get('WizzOrders',orderKey).driverId='driver1';}
  if(race==='terminal')f.get('WizzOrders',orderKey).status='cancelled';
  if(race==='delete')f.put('staging-AccountDeletion',{pk:'BUSINESS_LIFECYCLE#MERCHANT#branch1',sk:'META'});
  if(race==='offer')f.get('WaveOffers_staging',{orderId:'order1',SK:'driver1#WAVE#1'}).responseStatus='accepted';
 };const r=await Promise.allSettled([f.plan()]);assert(r[0].status==='rejected'||r[0].value.action==='STOP');assert.equal(f.intent().intentId,saved.intentId);}
});
test('foreign or missing offers, oversized plans and mismatched cycle/lease records fail closed',async()=>{
 for(const mutate of [f=>f.get('WaveOffers_staging',{orderId:'order1',SK:'driver1#WAVE#1'}).dispatchCycleId='other',f=>f.get('WizzDispatchJobs_staging',{orderId:'order1',SK:'LEGACY_WAVE#1'}).driverIds=Array.from({length:26},(_,i)=>'d'+i),f=>f.intent().rule.radiusMeters=1]){const f=await setup();await f.plan();await f.ready();mutate(f);await assert.rejects(f.plan());}
 const f=await setup();await f.plan();await f.acquire();await assert.rejects(f.fence('worker1',999));
});
test('an unavailable new schema never falls back to an unpinned old job',async()=>{
 const f=await setup();delete f.job().dispatchCycle;await assert.rejects(f.plan());assert.equal(f.job().dispatchTransition,undefined);
});

test('START delegates preparation-deadline review to timeout host without committing order review',async()=>{
 const f=await setup();await f.plan();await f.acquire();f.time=Date.parse(f.intent().waveDeadline);
 const before=structuredClone([...f.rows]);const result=await f.plan('START');
 assert.equal(result.action,'STOP');assert.equal(result.reason,'REVIEW_REQUIRES_TIMEOUT_HOST');assert.deepEqual([...f.rows],before);
 assert.equal((await f.plan('TIMEOUT')).action,'REVIEW');assert.equal(f.job().status,'no_driver_available');
});

test('released accepted financial offer permits next wave only with matching immutable unassignment',async()=>{
 const f=await setup('FINANCIAL');await f.plan();await f.ready(['financial_accepted','financial_declined']);
 const offer=f.get('WaveOffers_staging',{orderId:'order1',SK:'FINANCIAL#driver1#WAVE#1'});
 const {resolveFinancialOffer}=require('../dist/financialOfferVersion');const offerId=resolveFinancialOffer(offer.financialOffer).offerId;
 Object.assign(f.get('WizzOrders',orderKey),{assignmentAttemptCounter:1,holdAmount:0,holdStatus:'NONE',financialRelease:{attempt:1,offerId,operationId:'release1'}});
 Object.assign(f.job(),{financialRedispatch:{waveNumber:2,excludeDriverIds:['driver1'],operationId:'release1'},expiresAt:new Date(f.time+300000).toISOString()});
 await assert.rejects(f.plan(),/DRIVER_OFFER_ORDER_UNAVAILABLE/);
 f.put('staging-Holds',{orderId:'order1',sk:'ASSIGNMENT_RELEASE#1',kind:'COD_ASSIGNMENT_RELEASE',outcome:'UNASSIGNED',attempt:1,offerId,operationId:'release1',driverId:'driver1',branchId:'branch1',snapshotDigest:require('../dist/deliveryQuoteRecord').quoteHash(f.get('WizzOrders',orderKey).financialSnapshot)});
 f.time+=61000;const p=await f.plan();assert.equal(p.action,'START_WAVE');assert.equal(p.waveNumber,2);
 await f.ready(['financial_declined','financial_declined']);f.job().financialRedispatch=null;f.time+=61000;
 assert.equal((await f.plan()).waveNumber,3);
});
test('expired released search enters administrative review without cancelling customer order',async()=>{
 const f=await setup('FINANCIAL');await f.plan();await f.ready(['financial_declined','financial_declined']);
 Object.assign(f.get('WizzOrders',orderKey),{assignmentAttemptCounter:1,holdAmount:0,holdStatus:'NONE',financialRelease:{attempt:1,offerId:'offer1',operationId:'release1'}});
 Object.assign(f.job(),{financialRedispatch:{waveNumber:2,excludeDriverIds:['driver1'],operationId:'release1'},expiresAt:new Date(f.time+1000).toISOString()});
 f.put('staging-Holds',{orderId:'order1',sk:'ASSIGNMENT_RELEASE#1',kind:'COD_ASSIGNMENT_RELEASE',outcome:'UNASSIGNED',attempt:1,offerId:'offer1',operationId:'release1',driverId:'driver1',branchId:'branch1',snapshotDigest:require('../dist/deliveryQuoteRecord').quoteHash(f.get('WizzOrders',orderKey).financialSnapshot)});
 f.time+=1001;assert.equal((await f.plan()).action,'REVIEW');assert.equal(f.job().status,'no_driver_available');assert.equal(f.get('WizzOrders',orderKey).status,'ready_for_pickup');
});

test('late unassignment cannot extend the original captured cycle and reaches review',async()=>{
 const f=await setup('FINANCIAL');await f.plan();await f.ready(['financial_declined','financial_declined']);
 const o=f.get('WizzOrders',orderKey),offerId='offer1';Object.assign(o,{assignmentAttemptCounter:1,holdAmount:0,holdStatus:'NONE',financialRelease:{attempt:1,offerId,operationId:'release1'}});
 f.put('staging-Holds',{orderId:'order1',sk:'ASSIGNMENT_RELEASE#1',kind:'COD_ASSIGNMENT_RELEASE',outcome:'UNASSIGNED',attempt:1,offerId,operationId:'release1',driverId:'driver1',branchId:'branch1',snapshotDigest:require('../dist/deliveryQuoteRecord').quoteHash(o.financialSnapshot)});
 f.time=Date.parse(f.job().dispatchCycle.searchDeadline)+1000;
 Object.assign(f.job(),{financialRedispatch:{waveNumber:2,excludeDriverIds:['driver1'],operationId:'release1'},expiresAt:new Date(f.time+300000).toISOString()});
 assert.equal((await f.plan()).action,'REVIEW');assert.equal(f.job().status,'no_driver_available');
});
