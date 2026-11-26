const {test}=require('node:test'),assert=require('node:assert/strict');const {OrderCancellationService}=require('../dist/orderCancellationService'),{DriverUnassignmentService}=require('../dist/driverUnassignmentService');const {docClient}=require('../dist/db');
const order={orderId:'o',PK:'ORDER#o',SK:'META',status:'accepted',driverId:'d',holdId:'h',holdStatus:'ACTIVE',holdAmount:6000,orderTimeline:[],driverHistory:[],excludedDrivers:[]};
test('cancellation is durably pending before a failed wallet request',async()=>{const calls=[];const service=new OrderCancellationService({releaseHold:async()=>{calls.push('release');throw Error('network down');}});service.getOrder=async()=>order;service.validateCancellation=()=>{};service.updateOrderStatus=async(id,updates)=>{calls.push('persist');assert.equal(updates.walletFinancialStatus,'PENDING_RELEASE');assert.equal(updates.walletPendingHoldId,'h');};service.websocketNotifier={notifyOrderCancellation:async()=>{}};await service.cancelOrder({orderId:'o',canceledBy:'driver',requestedBy:'d',reason:'test cancellation'});assert.deepEqual(calls,['persist','release']);});
test('unassignment persists the pending hold reference before removing assignment and requesting release',async()=>{const calls=[];const service=new DriverUnassignmentService({releaseHold:async()=>{calls.push('release');throw Error('network down');}});service.getOrder=async()=>order;service.validateUnassignment=()=>{};service.updateOrderForReassignment=async(id,updates)=>{calls.push('persist');assert.equal(updates.walletPendingHoldId,'h');assert.equal(updates.walletFinancialStatus,'PENDING_RELEASE');};service.websocketNotifier={notifyDriverUnassignment:async()=>{}};service.invokeCreateDispatchJob=async()=>({success:true});await service.unassignDriver({orderId:'o',driverId:'d',requestedBy:'d',reason:'test unassignment'});assert.deepEqual(calls,['persist','release']);});
test('terminal order write guards status and driver snapshot',async()=>{let write;docClient.send=async c=>{write=c.input;return {};};const service=new OrderCancellationService({});await service.updateOrderStatus('o',{status:'canceled_by_driver',canceledAt:'now',canceledBy:'driver',cancelReason:'reason',walletFinancialStatus:'PENDING_RELEASE',walletPendingHoldId:'h',originalStatus:'accepted',originalDriverId:'d'},order);write=write.TransactItems[0].Update;assert(write.ConditionExpression.includes('attribute_not_exists(financialSnapshot)'));assert(write.ConditionExpression.includes('#status = :originalStatus'));assert(write.ConditionExpression.includes('driverId = :originalDriverId'));});

test('financial cancellation and reassignment reject before status mutation or generic hold release',async()=>{
 for(const Service of [OrderCancellationService,DriverUnassignmentService]){
  let calls=0;const service=new Service({releaseHold:async()=>{calls++;}});service.getOrder=async()=>({...order,financialSnapshot:{schemaVersion:1}});
  service.updateOrderStatus=async()=>{calls++;};service.updateOrderForReassignment=async()=>{calls++;};
  const request={orderId:'o',driverId:'d',canceledBy:'driver',requestedBy:'d',reason:'test'};
  await assert.rejects(Service===OrderCancellationService?service.cancelOrder(request):service.unassignDriver(request),e=>e.code==='FINANCIAL_CANCELLATION_REQUIRED'&&e.statusCode===409);
  assert.equal(calls,0);
 }
});


test('customer cancellation puts reservation restoration and status in one transaction',async()=>{
 const originalSend=docClient.send,calls=[];
 const tracked={orderId:'o',PK:'ORDER#o',SK:'META',status:'pending',storeId:'b',userId:'u',userSub:'s',createdAt:'2026-01-01',updatedAt:'2026-01-01',orderTimeline:[],offerSnapshot:{source:'MERCHANT',discountId:'d'},offerUsageReservation:{schemaVersion:1,userSub:'s',accountReserved:true,customerReserved:true,campaign:{source:'MERCHANT',id:'d',createdAt:null}}};
 docClient.send=async c=>{calls.push(c);const x=c.input;if(c.constructor.name==='GetCommand')return {Item:x.TableName==='WhizzMerchants_Discounts'?{discountId:'d',businessId:'b',usage_count:2}:{...x.Key,count:1,version:1}};return {};};
 try{
  const service=new OrderCancellationService({releaseHold:async()=>{throw Error('unexpected wallet release');}});service.getOrder=async()=>tracked;service.websocketNotifier={notifyOrderCancellation:async()=>{}};
  await service.cancelOrder({orderId:'o',canceledBy:'customer',requestedBy:'u',reason:'changed mind'});
  const tx=calls.find(c=>c.constructor.name==='TransactWriteCommand').input.TransactItems;
  assert.equal(tx.length,4);assert(tx[0].Update.UpdateExpression.includes('#release0'));
  const counters=tx.slice(1).map(x=>x.Put.Item);assert.equal(counters.filter(x=>x.count===0).length,2);assert.equal(counters.find(x=>x.discountId==='d').usage_count,1);
 }finally{docClient.send=originalSend;}
});

test('lost acknowledgement replays only the original actor and reason without another mutation',async()=>{
 const service=new OrderCancellationService({}),saved={...order,status:'canceled_by_customer',canceledBy:'customer',cancelReason:'changed mind',userId:'u',orderTimeline:[{event:'order_cancelled',actor:'u'}]};let writes=0;
 service.getOrder=async()=>saved;service.updateOrderStatus=async()=>{writes++;};
 const result=await service.cancelOrder({orderId:'o',canceledBy:'customer',requestedBy:'u',reason:'changed mind'});
 assert.equal(result.success,true);assert.equal(writes,0);
 await assert.rejects(service.cancelOrder({orderId:'o',canceledBy:'customer',requestedBy:'foreign',reason:'changed mind'}));
 await assert.rejects(service.cancelOrder({orderId:'o',canceledBy:'customer',requestedBy:'u',reason:'different'}));
 assert.equal(writes,0);
});
