const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./helpers/dispatch-financial-retry-fixture.cjs');
const {financialOfferSK}=require('../dist/financialOfferKey');
const {createStagingDriverOfferStore}=require('../dist/driverOfferStore');
const {createStagingDriverOfferAcceptance}=require('../dist/driverOfferAcceptance');
const {quoteCanonical}=require('../dist/deliveryQuoteRecord');
const money=f=>quoteCanonical([...f.rows].filter(([k])=>/^staging-(Wallets|Holds|LedgerEntries)\|/.test(k)));
async function offered(){
 const f=await fixture();f.retryMode='SAFE_FINANCIAL_RETRY';
 // Recreate a real immutable offer at the old cycle timestamp; then restore the reviewed job.
 const job=structuredClone(f.job()),time=f.time;f.time-=61000;
 Object.assign(f.job(),{status:'searching',financialPreparingWave:1,currentWaveNumber:0});
 const prepared=await f.context.prepare({orderId:'order1',branchId:'branch1',driverId:'driver1',waveNumber:1,offerId:'old-offer'});
 await createStagingDriverOfferStore({db:f.db,now:()=>f.time,enableDeliveryFunding:true}).save(prepared);
 Object.assign(f.job(),job);f.time=time;
 const old=f.get('WaveOffers_staging',{orderId:'order1',SK:'FINANCIAL#driver1#WAVE#1'});
 old.responseStatus='financial_declined';
 const wave=f.get('WizzDispatchJobs_staging',{orderId:'order1',SK:'FINANCIAL_WAVE#1'});wave.state='READY';wave.driverIds=['driver1'];wave.delivered=['driver1'];
 // These fields do not alter the established projected review digest.
 f.job().excludedDrivers=['driver1'];f.job().financialExcludedDriverIds=['driver2'];
 return {f,old};
}
test('staff restart reoffers to prior drivers in an isolated cycle; old offer/history and money survive; stale acceptance fails',async()=>{
 const {f,old}=await offered(),before=structuredClone(old),cash=money(f),snapshot=structuredClone(f.order().financialSnapshot);
 const receipt=await f.retry();assert.equal(receipt.status,'EXECUTED');assert.equal(f.job().dispatchCycle.keyVersion,3);assert.deepEqual(f.job().excludedDrivers,[]);assert.deepEqual(f.job().financialExcludedDriverIds,[]);
 const history=[...f.rows.values()].find(r=>r.kind==='DISPATCH_CYCLE_HISTORY');assert.deepEqual(history.source.excludedDrivers,['driver1']);assert.deepEqual(history.source.financialExcludedDriverIds,['driver2']);
 assert.equal((await f.start()).state,'STARTED');assert.equal(f.out.length,2);assert.deepEqual(old,before);assert.equal(money(f),cash);assert.deepEqual(f.order().financialSnapshot,snapshot);
 const sk=await financialOfferSK(f.db,'order1','driver1',1),fresh=f.get('WaveOffers_staging',{orderId:'order1',SK:sk});assert.notEqual(sk,old.SK);assert.notEqual(fresh.offerId,old.offerId);
 const api=createStagingDriverOfferAcceptance({db:f.db,now:()=>f.time,enableDeliveryFunding:true,context:f.context,authenticateDriver:async()=>({driverId:'driver1',subjectId:'driver1'})});
 await assert.rejects(api.accept({orderId:'order1',waveNumber:1,offerId:old.offerId}));
 await api.accept({orderId:'order1',waveNumber:1,offerId:fresh.offerId});assert.equal(f.order().driverId,'driver1');
 f.order().status='arrived_at_customer';await require('../dist/codCompletion').createStagingCodCompletion({db:f.db,now:()=>f.time,enableDeliveryFunding:true,authenticateDriver:async()=>({driverId:'driver1',subjectId:'driver1'})}).complete({orderId:'order1',cashCollected:true});assert.equal(f.order().status,'delivered');assert.deepEqual(old,before);
});
test('an active previous offer, unreleased acceptance, malformed proof or pending integration cannot restart',async()=>{
 for(const change of [o=>{o.responseStatus='financial_pending';o.expiresAt='2099-01-01T00:00:00.000Z';},o=>{o.responseStatus='financial_accepted';o.isWinner=true;},o=>{delete o.financialOffer;}]){
  const {f,old}=await offered();change(old);const cash=money(f),job=structuredClone(f.job());const r=await f.retry();assert.notEqual(r.status,'EXECUTED');assert.deepEqual(f.job(),job);assert.equal(money(f),cash);
 }
});

test('a fully released prior driver is eligible again, with previous guarantee and performance history preserved',async()=>{
 const f=await fixture({priorUnassign:true});f.retryMode='SAFE_FINANCIAL_RETRY';
 const cash=money(f),release=structuredClone(f.get('staging-Holds',{orderId:'order1',sk:'ASSIGNMENT_RELEASE#1'}));
 assert.equal((await f.retry()).status,'EXECUTED');assert.deepEqual(f.job().financialExcludedDriverIds,[]);
 for(const id of ['driver1','driver2'])f.get('WizzDriverLiveState_staging',{driverId:id}).locationUpdatedAt=new Date(f.time).toISOString();
 assert.equal((await f.start()).state,'STARTED');assert.equal(money(f),cash);assert.deepEqual(f.get('staging-Holds',{orderId:'order1',sk:'ASSIGNMENT_RELEASE#1'}),release);
 const sk=await financialOfferSK(f.db,'order1','driver1',1),fresh=f.get('WaveOffers_staging',{orderId:'order1',SK:sk});
 await createStagingDriverOfferAcceptance({db:f.db,now:()=>f.time,enableDeliveryFunding:true,context:f.context,authenticateDriver:async()=>({driverId:'driver1',subjectId:'driver1'})}).accept({orderId:'order1',waveNumber:1,offerId:fresh.offerId});assert.equal(f.order().assignmentAttemptCounter,2);
 await require('../dist/codReassignment').createStagingCodReassignment({db:f.db,now:()=>f.time,enableDeliveryFunding:true,reassignmentWindowSeconds:120,authenticate:async()=>({kind:'DRIVER',subjectId:'driver1'})}).unassign({orderId:'order1',offerId:fresh.offerId,attempt:2,cashCollected:false,reason:'Emergency'});
 const archived=f.get('staging-Holds',{orderId:'order1',sk:'ASSIGNMENT_RELEASE#2'});assert.equal(archived.offerStorageKey,sk);
 assert.equal(await require('../dist/financialOfferKey').historicalFinancialOfferSK(f.db,'order1','driver1',1,fresh.offerId,archived.offerStorageKey),sk);
 await assert.rejects(require('../dist/financialOfferKey').historicalFinancialOfferSK(f.db,'order1','driver1',1,fresh.offerId));
});
test('released assignment waits for financial integration and never resets an active hold',async()=>{
 for(const mutate of [f=>{[...f.rows.values()].find(r=>r.kind==='COD_UNASSIGN_OUTBOX').status='PENDING_INTEGRATION';},f=>{f.get('staging-Holds',{orderId:'order1',sk:'HOLD'}).status='ACTIVE';}]){
 const f=await fixture({priorUnassign:true});f.retryMode='SAFE_FINANCIAL_RETRY';mutate(f);const cash=money(f);const result=await f.retry();assert.notEqual(result.status,'EXECUTED');assert.equal(f.queue(),undefined);assert.equal(money(f),cash);
 }
});
