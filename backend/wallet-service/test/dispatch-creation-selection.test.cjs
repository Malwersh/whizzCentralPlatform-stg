const {test}=require('node:test'),assert=require('node:assert/strict');
const {marshall}=require('@aws-sdk/util-dynamodb');
const {QueryCommand,ScanCommand}=require('@aws-sdk/lib-dynamodb');
const {fixture}=require('./helpers/dispatch-cycle-fixture.cjs');
const {createStagingDispatchCreator}=require('../dist/dispatchCreator');
const {createStagingDispatchCoordinator}=require('../dist/dispatchCoordinator');
const {createStagingDispatchCandidates}=require('../dist/dispatchCandidates');
const orderKey={PK:'ORDER#order1',SK:'META'},source='arn:aws:dynamodb:us-east-1:699561669180:table/WizzOrders/stream/2026-10-16T00:00:00.000';
function record(f){const current=f.get('WizzOrders',orderKey);return {eventName:'MODIFY',eventSource:'aws:dynamodb',eventSourceARN:source,eventID:'event1',dynamodb:{SequenceNumber:'123',Keys:marshall(orderKey),OldImage:marshall({...current,status:'preparing'}),NewImage:marshall(current)}};}
test('stream replay after lost Invoke acknowledgement uses one deterministic job and captured policy',async()=>{
 const f=fixture(),r=record(f),calls=[];let fail=true;
 const creator=createStagingDispatchCreator({db:f.db,now:()=>f.time,invokeStart:async input=>{calls.push(input);if(fail)throw Error('Invoke reply lost');}});
 await assert.rejects(creator.process(r),/Invoke reply lost/);const first=structuredClone(f.job());assert.equal(f.get('WizzOrders',orderKey).deliveryJobId,first.dispatchJobId);
 f.time+=1000;f.get('staging-PlatformStaff',{pk:'OPERATIONAL_SETTINGS#DELIVERY_OPERATIONS',sk:'CURRENT'}).version=3;fail=false;
 const replay=await creator.process(r);assert.equal(replay.replayed,true);assert.deepEqual(calls[0],calls[1]);assert.deepEqual(f.job(),first);assert.equal(first.dispatchCycle.policy.version,2);
});
test('different initial events cannot overwrite the first job and unsupported sources or restart paths fail closed',async()=>{
 const f=fixture(),r=record(f),creator=createStagingDispatchCreator({db:f.db,now:()=>f.time,invokeStart:async()=>{}});await creator.process(r);
 await assert.rejects(creator.process({...r,eventID:'other',dynamodb:{...r.dynamodb,SequenceNumber:'124'}}));
 await assert.rejects(creator.process({...r,eventSourceARN:source.replace('WizzOrders','Other')}));
 const g=fixture();g.get('WizzOrders',orderKey).excludedDrivers=['driver1'];await assert.rejects(createStagingDispatchCreator({db:g.db,invokeStart:async()=>{}}).process(record(g)),/REASSIGNMENT_NOT_READY/);
});
test('non-ready changes and existing links skip without writes or invocation',async()=>{
 const f=fixture(),r=record(f);r.dynamodb.OldImage=structuredClone(r.dynamodb.NewImage);let invoked=0;const creator=createStagingDispatchCreator({db:f.db,invokeStart:async()=>{invoked++;}});assert.equal((await creator.process(r)).skipped,true);assert.equal(f.job(),undefined);assert.equal(invoked,0);
});
async function selection(mutate=()=>{}){
 const f=fixture();mutate(f.get('staging-PlatformStaff',{pk:'OPERATIONAL_SETTINGS#DELIVERY_OPERATIONS',sk:'CURRENT'}).values);await f.create();
 for(const id of ['driver1','driver2'])Object.assign(f.get('WizzDriverLiveState_staging',{driverId:id}),{current_work_region_id:'zone1',allowed_region_ids:['zone1'],allowed_region_ids_priority0:['zone1'],metricsSnapshot_totalTrips:0});
 const c=createStagingDispatchCoordinator({db:f.db,now:()=>f.time});await c.plan({orderId:'order1',assignmentId:'dispatch1',source:'START'});const id=f.job().dispatchTransition.id;await c.acquire({orderId:'order1',assignmentId:'dispatch1',intentId:id,owner:'w',leaseSeconds:10});
 f.intent=()=>f.get('WizzDispatchJobs_staging',{orderId:'order1',SK:'DISPATCH_TRANSITION#'+id});f.queries=[];f.pages=async()=>({Items:[{driverId:'driver2'},{driverId:'driver1'}]});const send=f.db.send;
 f.db.send=async cmd=>{if(cmd instanceof QueryCommand||cmd instanceof ScanCommand){f.queries.push(cmd.input);return f.pages(cmd);}return send(cmd);};
 f.select=()=>createStagingDispatchCandidates({db:f.db,now:()=>f.time})({job:f.job(),intent:f.intent()});return f;
}
test('candidate reads continue after empty filtered scan pages, hydrate live profiles, and break ties deterministically',async()=>{
 const f=await selection();let page=0;f.pages=async()=>++page===1?{Items:[],LastEvaluatedKey:{driverId:'cursor'}}:{Items:[{driverId:'driver2'},{driverId:'driver1'}]};assert.deepEqual(await f.select(),['driver1','driver2']);assert.equal(page,2);assert.equal(f.queries[0].IndexName,undefined);assert.equal(f.queries[0].FilterExpression,'current_work_region_id=:region AND #s=:available');assert.equal(f.queries[0].ExpressionAttributeValues[':region'],'zone1');assert.equal(f.queries[1].ExclusiveStartKey.driverId,'cursor');
});
test('read failure or pagination limit cannot look like an empty successful search',async()=>{
 const f=await selection();f.pages=async()=>{throw Error('read unavailable');};await assert.rejects(f.select(),/read unavailable/);assert.equal(f.queries.length,1);
 const g=await selection();let n=0;g.pages=async()=>({Items:[],LastEvaluatedKey:{driverId:'cursor'+(++n)}});await assert.rejects(g.select(),/CANDIDATES_UNAVAILABLE/);assert.equal(n,8);
});
test('strong state rejects banned, stale, unavailable and malformed-rate candidates before limiting recipients',async()=>{
 for(const change of [f=>f.get('WhizzDrivers_staging',{driverId:'driver1'}).status='BANNED',f=>f.get('WizzDriverLiveState_staging',{driverId:'driver1'}).locationUpdatedAt=new Date(f.time-120000).toISOString(),f=>f.get('WizzDriverLiveState_staging',{driverId:'driver1'}).status='busy',f=>f.get('WizzDriverLiveState_staging',{driverId:'driver1'}).metricsSnapshot_acceptanceRate=75]){const f=await selection();change(f);assert.deepEqual(await f.select(),['driver2']);}
});
test('captured radius, strict missing-history rule and permanent exclusions are respected',async()=>{
 const f=await selection(p=>{p.dispatch.profiles.FINANCIAL.normalWaves[0].radiusMeters=1;});assert.deepEqual(await f.select(),[]);
 const g=await selection(p=>{p.dispatch.profiles.FINANCIAL.newDriverExemption.missingHistory='NOT_EXEMPT';});delete g.get('WizzDriverLiveState_staging',{driverId:'driver1'}).metricsSnapshot_totalTrips;assert.deepEqual(await g.select(),['driver2']);
 const h=await selection();h.job().financialExcludedDriverIds=['driver1'];assert.deepEqual(await h.select(),['driver2']);
});
test('repeat-offer threshold comes from captured policy rather than a fixed fourth wave',async()=>{
 for(const threshold of [2,3]){const f=await selection(p=>{p.dispatch.profiles.FINANCIAL.repeatOffers.reofferFromWave=threshold;});f.intent().waveNumber=2;f.intent().rule=structuredClone(f.job().dispatchCycle.policy.values.dispatch.profiles.FINANCIAL.normalWaves[1]);f.put('WizzDispatchJobs_staging',{orderId:'order1',SK:'FINANCIAL_WAVE#1',assignmentId:'dispatch1',driverIds:['driver1','driver2']});assert.deepEqual(await f.select(),threshold===2?['driver1','driver2']:[]);}
});
test('shared Legacy filter retains its default trip exemption, ranking and region behavior',async()=>{
 const {createDriverSelection}=require('../../../lambda/WaveSystem_StartWave/driver-selection');const rows=[{driverId:'b',status:'available',isSearching:true,connectionId:'c',current_work_region_id:'z',lat:31.92,lng:44.46},{driverId:'a',status:'busy',isSearching:true,connectionId:'c',current_work_region_id:'z',lat:31.92,lng:44.46}];
 const shared=createDriverSelection({queryDriversByRegion:async()=>rows,queryAllAvailableDrivers:async()=>{throw Error('unexpected fallback');},console:{log(){},warn(){}},MAX_DISTANCE_KM:20});const found=await shared.getQualifiedDrivers({restaurantLat:31.92,restaurantLng:44.46,restaurantRegionId:'z'},[],[],[],false,false,1,{});assert.deepEqual(found.map(r=>r.driverId),['b']);assert.equal(shared.calculateDistance(0,0,0,0),0);
});
test('integrated financial runner selects through shared provider and reuses the stored recipients',async()=>{
 const f=await selection(),{createStagingPinnedFinancialRunner}=require('../dist/dispatchWaveExecutor'),{route}=require('./helpers/driver-offer-fixture.cjs');const sent=[];
 const runner=createStagingPinnedFinancialRunner({db:f.db,now:()=>f.time,cognito:{async send(c){return {Enabled:true,Username:c.input.Username,UserStatus:'CONFIRMED',UserAttributes:[{Name:'sub',Value:c.input.Username}]};}},router:{async getRoute(a,b){return route('route',a,b);}},sendOffer:async(id,message)=>{sent.push({id,message});}});
 const input={orderId:'order1',assignmentId:'dispatch1',owner:'w',leaseSeconds:10};await runner.run(input);assert.equal(sent.length,2);const reads=f.queries.length;await runner.run(input);assert.equal(sent.length,2);assert.equal(f.queries.length,reads);
});
test('Creator entry point propagates new-mode failure for stream retry and blocks direct reassignment',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),code=fs.readFileSync(path.join(__dirname,'../../../lambda/WaveSystem_CreateDispatchJob/index.js'),'utf8');
 const exports={},ctx={exports,process:{env:{DISPATCH_JOBS_TABLE:'jobs',DISPATCH_CYCLE_MODE:'PLAN_ONLY'}},console:{log(){},error(){}},require:n=>n==='aws-sdk'?{DynamoDB:{DocumentClient:class{}},Lambda:class{}}:{createUnifiedDispatchFromStream:async()=>{throw Error('new path failed');}}};vm.runInNewContext(code,ctx);
 await assert.rejects(exports.handler({Records:[{}]}),/new path failed/);await assert.rejects(exports.handler({orderId:'order1'}),/UNIFIED_REASSIGNMENT_NOT_READY/);
});
test('legacy Creator cannot overwrite a pinned job when mode is off',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),s=fs.readFileSync(path.join(__dirname,'../../../lambda/WaveSystem_CreateDispatchJob/index.js'),'utf8');const a=s.indexOf('async function createDispatchJobForOrder('),b=s.indexOf('\nasync function ',a+30),ctx={DISPATCH_JOBS_TABLE:'jobs',dynamodb:{get:q=>{assert.equal(q.ConsistentRead,true);return {promise:async()=>({Item:{dispatchCycle:null}})};}}};vm.runInNewContext(s.slice(a,b)+'\nthis.run=createDispatchJobForOrder;',ctx);await assert.rejects(ctx.run({orderId:'order1'}),/UNIFIED_DISPATCH_NOT_READY/);
});
