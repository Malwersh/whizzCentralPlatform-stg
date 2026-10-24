const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./helpers/dispatch-cycle-fixture.cjs');
const {createStagingLegacyWaveExecutor,createStagingLegacyResponses}=require('../dist/dispatchLegacy');
const {buildLegacyOfferRow}=require('../../../lambda/WaveSystem_StartWave/legacy-offer-contract');
const {setup}=require('./helpers/dispatch-legacy-fixture.cjs');
test('legacy producer uses shared offer pricing, pins READY/APPLIED and retries without selection or duplicate sends',async()=>{
 const f=await setup();const r=await f.run();assert.equal(r.kind,'LEGACY_WAVE_READY');assert.equal(f.wave().state,'READY');assert.equal(f.intent().state,'APPLIED');assert.equal(f.offer('driver1').estimatedEarningsAtOffer,3000);assert.equal(f.offer('driver1').bonusAmount,0);assert.equal(f.sent.length,2);await f.run();assert.equal(f.selected,1);assert.equal(f.sent.length,2);
});
test('legacy send failure resumes fixed IDs after lease transfer and skips an already declined recipient',async()=>{
 const f=await setup();f.fail=true;await assert.rejects(f.run(),/lost send ACK/);await f.respond('driver1','DECLINE');f.time+=10000;await f.run('worker2');assert.equal(f.sent.length,2);assert.equal(f.sent[1].id,'driver2');assert.equal(f.selected,1);assert.deepEqual(f.wave().delivered,['driver2']);
});
test('legacy decline advances once through the shared decision and creates durable response evidence',async()=>{
 const f=await setup();await f.run();assert.equal((await f.respond('driver1','DECLINE')).transition.action,'WAIT');const last=await f.respond('driver2','DECLINE');assert.equal(last.transition.waveNumber,2);assert.equal((await f.respond('driver2','DECLINE')).transition.intentId,last.transition.intentId);assert.equal([...f.rows.values()].filter(r=>r.kind==='DISPATCH_RESPONSE_OUTBOX').length,2);
});
test('legacy acceptance consumes an existing owned reservation proof without another wallet or ledger write',async()=>{
 const f=await setup();await f.run();f.reserve();const wallet=structuredClone(f.get('staging-Wallets',{walletId:'WALLET#DRIVER#driver1',sk:'META'}));const r=await f.respond('driver1','ACCEPT');assert.equal(r.holdId,'legacyhold1');assert.equal((await f.respond('driver1','ACCEPT')).replayed,true);assert.equal(f.job().status,'assigned');assert.equal(f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'}).driverId,'driver1');assert.deepEqual(f.get('staging-Wallets',{walletId:'WALLET#DRIVER#driver1',sk:'META'}),wallet);assert.equal([...f.rows.values()].filter(r=>r.kind==='DISPATCH_RESPONSE_OUTBOX').length,1);assert.equal([...f.rows.keys()].some(k=>k.startsWith('staging-LedgerEntries|')),false);
});
test('missing, foreign, changed amount, financial or released reservation cannot assign legacy orders',async()=>{
 for(const change of [f=>{},f=>f.reserve('driver2'),f=>{f.reserve();f.get('staging-Holds',{orderId:'order1',sk:'HOLD'}).amount=9;},f=>{f.reserve();f.get('staging-Holds',{orderId:'order1',sk:'HOLD'}).financialSchemaVersion=2;},f=>{f.reserve();f.get('staging-Holds',{orderId:'order1',sk:'HOLD'}).status='RELEASED';}]){const f=await setup();await f.run();change(f);await assert.rejects(f.respond('driver1','ACCEPT'));assert.equal(f.job().status,'searching');assert.equal(f.offer('driver1').responseStatus,'pending');}
});
test('reservation release racing acceptance rejects the full assignment transaction',async()=>{
 const f=await setup();await f.run();f.reserve();f.beforeCommit=()=>{f.get('staging-Holds',{orderId:'order1',sk:'HOLD'}).status='RELEASED';};await assert.rejects(f.respond('driver1','ACCEPT'));assert.equal(f.job().status,'searching');assert.equal(f.offer('driver1').responseStatus,'pending');assert.equal(f.get('WizzDriverLiveState_staging',{driverId:'driver1'}).status,'available');
});
test('two zero-reservation acceptances cannot both assign a pinned legacy job',async()=>{
 const f=await setup(0);await f.run();const results=await Promise.allSettled([f.respond('driver1','ACCEPT'),f.respond('driver2','ACCEPT')]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal([...f.rows.values()].filter(r=>r.kind==='DISPATCH_RESPONSE_OUTBOX').length,1);
});
test('legacy acceptance commits once after lost transaction acknowledgement, and blocks further sends',async()=>{
 const f=await setup();await f.run();f.reserve();const send=f.db.send;f.db.send=async c=>{const r=await send(c);if(c.input.TransactItems?.some(op=>op.Put?.Item.eventType==='ACCEPTED'))throw Error('reply lost');return r;};const r=await f.respond('driver1','ACCEPT');assert.equal(r.replayed,true);assert.equal((await f.run()).action,'STOP');assert.equal(f.sent.length,2);
});
test('tampered terms, stale cycle and unauthorized driver cannot respond',async()=>{
 for(const mutate of [f=>f.offer('driver1').holdRequiredAmount=1,f=>f.wave().cycleDigest='foreign',f=>f.intent().state='LEASED',f=>f.get('WhizzDrivers_staging',{driverId:'driver1'}).cognitoSub='another']){const f=await setup();await f.run();f.reserve();mutate(f);await assert.rejects(f.respond('driver1','ACCEPT'));await assert.rejects(f.respond('driver1','DECLINE'));assert.equal(f.job().status,'searching');}
});
test('legacy adapter rejects financial cycles and oversized recipients rather than truncating ALL',async()=>{
 const f=await setup(10000,'FINANCIAL');await assert.rejects(f.run(),/LEGACY_ENGINE_REQUIRED/);assert.equal(f.sent.length,0);
 const g=await setup();const e=createStagingLegacyWaveExecutor({db:g.db,now:()=>g.time,selectDrivers:async()=>Array.from({length:26},(_,i)=>'d'+i),prepareOffer:g.prepare,message:g.message,sendOffer:g.send});await assert.rejects(e.run({orderId:'order1',assignmentId:'dispatch1',owner:'x',leaseSeconds:10}),/LEGACY_RECIPIENT_LIMIT/);assert.equal(g.wave(),undefined);
});
test('order price changed after offer preparation cannot be accepted with stale reservation terms',async()=>{
 const f=await setup();await f.run();f.reserve();f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'}).subtotal=11000;await assert.rejects(f.respond('driver1','ACCEPT'));assert.equal(f.job().status,'searching');
});
test('legacy acceptance during sending stops remaining sends without releasing or duplicating reservation',async()=>{
 const f=await setup();f.reserve();f.send=async(id,message)=>{f.sent.push({id,message});await f.respond(id,'ACCEPT');};assert.equal((await f.run()).action,'STOP');assert.equal(f.sent.length,1);assert.equal(f.get('staging-Holds',{orderId:'order1',sk:'HOLD'}).status,'ACTIVE');assert.equal((await f.respond('driver1','ACCEPT')).replayed,true);
});
test('a failed READY transaction leaves preparation resumable without an APPLIED acknowledgement',async()=>{
 const f=await setup(),send=f.db.send;f.db.send=async c=>{if(c.input.TransactItems?.some(op=>op.Update?.Key.SK?.startsWith('DISPATCH_TRANSITION#')&&op.Update.ExpressionAttributeValues?.[':ready']==='APPLIED'))throw Error('READY failed');return send(c);};await assert.rejects(f.run());assert.equal(f.wave().state,'PREPARING');assert.equal(f.intent().state,'LEASED');assert.equal(f.sent.length,0);f.db.send=send;await f.run();assert.equal(f.wave().state,'READY');assert.equal(f.intent().state,'APPLIED');assert.equal(f.selected,1);
});
test('competing legacy executors cannot both own delivery and an expired lease cannot ACK a send',async()=>{
 const f=await setup();const result=await Promise.allSettled([f.run('one'),f.run('two')]);assert.equal(result.filter(r=>r.status==='fulfilled'&&r.value.action==='LEASE_BUSY').length,1);assert.equal(f.sent.length,2);
 const g=await setup();g.send=async(id,message)=>{g.sent.push({id,message});g.time+=11000;};await assert.rejects(g.run());assert.equal(g.sent.length,1);assert.deepEqual(g.wave().delivered,[]);
});
