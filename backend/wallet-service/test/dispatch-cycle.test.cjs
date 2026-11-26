const {test}=require('node:test'),assert=require('node:assert/strict');
const {policy,fixture}=require('./helpers/dispatch-cycle-fixture.cjs');
const {validateOperationsValues}=require('../dist/deliveryOperationsPolicy');
const {createDispatchCycle,validateDispatchCycle,decideDispatchTransition:decide}=require('../dist/dispatchCycle');
const {createStagingDispatchCycleStore}=require('../dist/dispatchCycleStore');
const key={pk:'OPERATIONAL_SETTINGS#DELIVERY_OPERATIONS',sk:'CURRENT'},orderKey={PK:'ORDER#order1',SK:'META'};
const initial={currentWave:0,assigned:false,terminal:false,waveState:'NONE',waveDeadline:null};
function cycle(engine='FINANCIAL'){return createDispatchCycle({id:'c1',orderId:'order1',assignmentId:'a1',engine,startedAt:'2026-10-16T12:00:00.000Z',policy:{version:2,values:policy()}});}
test('five-field operating policies stay valid, expanded policies have explicit units and consistent financial limits',()=>{
 const v=policy();assert.deepEqual(validateOperationsValues(v),v);delete v.dispatch;assert.deepEqual(validateOperationsValues(v),v);
 for(const mutate of [v=>v.dispatch.profiles.FINANCIAL.offerTtlSeconds=90,v=>v.dispatch.profiles.FINANCIAL.normalWaves.pop(),v=>v.dispatch.profiles.LEGACY.normalWaves[0].minimumAcceptancePercent=.7,v=>v.dispatch.profiles.LEGACY.normalWaves[0].number=2,v=>v.dispatch.profiles.FINANCIAL.normalWaves[3].recipients='ALL',v=>v.dispatch.profiles.LEGACY.recovery.enabled=true,v=>v.dispatch.profiles.LEGACY.boost=true,v=>v.dispatch.performanceMode='NEW_SCORE']){const p=policy();mutate(p);assert.throws(()=>validateOperationsValues(p));}
});
test('new job, order link, pinned policy and deletion fences form one transaction without financial writes',async()=>{
 const f=fixture(),r=await f.create();assert.equal(r.policyVersion,2);assert.equal(f.job().dispatchCycle.engine,'FINANCIAL');assert.equal(f.job().expiresAt,new Date(f.time+900000).toISOString());assert.equal(f.get('WizzOrders',orderKey).deliveryJobId,'dispatch1');
 const tx=f.calls.find(c=>c.input.TransactItems).input.TransactItems;assert(tx.some(x=>x.ConditionCheck?.Key.pk===key.pk));assert(tx.some(x=>x.ConditionCheck?.Key.pk==='BUSINESS_LIFECYCLE#MERCHANT#branch1'));assert(tx.some(x=>x.ConditionCheck?.Key.pk==='ACCOUNT_LIFECYCLE#MERCHANT#owner1'));assert(!tx.some(x=>/Wallets|LedgerEntries|Holds|WaveOffers/.test((x.Put??x.Update??x.ConditionCheck).TableName)));
});
test('legacy and financial cycles pin distinct compatibility profiles without granting recovery or score activation',async()=>{
 for(const engine of ['LEGACY','FINANCIAL']){const f=fixture(engine);await f.create();const c=f.job().dispatchCycle;assert.equal(c.engine,engine);const first=decide(c,initial,c.startedAt);assert.equal(first.offerTtlSeconds,engine==='LEGACY'?90:60);assert.equal(c.policy.values.dispatch.profiles[engine].recovery.enabled,false);assert.equal(c.policy.values.dispatch.performanceMode,'LEGACY_METRICS');}
});
test('racing creation requests yield one job and cannot replace its cycle or order link',async()=>{
 const f=fixture();const results=await Promise.allSettled([f.create(),f.store.create({requestId:'other-cycle',job:{...f.input.job,dispatchJobId:'other-job'}})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.get('WizzOrders',orderKey).deliveryJobId,f.job().dispatchJobId);
});
test('lost acknowledgement and retry after a policy update preserve the original cycle and deadline',async()=>{
 const f=fixture(),send=f.db.send;let once=false;f.db.send=async c=>{const r=await send(c);if(c.input.TransactItems&&!once){once=true;throw Error('lost response');}return r;};
 const first=await f.create();assert.equal(first.replayed,true);const before=structuredClone(f.job());f.get('staging-PlatformStaff',key).version=3;f.get('staging-PlatformStaff',key).values.dispatch.profiles.FINANCIAL.normalWaves[0].radiusMeters=7000;f.time+=60000;
 assert.equal((await f.create()).replayed,true);assert.deepEqual(f.job(),before);assert.equal(decide(before.dispatchCycle,initial,before.dispatchCycle.startedAt).rule.radiusMeters,5000);
});
test('policy, order, ownership and deletion races reject the entire creation',async()=>{
 for(const race of ['policy','order','owner','branchDelete','ownerDelete']){const f=fixture();f.beforeCommit=()=>{
  if(race==='policy')f.get('staging-PlatformStaff',key).version++;
  if(race==='order')f.get('WizzOrders',orderKey).status='cancelled';
  if(race==='owner')f.get('WhizzMerchants_Businesses',{businessId:'branch1'}).ownerId='other-owner';
  if(race==='branchDelete'||race==='ownerDelete')f.put('staging-AccountDeletion',{pk:race==='branchDelete'?'BUSINESS_LIFECYCLE#MERCHANT#branch1':'ACCOUNT_LIFECYCLE#MERCHANT#owner1',sk:'META'});
 };await assert.rejects(f.create());assert.equal(f.job(),undefined);assert.equal(f.get('WizzOrders',orderKey).deliveryJobId,undefined);}
});
test('existing old jobs are never backfilled and malformed financial evidence cannot downgrade to legacy',async()=>{
 const old=fixture();old.put('WizzDispatchJobs_staging',old.input.job);await assert.rejects(old.create());assert.equal(old.job().dispatchCycle,undefined);
 for(const value of [null,{}, {schemaVersion:1}]){const f=fixture('LEGACY');f.get('WizzOrders',orderKey).financialSnapshot=value;await assert.rejects(f.create());assert.equal(f.job(),undefined);}
 const f=fixture();delete f.get('WizzOrders',orderKey).financialSnapshot;f.get('WizzOrders',orderKey).commercialPricing={};await assert.rejects(f.create());
});
test('creation refuses an unconfigured policy or reuse of the request for another job',async()=>{
 const f=fixture();delete f.get('staging-PlatformStaff',key).values.dispatch;await assert.rejects(f.create(),/DISPATCH_POLICY_NOT_CONFIGURED/);
 const g=fixture();await g.create();await assert.rejects(g.store.create({...g.input,job:{...g.input.job,restaurantName:'changed'}}));
});
test('cycle digest guards nested policy and deadline; external mutation cannot rewrite a captured snapshot',()=>{
 const p=policy(),c=createDispatchCycle({id:'c1',orderId:'order1',assignmentId:'a1',engine:'LEGACY',startedAt:'2026-10-16T12:00:00.000Z',policy:{version:2,values:p}});p.dispatch.profiles.LEGACY.offerTtlSeconds=1;assert.equal(validateDispatchCycle(c).policy.values.dispatch.profiles.LEGACY.offerTtlSeconds,90);
 for(const mutate of [v=>v.searchDeadline='2026-10-16T13:00:00.000Z',v=>v.policy.values.dispatch.profiles.LEGACY.normalWaves[0].radiusMeters=9000,v=>v.engine='FINANCIAL']){const bad=structuredClone(c);mutate(bad);assert.throws(()=>validateDispatchCycle(bad));}
});
test('decline, timeout and empty completion share the same fourth-wave rule; no fifth wave is silently enabled',()=>{
 const c=cycle('LEGACY'),at='2026-10-16T12:05:00.000Z',base={currentWave:3,assigned:false,terminal:false,waveDeadline:at};const decisions=['EXPIRED','EMPTY','ALL_DECLINED'].map(waveState=>decide(c,{...base,waveState},at));assert.deepEqual(decisions[0],decisions[1]);assert.deepEqual(decisions[1],decisions[2]);assert.equal(decisions[0].rule.recipients,'ALL');assert.equal(decisions[0].waveNumber,4);
 const exhausted=decide(c,{...base,currentWave:4,waveState:'EMPTY'},at);assert.deepEqual(exhausted,{action:'REVIEW',reason:'NORMAL_WAVES_EXHAUSTED'});
});
test('stored deadline controls transitions, assignment and terminal state prevent further dispatch',()=>{
 const c=cycle(),base={currentWave:1,assigned:false,terminal:false,waveState:'OPEN',waveDeadline:'2026-10-16T12:01:00.000Z'};
 assert.equal(decide(c,base,'2026-10-16T12:00:59.999Z').action,'WAIT');assert.equal(decide(c,base,base.waveDeadline).waveNumber,2);
 assert.equal(decide(c,{...base,assigned:true},c.searchDeadline).reason,'ASSIGNED');assert.equal(decide(c,{...base,terminal:true},c.searchDeadline).reason,'ORDER_TERMINAL');assert.equal(decide(c,base,c.searchDeadline).reason,'SEARCH_DEADLINE');
 const last=decide(c,{...base,waveState:'EMPTY'},'2026-10-16T12:14:55.000Z');assert.equal(last.deadline,c.searchDeadline);assert.equal(last.remainingSeconds,5);
});
test('preparation resumes the same wave until its deadline, then requires review instead of publishing stale offers',()=>{
 const c=cycle(),p={currentWave:1,assigned:false,terminal:false,waveState:'PREPARING',waveDeadline:'2026-10-16T12:01:00.000Z'};
 assert.deepEqual(decide(c,p,'2026-10-16T12:00:30.000Z'),{action:'RESUME',waveNumber:1});assert.equal(decide(c,p,p.waveDeadline).reason,'PREPARATION_DEADLINE');
 assert.throws(()=>decide(c,{...p,waveDeadline:'2026-10-16T11:00:00.000Z'},p.waveDeadline));
});

test('an existing pending hold or terminal financial hold prevents initial cycle creation for legacy orders too',async()=>{for(const fields of [{walletPendingHoldId:'pending-hold'},{holdStatus:'ACTIVE'},{holdStatus:'SETTLED'}]){const f=fixture('LEGACY');Object.assign(f.get('WizzOrders',orderKey),fields);await assert.rejects(f.create());assert.equal(f.job(),undefined);}});
