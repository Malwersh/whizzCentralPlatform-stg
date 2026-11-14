const {test}=require('node:test'),assert=require('node:assert/strict');
const {forward}=require('../src/handlers/order-activity-stream');
const record=(status='delivered',old='arrived_at_customer')=>({eventName:'MODIFY',eventSource:'aws:dynamodb',eventSourceARN:'arn:aws:dynamodb:us-east-1:699561669180:table/WizzOrders/stream/test',dynamodb:{NewImage:{PK:{S:'ORDER#order'},SK:{S:'META'},orderId:{S:'order'},status:{S:status}},OldImage:{status:{S:old}}}});
test('committed status transitions enqueue once without changing dispatch or financial data',async()=>{const calls=[];assert.equal((await forward({Records:[record(),record()]},async r=>{calls.push(r);return {StatusCode:202}})).queued,1);assert.equal(calls[0].InvocationType,'Event');assert.deepEqual(JSON.parse(calls[0].Payload),{source:'wizz.order-activity-stream',schemaVersion:1,orderId:'order'});});
test('same status and foreign stream never enqueue',async()=>{const foreign=record();foreign.eventSourceARN='foreign';assert.equal((await forward({Records:[record('assigned','assigned'),foreign]},()=>assert.fail())).queued,0);});
test('failed enqueue is retried by the stream',async()=>{await assert.rejects(forward({Records:[record()]},async()=>({StatusCode:500})),/ENQUEUE_FAILED/)});
test('return review transition enqueues even when base status remains return_arrived',async()=>{const r=record('return_arrived','return_arrived');r.dynamodb.OldImage.returnStatus={S:'ARRIVED_AT_BRANCH'};r.dynamodb.NewImage.returnStatus={S:'REVIEW_REQUIRED'};assert.equal((await forward({Records:[r]},async()=>({StatusCode:202}))).queued,1);assert.equal((await forward({Records:[{...r,dynamodb:{...r.dynamodb,OldImage:r.dynamodb.NewImage}}]},()=>assert.fail())).queued,0);});
test('cancellation-only changes enqueue once, unchanged references and timestamps do not',async()=>{
 const r=record('in_kitchen','in_kitchen'),ref={M:{requestId:{S:'CAN:r'},caseId:{S:'OEX:c'},state:{S:'REQUESTED'},version:{N:'1'}}};r.dynamodb.NewImage.exceptionCancellation=ref;
 const calls=[];await forward({Records:[r,r]},async v=>{calls.push(v);return {StatusCode:202};});assert.equal(calls.length,1);assert.equal(JSON.parse(calls[0].Payload).cancellationChange.state,'REQUESTED');
 r.dynamodb.OldImage.exceptionCancellation=ref;assert.equal((await forward({Records:[r]},()=>assert.fail())).queued,0);
});
