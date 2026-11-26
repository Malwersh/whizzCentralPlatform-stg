const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./helpers/dispatch-financial-retry-fixture.cjs');
const money=f=>structuredClone([...f.rows].filter(([k])=>/^staging-(Wallets|Holds|LedgerEntries)\|/.test(k)||k.includes('DELIVERY_RESERVATION#')||k.includes('DELIVERY_USAGE#')||k.includes('DELIVERY_BUDGET#')));
test('funded never-offered recovery archives old plan, preserves all prices/tip/funding and starts a distinct durable cycle once',async()=>{
 const f=await fixture(),before=money(f),snapshot=structuredClone(f.order().financialSnapshot),old=structuredClone(f.job());
 const r=await f.retry();assert.equal(r.status,'EXECUTED');assert.equal(r.startStatus,'PENDING');assert.deepEqual(money(f),before);assert.deepEqual(f.order().financialSnapshot,snapshot);assert.notEqual(f.job().dispatchCycle.id,old.dispatchCycle.id);assert.equal(f.job().financialPreparingWave,undefined);
 const oldWave=f.get('WizzDispatchJobs_staging',{orderId:'order1',SK:'FINANCIAL_WAVE#1'});assert.equal(oldWave.state,'PREPARING');
 assert.equal((await f.retry()).replayed,true);assert.equal((await f.start()).state,'STARTED');assert.equal(f.out.length,2);assert.deepEqual(oldWave,f.get('WizzDispatchJobs_staging',{orderId:'order1',SK:'FINANCIAL_WAVE#1'}));assert.deepEqual(money(f),before);assert.deepEqual(f.order().financialSnapshot,snapshot);
 assert.equal((await f.start()).replayed,true);assert.equal(f.out.length,2);
 await assert.rejects(f.coordinator.plan({orderId:'order1',assignmentId:old.dispatchJobId,source:'TIMEOUT'}));
 await f.service('driver1').accept(f.selector('driver1'));assert.equal(f.order().financialAcceptance.schemaVersion,2);
 f.order().status='arrived_at_customer';await require('../dist/codCompletion').createStagingCodCompletion({db:f.db,now:()=>f.time,enableDeliveryFunding:true,authenticateDriver:async()=>({driverId:'driver1',subjectId:'driver1'})}).complete({orderId:'order1',cashCollected:true});assert.equal(f.order().status,'delivered');
});
test('prior offer, acceptance, unexpected hold or delivered plan cannot be reset by initial recovery',async()=>{
 for(const mutate of [f=>f.put('WaveOffers_staging',{orderId:'order1',SK:'FINANCIAL#driver1#WAVE#1'}),f=>f.put('WizzDispatchJobs_staging',{orderId:'order1',SK:'DISPATCH_ACCEPTANCE#prior',kind:'LEGACY_ACCEPTANCE_ATTEMPT'}),f=>f.put('staging-Holds',{orderId:'order1',sk:'UNKNOWN',status:'ACTIVE'}),f=>f.get('WizzDispatchJobs_staging',{orderId:'order1',SK:'FINANCIAL_WAVE#1'}).delivered.push('driver1')]){
  const f=await fixture();mutate(f);const before=money(f),job=structuredClone(f.job());let result;try{result=await f.retry();}catch(error){assert.match(error.message,/REVIEW_INCOMPLETE/);}assert.notEqual(result?.status,'EXECUTED');assert.deepEqual(f.job(),job);assert.deepEqual(money(f),before);assert.equal(f.queue(),undefined);
 }
});
test('funding or actor change at commit prevents restart and leaves decision pending',async()=>{
 for(const kind of ['funding','actor']){const f=await fixture();f.beforeCommit=()=>{if(kind==='actor')f.actor().version++;else f.get('staging-Holds',{orderId:'order1',sk:'DELIVERY_PROMOTION_FUNDING'}).status='RELEASED';};await assert.rejects(f.retry());assert.equal(f.decision().status,'PENDING_EXECUTION');assert.equal(f.queue(),undefined);assert.equal(f.job().status,'no_driver_available');}
});
test('concurrent recovery and lost acknowledgement yield one cycle, one queue and same receipt',async()=>{
 const f=await fixture(),r=await Promise.all([f.retry(),f.retry()]);assert.equal(r[0].assignmentId,r[1].assignmentId);assert.equal([...f.rows.values()].filter(r=>r.kind==='DISPATCH_RESTART_START').length,1);
 const g=await fixture(),send=g.db.send;let once=true;g.db.send=async c=>{const result=await send(c);if(once&&c.input.TransactItems?.some(op=>op.Put?.Item.kind==='DISPATCH_RESTART_START')){once=false;throw Error('lost ACK');}return result;};assert.equal((await g.retry()).replayed,true);
});
test('partial invocation failure resumes stored offer with same event identity and no false STARTED',async()=>{const f=await fixture();await f.retry();const callback=f.callback;f.callback=async s=>{await callback(s);throw Error('lost response');};assert.equal((await f.start()).state,'STARTED');assert.equal(f.out.length,2);assert.equal((await f.start()).replayed,true);assert.equal(f.out.length,2);});

test('completed empty waves may be retried while a ready wave with recipients cannot',async()=>{
 const f=await fixture(),w=f.get('WizzDispatchJobs_staging',{orderId:'order1',SK:'FINANCIAL_WAVE#1'});w.state='READY';w.driverIds=[];w.delivered=[];
 const before=money(f);assert.equal((await f.retry()).status,'EXECUTED');assert.deepEqual(money(f),before);assert.equal(w.state,'READY');
 const g=await fixture(),other=g.get('WizzDispatchJobs_staging',{orderId:'order1',SK:'FINANCIAL_WAVE#1'});other.state='READY';other.driverIds=['driver1'];other.delivered=[];
 assert.notEqual((await g.retry()).status,'EXECUTED');assert.equal(g.queue(),undefined);
});
