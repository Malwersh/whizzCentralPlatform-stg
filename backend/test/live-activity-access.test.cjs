const {test}=require('node:test');
const assert=require('node:assert/strict');
const {authorize}=require('../src/handlers/live-activity-order-access');
const {content}=require('../src/handlers/order-arrival-content');
function fixture(overrides={}){
 const order={orderId:'test-order',userId:'profile-1',userSub:'customer-1',status:'preparing',...overrides};
 const reads=[];
 const db={send:async command=>{reads.push(command.input);return {Item:command.input.TableName==='WizzOrders'?order:{userId:'profile-1',cognitoSub:'customer-1',isActive:true}};}};
 return {event:{},body:{orderId:order.orderId},db,verify:async()=>({pool:'users',payload:{sub:'customer-1',token_use:'id',aud:'users-client'}}),clientId:'users-client',reads};
}
test('owner identity is server verified and registration fences order and active profile',async()=>{
 const f=fixture();const result=await authorize(f);assert.equal(result.subjectId,'customer-1');assert.equal(result.guards.length,2);assert.ok(f.reads.every(r=>r.ConsistentRead));
});
test('another customer, merchant token, or wrong client cannot register or send',async()=>{
 for(const jwt of [{pool:'users',payload:{sub:'someone-else',token_use:'id',aud:'users-client'}},{pool:'merchants',payload:{sub:'customer-1',token_use:'id',aud:'users-client'}},{pool:'users',payload:{sub:'customer-1',token_use:'access',client_id:'another-client'}}]){
  await assert.rejects(authorize({...fixture(),verify:async()=>jwt}),e=>e.status===403);
 }
});
test('guest token must match this actual guest order and is not double prefixed',async()=>{
 const f=fixture({isGuestOrder:true,guestToken:'GUEST_secret'});f.body.guestToken='GUEST_secret';assert.equal((await authorize(f)).subjectId,'GUEST_secret');
 f.body.guestToken='GUEST_other';await assert.rejects(authorize(f),e=>e.status===403);
 const registered=fixture({guestToken:'secret'});registered.body.guestToken='secret';await assert.rejects(authorize(registered),e=>e.status===403);
});
test('deleted and terminal orders cannot start an activity; terminal owner can end it',async()=>{
 await assert.rejects(authorize(fixture({deletedAt:'2026-10-17'})),e=>e.status===403);
 await assert.rejects(authorize(fixture({status:'delivered'})),e=>e.status===403);
 assert.equal((await authorize({...fixture({status:'delivered'}),allowTerminal:true})).order.status,'delivered');
});
test('arrival content uses canonical timestamps without inventing a fixed ETA',()=>{
 const now=Date.parse('2026-10-17T20:00:00Z');
 assert.equal(content({status:'preparing'},now).arrivalLatestEpoch,undefined);
 const result=content({status:'preparing',deliveryEstimate:{earliestAt:'2026-10-17T20:20:00Z',latestAt:'2026-10-17T20:25:00Z'}},now);
 assert.equal(result.arrivalLatestEpoch,Math.floor(now/1000)+1500);
 assert.equal(content({status:'pending',estimatedDeliveryTime:'2026-10-17T20:25:00Z'},now).arrivalLatestEpoch,undefined);
 assert.equal(content({status:'preparing',estimatedDeliveryTime:'2026-10-17T19:00:00Z'},now).etaText,'يجري تحديث وقت الوصول');
});

test('assigned activity ignores historical search exhaustion and displays the current arrival window',()=>{const c=content({status:'assigned',driverId:'driver',financialSearch:{status:'no_driver_available'},deliveryEstimate:{latestAt:'2026-10-19T20:00:00.000Z'}},Date.parse('2026-10-19T19:00:00Z'));assert.notEqual(c.etaText,'بانتظار سائق');assert.equal(c.statusLabel,'تم تعيين سائق');assert.ok(c.arrivalLatestEpoch);});
