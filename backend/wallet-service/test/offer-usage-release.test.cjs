const {test}=require('node:test'),assert=require('node:assert/strict');
const {prepareOfferUsageRelease:prepare,offerUsageOrderFence:fence}=require('../dist/offerUsageRelease');
const {TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {setup}=require('./helpers/driver-financial-fixture.cjs');
function fixture(source='MERCHANT'){
 const f=setup(),order=f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'});
 Object.assign(order,{status:'pending',userSub:'customer',offerSnapshot:{discountId:'offer',source},
  offerUsageReservation:{schemaVersion:1,userSub:'customer',accountReserved:true,customerReserved:true,campaign:{id:'offer',source,createdAt:'2026-01-01'}}});
 f.put('staging-WizzOfferJourney',{pk:'USER#customer',sk:'ORDERS',count:2,version:3,lastAt:f.time});
 const customerKey={pk:'USER#customer',sk:'OFFER#'+source.toLowerCase()+'#offer'};
 f.put('staging-WizzOfferJourney',{...customerKey,count:1,version:1});
 const table=source==='MERCHANT'?'WhizzMerchants_Discounts':'WizzCentral_Platform_Discounts';
 f.put(table,{discountId:'offer',businessId:'branch1',createdAt:'2026-01-01',version:4,fundingPolicyId:'keep',
  ...(source==='MERCHANT'?{usage_count:3,usageCount:3}:{usage:3,currentUsage:3})});
 const plan=()=>prepare(f.db,order,new Date(f.time).toISOString());
 const commit=async p=>f.db.send(new TransactWriteCommand({TransactItems:[...p.operations,{Put:{TableName:'WizzOrders',Item:{...order,status:'cancelled',...p.fields},...fence(order)}}]}));
 return {f,order,table,customerKey,plan,commit};
}
test('release is atomic, decrements current counters and preserves campaign terms for both sources',async()=>{
 for(const source of ['MERCHANT','PLATFORM']){
  const {f,order,table,customerKey,plan,commit}=fixture(source),p=await plan();
  assert.equal(f.get('staging-WizzOfferJourney',customerKey).count,1);
  await commit(p);
  const account=f.get('staging-WizzOfferJourney',{pk:'USER#customer',sk:'ORDERS'});
  assert.equal(account.count,1);assert.equal(account.version,4);assert.equal(account.historyRequired,true);
  assert.equal(f.get('staging-WizzOfferJourney',customerKey).count,0);
  const campaign=f.get(table,{discountId:'offer'});
  assert.equal(campaign.version,4);assert.equal(campaign.fundingPolicyId,'keep');
  assert.equal(campaign[source==='MERCHANT'?'usage_count':'usage'],2);
  const saved=f.get('WizzOrders',{PK:order.PK,SK:order.SK});
  assert.equal(saved.offerUsageRelease.policy,'BEFORE_MERCHANT_ACCEPTANCE');
  assert.equal((await prepare(f.db,saved,new Date(f.time).toISOString())).operations.length,0);
  await assert.rejects(commit(p)); // Retrying the original plan cannot release twice.
 }
});
test('accepted, untracked and already restored orders never release counters',async()=>{
 for(const patch of [{status:'confirmed'},{confirmedAt:'2026-01-01'},{merchantAcceptedAt:'2026-01-01'},
  {acceptedAt:'2026-01-01'},{financialAcceptance:{}},{offerUsageReservation:null},{offerUsageRelease:{schemaVersion:1}}]){
  const {f,order}=fixture();const p=await prepare(f.db,{...order,...patch},'2026-01-01');
  assert.equal(p.operations.length,0);assert.deepEqual(p.fields,{});
 }
});
test('acceptance or concurrent counter changes invalidate the entire release',async()=>{
 for(const race of ['accept','counter']){
  const {f,order,customerKey,plan,commit}=fixture(),p=await plan();
  f.beforeCommit=()=>{if(race==='accept')order.confirmedAt='2026-01-01';else f.get('staging-WizzOfferJourney',customerKey).version++;};
  await assert.rejects(commit(p));
  assert.equal(f.get('staging-WizzOfferJourney',{pk:'USER#customer',sk:'ORDERS'}).count,2);
  assert.equal(order.status,'pending');
 }
});
test('malformed evidence or exhausted counters require review without any writes',async()=>{
 for(const change of ['proof','count']){
  const {f,order,customerKey,plan}=fixture();
  if(change==='proof')order.offerUsageReservation.userSub='foreign';
  else f.get('staging-WizzOfferJourney',customerKey).count=0;
  await assert.rejects(plan(),{code:'OFFER_USAGE_REVIEW_REQUIRED'});
  assert.equal(order.status,'pending');
 }
});
test('guest reservations restore only global usage and absent campaigns are never recreated',async()=>{
 const {f,order,table,plan,commit}=fixture();
 Object.assign(order,{userSub:null});Object.assign(order.offerUsageReservation,{userSub:null,accountReserved:false,customerReserved:false});
 const p=await plan();assert.equal(p.operations.length,1);await commit(p);
 assert.equal(f.get(table,{discountId:'offer'}).usage_count,2);
 const other=fixture();other.f.rows.delete([...other.f.rows.keys()].find(k=>k.startsWith(other.table+'|')));
 const missing=await other.plan();await other.commit(missing);
 assert.equal(other.f.get(other.table,{discountId:'offer'}),undefined);
});
