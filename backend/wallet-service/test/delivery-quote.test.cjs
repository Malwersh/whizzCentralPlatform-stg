const {test}=require('node:test');
const assert=require('node:assert/strict');
const {fixture,at,m}=require('./helpers/delivery-quote-fixture.cjs');
const {createStagingDeliveryQuotes}=require('../dist/deliveryQuote');
const reject=(p,code)=>assert.rejects(p,e=>e.code===code&&e.message===code);
test('persists delivery fee evidence with atomic profile/reference checks and allowlisted reply',async()=>{
 const f=fixture(),q=await f.create();assert.equal(q.kind,'DELIVERY_FEE_ONLY');assert.equal(q.customerDeliveryFee.minorAmount,3100000);
 assert.equal(q.expiresAt,new Date(at+120000).toISOString());assert.equal(f.saved.size,1);
 const tx=f.transactions.find(t=>t.TransactItems.some(a=>a.Put));
 const checks=tx.TransactItems.filter(a=>a.ConditionCheck).map(a=>a.ConditionCheck);
 assert.ok(checks.some(c=>c.TableName==='WizzUser_users_staging'));
 assert.equal(checks.filter(c=>c.TableName==='WizzCentral_Regions').length,4);
 assert.equal(checks.filter(c=>c.TableName==='WizzCentral_RegionsDerived_staging').length,4);
 assert.equal(new Set(checks.map(c=>c.TableName+JSON.stringify(c.Key))).size,checks.length);
 const raw=JSON.stringify(q);for(const secret of ['owner1','sub1','cognitoSub','fences','binding','userId'])assert.ok(!raw.includes(secret));
 assert.ok(!raw.includes('driverEarning'));assert.equal([...f.saved.values()][0].ttl,undefined);
});
test('retry returns the same quote without routing again or extending expiry, including request ID case',async()=>{
 const f=fixture(),a=await f.create();f.time+=1000;
 assert.deepEqual(await f.create({requestId:a.quoteId.toUpperCase()}),a);assert.equal(f.providerCalls,1);assert.equal(f.saved.size,1);
 await reject(f.create({addressId:'other'}),'QUOTE_REQUEST_CONFLICT');assert.equal(f.providerCalls,1);
});
test('expired ID stays reserved; new ID explicitly obtains a new quote',async()=>{
 const f=fixture(),q=await f.create();f.time=at+120000;
 await reject(f.create(),'QUOTE_EXPIRED');await reject(f.service.get({quoteId:q.quoteId}),'QUOTE_EXPIRED');
 assert.equal(f.providerCalls,1);assert.equal(f.saved.size,1);
 const next=await f.create({requestId:'22345678-1234-4123-8123-123456789abc'});assert.notEqual(next.quoteId,q.quoteId);assert.equal(f.saved.size,2);
});
test('expiry is bounded by route evidence and rule end',async()=>{
 const f=fixture();f.routeTTL=10;assert.equal(Date.parse((await f.create()).expiresAt),at+10000);
 const g=fixture();g.policy.values.deliveryRules[0].effectiveTo=new Date(at+5000).toISOString();assert.equal(Date.parse((await g.create()).expiresAt),at+5000);
});
test('input cannot inject price, scope, identity, route or expiration; invalid IDs fail before reads',async()=>{
 const f=fixture();for(const patch of [{userId:'victim'},{amount:0},{expiresAt:'later'},{rule:{}},{route:{}},{requestId:'bad'}])await reject(f.create(patch),'INVALID_QUOTE_REQUEST');
 assert.equal(f.calls.length,0);assert.equal(f.saved.size,0);
});
test('owner scoped read hides another customer quote and a different identity generation',async()=>{
 const f=fixture(),q=await f.create();f.authenticate=async()=>({userId:'other',subjectId:'otherSub'});
 await reject(f.service.get({quoteId:q.quoteId}),'QUOTE_UNAVAILABLE');
 f.authenticate=async()=>({userId:'u1',subjectId:'newSub'});await reject(f.service.get({quoteId:q.quoteId}),'QUOTE_UNAVAILABLE');
});
test('profile deletion, deactivation and reference changes invalidate existing quote without resaving it',async()=>{
 const mutations=[f=>{f.profile.deletionRequestId='deleted';},f=>{f.profile.isActive=false;},f=>{f.address.longitude=44.458;},
  f=>{f.branch.ordersBlocked=true;},f=>{f.branch.ownerId='new';},f=>{f.policy.values.deliveryRules[0].base=m('2000');},
  f=>{f.regions.get('zone').geometry.coordinates[0][0][0]=44.41;},f=>{f.derivedActive=0;},f=>{f.deleted=true;},f=>{f.organization.subjectId='new';}];
 for(const mutate of mutations){const f=fixture(),q=await f.create();mutate(f);await reject(f.service.get({quoteId:q.quoteId}),'QUOTE_INVALIDATED');assert.equal(f.saved.size,1);assert.equal(f.providerCalls,1);}
});
test('race after reference reads rejects the whole create, even without version or timestamp updates',async()=>{
 for(const mutate of [f=>{f.address.longitude=44.458;},f=>{f.branch.ordersBlocked=true;},f=>{f.deleted=true;},f=>{f.profile.isActive=false;},
  f=>{f.policy.values.deliveryRules[0].base=m('2000');},f=>{f.derivedActive=0;}]){
  const f=fixture();f.beforeTransaction=tx=>{if(tx.TransactItems.some(a=>a.Put))mutate(f);};
  await reject(f.create(),'QUOTE_INVALIDATED');assert.equal(f.saved.size,0);
 }
});
test('a committed write with lost acknowledgement is recovered from the same reserved ID',async()=>{
 const f=fixture();f.loseResponse=true;const q=await f.create();assert.equal(q.quoteId,'12345678-1234-4123-8123-123456789abc');assert.equal(f.saved.size,1);assert.equal(f.providerCalls,1);
});
test('concurrent matching requests converge to one quote; differing content never reuses the result',async()=>{
 const f=fixture();const [a,b]=await Promise.all([f.create(),f.create()]);assert.deepEqual(a,b);assert.equal(f.saved.size,1);
 await reject(f.create({branchId:'another'}),'QUOTE_REQUEST_CONFLICT');
});
test('failure of read authorization transaction never returns a cached price',async()=>{
 const f=fixture(),q=await f.create();f.beforeTransaction=()=>{throw Error('private SDK error');};await reject(f.service.get({quoteId:q.quoteId}),'QUOTE_UNAVAILABLE');
});
test('expiration during transaction and backward clock never return an apparently valid quote',async()=>{
 const f=fixture();f.beforeTransaction=tx=>{if(!tx.TransactItems.some(a=>a.Put))f.time+=120000;};await reject(f.create(),'QUOTE_EXPIRED');
 const g=fixture(),q=await g.create();g.time=at-1;await reject(g.service.get({quoteId:q.quoteId}),'QUOTE_EXPIRED');
});
test('missing live account condition cannot be used as an authentication shortcut',async()=>{
 const f=fixture();const service=createStagingDeliveryQuotes({db:f.db,createRouter:()=>{throw Error('should not route');},authenticateCustomer:async()=>({userId:'u1',subjectId:'sub1'})});
 await reject(service.create({branchId:'b1',addressId:'a1',requestId:'12345678-1234-4123-8123-123456789abc'}),'CUSTOMER_UNAVAILABLE');
});
test('tampered persisted quote is never returned as a trusted amount',async()=>{
 const f=fixture(),q=await f.create();[...f.saved.values()][0].calculation.customerDeliveryFee.minorAmount=0;
 await reject(f.service.get({quoteId:q.quoteId}),'QUOTE_UNAVAILABLE');
});
test('reference payload limit fails before any quote write',async()=>{
 const f=fixture();f.regions.get('zone').geometry.coordinates[0]=[...Array.from({length:30000},()=>[44.4,31.9]),[44.5,31.9],[44.5,32],[44.4,32],[44.4,31.9]];
 await reject(f.create(),'QUOTE_REFERENCE_LIMIT');assert.equal(f.saved.size,0);
});
