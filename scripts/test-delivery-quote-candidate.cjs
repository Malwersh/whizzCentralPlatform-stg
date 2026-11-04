const {test}=require('node:test'),assert=require('node:assert/strict');
if(!process.env.QUOTE_ORDER_HANDLER_FILE)throw Error('LIVE_DERIVED_CANDIDATE_REQUIRED');
const {setup}=require('../backend/wallet-service/test/helpers/quote-order-handler-fixture.cjs');
test('live-derived candidate retains merchant discount calculation; replay does not increment usage twice',async()=>{
 const f=await setup();f.discountRow={discountId:'d1',businessId:'b1',status:'active',type:'percentage',value:10,applicability:'allItems'};
 const first=await f.invoke({discountId:'d1'});assert.equal(first.statusCode,201,JSON.stringify(first.json));
 assert.equal(first.json.order.pricing.deliveryFee,3100000);assert.equal(first.json.order.pricing.discount,350000);assert.equal(first.json.order.pricing.total,6250000);
 assert.equal(f.discountUpdates,1);f.time+=300000;
 const retry=await f.invoke({discountId:'d1'});assert.equal(retry.statusCode,200);assert.equal(retry.json.orderId,first.json.orderId);assert.equal(f.discountUpdates,1);
});
test('live-derived candidate retains discount scope validation and does not consume quote for a foreign discount',async()=>{
 const f=await setup();f.discountRow={discountId:'foreign',businessId:'b2',status:'active',type:'fixedAmount',value:500};
 const result=await f.invoke({discountId:'foreign'});assert.equal(result.statusCode,400);assert.equal(f.orders.size,0);assert.equal(f.discountUpdates||0,0);
});
test('live-derived candidate keeps free-delivery discount tied to saved quote fee, not client fee',async()=>{
 const f=await setup();f.discountRow={discountId:'free',businessId:'b1',status:'active',type:'freeDelivery',value:0};
 const result=await f.invoke({discountId:'free'});assert.equal(result.statusCode,201,JSON.stringify(result.json));
 assert.equal(result.json.order.pricing.deliveryFee,3100000);assert.equal(result.json.order.pricing.discount,3100000);assert.equal(result.json.order.pricing.total,3500000);
});
