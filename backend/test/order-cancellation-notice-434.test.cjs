const {test}=require('node:test'),assert=require('node:assert/strict');
const {send}=require('../src/handlers/order-cancellation-notice');
const ref={requestId:'CAN:r',caseId:'OEX:c',state:'REQUESTED',version:1};
const order={orderId:'o',orderNumber:'ORD1',storeId:'branch',status:'in_kitchen',exceptionCancellation:ref};
test('notification uses committed branch, stable event ID and current cancellation without customer data',async()=>{
 let body;await send({...order,customerName:'private',address:'private'},ref,async b=>{body=b;return {statusCode:200,body:'{"tokensCount":2,"failureCount":0}'}});
 assert.equal(body.businessId,'branch');assert.equal(body.action,'customer_cancellation_requested');assert.equal(body.eventId,'cancellation:o:CAN:r:1');assert.equal(body.customerName,undefined);assert.equal(body.address,undefined);
});
test('stale request cannot resurrect a cancellation and final state wins',async()=>{
 assert.deepEqual(await send(order,{...ref,requestId:'other'},()=>assert.fail()),{skipped:true});
 let body;await send({...order,status:'cancelled',exceptionCancellation:{...ref,state:'CANCELLED',version:2}},ref,async b=>{body=b;return {statusCode:200,body:'{}'}});assert.equal(body.action,'order_cancellation_confirmed');assert.equal(body.cancellationVersion,2);
});
test('delivery failures retry while absent tokens are a valid no-recipient result',async()=>{
 await assert.rejects(send(order,ref,async()=>({statusCode:200,body:'{"failureCount":1}'})),/DELIVERY_FAILED/);
 assert.equal((await send(order,ref,async()=>({statusCode:200,body:'{"tokensCount":0}'}))).tokensCount,0);
});
