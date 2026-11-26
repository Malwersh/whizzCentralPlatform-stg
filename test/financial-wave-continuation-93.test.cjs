const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const {createFinancialWavePolicy}=require('../lambda/WaveSystem_StartWave/financial-wave-policy');
const ts=require('../backend/wallet-service/node_modules/typescript');
const policy=require('./fixtures/financial-wave-policy-93.json');
test('pinned policy keeps prior drivers temporary, permanent unassignments separate and reoffers only from wave four',async()=>{
 const calls=[];const job={orderId:'order1',dispatchJobId:'job1',financialSearchMaxWave:4,excludedDrivers:['unassigned']};
 const db={get(q){calls.push(q);return {promise:async()=>{const n=Number(q.Key.SK.split('#')[1]);return {Item:{assignmentId:'job1',state:'EXPIRED',driverIds:n===1?['timedout']:[],...(n===1?{operatingLimits:policy}:{})}};}};}};
 const read=createFinancialWavePolicy({db,jobsTable:'jobs'}).read;
 const two=await read(job,2);assert.deepEqual(two.permanent,['unassigned']);assert.deepEqual(two.previous,['timedout']);assert.equal(two.isFinalWave,false);
 const four=await read(job,4);assert.deepEqual(four.previous,['timedout']);assert.equal(four.isFinalWave,true);assert.equal(four.thresholds.MAX_DISTANCE_KM,20);
 assert.equal(two.thresholds.MAX_DISTANCE_KM,10);assert.equal(two.operating.version,2);
 await assert.rejects(read(job,5),/FINANCIAL_WAVE_LIMIT/);
});
const source=fs.readFileSync('lambda/WaveSystem_HandleWaveTimeout/index.js','utf8'),ast=ts.createSourceFile('timeout.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const body=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name.text==='processExpiredWave').getText(ast);
function setup({missing=false,inScope=true,startSuccess=true}={}){
 const calls=[];const job={financialDispatch:true,orderId:'o',restaurantId:'b',dispatchJobId:'j',currentWaveNumber:1,maxWaves:4,expiresAt:'2099-01-01T00:00:00.000Z'};
 const context={console:{log(){},error(){}},getDispatchJob:async()=>job,DISPATCH_JOBS_TABLE:'jobs',dynamodb:{get:()=>({promise:async()=>({Item:missing?undefined:{orderId:'o'}})})},
 require:(name)=>name==='./finance-rollout'?{readFinanceRollout:()=>({scopes:[{orders:inScope?[{orderId:'o',branchId:'b'}]:[]}]})}:name==='./financial-runtime'?{exhaustFinancialSearch:async()=>({exhausted:false}),expireFinancialWave:async()=>({expired:true,driverIds:['timedout']})}:{createFinancialWavePolicy:()=>({read:async()=>({permanent:['unassigned'],previous:['timedout'],isFinalWave:false})})},
 invokeStartWave:async(...args)=>{calls.push(args);return {success:startSuccess};}};
 return {calls,run:vm.runInNewContext(body+';processExpiredWave',context)};
}
test('timeout continuation sends temporary and permanent histories correctly and confirms successful next wave',async()=>{const x=setup();const r=await x.run('o',[],'2026-10-17T00:00:00.000Z');assert.equal(r.nextWaveStarted,true);assert.deepEqual(x.calls[0],['j','o',2,['unassigned'],['timedout'],false,false]);});
test('failed next wave is not reported as success',async()=>{const x=setup({startSuccess:false});await assert.rejects(x.run('o',[],'2026-10-17T00:00:00.000Z'),/FINANCIAL_NEXT_WAVE_PENDING/);});
test('missing deleted order and out-of-scope financial rows cause no continuation writes',async()=>{for(const settings of [{missing:true},{inScope:false}]){const x=setup(settings);const r=await x.run('o',[],'2026-10-17T00:00:00.000Z');assert.ok(r.skipped);assert.equal(x.calls.length,0);}});
test('actual selector with a single timed-out driver yields recipients 1,0,0,1 across four waves',async()=>{
 const {createDriverSelection}=require('../lambda/WaveSystem_StartWave/driver-selection');
 const driver={driverId:'d',status:'available',isSearching:true,connectionId:'c',connectionStatus:'connected',current_work_region_id:'r',allowed_region_ids:['r'],allowed_region_ids_priority0:['r'],lat:31.92,lng:44.46,metricsSnapshot_totalTrips:0};
 const selection=createDriverSelection({console:{log(){},warn(){},error(){}},MAX_DISTANCE_KM:20,queryDriversByRegion:async()=>[driver],queryAllAvailableDrivers:async()=>[driver]});
 const job={orderId:'o',dispatchJobId:'j',restaurantLat:31.92,restaurantLng:44.46,restaurantRegionId:'r',financialSearchMaxWave:4};
 const waves={};const db={get(q){return {promise:async()=>({Item:q.TableName==='staging-PlatformStaff'?{version:2,values:policy.values}:waves[q.Key.SK]})};}};
 const read=createFinancialWavePolicy({db,jobsTable:'jobs'}).read,counts=[];
 for(let n=1;n<=4;n++){
  const p=await read(job,n),recipients=await selection.getQualifiedDrivers(job,p.permanent,p.permanent,p.previous,p.isFinalWave,false,n,p.thresholds);
  counts.push(recipients.length);waves['FINANCIAL_WAVE#'+n]={assignmentId:'j',state:'EXPIRED',driverIds:recipients.map(v=>v.driverId),operatingLimits:policy};
 }
 assert.deepEqual(counts,[1,0,0,1]);
});
