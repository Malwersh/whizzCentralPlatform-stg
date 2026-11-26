const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./helpers/delivery-funded-dispatch-fixture.cjs');
const {createStagingDispatchFinancialHost:host}=require('../dist/dispatchLegacyHost');
const {ScanCommand}=require('@aws-sdk/lib-dynamodb');
const checkpoint={orderId:'SYSTEM#DISPATCH_HOST',SK:'CURSOR#FINANCIAL'};
test('financial-only host preserves ordinary legacy creation without constructing financial clients',async()=>{
 const {createUnifiedDispatchFromStream}=require('../dist/dispatchCoordinatorRuntime'),saved={...process.env};
 try{Object.assign(process.env,{STAGE:'staging',AWS_REGION:'us-east-1',DISPATCH_HOST_ACCOUNT_ID:'699561669180',DISPATCH_FINANCIAL_HOST_MODE:'REQUIRED',DISPATCH_LEGACY_HOST_MODE:'OFF',DISPATCH_CYCLE_MODE:'FINANCIAL_RESPONSES',FINANCIAL_DISPATCH_MODE:'REQUIRED'});
  assert.deepEqual(await createUnifiedDispatchFromStream({dynamodb:{NewImage:{orderId:{S:'ordinary-order'}}}},async()=>{assert.fail('must use existing legacy path');}),{legacyFallback:true});
 }finally{process.env=saved;}
});
test('financial runtime rejects disabled or foreign schedules before creating SDK clients',async()=>{
 const {runHostedFinancialTick,runHostedFinancialWave}=require('../dist/dispatchCoordinatorRuntime'),saved={...process.env};
 try{
  delete process.env.DISPATCH_FINANCIAL_HOST_MODE;
  await assert.rejects(runHostedFinancialTick({},undefined,async()=>{}),/FINANCIAL_HOST_DISABLED/);
  Object.assign(process.env,{STAGE:'staging',AWS_REGION:'us-east-1',DISPATCH_HOST_ACCOUNT_ID:'699561669180',DISPATCH_FINANCIAL_HOST_MODE:'REQUIRED',DISPATCH_CYCLE_MODE:'FINANCIAL_RESPONSES',FINANCIAL_DISPATCH_MODE:'REQUIRED',DISPATCH_HOST_RULE_ARN:'arn:aws:events:us-east-1:699561669180:rule/exact'});
  for(const event of [{source:'api'},{source:'aws.events','detail-type':'Scheduled Event',account:'699561669180',region:'us-east-1',resources:['arn:aws:events:us-east-1:699561669180:rule/foreign']}])await assert.rejects(runHostedFinancialTick(event,undefined,async()=>{}),/TRIGGER_INVALID/);
  await assert.rejects(runHostedFinancialTick({source:'aws.events','detail-type':'Scheduled Event',account:'699561669180',region:'us-east-1',resources:[process.env.DISPATCH_HOST_RULE_ARN]},undefined,async()=>{}),/CONTEXT_REQUIRED/);
  process.env.DISPATCH_HOST_ACCOUNT_ID='other';await assert.rejects(runHostedFinancialWave({orderId:'o',assignmentId:'a',cycleId:'c'},async()=>{},'worker'),/FINANCIAL_HOST_DISABLED/);
 }finally{process.env=saved;}
});
async function setup(){
 const f=await fixture();await f.create();const send=f.db.send;f.scans=[];f.scan=()=>({Items:[{orderId:'order1',SK:'METADATA'}]});
 f.db.send=async c=>{if(c instanceof ScanCommand){f.scans.push(c.input);return f.scan(c.input);}return send(c);};
 f.calls=[];f.remaining=60000;f.start=async s=>{f.calls.push(s);return f.execute();};
 f.host=host({db:f.db,now:()=>f.time,mode:'REQUIRED',enableDeliveryFunding:true,remainingMs:()=>f.remaining,start:s=>f.start(s)});
 f.refresh=()=>{for(const id of ['driver1','driver2'])f.get('WizzDriverLiveState_staging',{driverId:id}).locationUpdatedAt=new Date(f.time).toISOString();};
 return f;
}
test('periodic financial host sends and advances expired V2 waves with original funding unchanged',async()=>{
 const f=await setup(),funding=f.funding(),snapshot=structuredClone(f.order().financialSnapshot);
 assert.equal((await f.host.tick('tick1')).failed,0);assert.equal(f.out.length,2);
 f.time+=60001;f.refresh();assert.equal((await f.host.tick('tick2')).failed,0);
 assert.equal(f.job().currentWaveNumber,2);assert.equal(f.out.length,4);assert.equal(f.funding(),funding);assert.deepEqual(f.order().financialSnapshot,snapshot);
 assert.equal(f.get('WaveOffers_staging',{orderId:'order1',SK:'FINANCIAL#driver1#WAVE#1'}).responseStatus,'financial_expired');
});
test('financial host resumes missing send acknowledgement without extending offer or search deadlines',async()=>{
 const f=await setup();await f.host.tick('one');const wave=f.get('WizzDispatchJobs_staging',{orderId:'order1',SK:'FINANCIAL_WAVE#1'}),deadline=f.job().expiresAt;
 wave.delivered=['driver1'];const offer=f.get('WaveOffers_staging',{orderId:'order1',SK:'FINANCIAL#driver2#WAVE#1'}),expiry=offer.expiresAt;
 f.time+=1000;assert.equal((await f.host.tick('two')).failed,0);assert.equal(f.out.length,3);assert.equal(f.job().currentWaveNumber,1);assert.equal(offer.expiresAt,expiry);assert.equal(f.job().expiresAt,deadline);
});
test('concurrent host ticks lease one independent financial cursor and send once',async()=>{
 const f=await setup(),r=await Promise.all([f.host.tick('a'),f.host.tick('b')]);assert(r.some(v=>v.busy));assert.equal(f.calls.length,1);assert.equal(f.out.length,2);
 assert.equal(f.get('WizzDispatchJobs_staging',checkpoint).leaseUntil,0);assert.equal(f.get('WizzDispatchJobs_staging',{...checkpoint,SK:'CURSOR#LEGACY'}),undefined);
});
test('assigned or foreign engine jobs never produce another financial wave',async()=>{
 const f=await setup();await f.host.tick('one');await f.service('driver1').accept(f.selector('driver1'));await f.host.tick('two');assert.equal(f.calls.length,1);
 f.job().financialDispatch=false;assert.equal((await f.host.processOrder('order1')).skipped,'OTHER_ENGINE');
});
test('failed invocation retries durable intent without allocating subsidy twice',async()=>{
 const f=await setup(),funding=f.funding(),normal=f.start;f.start=async()=>{throw Error('lost invocation');};assert.equal((await f.host.tick('one')).failed,1);
 const intent=f.job().dispatchTransition.id;f.start=normal;f.time+=1000;assert.equal((await f.host.tick('two')).failed,0);assert.equal(f.job().dispatchTransition.id,intent);assert.equal(f.out.length,2);assert.equal(f.funding(),funding);
});
test('empty filtered pages and short remaining execution preserve financial scan continuation',async()=>{
 const f=await setup(),cursor={orderId:'later',SK:'METADATA'};f.scan=()=>({Items:[],LastEvaluatedKey:cursor});await f.host.tick('empty');assert.deepEqual(f.get('WizzDispatchJobs_staging',checkpoint).cursor,cursor);
 f.scan=()=>({Items:[{orderId:'order1',SK:'METADATA'}]});f.remaining=1000;assert.equal((await f.host.tick('short')).complete,false);assert.equal(f.calls.length,0);assert.deepEqual(f.scans.at(-1).ExclusiveStartKey,cursor);
});
test('disabled capability, changed snapshot, and legacy restart cannot enter financial execution',async()=>{
 const f=await setup();await assert.rejects(host({db:f.db,mode:'OFF',start:async()=>{}}).tick('off'),/FINANCIAL_HOST_DISABLED/);
 f.order().financialSnapshot.deliveryFunding.policyPin.policyId='changed';assert.equal((await f.host.tick('invalid')).failed,1);assert.equal(f.calls.length,0);
 const g=await setup();g.job().dispatchRestart={restartId:'legacy'};assert.equal((await g.host.tick('restart')).failed,1);assert.equal(g.calls.length,0);
});
test('financial search ends at its captured limit without cancelling the order or releasing original funding',async()=>{
 const f=await setup(),funding=f.funding(),snapshot=structuredClone(f.order().financialSnapshot);
 const count=f.job().maxWaves;await f.host.tick('first');
 for(let n=1;n<=count;n++){f.time+=60001;f.refresh();assert.equal((await f.host.tick('tick'+n)).failed,0);}
 assert.equal(f.job().status,'no_driver_available');assert.equal(f.order().status,'ready_for_pickup');assert.equal(f.calls.length,count);
 assert.equal(f.funding(),funding);assert.deepEqual(f.order().financialSnapshot,snapshot);
 await f.host.tick('again');assert.equal(f.calls.length,count);
});

test('financial tick crosses empty historical pages in one bounded pass without changing deadlines',async()=>{
 const f=await setup(),deadline=f.job().expiresAt;let pages=0;
 f.scan=()=>++pages<4?{Items:[],LastEvaluatedKey:{orderId:'history'+pages,SK:'META'}}:{Items:[{orderId:'order1',SK:'METADATA'}]};
 const r=await f.host.tick('paged');assert.equal(pages,4);assert.equal(r.processed,1);assert.equal(f.calls.length,1);assert.equal(f.job().expiresAt,deadline);
});
test('financial history scanning is bounded and retains continuation',async()=>{
 const f=await setup();let pages=0;f.scan=()=>({Items:[],LastEvaluatedKey:{orderId:'history'+(++pages),SK:'META'}});
 const r=await f.host.tick('bounded');assert.equal(pages,20);assert.equal(r.hasContinuation,true);assert.equal(f.calls.length,0);
});
