const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./helpers/dispatch-cycle-fixture.cjs');
const {route}=require('./helpers/driver-offer-fixture.cjs');
const {createStagingDriverOfferContext}=require('../dist/driverOfferContext');
const {createStagingDriverOfferAcceptance}=require('../dist/driverOfferAcceptance');
const {createStagingDispatchWaveExecutor}=require('../dist/dispatchWaveExecutor');
async function setup(engine='FINANCIAL'){
 const f=fixture(engine);await f.create();f.selected=0;f.out=[];
 f.contextFactory=p=>createStagingDriverOfferContext({...p,now:()=>f.time,cognito:{async send(c){return {Enabled:true,Username:c.input.Username,UserStatus:'CONFIRMED',UserAttributes:[{Name:'sub',Value:c.input.Username}]};}},router:{async getRoute(a,b){return route('route',a,b);}}});
 f.send=async(id,message)=>{f.out.push({id,message});};
 f.executor=createStagingDispatchWaveExecutor({db:f.db,now:()=>f.time,selectDrivers:async()=>{f.selected++;return ['driver1','driver2'];},context:f.contextFactory,sendOffer:(...args)=>f.send(...args)});
 f.run=(owner='worker1')=>f.executor.run({orderId:'order1',assignmentId:'dispatch1',owner,leaseSeconds:10});
 f.wave=()=>f.get('WizzDispatchJobs_staging',{orderId:'order1',SK:'FINANCIAL_WAVE#1'});
 f.intent=()=>f.get('WizzDispatchJobs_staging',{orderId:'order1',SK:'DISPATCH_TRANSITION#'+f.job().dispatchTransition.id});
 f.service=id=>createStagingDriverOfferAcceptance({db:f.db,now:()=>f.time,context:f.context,authenticateDriver:async()=>({driverId:id,subjectId:id})});
 f.selector=id=>({orderId:'order1',waveNumber:1,offerId:f.get('WaveOffers_staging',{orderId:'order1',SK:'FINANCIAL#'+id+'#WAVE#1'}).offerId});
 return f;
}
test('pinned financial producer atomically marks READY and APPLIED, then sends fixed IDs; replay does not select or send again',async()=>{
 const f=await setup();const r=await f.run();assert.equal(r.kind,'FINANCIAL_WAVE_READY');assert.equal(f.intent().state,'APPLIED');assert.equal(f.wave().cycleDigest,f.job().dispatchCycle.digest);assert.equal(f.out.length,2);assert.equal(f.selected,1);
 for(const row of [...f.rows.values()].filter(v=>v.kind==='FINANCIAL_DRIVER_OFFER'))assert(Date.parse(row.expiresAt)<=Date.parse(f.intent().waveDeadline));
 await f.run();assert.equal(f.selected,1);assert.equal(f.out.length,2);assert.equal(f.get('staging-Wallets',{walletId:'WALLET#DRIVER#driver1',sk:'META'}).lockedBalance,0);
});
test('send timeout resumes the same saved offer and recipient list after lease transfer',async()=>{
 const f=await setup();let failed=false;f.send=async(id,m)=>{f.out.push({id,message:m});if(!failed){failed=true;throw Error('send acknowledgement lost');}};
 await assert.rejects(f.run(),/send acknowledgement lost/);assert.equal(f.intent().state,'APPLIED');const saved=structuredClone(f.get('WaveOffers_staging',{orderId:'order1',SK:'FINANCIAL#driver1#WAVE#1'}));
 f.time+=10000;await f.run('worker2');assert.equal(f.out[0].message.eventId,f.out[1].message.eventId);assert.equal(f.selected,1);assert.deepEqual(f.get('WaveOffers_staging',{orderId:'order1',SK:saved.SK}),saved);assert.equal(f.out.length,3);assert.equal(f.intent().leaseVersion,2);
});
test('expired worker cannot prepare another offer or acknowledge delivery',async()=>{
 const f=await setup();f.send=async(id,m)=>{f.out.push({id,message:m});f.time+=11000;};await assert.rejects(f.run());assert.equal(f.out.length,1);assert.deepEqual(f.wave().delivered,[]);
});
test('acceptance while sending stops further notifications; winner+hold replay remains idempotent',async()=>{
 const f=await setup();f.send=async(id,m)=>{f.out.push({id,message:m});await f.service(id).accept(f.selector(id));};const r=await f.run();assert.equal(r.action,'STOP');assert.equal(f.out.length,1);assert.equal(f.job().status,'assigned');assert.equal((await f.service('driver1').accept(f.selector('driver1'))).replayed,true);
 assert.equal(f.get('staging-Wallets',{walletId:'WALLET#DRIVER#driver1',sk:'META'}).lockedBalance,10500);await f.run();assert.equal(f.out.length,1);
});
test('declines use pinned READY proof and advance once; repeated decline resumes the same next intent',async()=>{
 const f=await setup();await f.run();const first=await f.service('driver1').decline(f.selector('driver1'));assert.equal(first.transition.action,'WAIT');const last=await f.service('driver2').decline(f.selector('driver2'));assert.equal(last.transition.waveNumber,2);const repeat=await f.service('driver2').decline(f.selector('driver2'));assert.equal(repeat.transition.intentId,last.transition.intentId);assert.equal(f.intent().sequence,2);
});
test('stale transition, missing application proof or changed deadline blocks acceptance and decline before money',async()=>{
 for(const mutate of [f=>f.intent().state='LEASED',f=>f.wave().cycleDigest='wrong',f=>f.intent().waveDeadline='bad',f=>f.job().dispatchTransition.id='replacement']){
  const f=await setup();await f.run();mutate(f);await assert.rejects(f.service('driver1').accept(f.selector('driver1')));await assert.rejects(f.service('driver1').decline(f.selector('driver1')));assert.equal(f.job().status,'searching');assert.equal(f.get('staging-Wallets',{walletId:'WALLET#DRIVER#driver1',sk:'META'}).lockedBalance,0);
 }
});
test('legacy cycles cannot enter the financial producer or create financial offers',async()=>{
 const f=await setup('LEGACY');await assert.rejects(f.run(),/LEGACY_CYCLE_EXECUTOR_NOT_READY/);assert.equal(f.wave(),undefined);assert.equal(f.out.length,0);
});
test('simultaneous final declines create one next transition and a stale preparation path cannot bypass the executor',async()=>{
 const f=await setup();await f.run();const results=await Promise.all([f.service('driver1').decline(f.selector('driver1')),f.service('driver2').decline(f.selector('driver2'))]);assert(results.every(v=>v.success));assert.equal(f.intent().waveNumber,2);assert.equal(f.intent().sequence,2);
 const {createStagingDriverFinancialWave}=require('../dist/driverFinancialWave');await assert.rejects(createStagingDriverFinancialWave({db:f.db,context:f.context,now:()=>f.time,sendOffer:async()=>{throw Error('must not send');}}).run({orderId:'order1',branchId:'branch1',waveNumber:2,driverIds:[]}));
});
test('a failed READY acknowledgement never leaves APPLIED without a READY wave',async()=>{
 const f=await setup();let trapped=false;
 const original=f.db.send;f.db.send=async command=>{if(command.input.TransactItems?.some(op=>op.Update?.ExpressionAttributeValues?.[':applyState']==='APPLIED')){trapped=true;throw Error('READY transaction failed');}return original(command);};
 await assert.rejects(f.run());assert.equal(trapped,true);assert.equal(f.intent().state,'LEASED');assert.equal(f.wave().state,'PREPARING');assert.equal(f.out.length,0);
 f.db.send=original;await f.run();assert.equal(f.intent().state,'APPLIED');assert.equal(f.wave().state,'READY');assert.equal(f.out.length,2);assert.equal(f.selected,1);
});
test('composition preserves token boundaries and omits empty expression maps for repeated deletion fences',()=>{
 const {composeDispatchTransaction}=require('../dist/dispatchTransaction');
 const raw={ConditionCheck:{TableName:'locks',Key:{pk:'p',sk:'s'},ConditionExpression:'attribute_not_exists(pk)'}};
 const merged=composeDispatchTransaction([raw],[raw])[0].ConditionCheck;assert.equal(merged.ExpressionAttributeNames,undefined);assert.equal(merged.ExpressionAttributeValues,undefined);
 const a={ConditionCheck:{TableName:'jobs',Key:{orderId:'o',SK:'m'},ConditionExpression:'#f1=:v1 AND #f10=:v10',ExpressionAttributeNames:{'#f1':'one','#f10':'ten'},ExpressionAttributeValues:{':v1':1,':v10':10}}};
 const b=composeDispatchTransaction([a],[a])[0].ConditionCheck;assert.equal(Object.keys(b.ExpressionAttributeNames).length,4);assert.equal(Object.keys(b.ExpressionAttributeValues).length,4);assert(!b.ConditionExpression.includes('undefined'));
});
test('revoked transition during the acceptance transaction rolls back assignment and funds',async()=>{
 const f=await setup();await f.run();f.beforeCommit=()=>{f.intent().state='CANCELLED';};await assert.rejects(f.service('driver1').accept(f.selector('driver1')));assert.equal(f.job().status,'searching');assert.equal(f.get('staging-Wallets',{walletId:'WALLET#DRIVER#driver1',sk:'META'}).lockedBalance,0);assert.equal(f.get('staging-Holds',{orderId:'order1',sk:'HOLD'}),undefined);
});
test('failure advancing a committed decline returns a pending transition and retry resumes it',async()=>{
 const f=await setup();await f.run();await f.service('driver1').decline(f.selector('driver1'));const send=f.db.send;let committed=false,failed=false;
 f.db.send=async c=>{if(committed&&!failed&&c.input.TableName==='WizzDispatchJobs_staging'&&c.input.Key?.SK==='METADATA'){failed=true;throw Error('followup unavailable');}const r=await send(c);if(c.input.TransactItems?.some(op=>op.Update?.ExpressionAttributeValues?.[':uStatus']==='financial_declined'))committed=true;return r;};
 const r=await f.service('driver2').decline(f.selector('driver2'));assert.equal(r.success,true);assert.equal(r.transitionPending,true);assert.equal(f.get('WaveOffers_staging',{orderId:'order1',SK:'FINANCIAL#driver2#WAVE#1'}).responseStatus,'financial_declined');f.db.send=send;const retried=await f.service('driver2').decline(f.selector('driver2'));assert.equal(retried.transition.waveNumber,2);
});
test('a decline after lost send acknowledgement does not block delivery to remaining recipients',async()=>{
 const f=await setup();let once=true;f.send=async(id,m)=>{f.out.push({id,message:m});if(once){once=false;throw Error('lost send ACK');}};await assert.rejects(f.run());await f.service('driver1').decline(f.selector('driver1'));f.time+=10000;await f.run('worker2');assert.equal(f.out.length,2);assert.equal(f.out[1].id,'driver2');assert.deepEqual(f.wave().delivered,['driver2']);assert.equal(f.get('WaveOffers_staging',{orderId:'order1',SK:'FINANCIAL#driver1#WAVE#1'}).responseStatus,'financial_declined');
});
