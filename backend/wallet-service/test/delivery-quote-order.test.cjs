const {test}=require('node:test');
const assert=require('node:assert/strict');
const {fixture,at,m}=require('./helpers/delivery-quote-fixture.cjs');
const {createStagingQuoteOrder}=require('../dist/deliveryQuoteOrder');
const reject=(p,code)=>assert.rejects(p,e=>e.code===code&&e.message===code);
const requestId='abcdefab-1234-4123-8123-123456789abc';
async function setup({free=false}={}){
 const f=fixture();if(free){const r=f.policy.values.deliveryRules[0];r.base=m('0');r.perKm=m('0');}
 const quote=await f.create();
 f.content={userId:'u1',storeId:'b1',deliveryAddress:{id:'a1',latitude:31.925,longitude:44.457},items:[{id:'product',price:3500,quantity:1}],deliveryFee:9999999};
 f.request={quoteId:quote.quoteId,branchId:'b1',addressId:'a1',requestId,requestContent:f.content};
 f.consumer=createStagingQuoteOrder({db:f.db,authenticateCustomer:f.auth,now:()=>f.time});
 f.prepare=(patch={})=>f.consumer.prepare({...f.request,...patch});
 f.order=s=>({PK:'ORDER#'+s.orderId,SK:'META',orderId:s.orderId,userId:'u1',userSub:'sub1',storeId:'b1',isGuestOrder:false,
  currency:'IQD',deliveryType:'delivery',deliveryAddress:{lat:31.925,lng:44.457},restaurantLat:31.925,restaurantLng:44.457,
  status:'pending',pricing:{goodsSubtotal:3500000,deliveryFee:s.deliveryFeeMinor,total:3500000+s.deliveryFeeMinor}});
 return f;
}
test('order write and quote consumption share one atomic transaction with server fee and all guards',async()=>{
 const f=await setup(),s=await f.prepare(),result=await s.commit(f.order(s));assert.equal(result.replayed,false);assert.equal(f.orders.size,1);
 assert.equal(result.order.pricing.deliveryFee,3100000);assert.equal(result.order.deliveryQuote.deliveryFee.minorAmount,3100000);
 const tx=f.transactions.at(-1);assert.ok(tx.TransactItems.some(a=>a.Put?.TableName==='WizzOrders'));assert.ok(tx.TransactItems.some(a=>a.Update?.TableName==='staging-DeliveryQuotes'));
 assert.equal(tx.TransactItems.filter(a=>a.ConditionCheck?.TableName==='WhizzMerchants_Businesses').length,1);
 const ids=tx.TransactItems.map(a=>{const v=a.ConditionCheck??a.Put??a.Update;return v.TableName+JSON.stringify(v.Key??{PK:v.Item.PK,SK:v.Item.SK});});assert.equal(new Set(ids).size,ids.length);
 assert.equal([...f.saved.values()][0].consumption.orderId,s.orderId);
 await reject(f.service.get({quoteId:f.request.quoteId}),'QUOTE_CONSUMED');
});
test('zero delivery fee survives commit without the legacy fallback',async()=>{
 const f=await setup({free:true}),s=await f.prepare();assert.equal(s.deliveryFeeMinor,0);const r=await s.commit(f.order(s));assert.equal(r.order.pricing.deliveryFee,0);assert.equal(r.order.pricing.total,3500000);
});
test('retry after commit, expiry and changed policy returns the same stored order',async()=>{
 const f=await setup(),s=await f.prepare(),first=await s.commit(f.order(s));f.time=at+300000;f.policy.version++;f.branch.ordersBlocked=true;
 const retry=await f.prepare();assert.deepEqual(retry.replayedOrder,first.order);assert.equal(f.orders.size,1);assert.equal(f.providerCalls,1);
});
test('retry with changed basket or another attempt cannot spend the same quote',async()=>{
 const f=await setup(),s=await f.prepare();await s.commit(f.order(s));
 await reject(f.prepare({requestContent:{...f.content,items:[{id:'other'}]}}),'QUOTE_REQUEST_CONFLICT');
 await reject(f.prepare({requestId:'bbcdefab-1234-4123-8123-123456789abc'}),'QUOTE_CONSUMED');assert.equal(f.orders.size,1);
});
test('two concurrent identical confirmations converge to the persisted order',async()=>{
 const f=await setup(),[a,b]=await Promise.all([f.prepare(),f.prepare()]);
 const results=await Promise.all([a.commit(f.order(a)),b.commit(f.order(b))]);assert.equal(f.orders.size,1);assert.equal(results.filter(r=>!r.replayed).length,1);assert.deepEqual(results[0].order,results[1].order);
});
test('two different confirmations compete for one quote and only one order is saved',async()=>{
 const f=await setup(),a=await f.prepare(),b=await f.prepare({requestId:'bbcdefab-1234-4123-8123-123456789abc'});
 const r=await Promise.allSettled([a.commit(f.order(a)),b.commit(f.order(b))]);assert.equal(r.filter(v=>v.status==='fulfilled').length,1);assert.equal(f.orders.size,1);assert.equal(r.find(v=>v.status==='rejected').reason.code,'QUOTE_CONSUMED');
});
test('lost acknowledgement recovers committed order rather than creating or overwriting it',async()=>{
 const f=await setup(),s=await f.prepare();f.loseResponse=true;const result=await s.commit(f.order(s));assert.equal(result.replayed,true);assert.equal(f.orders.size,1);assert.equal(result.order.orderId,s.orderId);
});
test('expiry before confirmation and during its preparation prevents order creation',async()=>{
 const f=await setup();f.time=at+120000;await reject(f.prepare(),'QUOTE_EXPIRED');assert.equal(f.orders.size,0);
 const g=await setup(),s=await g.prepare();g.time=at+120000;await reject(s.commit(g.order(s)),'QUOTE_EXPIRED');assert.equal(g.orders.size,0);assert.equal([...g.saved.values()][0].consumption,undefined);
});
test('reference changes or profile deletion before transaction leave quote and order unchanged',async()=>{
 for(const mutate of [f=>{f.address.longitude=44.458;},f=>{f.branch.ordersBlocked=true;},f=>{f.deleted=true;},f=>{f.derivedActive=0;},f=>{f.profile.deletionRequestId='delete';},f=>{f.policy.version++;}]){
  const f=await setup(),s=await f.prepare();f.beforeTransaction=t=>{if(t.TransactItems.some(a=>a.Update))mutate(f);};await reject(s.commit(f.order(s)),'QUOTE_INVALIDATED');assert.equal(f.orders.size,0);assert.equal([...f.saved.values()][0].consumption,undefined);
 }
});
test('foreign identity and mismatched branch/address or coordinates cannot spend a quote',async()=>{
 const f=await setup();await reject(f.prepare({branchId:'foreign'}),'QUOTE_REQUEST_CONFLICT');await reject(f.prepare({addressId:'foreign'}),'QUOTE_REQUEST_CONFLICT');
 for(const deliveryAddress of [{id:'a1',latitude:31.926,longitude:44.457},{id:'a1',latitude:31.925,lat:0,longitude:44.457},{id:'a1'}])await reject(f.prepare({requestContent:{...f.content,deliveryAddress}}),'INVALID_QUOTE_ORDER');
 f.authenticate=async()=>({userId:'other',subjectId:'foreign'});await reject(f.prepare(),'QUOTE_UNAVAILABLE');assert.equal(f.orders.size,0);
});
test('caller cannot replace order identity, routing points or server-derived fee at commit',async()=>{
 const f=await setup(),s=await f.prepare();for(const patch of [{userId:'other'},{storeId:'other'},{orderId:'other'},{restaurantLat:0},{deliveryAddress:{lat:1,lng:1}},{pricing:{deliveryFee:0,total:0}},{pricing:{deliveryFee:s.deliveryFeeMinor,total:NaN}}])await reject(s.commit({...f.order(s),...patch}),'INVALID_QUOTE_ORDER');assert.equal(f.orders.size,0);
});
test('same order request ID cannot be reused against another quote, nor resurrect a deleted order',async()=>{
 const f=await setup(),s=await f.prepare();await s.commit(f.order(s));
 const q=await f.create({requestId:'22345678-1234-4123-8123-123456789abc'});
 await reject(f.prepare({quoteId:q.quoteId}),'QUOTE_REQUEST_CONFLICT');
 f.orders.clear();await reject(f.prepare(),'QUOTE_ORDER_UNAVAILABLE');assert.equal(f.orders.size,0);
});
test('live account is revalidated for retries and commit; loss cannot return cached order',async()=>{
 const f=await setup(),s=await f.prepare();await s.commit(f.order(s));f.profile.isActive=false;await reject(f.prepare(),'QUOTE_ORDER_UNAVAILABLE');
 const g=await setup(),p=await g.prepare();g.authenticate=async()=>{throw Error('revoked');};await reject(p.commit(g.order(p)),'CUSTOMER_UNAVAILABLE');assert.equal(g.orders.size,0);
});

test('offer journey order/redemption counters compose atomically with the quote and replay without recounting',async()=>{
 const f=await setup(),journey=new Map();
 f.extraLookup=(table,key)=>table==='staging-WizzOfferJourney'?journey.get(key.pk+'|'+key.sk):undefined;
 f.extraPut=op=>{if(op.TableName!=='staging-WizzOfferJourney')return false;journey.set(op.Item.pk+'|'+op.Item.sk,structuredClone(op.Item));return true;};
 const s=await f.prepare();
 const counts=['ORDERS','OFFER#merchant#campaign'].map(sk=>({Put:{TableName:'staging-WizzOfferJourney',Item:{pk:'USER#sub1',sk,count:1,version:1},ConditionExpression:'attribute_not_exists(pk)'}}));
 await s.commit(f.order(s),counts);
 assert.equal(journey.size,2);assert.equal(f.orders.size,1);
 assert.equal(f.transactions.at(-1).TransactItems.filter(x=>x.Put?.TableName==='staging-WizzOfferJourney').length,2);
 const replay=await f.prepare();assert.equal(replay.replayedOrder.orderId,s.orderId);
 assert.equal(f.transactions.flatMap(t=>t.TransactItems).filter(x=>x.Put?.TableName==='staging-WizzOfferJourney').length,2); // replay cannot write either counter again
});
test('a concurrent per-customer redemption rejects the complete order transaction',async()=>{
 const f=await setup();f.extraLookup=(table,key)=>table==='staging-WizzOfferJourney'?{pk:key.pk,sk:key.sk,count:1,version:1}:undefined;
 const s=await f.prepare();
 await reject(s.commit(f.order(s),[{Put:{TableName:'staging-WizzOfferJourney',Item:{pk:'USER#sub1',sk:'OFFER#merchant#campaign',count:1,version:1},ConditionExpression:'attribute_not_exists(pk)'}}]),'QUOTE_INVALIDATED');
 assert.equal(f.orders.size,0);assert.equal([...f.saved.values()][0].consumption,undefined);
});
test('two operations on one offer counter are rejected before any write',async()=>{
 const f=await setup(),s=await f.prepare(),put={Put:{TableName:'staging-WizzOfferJourney',Item:{pk:'USER#sub1',sk:'ORDERS',count:1,version:1},ConditionExpression:'attribute_not_exists(pk)'}};
 const before=f.transactions.length;
 await reject(s.commit(f.order(s),[put,put]),'INVALID_QUOTE_ORDER');
 assert.equal(f.transactions.length,before);assert.equal(f.orders.size,0);
});

test('merchant response deadline queue composes with quote order while preserving duplicate-write rejection',()=>{
 const {composeQuoteOrderOperations}=require('../dist/deliveryQuoteOrder');
 const put={Put:{TableName:'staging-WalletLifecycle',Item:{operationId:'MERCHANT_RESPONSE#order1',kind:'MERCHANT_RESPONSE',status:'PENDING'},ConditionExpression:'attribute_not_exists(operationId)'}};
 assert.deepEqual(composeQuoteOrderOperations([put]),[put]);
 assert.throws(()=>composeQuoteOrderOperations([put,put]),e=>e.code==='INVALID_QUOTE_ORDER');
 assert.throws(()=>composeQuoteOrderOperations([{Put:{TableName:'unrecognized',Item:{operationId:'x'}}}]),e=>e.code==='INVALID_QUOTE_ORDER');
});
