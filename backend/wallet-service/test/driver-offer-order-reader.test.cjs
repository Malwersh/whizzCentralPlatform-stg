const {test}=require('node:test');
const assert=require('node:assert/strict');
const {GetCommand}=require('@aws-sdk/lib-dynamodb');
const {createStagingDriverOfferOrderReader:reader,prepareDriverOfferFinancialSnapshot:prepare}=require('../dist/driverOfferOrderReader');
const {parseIqd:m}=require('../dist/money');
const {quoteHash}=require('../dist/deliveryQuoteRecord');
function snapshot(method='COD') {return {
 snapshotId:'snapshot1',revision:1,orderId:'order1',branchId:'branch1',merchantId:'merchant1',zoneId:'zone1',cityId:'city1',governorateId:'gov1',
 branchPoint:{latitude:31.92,longitude:44.46},customerPoint:{latitude:31.93,longitude:44.47},confirmedCustomerTotal:m('14500'),
 allocation:{allocationSchemaVersion:1,paymentMethod:method,goodsGross:m('10000'),merchantGoodsDiscount:m('0'),platformGoodsDiscount:m('0'),merchantCommission:m('0'),
 serviceFee:m('500'),customerDeliveryFee:m('3000'),driverTip:m('1000'),merchantOtherCharges:m('0'),platformOtherCharges:m('0'),thirdPartyOtherCharges:m('0')},
 paymentEvidence:method==='COD'?null:{reference:'payment1',verifiedAt:'2026-10-15T12:00:00.000Z',amount:m('14500')}
};}
function saved(){return {PK:'ORDER#order1',SK:'META',orderId:'order1',storeId:'branch1',merchantId:'merchant1',status:'ready_for_pickup',financialSnapshot:prepare(snapshot()),customerPhone:'NEVER_PROJECT'};}
function setup(item=saved()) {const calls=[];const r=reader({db:{async send(c){calls.push(c);return {Item:item};}}});return {read:()=>r.read({orderId:'order1',branchId:'branch1'}),r,calls,item};}
const rejects=(p,code)=>assert.rejects(p,e=>e.code===code);
test('strong projected read returns complete COD snapshot and an exact atomic condition without customer fields',async()=>{
 const {read,calls}=setup(),out=await read();assert.equal(calls.length,1);assert.ok(calls[0] instanceof GetCommand);
 const q=calls[0].input;assert.equal(q.TableName,'WizzOrders');assert.equal(q.ConsistentRead,true);assert.deepEqual(q.Key,{PK:'ORDER#order1',SK:'META'});
 assert.ok(!Object.values(q.ExpressionAttributeNames).includes('customerPhone'));
 assert.deepEqual(out.snapshot,snapshot());assert.equal(out.snapshotHash,quoteHash(snapshot()));
 assert.equal(out.performsWrites,false);assert.equal(out.requiresAtomicComposition,true);assert.equal(out.requiresLiveDriverAndDeletionGuards,true);
 assert.ok(!JSON.stringify(out).includes('NEVER_PROJECT'));
 const c=out.condition.ConditionCheck;
 for(const [alias,f] of Object.entries(c.ExpressionAttributeNames)){
  const i=alias.slice(2);if(f==='financialSnapshot')assert.deepEqual(c.ExpressionAttributeValues[':v'+i],prepare(snapshot()));
  if(['driverId','assignedDriverId','deletedAt','orderStatus'].includes(f))assert.ok(c.ConditionExpression.includes(`attribute_not_exists(${alias})`));
 }
});
test('missing old order snapshot and delivery-only quote cannot be promoted into full financial terms',async()=>{
 for(const f of [undefined,{kind:'DELIVERY_FEE_ONLY',customerDeliveryFee:m('3000')}]){
  const s=saved();s.financialSnapshot=f;await rejects(setup(s).read(),'DRIVER_OFFER_FINANCIAL_SNAPSHOT_REQUIRED');
 }
});
test('request only accepts order and branch selectors, never client financial data or a table override',async()=>{
 const {r,calls}=setup();for(const v of [null,{orderId:'order1'},{orderId:'order1',branchId:'branch1',financialSnapshot:prepare(snapshot())},{orderId:'order1',branchId:'branch1',table:'prod'},{orderId:'../x',branchId:'branch1'}])await rejects(r.read(v),'INVALID_DRIVER_OFFER_ORDER_READ');assert.equal(calls.length,0);
});
test('unavailable, deleted, assigned, foreign or conflicting branch/state records fail closed',async()=>{
 const cases=[undefined,null];for(const item of cases)await rejects(setup(item===undefined?null:item).read(),'DRIVER_OFFER_ORDER_UNAVAILABLE');
 for(const patch of [{PK:'ORDER#other'},{SK:'OTHER'},{orderId:'other'},{storeId:'other'},{businessId:'other'},{merchantId:'other'},{status:'delivered'},{orderStatus:'assigned'},{driverId:'driver1'},{assignedDriverId:'driver1'},{deletionStatus:'PENDING'},{deletedAt:'now'},{isDeleted:true}])await rejects(setup({...saved(),...patch}).read(),'DRIVER_OFFER_ORDER_UNAVAILABLE');
});
test('matching branch/state aliases are accepted and every present alias is fenced',async()=>{
 const s=saved();s.businessId='branch1';s.orderStatus='ready_for_pickup';s.isDeleted=false;const out=await setup(s).read();const c=out.condition.ConditionCheck;
 for(const f of ['businessId','orderStatus','isDeleted']){const a=Object.keys(c.ExpressionAttributeNames).find(a=>c.ExpressionAttributeNames[a]===f);assert.ok(c.ConditionExpression.includes(a+' = :v'+a.slice(2)));}
});
test('malformed, tampered, incomplete or inconsistent financial envelopes are rejected',async()=>{
 for(const change of [s=>s.financialSnapshot.digest='bad',s=>s.financialSnapshot.extra=true,s=>s.financialSnapshot.schemaVersion=2,s=>s.financialSnapshot.snapshot.revision++,s=>s.financialSnapshot.snapshot.allocation.merchantCommission=undefined]){const s=saved();change(s);await rejects(setup(s).read(),'DRIVER_OFFER_FINANCIAL_SNAPSHOT_REQUIRED');}
 for(const change of [s=>delete s.allocation.merchantCommission,s=>s.confirmedCustomerTotal=m('1'),s=>s.revision=0,s=>s.allocation.driverEarning=m('3000')]){const v=snapshot();change(v);assert.throws(()=>prepare(v),e=>e.code==='DRIVER_OFFER_FINANCIAL_SNAPSHOT_REQUIRED');}
});
test('snapshot order and branch identities must agree with selected operational order',async()=>{
 for(const f of ['orderId','branchId','merchantId']){const v=snapshot();v[f]='other';const s=saved();s.financialSnapshot=prepare(v);await rejects(setup(s).read(),'DRIVER_OFFER_ORDER_UNAVAILABLE');}
});
test('PREPAID reference shape does not bypass missing trusted payment and funding readers',async()=>{
 const s=saved();s.financialSnapshot=prepare(snapshot('PREPAID'));await rejects(setup(s).read(),'DRIVER_OFFER_PAYMENT_READER_REQUIRED');
});
test('database errors remain unavailable and never fall back to pricing heuristics',async()=>{
 const r=reader({db:{async send(){throw new Error('secret backend details');}}});await rejects(r.read({orderId:'order1',branchId:'branch1'}),'DRIVER_OFFER_ORDER_UNAVAILABLE');
});
test('returned values and prepared envelope are detached from their input/storage references',async()=>{
 const v=snapshot(),e=prepare(v);v.allocation.serviceFee=m('1');assert.deepEqual(e.snapshot.allocation.serviceFee,m('500'));
 const s=saved(),out=await setup(s).read();s.financialSnapshot.snapshot.revision++;assert.equal(out.snapshot.revision,1);
 out.snapshot.revision++;assert.equal(out.condition.ConditionCheck.ExpressionAttributeValues[Object.keys(out.condition.ConditionCheck.ExpressionAttributeNames).find(a=>out.condition.ConditionCheck.ExpressionAttributeNames[a]==='financialSnapshot').replace('#f',':v')].snapshot.revision,1);
});
