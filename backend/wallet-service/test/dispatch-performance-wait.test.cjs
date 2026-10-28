const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./helpers/dispatch-cycle-fixture.cjs');
const {createStagingDispatchCoordinator}=require('../dist/dispatchCoordinator');
const {fixture:funded}=require('./helpers/delivery-funded-dispatch-fixture.cjs');
const {createStagingDispatchWaveExecutor}=require('../dist/dispatchWaveExecutor');
test('missing financial wave retries preparation with same identity while preserving original search deadline',async()=>{
 const f=fixture();await f.create();const c=createStagingDispatchCoordinator({db:f.db,now:()=>f.time}),select={orderId:'order1',assignmentId:'dispatch1',source:'TIMEOUT'};
 const original=await c.plan(select),ref=structuredClone(f.job().dispatchTransition),deadline=f.job().expiresAt;
 const lease=await c.acquire({orderId:'order1',assignmentId:'dispatch1',intentId:ref.id,owner:'old',leaseSeconds:10});
 f.time+=61000;const fresh=await c.plan(select);assert.equal(fresh.intentId,original.intentId);assert.equal(fresh.action,'START_WAVE');assert.equal(f.job().status,'searching');assert.equal(f.job().currentWaveNumber,0);assert.equal(f.job().expiresAt,deadline);
 await assert.rejects(c.executionFence({orderId:'order1',assignmentId:'dispatch1',intentId:ref.id,owner:'old',leaseVersion:lease.leaseVersion}));
 f.time=Date.parse(deadline);assert.equal((await c.plan(select)).action,'REVIEW');assert.equal(f.job().status,'no_driver_available');
});
test('persisted partial wave cannot be reset as an empty preparation retry',async()=>{
 const f=fixture();await f.create();const c=createStagingDispatchCoordinator({db:f.db,now:()=>f.time}),v={orderId:'order1',assignmentId:'dispatch1',source:'TIMEOUT'};await c.plan(v);
 f.put('WizzDispatchJobs_staging',{orderId:'order1',SK:'FINANCIAL_WAVE#1',kind:'FINANCIAL_WAVE',state:'PREPARING',driverIds:['driver1']});f.time+=61000;
 assert.equal((await c.plan(v)).action,'REVIEW');
});
test('bounded wait reads saved performance again, validates lease, then sends once',async()=>{
 const f=await funded();await f.create();let tries=0,waits=0;
 const runner=createStagingDispatchWaveExecutor({db:f.db,now:()=>f.time,enableDeliveryFunding:true,selectDrivers:async()=>{if(tries++<2)throw Error('DISPATCH_PERFORMANCE_REFRESH_PENDING');return ['driver1'];},waitForPerformance:async ms=>{assert.equal(f.out.length,0);waits++;f.time+=ms;},context:f.contextFactory,sendOffer:async(id,message)=>f.out.push({id,message})});
 await runner.run({orderId:'order1',assignmentId:'dispatch1',owner:'waiter',leaseSeconds:10});assert.equal(tries,3);assert.equal(waits,2);assert.equal(f.out.length,1);assert.equal(f.job().currentWaveNumber,1);
});
