const {test}=require('node:test'),assert=require('node:assert/strict');
const {dispatchWaveSK,dispatchOfferSK}=require('../../src/utils/dispatch-cycle-keys');
const {createDispatchCycle,validateDispatchCycle}=require('../dist/dispatchCycle');
const {setup}=require('./helpers/dispatch-legacy-source-fixture.cjs');
const {createStagingDispatchCoordinator}=require('../dist/dispatchCoordinator');
const {createStagingLegacyResponses}=require('../dist/dispatchLegacy');
const {createStagingLegacyAcceptanceBridge}=require('../dist/dispatchLegacyBridge');
const {buildLegacySourcePush}=require('../dist/dispatchLegacySource');
const {pinnedWavePushData}=require('../../src/utils/pinned-wave-push');
const make=(c,extra={})=>createDispatchCycle({id:c.id,orderId:c.orderId,assignmentId:c.assignmentId,engine:c.engine,startedAt:c.startedAt,policy:c.policy,...extra});
test('key versions preserve old bytes and isolate cycle, driver, engine and wave without delimiter collisions',()=>{
 const old={engine:'LEGACY',id:'a#b'},v2={...old,keyVersion:2};assert.equal(dispatchWaveSK(old,1),'LEGACY_WAVE#1');assert.equal(dispatchOfferSK(old,'d',1),'d#WAVE#1');
 assert.equal(dispatchWaveSK({engine:'FINANCIAL',id:'x'},1),'FINANCIAL_WAVE#1');
 const keys=[dispatchWaveSK(v2,1),dispatchWaveSK({...v2,id:'a'},1),dispatchWaveSK(v2,2),dispatchOfferSK(v2,'d',1),dispatchOfferSK(v2,'d#WAVE#1',1)];assert.equal(new Set(keys).size,keys.length);assert(keys.every(k=>k.startsWith('CYCLE#')));
 for(const c of [{...v2,keyVersion:3},{...v2,id:'bad space'}])assert.throws(()=>dispatchWaveSK(c,1));
 for(const c of [{engine:'FINANCIAL',id:'bad space'},{engine:'FINANCIAL',id:'x',keyVersion:3}])assert.throws(()=>dispatchOfferSK(c,'driver',1));
 for(const n of [0,-1,1.5,1001])assert.throws(()=>dispatchWaveSK(v2,n));
});
test('namespace is frozen cycle evidence; funded initial retry isolates waves and retains settlement offer keys',async()=>{
 const f=await setup(),c=f.job().dispatchCycle,n=make(c,{keyVersion:2});assert.equal(validateDispatchCycle(n).keyVersion,2);assert.notEqual(n.digest,c.digest);assert.deepEqual(validateDispatchCycle(c),c);
 assert.throws(()=>validateDispatchCycle({...c,keyVersion:2}));assert.throws(()=>make(c,{keyVersion:3}));const financial=make(c,{keyVersion:2,engine:'FINANCIAL'});assert.equal(validateDispatchCycle(financial).engine,'FINANCIAL');assert.match(dispatchWaveSK(financial,1),/^CYCLE#[a-f0-9]{64}#FINANCIAL_WAVE#1$/);assert.equal(dispatchOfferSK(financial,'driver',1),'FINANCIAL#driver#WAVE#1');assert.notEqual(dispatchWaveSK(financial,1),dispatchWaveSK({...financial,id:'other'},1));
});
test('namespaced sender and acceptance reuse recorded terms, bridge and response receipt without money writes',async()=>{
 const f=await setup({keyVersion:2});await f.run();const o=f.offer();assert.equal(o.dispatchKeyVersion,2);assert.equal(f.get('WaveOffers_staging',{orderId:'order1',SK:'driver1#WAVE#1'}),undefined);
 assert.match(o.offerId,/^OFFER_order1_C[a-f0-9]{48}_W1$/);assert.equal(o.offerId.split('_')[1],'order1');assert.equal(o.offerId.split('_').at(-1),'W1');assert.equal(f.sent[0].message.dispatchKeyVersion,2);assert.equal(pinnedWavePushData(buildLegacySourcePush(f.sent[0].message),f.time).dispatchKeyVersion,'2');
 const bridge=createStagingLegacyAcceptanceBridge({db:f.db,now:()=>f.time,authenticateDriver:async()=>({driverId:'driver1',subjectId:'driver1'}),reserve:async x=>{f.reserve();f.get('staging-Holds',{orderId:'order1',sk:'HOLD'}).metadata.pinnedDispatchAttemptId=x.attemptId;}});
 const r=await bridge.accept({orderId:'order1',offerId:o.offerId,waveNumber:1});assert.equal(r.success,true);assert.equal((await bridge.accept({orderId:'order1',offerId:o.offerId,waveNumber:1})).replayed,true);
});
test('cycle rollover keeps prior offers and waves byte-for-byte; late response and timeout cannot advance new cycle',async()=>{
 const f=await setup({keyVersion:2});await f.run();const oldCycle=structuredClone(f.job().dispatchCycle),oldOffer=structuredClone(f.offer()),oldWave=structuredClone(f.get('WizzDispatchJobs_staging',{orderId:'order1',SK:dispatchWaveSK(oldCycle,1)}));
 // Simulate only the future trusted restart transaction outcome; this is NOT a restart API.
 const j=f.job();j.dispatchCycle=make(oldCycle,{id:'cycle-next',assignmentId:'dispatch2'});j.dispatchJobId='dispatch2';j.currentWaveNumber=0;delete j.dispatchTransition;
 f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'}).deliveryJobId='dispatch2';
 await f.executor.run({orderId:'order1',assignmentId:'dispatch2',owner:'newworker',leaseSeconds:10});
 assert.notEqual(f.offer().offerId,oldOffer.offerId);assert.deepEqual(f.get('WaveOffers_staging',{orderId:'order1',SK:oldOffer.SK}),oldOffer);assert.deepEqual(f.get('WizzDispatchJobs_staging',{orderId:'order1',SK:oldWave.SK}),oldWave);
 const respond=createStagingLegacyResponses({db:f.db,now:()=>f.time,authenticateDriver:async()=>({driverId:'driver1',subjectId:'driver1'})});await assert.rejects(respond.respond('ACCEPT',{orderId:'order1',offerId:oldOffer.offerId,waveNumber:1}));await assert.rejects(respond.respond('DECLINE',{orderId:'order1',offerId:oldOffer.offerId,waveNumber:1}));
 const before=structuredClone(f.job());await assert.rejects(createStagingDispatchCoordinator({db:f.db,now:()=>f.time}).plan({orderId:'order1',assignmentId:'dispatch1',source:'TIMEOUT'}));assert.deepEqual(f.job(),before);
});
test('decline and expiry operate on the namespaced wave while old-format lookalikes stay unchanged',async()=>{
 const f=await setup({keyVersion:2});await f.run();const decoy={...structuredClone(f.offer()),SK:'driver1#WAVE#1',offerId:'old-offer',dispatchCycleId:'old-cycle'};f.put('WaveOffers_staging',decoy);await f.respond('driver1','DECLINE');assert.equal(f.offer().responseStatus,'rejected');f.time+=90000;
 await createStagingDispatchCoordinator({db:f.db,now:()=>f.time}).plan({orderId:'order1',assignmentId:'dispatch1',source:'TIMEOUT'});assert.equal(f.offer('driver2').responseStatus,'expired');assert.deepEqual(f.get('WaveOffers_staging',{orderId:'order1',SK:decoy.SK}),decoy);
});
