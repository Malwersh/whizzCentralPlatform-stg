const {test}=require('node:test');const assert=require('node:assert/strict');
const {GetCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {createStagingDeliveryQuoteRateLimiter}=require('../dist/deliveryQuoteRateLimit');
const {fixture:quoteFixture}=require('./helpers/delivery-quote-fixture.cjs');
const {createStagingDeliveryQuotes}=require('../dist/deliveryQuote');
const rejected=(p,code)=>assert.rejects(p,e=>e.code===code);
function fixture(max=2){
 const f={time:Date.parse('2026-10-15T12:00:30Z'),rows:new Map(),calls:[],beforeWrite:()=>{}};
 f.customer={userId:'u1',subjectId:'s1',condition:{ConditionCheck:{TableName:'WizzUser_users_staging',Key:{userId:'u1'},ConditionExpression:'attribute_not_exists(deletionRequestId)'}}};
 f.db={send:async cmd=>{
  f.calls.push(cmd.input);
  if(f.failRead)throw Error('secret database detail');
  if(cmd instanceof GetCommand){assert.equal(cmd.input.ConsistentRead,true);return {Item:structuredClone(f.rows.get(cmd.input.Key.pk))};}
  assert.ok(cmd instanceof TransactWriteCommand);f.beforeWrite();
  if(f.deleting)throw Object.assign(Error(),{name:'TransactionCanceledException',CancellationReasons:[{Code:'ConditionalCheckFailed'},{Code:'None'}]});
  const put=cmd.input.TransactItems[1].Put,old=f.rows.get(put.Item.pk);
  if(f.forceConflict || (put.ExpressionAttributeValues ? old?.digest!==put.ExpressionAttributeValues[':digest'] || old?.version!==put.ExpressionAttributeValues[':version'] || old?.retentionHold : old))
   throw Object.assign(Error(),{name:'TransactionCanceledException',CancellationReasons:[{Code:'None'},{Code:'ConditionalCheckFailed'}]});
  f.rows.set(put.Item.pk,structuredClone(put.Item));
  if(f.lostAck)throw Error('network lost');return {};
 }};
 f.limiter=createStagingDeliveryQuoteRateLimiter({db:f.db,maxPerMinute:max,now:()=>f.time});
 f.reserve=(c=f.customer)=>f.limiter.reserve(c);return f;
}
test('quota is persistent bounded and scoped to the authenticated profile with an atomic account fence',async()=>{
 const f=fixture(1);await f.reserve();await rejected(f.reserve(),'QUOTE_RATE_LIMITED');
 assert.equal(f.rows.get('CUSTOMER#u1').count,1);assert.equal(f.rows.get('CUSTOMER#u1').sk,'RATE#DELIVERY_QUOTE');
 const tx=f.calls.find(c=>c.TransactItems);assert.deepEqual(tx.TransactItems[0],f.customer.condition);
 await f.reserve({...f.customer,userId:'u2',condition:{ConditionCheck:{...f.customer.condition.ConditionCheck,Key:{userId:'u2'}}}});
 assert.equal(f.rows.size,2);assert.equal(JSON.stringify([...f.rows.values()]).includes('token'),false);
});
test('concurrent reservations cannot exceed the configured quota',async()=>{
 const f=fixture(2),results=await Promise.allSettled(Array.from({length:10},()=>f.reserve()));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,2);assert.equal(f.rows.get('CUSTOMER#u1').count,2);
 assert.ok(results.filter(r=>r.status==='rejected').every(r=>['QUOTE_RATE_LIMITED','QUOTE_RATE_UNAVAILABLE'].includes(r.reason.code)));
});
test('fixed minute reset keeps one row and stable version, emits bounded retry time',async()=>{
 const f=fixture(1);await f.reserve();await assert.rejects(f.reserve(),e=>e.code==='QUOTE_RATE_LIMITED'&&e.retryAfterSeconds===30);
 f.time+=30000;await f.reserve();assert.equal(f.rows.size,1);assert.equal(f.rows.get('CUSTOMER#u1').count,1);assert.equal(f.rows.get('CUSTOMER#u1').version,2);
});
test('quota changes do not reset usage, identity mismatch or clock rollback never overwrite the row',async()=>{
 const f=fixture(2);await f.reserve();const limiter=createStagingDeliveryQuoteRateLimiter({db:f.db,maxPerMinute:1,now:()=>f.time});
 await rejected(limiter.reserve(f.customer),'QUOTE_RATE_LIMITED');await rejected(f.reserve({...f.customer,subjectId:'foreign'}),'QUOTE_RATE_UNAVAILABLE');
 f.time-=60000;await rejected(f.reserve(),'QUOTE_RATE_UNAVAILABLE');assert.equal(f.rows.get('CUSTOMER#u1').version,1);
});
test('missing account fence, invalid config and corrupt or held rows fail closed',async()=>{
 for(const max of [0,121,1.5,NaN])assert.throws(()=>createStagingDeliveryQuoteRateLimiter({db:{},maxPerMinute:max}),e=>e.code==='QUOTE_RATE_UNAVAILABLE');
 const f=fixture();await rejected(f.reserve({...f.customer,condition:{}}),'QUOTE_RATE_UNAVAILABLE');assert.equal(f.calls.length,0);
 for(const mutate of [r=>r.count++,r=>r.retentionHold=true,r=>r.schemaVersion=2]){const g=fixture();await g.reserve();mutate(g.rows.get('CUSTOMER#u1'));await rejected(g.reserve(),'QUOTE_RATE_UNAVAILABLE');}
});
test('deletion, storage failure, lost acknowledgement and contention exhaustion never authorize routing',async()=>{
 for(const flag of ['deleting','failRead','lostAck','forceConflict']){const f=fixture();f[flag]=true;await rejected(f.reserve(),'QUOTE_RATE_UNAVAILABLE');
 if(flag==='lostAck')assert.equal(f.rows.get('CUSTOMER#u1').count,1);
 assert.ok(f.calls.length<=6);}
});
test('reservation crossing a minute or moving backwards cannot start a road call',async()=>{
 for(const delta of [60000,-1]){const f=fixture();f.beforeWrite=()=>{f.time+=delta;};await rejected(f.reserve(),'QUOTE_RATE_UNAVAILABLE');}
});
test('actual quote service only reserves new calculations; replay and GET never spend quota',async()=>{
 const q=quoteFixture(),{createStagingDeliveryRouting}=require('../dist/regionCoverage');let reserved=0;
 const service=createStagingDeliveryQuotes({db:q.db,authenticateCustomer:async()=>({...await q.authenticate(),condition:{ConditionCheck:{TableName:'WizzUser_users_staging',Key:{userId:'u1'},ConditionExpression:'attribute_exists(userId) AND attribute_not_exists(deletionRequestId)'}}}),now:()=>q.time,
  beforeCalculate:async()=>{if(++reserved>1)throw Object.assign(Error('limited'),{code:'QUOTE_RATE_LIMITED'});},
  createRouter:db=>createStagingDeliveryRouting({db,getAccessToken:async()=>'synthetic',profile:'driving',ttlSeconds:120,timeoutMs:1000,now:()=>q.time,
   fetchImpl:async()=>{q.providerCalls++;return new Response(JSON.stringify({code:'Ok',routes:[{distance:2100,duration:300}]}));}})});
 const input={branchId:'b1',addressId:'a1',requestId:'12345678-1234-4123-8123-123456789abc'};
 const first=await service.create(input);await service.create(input);await service.get({quoteId:first.quoteId});assert.equal(reserved,1);assert.equal(q.providerCalls,1);
 await rejected(service.create({...input,requestId:'22345678-1234-4123-8123-123456789abc'}),'QUOTE_RATE_LIMITED');assert.equal(q.providerCalls,1);
});
