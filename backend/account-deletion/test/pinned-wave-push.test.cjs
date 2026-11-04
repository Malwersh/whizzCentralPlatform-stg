const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const {pinnedWavePushData,pinnedWavePushDigest}=require('../../src/utils/pinned-wave-push');
const {createPinnedWavePushHandler}=require('../../src/utils/pinned-wave-push-handler');
const at=Date.parse('2026-10-16T12:00:00.000Z');
function fixture(keyVersion){
 const body={dispatchDriverId:'driver-record',driverId:'driver-sub',offerId:'offer1',eventId:'offer1',orderId:'order1',cycleId:'cycle1',waveNumber:1,restaurantId:'branch1',restaurantName:'مطعم',restaurantAddress:'عنوان',restaurantLat:31.91,restaurantLng:44.45,customerAddress:'عنوان عميل',customerLat:31.92,customerLng:44.46,deliveryFee:0,tip:1500,bonusAmount:0,orderTotal:101500,holdRequiredAmount:100000,estimatedEarnings:1500,currency:'IQD',distance:1.5,estimatedMinutes:8,itemsCount:1,sentAt:new Date(at).toISOString(),expiresAt:new Date(at+90000).toISOString(),moneyUnit:'IQD_WHOLE',legacySourceVersion:1,type:'new_wave_offer',action:'wave_assignment'};
 if(keyVersion!==undefined)body.dispatchKeyVersion=keyVersion;
 const data=pinnedWavePushData(body,at),digest='a'.repeat(64);body.dispatchMessageDigest=digest;
 const offer={orderId:'order1',SK:require('../../src/utils/dispatch-cycle-keys').dispatchOfferSK({id:'cycle1',engine:'LEGACY',...(keyVersion===2?{keyVersion:2}:{})},'driver-record',1),...(keyVersion===2?{dispatchKeyVersion:2}:{}),offerId:'offer1',driverId:'driver-record',driverSubjectId:'driver-sub',dispatchCycleId:'cycle1',legacySourceVersion:1,responseStatus:'pending',isWinner:false,expiresAt:body.expiresAt,deliveryAck:{schemaVersion:1,messageDigest:digest,pushDigest:pinnedWavePushDigest(data)}};
 const profile={driverId:'driver-record',cognitoSub:'driver-sub',status:'APPROVED'},token={token:'token1',subjectId:'driver-sub',app:'driver',env:'staging',ttl:Math.floor(at/1000)+600};
 const calls=[],sent=[],env={...require('../../wallet-service/test/helpers/finance-rollout-fixture.cjs').scopeEnv({orders:[{orderId:'order1',branchId:'branch1',customerSubjectId:'customer'}],drivers:[{driverId:'driver-record',subjectId:'driver-sub'}]}),STAGE:'staging',AWS_REGION:'us-east-1',PINNED_DISPATCH_ACCOUNT_ID:'699561669180',PINNED_LEGACY_PUSH_MODE:'REQUIRED',PUSH_TOKENS_TABLE:'WizzCentral_PushDeviceTokens_staging'};
 const f={body,data,offer,profile,token,calls,sent,env,time:at,closed:false,job:{orderId:'order1',SK:'METADATA',status:'searching',dispatchCycle:{id:'cycle1',engine:'LEGACY',...(keyVersion===2?{keyVersion:2}:{})}},tokenMissing:false,pages:0,beforeRead:()=>{},query:()=>({Items:[token]}),provider:()=>({successCount:1})};
 const db={async send(c){const q=c.input;calls.push(q);f.beforeRead(q);if(c.constructor.name==='QueryCommand'){f.pages++;return f.query(q);}assert.equal(c.constructor.name,'GetCommand');assert.equal(q.ConsistentRead,true);const row=q.TableName==='WizzOrders'?{PK:'ORDER#order1',SK:'META',orderId:'order1',storeId:'branch1',userSub:'customer',financeRollout:require('../../wallet-service/test/helpers/finance-rollout-fixture.cjs').scopePin(env,'order1')}:q.TableName==='WizzDispatchJobs_staging'?f.job:q.TableName==='WaveOffers_staging'?q.Key.SK===offer.SK?offer:undefined:q.TableName==='WhizzDrivers_staging'?profile:q.TableName==='staging-AccountDeletion'?f.closed?{pk:q.Key.pk}:undefined:q.TableName===env.PUSH_TOKENS_TABLE&&!f.tokenMissing?token:undefined;return {Item:row&&structuredClone(row)};}};
 f.run=()=>createPinnedWavePushHandler({db,env,now:()=>f.time,getMessaging:async()=>({sendEachForMulticast:async m=>{sent.push(m);return f.provider();}})})(body);return f;
}
test('pinned push preserves explicit units, cash tip, zero fee, cycle and recipient without leaking token failures',async()=>{
 const f=fixture(),r=await f.run(),body=JSON.parse(r.body);assert.equal(body.success,true);assert.equal(body.offerId,'offer1');assert.equal(body.driverId,'driver-sub');assert.equal(f.sent[0].data.tip,'1500');assert.equal(f.sent[0].data.orderTotal,'101500');assert.equal(f.sent[0].data.deliveryFee,'0');assert.equal(f.sent[0].data.cycleId,'cycle1');assert.equal(f.sent[0].data.moneyUnit,'IQD_WHOLE');assert.equal(f.sent[0].apns.payload.tip,undefined);assert.equal(f.sent[0].apns.headers['apns-expiration'],String(Math.floor((at+90000)/1000)));assert(!JSON.stringify(body).includes('token1'));assert(!JSON.stringify(f.sent[0].data).includes('dispatchMessageDigest'));
});
test('versioned notification mode is closed by default and outside the exact Staging scope',async()=>{
 for(const change of [e=>delete e.PINNED_LEGACY_PUSH_MODE,e=>e.PINNED_LEGACY_PUSH_MODE='OFF',e=>e.STAGE='production',e=>e.PINNED_DISPATCH_ACCOUNT_ID='other',e=>e.AWS_REGION='other']){const f=fixture();change(f.env);assert.equal((await f.run()).statusCode,503);assert.equal(f.calls.length,0);assert.equal(f.sent.length,0);}
});
test('accepted, expired, foreign, tampered or deleting offers cannot reach Firebase',async()=>{
 for(const change of [f=>f.offer.responseStatus='accepted',f=>f.offer.isWinner=true,f=>f.offer.dispatchCycleId='another',f=>f.offer.driverSubjectId='another',f=>f.profile.cognitoSub='another',f=>f.profile.isBanned=true,f=>f.closed=true,f=>f.time=at+90000,f=>f.body.tip=0,f=>f.offer.deliveryAck.messageDigest='wrong']){const f=fixture();change(f);await assert.rejects(f.run());assert.equal(f.sent.length,0);}
});
test('token index pagination, app ownership and strong rehydration prevent sending to removed or reassigned tokens',async()=>{
 const f=fixture();f.query=()=>f.pages===1?{Items:[],LastEvaluatedKey:{token:'cursor'}}:{Items:[f.token,{...f.token,token:'user-token',app:'user'}]};await f.run();assert.equal(f.pages,2);assert.deepEqual(f.sent[0].tokens,['token1']);
 for(const change of [f=>f.tokenMissing=true,f=>f.token.subjectId='another',f=>f.token.app='user',f=>f.token.env='production',f=>f.token.ttl=0]){const g=fixture();g.beforeRead=q=>{if(q.TableName===g.env.PUSH_TOKENS_TABLE&&q.Key)change(g);};const r=await g.run();assert.equal(JSON.parse(r.body).success,false);assert.equal(g.sent.length,0);}
});
test('deletion or acceptance after token lookup prevents the final provider call',async()=>{
 for(const kind of ['deletion','accepted']){const f=fixture();f.beforeRead=q=>{if(q.TableName===f.env.PUSH_TOKENS_TABLE&&q.Key){if(kind==='deletion')f.closed=true;else f.offer.responseStatus='accepted';}};await assert.rejects(f.run());assert.equal(f.sent.length,0);}
});
test('all provider failures return an explicit non-ACK with no free error text or token identifiers',async()=>{
 const f=fixture();f.provider=()=>({successCount:0,responses:[{error:{message:'PRIVATE_TOKEN_FAILURE'}}]});const r=await f.run();assert.equal(JSON.parse(r.body).success,false);assert.equal(JSON.parse(r.body).successCount,0);assert(!r.body.includes('PRIVATE'));
});
test('incomplete or looping token inventory fails closed without a partial multicast',async()=>{
 const f=fixture();f.query=()=>({Items:[f.token],LastEvaluatedKey:{token:'same'}});await assert.rejects(f.run());assert.equal(f.sent.length,0);
});
test('unknown unit/extra metadata and overflowing FCM envelope are refused without truncation',async()=>{
 for(const change of [f=>f.body.moneyUnit='MINOR',f=>f.body.metadata={phone:'PRIVATE'},f=>f.body.restaurantAddress='ع'.repeat(1000)]){const f=fixture();change(f);await assert.rejects(f.run());assert.equal(f.sent.length,0);}
});
test('existing internal-key HTTP handler preserves legacy route and never falls back for versioned input',async()=>{
 const calls=[],exports={},modules={
  '@aws-sdk/client-dynamodb':{DynamoDBClient:class{}},'@aws-sdk/lib-dynamodb':{DynamoDBDocumentClient:{from:()=>({send:async()=>{calls.push('query');return {Items:[]};}})},QueryCommand:class{}},
  '../utils/firebase':{getMessaging:async()=>{throw Error('unexpected');}},'../utils/http':require('../../src/utils/http'),
  '../utils/pinned-wave-push-handler':{createPinnedWavePushHandler:()=>async()=>({statusCode:503,body:'closed'})}
 };
 vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../../src/handlers/push-wave-offer.js'),'utf8'),{exports,process:{env:{PUSH_TOKENS_TABLE:'tokens',NOTIFICATIONS_INTERNAL_KEY:'test-only'}},console:{error(){}},require:n=>{assert(modules[n],n);return modules[n];}});
 const event=body=>({httpMethod:'POST',headers:{'x-internal-key':'test-only'},body:JSON.stringify(body)});
 assert.equal((await exports.sendWaveOffer(event({driverId:'d',orderId:'o',offerId:'f'}))).statusCode,200);assert.equal(calls.length,1);
 assert.equal((await exports.sendWaveOffer(event({legacySourceVersion:1}))).statusCode,503);assert.equal(calls.length,1);
 assert.equal((await exports.sendWaveOffer({...event({legacySourceVersion:1}),headers:{}})).statusCode,401);
});

test('cycle-scoped push addresses exact namespace and rejects a superseded cycle or stripped version',async()=>{const f=fixture(2);assert.equal(JSON.parse((await f.run()).body).success,true);assert(f.calls.some(q=>q.TableName==='WaveOffers_staging'&&q.Key.SK.startsWith('CYCLE#')));assert.equal(f.sent[0].data.dispatchKeyVersion,'2');for(const change of [g=>g.job.dispatchCycle.id='next-cycle',g=>g.job.status='cancelled',g=>delete g.body.dispatchKeyVersion,g=>g.offer.dispatchKeyVersion=3]){const g=fixture(2);change(g);await assert.rejects(g.run());assert.equal(g.sent.length,0);}});

test('queued old-format push is refused once its job moves to a new cycle, including a change after token hydration',async()=>{for(const late of [false,true]){const f=fixture();if(late)f.beforeRead=q=>{if(q.TableName===f.env.PUSH_TOKENS_TABLE&&q.Key)f.job.dispatchCycle.id='new-cycle';};else f.job.dispatchCycle.id='new-cycle';await assert.rejects(f.run());assert.equal(f.sent.length,0);}});
