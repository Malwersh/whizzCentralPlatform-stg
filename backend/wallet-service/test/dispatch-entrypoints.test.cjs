const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'../../../lambda'),quiet={log(){},error(){},warn(){}};
function source(name){return fs.readFileSync(path.join(root,name,'index.js'),'utf8');}
function fn(s,name){const start=s.indexOf('async function '+name+'('),end=s.indexOf('\nasync function ',start+20);assert(start>=0);return s.slice(start,end<0?undefined:end);}
test('timeout includes pinned empty final waves and routes them without legacy queries or writes',async()=>{
 const s=source('WaveSystem_HandleWaveTimeout');let scan,calls=0;
 const ctx={console:quiet,process:{env:{}},Date,DISPATCH_JOBS_TABLE:'jobs',scanAll:async q=>{scan=q;return {Items:[{orderId:'order1',dispatchCycle:null,currentWaveNumber:4,maxWaves:4}]};},checkActiveOffers:async()=>{throw Error('legacy query');},getDispatchJob:async()=>({dispatchJobId:'cycle1',dispatchCycle:{}}),require:()=>({coordinateUnifiedDispatch:async input=>{calls++;assert.equal(input.source,'TIMEOUT');return {claimed:true,action:'START_WAVE'};}})};
 vm.runInNewContext(fn(s,'getStuckOrders')+'\n'+fn(s,'processExpiredWave')+'\nthis.scan=getStuckOrders;this.run=processExpiredWave;',ctx);
 assert.equal((await ctx.scan()).length,1);assert.match(scan.FilterExpression,/attribute_exists\(dispatchCycle\)/);
 const r=await ctx.run('order1',[],new Date().toISOString());assert.equal(calls,1);assert.equal(r.transitionClaimed,true);assert.equal(r.nextWaveStarted,false);
 ctx.require=()=>({coordinateUnifiedDispatch:async()=>{throw Error('UNIFIED_DISPATCH_NOT_READY');}});await assert.rejects(ctx.run('order1',[],new Date().toISOString()),/UNIFIED_DISPATCH_NOT_READY/);
});
test('start strongly reads the selected job and rejects invocations for a replaced assignment',async()=>{
 const s=source('WaveSystem_StartWave');let request,assignment='opaque';const ctx={console:quiet,DISPATCH_JOBS_TABLE:'jobs',dynamodb:{get:q=>{request=q;return {promise:async()=>({Item:{dispatchJobId:assignment}})};}}};
 vm.runInNewContext(fn(s,'getDispatchJob')+'\nthis.run=getDispatchJob;',ctx);assert.equal((await ctx.run('opaque','order1')).dispatchJobId,'opaque');assert.equal(request.Key.orderId,'order1');assert.equal(request.ConsistentRead,true);assignment='replacement';assert.equal(await ctx.run('opaque','order1'),null);
});
test('reject refuses every pinned or malformed cycle before offer, live-state and metric mutations',async()=>{
 for(const cycle of [{},null]){const s=source('WaveSystem_HandleDriverReject'),exports={},calls=[];class Command{constructor(input){this.input=input;}}
 const ctx={exports,console:quiet,process:{env:{DISPATCH_JOBS_TABLE:'jobs',WAVE_OFFERS_TABLE:'offers',DRIVER_LIVE_STATE_TABLE:'WizzDriverLiveState_staging'}},require:n=>{
  if(n==='./driver-lifecycle')return {driverRequestContext:{run:(_,fn)=>fn(),getStore:()=>({})},driverLifecycleClient:x=>x};
  if(n==='@aws-sdk/lib-dynamodb')return {GetCommand:Command,QueryCommand:Command,UpdateCommand:Command,DynamoDBDocumentClient:{from:()=>({send:async c=>{calls.push(c.input);return {Item:{dispatchCycle:cycle}};}})}};
  if(n==='@aws-sdk/client-dynamodb')return {DynamoDBClient:class{}};
  if(n==='@aws-sdk/client-lambda')return {LambdaClient:class{},InvokeCommand:Command};throw Error(n);
 }};vm.runInNewContext(s,ctx);const r=await exports.handler({body:JSON.stringify({driverId:'driver1',orderId:'order1',offerId:'OFFER_order1_driver1_W1'})});assert.equal(r.statusCode,409);assert.equal(JSON.parse(r.body).code,'UNIFIED_DECLINE_NOT_READY');assert.equal(calls.length,1);assert.equal(calls[0].ConsistentRead,true);}
});
test('runtime is closed by default and planning mode cannot open decline or an executor',async()=>{
 const {coordinateUnifiedDispatch}=require('../dist/dispatchCoordinatorRuntime'),saved={...process.env};
 try{process.env.STAGE='staging';process.env.AWS_REGION='us-east-1';delete process.env.DISPATCH_CYCLE_MODE;await assert.rejects(coordinateUnifiedDispatch({}),/UNIFIED_DISPATCH_NOT_READY/);process.env.DISPATCH_CYCLE_MODE='PLAN_ONLY';await assert.rejects(coordinateUnifiedDispatch({source:'DECLINE'}),/UNIFIED_DECLINE_NOT_READY/);process.env.DISPATCH_CYCLE_MODE='REQUIRED';await assert.rejects(coordinateUnifiedDispatch({}),/UNIFIED_DISPATCH_NOT_READY/);}
 finally{for(const k of ['STAGE','AWS_REGION','DISPATCH_CYCLE_MODE'])if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}
});

test('host-managed timeout never invokes the planning-only or old expiration branches',async()=>{const s=source('WaveSystem_HandleWaveTimeout'),ctx={console:quiet,process:{env:{DISPATCH_LEGACY_HOST_MODE:'REQUIRED'}},getDispatchJob:async()=>({dispatchJobId:'a',dispatchCycle:{engine:'LEGACY'}}),require:()=>{throw Error('old planner');}};vm.runInNewContext(fn(s,'processExpiredWave')+'\nthis.run=processExpiredWave;',ctx);assert.equal((await ctx.run('o',[],new Date().toISOString())).dispatchAction,'HOST_MANAGED');});
test('StartWave host branch uses only selected cycle and original transport, rejecting stale event cycle',async()=>{const s=source('WaveSystem_StartWave'),start=s.indexOf("    if (Object.prototype.hasOwnProperty.call(dispatchJob,'dispatchCycle'))"),end=s.indexOf("    if (dispatchJob.status === 'assigned')",start);assert(start>0&&end>start);const calls=[],ctx={process:{env:{DISPATCH_LEGACY_HOST_MODE:'REQUIRED'}},apigateway:{transport:'existing'},JSON,Error,require:n=>n==='crypto'?{randomUUID:()=> 'test-worker'}:{runHostedLegacyWave:async(...a)=>{calls.push(a);return {kind:'LEGACY_WAVE_READY'};},coordinateUnifiedDispatch:()=>{throw Error('planner');}}};vm.runInNewContext('this.run=async function(dispatchJob,dispatchJobId,event){'+s.slice(start,end)+'};',ctx);const job={orderId:'o',dispatchCycle:{id:'c',engine:'LEGACY'}};assert.equal((await ctx.run(job,'assignment',{cycleId:'c'})).statusCode,200);assert.equal(calls[0][0].assignmentId,'assignment');assert.equal(calls[0][1],ctx.apigateway);await assert.rejects(ctx.run(job,'assignment',{cycleId:'stale'}),/DISPATCH_HOST_SOURCE_INVALID/);assert.equal(calls.length,1);});

test('timeout helpers cannot re-enter the host or reference an invocation event/context',async()=>{const s=source('WaveSystem_HandleWaveTimeout');for(const name of ['checkActiveOffers','updateDriverPerformanceMetricsOnTimeout']){const body=fn(s,name);assert(!body.includes('runHostedLegacyTick'));assert(!body.includes('hostSummary'));assert(!/\bevent\b|\bcontext\b/.test(body));}const ctx={console:quiet,Date,WAVE_OFFERS_TABLE:'offers',dynamodb:{query:()=>({promise:async()=>({Items:[{offerId:'existing'}]})})}};vm.runInNewContext(fn(s,'checkActiveOffers')+'\nthis.run=checkActiveOffers;',ctx);assert.equal(await ctx.run('o'),true);});
