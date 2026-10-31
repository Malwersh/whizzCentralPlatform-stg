const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./helpers/delivery-funded-dispatch-fixture.cjs');
const {createStagingFinancialOfferDelivery:delivery}=require('../dist/financialOfferDelivery');
async function setup(){
 const f=await fixture();await f.create();await f.execute();f.sockets=[];f.pushes=[];f.authorizations=[];
 f.get('WizzDriverLiveState_staging',{driverId:'driver1'}).connectionId='connection';
 f.put('WizzUser_websocket_connections_staging',{connectionId:'connection',identityScope346:{version:1,role:'DRIVER',subjectId:'driver1',driverId:'driver1',expiresAt:Math.floor(f.time/1000)+600}});
 f.push=async ref=>({statusCode:200,body:JSON.stringify({success:true,offerId:ref.offerId,eventId:ref.offerId,cycleId:ref.cycleId,driverId:ref.driverId,successCount:1})});
 f.socket=async()=>{};f.saved=()=>f.get('WaveOffers_staging',{orderId:'order1',SK:'FINANCIAL#driver1#WAVE#1'});
 f.send=delivery({db:f.db,now:()=>f.time,enableDeliveryFunding:true,beforeSend:async(...args)=>f.authorizations.push(args),postSocket:async(...args)=>{f.sockets.push(args);return f.socket(...args);},postPush:async ref=>{f.pushes.push(ref);return f.push(ref);}});
 f.message=f.out.find(x=>x.id==='driver1').message;return f;
}
test('financial channels record separate durable acknowledgements and replay sends neither again',async()=>{
 const f=await setup(),funds=f.funding(),expiry=f.saved().expiresAt;await f.send('driver1',f.message);await f.send('driver1',f.message);
 assert.equal(f.sockets.length,1);assert.equal(f.pushes.length,1);assert.equal(f.saved().financialDeliveryAck.pushAccepted,true);assert.equal(f.saved().financialDeliveryAck.websocketAccepted,true);
 assert.equal(f.funding(),funds);assert.equal(f.saved().expiresAt,expiry);assert.equal(f.pushes[0].offerDigest,f.message.offer.offerDigest);
 assert(!JSON.stringify(f.pushes[0]).includes('customerCashToCollect'));
});
test('lost push acknowledgement retries only push with identical reference and expiry',async()=>{
 const f=await setup(),normal=f.push;f.push=async()=>({statusCode:200,body:'invalid'});await assert.rejects(f.send('driver1',f.message),/RETRY_REQUIRED/);
 f.push=normal;await f.send('driver1',f.message);assert.equal(f.sockets.length,1);assert.equal(f.pushes.length,2);assert.deepEqual(f.pushes[0],f.pushes[1]);
});
test('gone or missing websocket falls back to push while ordinary socket failure remains retryable',async()=>{
 for(const missing of [false,true]){const f=await setup();if(missing)delete f.get('WizzDriverLiveState_staging',{driverId:'driver1'}).connectionId;else f.socket=async()=>{throw {statusCode:410};};await f.send('driver1',f.message);assert.equal(f.pushes.length,1);assert.equal(f.saved().financialDeliveryAck.websocketUnavailable,true);}
 const f=await setup();f.socket=async()=>{throw Error('network');};await assert.rejects(f.send('driver1',f.message),/RETRY_REQUIRED/);assert.equal(f.pushes.length,1);assert.equal(f.saved().financialDeliveryAck.websocketAccepted,false);f.socket=async()=>{};await f.send('driver1',f.message);assert.equal(f.pushes.length,1);assert.equal(f.sockets.length,2);
});
test('expired, changed and foreign-driver messages cannot send',async()=>{
 for(const alter of [f=>{f.time=Date.parse(f.saved().expiresAt);},f=>{f.message=structuredClone(f.message);f.message.offer.offerDigest='forged';},f=>{f.saved().responseStatus='financial_declined';},f=>{f.order().financialSnapshot.deliveryFunding.policyPin.policyId='changed';}]){
  const f=await setup();alter(f);await assert.rejects(f.send('driver1',f.message));assert.equal(f.sockets.length,0);assert.equal(f.pushes.length,0);
 }
 const f=await setup();await assert.rejects(f.send('driver2',f.message));assert.equal(f.pushes.length,0);
});
test('unrelated or zero-recipient provider acknowledgements never count as delivered',async()=>{
 for(const patch of [{successCount:0},{offerId:'other'},{driverId:'other'},{cycleId:'other'},{success:false}]){const f=await setup(),normal=f.push;f.push=async ref=>{const r=await normal(ref);return {...r,body:JSON.stringify({...JSON.parse(r.body),...patch})};};await assert.rejects(f.send('driver1',f.message),/RETRY_REQUIRED/);assert.equal(f.saved().financialDeliveryAck.pushAccepted,false);}
});
test('committed channel ACK with lost database response is recovered without another external send',async()=>{
 const f=await setup(),send=f.db.send;let lost=false;
 f.db.send=async c=>{const r=await send(c);if(!lost&&c.input.TransactItems?.some(op=>op.Update?.ExpressionAttributeValues?.[':ack']?.pushAccepted===true)){lost=true;throw Error('ack response lost');}return r;};
 await f.send('driver1',f.message);await f.send('driver1',f.message);assert(lost);assert.equal(f.pushes.length,1);assert.equal(f.sockets.length,1);
});
test('assignment during socket delivery prevents a later push and no successful ACK is invented',async()=>{
 const f=await setup();f.socket=async()=>{await f.service('driver1').accept(f.selector('driver1'));};
 await assert.rejects(f.send('driver1',f.message));assert.equal(f.pushes.length,0);assert.equal(f.saved().financialDeliveryAck.pushAccepted,false);assert.equal(f.saved().responseStatus,'financial_accepted');
});

test('foreign, expired and pre-cutover sockets receive no offer but canonical push remains available',async()=>{
 for(const scope of [undefined,{version:1,role:'DRIVER',subjectId:'other',driverId:'driver1',expiresAt:9999999999},{version:1,role:'DRIVER',subjectId:'driver1',driverId:'other',expiresAt:9999999999},{version:1,role:'DRIVER',subjectId:'driver1',driverId:'driver1',expiresAt:1}]){
  const f=await setup();f.put('WizzUser_websocket_connections_staging',{connectionId:'connection',identityScope346:scope});await f.send('driver1',f.message);assert.equal(f.sockets.length,0);assert.equal(f.pushes.length,1);assert.equal(f.saved().financialDeliveryAck.websocketUnavailable,true);
 }
});
