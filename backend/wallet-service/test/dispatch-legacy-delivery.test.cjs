const {test}=require('node:test'),assert=require('node:assert/strict');
const {setup}=require('./helpers/dispatch-legacy-source-fixture.cjs');
const {createStagingLegacyWaveExecutor}=require('../dist/dispatchLegacy');
const {createStagingLegacyOfferDelivery}=require('../dist/dispatchLegacyDelivery');
async function fixture(ids=['driver1'],keyVersion){
 const f=await setup({keyVersion}),sent={ws:[],push:[]};f.ws=async(id,m)=>{sent.ws.push({id,m});};f.push=async p=>{sent.push.push(p);return {statusCode:200,body:JSON.stringify({success:true,driverId:p.driverId,offerId:p.offerId,eventId:p.eventId,cycleId:p.cycleId,successCount:1})};};
 const delivery=createStagingLegacyOfferDelivery({db:f.db,now:()=>f.time,postSocket:(...a)=>f.ws(...a),postPush:p=>f.push(p)});
 f.executor=createStagingLegacyWaveExecutor({db:f.db,now:()=>f.time,selectDrivers:async()=>ids,prepareOffer:f.source.prepare,message:f.source.message,sendOffer:delivery});f.sent=sent;return f;
}
test('existing offer stores independent provider acknowledgements without tokens, addresses or money writes',async()=>{
 const f=await fixture();await f.run();assert.equal(f.sent.ws.length,1);assert.equal(f.sent.push.length,1);const ack=f.offer().deliveryAck;assert.equal(ack.websocketAccepted,true);assert.equal(ack.pushAccepted,true);assert.equal(ack.websocketUnavailable,false);assert(!JSON.stringify(ack).includes('عنوان'));assert(!JSON.stringify(ack).includes('driver1'));await f.run();assert.equal(f.sent.push.length,1);
});
test('push failure retries only push and does not prevent sending to other selected drivers',async()=>{
 const f=await fixture(['driver1','driver2']),normal=f.push;let fail=true;f.push=async p=>{if(p.driverId==='driver1'&&fail)return {statusCode:500,body:'{}'};return normal(p);};
 await assert.rejects(f.run(),/LEGACY_DELIVERY_RETRY_REQUIRED/);assert.equal(f.sent.ws.length,2);assert.equal(f.offer('driver1').deliveryAck.pushAccepted,false);assert.equal(f.offer('driver2').deliveryAck.pushAccepted,true);const wave=f.get('WizzDispatchJobs_staging',{orderId:'order1',SK:'LEGACY_WAVE#1'});assert.deepEqual(wave.delivered,['driver2']);fail=false;f.time+=10000;await f.run('two');assert.equal(f.sent.ws.length,2);assert.equal(f.offer().deliveryAck.pushAccepted,true);assert.equal(f.sent.push.length,2);
});
test('push acknowledged before transient socket failure is never repeated when socket retries',async()=>{
 const f=await fixture(),normal=f.ws;f.ws=async()=>{throw Error('network');};await assert.rejects(f.run(),/LEGACY_DELIVERY_RETRY_REQUIRED/);assert.equal(f.sent.push.length,1);f.ws=normal;f.time+=10000;await f.run('two');assert.equal(f.sent.push.length,1);assert.equal(f.sent.ws.length,1);
});
test('absent and Gone socket connections use push, without mutating live state or offer response',async()=>{
 for(const kind of ['missing','gone']){const f=await fixture();if(kind==='missing')delete f.get('WizzDriverLiveState_staging',{driverId:'driver1'}).connectionId;else f.ws=async()=>{throw Object.assign(Error('gone'),{statusCode:410});};await f.run();assert.equal(f.offer().deliveryAck.websocketUnavailable,true);assert.equal(f.offer().responseStatus,'pending');assert.equal(f.get('WizzDriverLiveState_staging',{driverId:'driver1'}).status,'available');assert.equal(f.sent.push.length,1);}
});
test('HTTP success with zero tokens, provider failures, wrong identity, malformed body or old response cannot ACK push',async()=>{
 for(const response of [{statusCode:200,body:'{"success":false,"successCount":0}'},{statusCode:200,body:'{"success":true,"successCount":1}'},{statusCode:200,body:'not json'},{statusCode:401,body:'{}'},{skipped:true}]){const f=await fixture();f.push=async()=>response;await assert.rejects(f.run(),/LEGACY_DELIVERY_RETRY_REQUIRED/);assert.equal(f.offer().deliveryAck.pushAccepted,false);assert.deepEqual(f.get('WizzDispatchJobs_staging',{orderId:'order1',SK:'LEGACY_WAVE#1'}).delivered,[]);}
});
test('lost database acknowledgement recovers the committed channel before attempting another network send',async()=>{
 const f=await fixture(),send=f.db.send;let lost=false;f.db.send=async c=>{const r=await send(c);if(!lost&&c.input.TransactItems?.some(x=>Object.values(x.Update?.ExpressionAttributeValues??{}).some(v=>v?.websocketAccepted===true))){lost=true;throw Error('ACK lost');}return r;};await f.run();assert.equal(f.sent.ws.length,1);assert.equal(f.sent.push.length,1);assert.equal(f.offer().deliveryAck.pushAccepted,true);
});
test('revocation, changed pickup, competing acceptance and expiry before channel ACK prevent subsequent sends',async()=>{
 for(const kind of ['delete','pickup','accept','expire']){const f=await fixture(),normal=f.ws;f.ws=async(...a)=>{await normal(...a);if(kind==='delete')f.put('staging-AccountDeletion',{pk:'ACCOUNT_LIFECYCLE#DRIVER#driver1',sk:'META'});if(kind==='pickup')f.get('WhizzMerchants_Businesses',{businessId:'branch1'}).latitude=33;if(kind==='accept'){f.reserve();await f.respond();}if(kind==='expire')f.time+=100000;};if(kind==='accept')assert.equal((await f.run()).action,'STOP');else await assert.rejects(f.run());assert.equal(f.sent.push.length,0);assert.equal(f.offer().deliveryAck.pushAccepted,false);}
});
test('persisted channel hash mismatch fails closed rather than suppressing a new message',async()=>{
 const f=await fixture(),normal=f.push;f.push=async()=>({statusCode:500,body:'{}'});await assert.rejects(f.run());f.offer().deliveryAck.messageDigest='changed';f.push=normal;f.time+=10000;await assert.rejects(f.run('two'),/LEGACY_DELIVERY_PROOF_REQUIRED/);assert.equal(f.sent.push.length,0);
});

test('namespaced delivery ACK resumes only its recorded cycle and never creates an old-format ACK',async()=>{const f=await fixture(['driver1'],2);await f.run();assert.equal(f.offer().deliveryAck.pushAccepted,true);assert.equal(f.sent.push[0].dispatchKeyVersion,'2');assert.equal(f.get('WaveOffers_staging',{orderId:'order1',SK:'driver1#WAVE#1'}),undefined);await f.run();assert.equal(f.sent.push.length,1);});
