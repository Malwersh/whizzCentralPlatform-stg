const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../../../lambda/WaveSystem_HandleWaveTimeout/index.js'),'utf8');
const quiet={log(){},error(){},warn(){}};
function fn(name){const start=source.indexOf('async function '+name+'('),end=source.indexOf('\nasync function ',start+20);return source.slice(start,end<0?undefined:end);}
test('timeout scanner has one definition, resumes durable redispatch and retains scan pagination',async()=>{
 assert.equal((source.match(/async function getStuckOrders\(/g)||[]).length,1);
 let scan;const ctx={console:quiet,Date,DISPATCH_JOBS_TABLE:'jobs',scanAll:async q=>{scan=q;return {Items:[{orderId:'o',financialDispatch:true}]};},checkActiveOffers:async()=>{throw Error('must not query legacy offers');}};
 vm.runInNewContext(fn('getStuckOrders')+'\nthis.run=getStuckOrders;',ctx);
 assert.equal((await ctx.run()).length,1);assert.match(scan.FilterExpression,/attribute_exists\(financialRedispatch\)/);assert.equal(scan.ExpressionAttributeValues[':metadata'],'METADATA');assert.match(scan.FilterExpression,/OR \(updatedAt/);
});
test('redispatch retry preserves intent on invocation failure and never expires a released assignment',async()=>{
 const job={financialDispatch:true,restaurantId:'b',status:'searching',currentWaveNumber:4,dispatchJobId:'job1',financialRedispatch:{waveNumber:5,excludeDriverIds:['driver1']}};let fail=true,calls=0;
 const ctx={console:quiet,dynamodb:{get:()=>({promise:async()=>({Item:{orderId:'o'}})})},getDispatchJob:async()=>structuredClone(job),invokeStartWave:async(...args)=>{calls++;assert.equal(args[2],5);assert.equal(args[3][0],'driver1');assert.equal(args[5],false);assert.equal(args[6],false);return {success:!fail};},require(){return {readFinanceRollout:()=>({scopes:[{orders:[{orderId:'o',branchId:'b'}]}]}),exhaustFinancialSearch:async()=>({exhausted:false}),expireFinancialWave:async()=>{throw Error('must not expire old wave');}};}};
 vm.runInNewContext(fn('processExpiredWave')+'\nthis.run=processExpiredWave;',ctx);
 await assert.rejects(ctx.run('o',[],'2026-10-16T00:00:00Z'),/FINANCIAL_REDISPATCH_PENDING/);assert.equal(job.financialRedispatch.waveNumber,5);
 fail=false;assert.equal((await ctx.run('o',[],'2026-10-16T00:00:01Z')).nextWaveStarted,true);assert.equal(calls,2);
});
test('hosted financial unassignment is processed directly rather than skipped as host managed',async()=>{
 for(const action of ['START_ATTEMPTED','REVIEW']){
  let calls=0;const ctx={console:quiet,process:{env:{DISPATCH_FINANCIAL_HOST_MODE:'REQUIRED'}},getDispatchJob:async()=>({financialRedispatch:{waveNumber:2},dispatchCycle:{engine:'FINANCIAL'}}),require:()=>({resumeHostedFinancialUnassignment:async id=>{assert.equal(id,'order1');calls++;return {action};}})};
  vm.runInNewContext(fn('processExpiredWave')+'\nthis.run=processExpiredWave;',ctx);
  const r=await ctx.run('order1',[],'2026-10-24T00:00:00Z');assert.equal(calls,1);assert.equal(r.dispatchAction,action);assert.equal(r.nextWaveStarted,action==='START_ATTEMPTED');
 }
});
