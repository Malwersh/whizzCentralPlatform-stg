const {test}=require('node:test'),assert=require('node:assert/strict');
const {createStagingDeliveryCampaignBudget:create,deliveryCampaignBudgetInitialization:init}=require('../dist/deliveryCampaignBudget');
const {parseIqd:m}=require('../dist/money');
function policy(){return {schemaVersion:1,id:'campaign',version:1,merchantId:'merchant',branchId:'branch',origin:'SHARED',effectiveFrom:'2026-10-16T00:00:00.000Z',effectiveTo:'2026-10-25T00:00:00.000Z',customerRule:{kind:'CAPPED_PRICE',amount:m('1500')},funding:{kind:'CONTRIBUTION_THEN_REMAINDER',contributor:'MERCHANT',contribution:m('1000'),remainderCap:m('2000')},eligibility:{regionIds:['zone'],maximumRoadMeters:5000,minimumGoods:m('10000'),minimumGoodsBasis:'AFTER_GOODS_DISCOUNTS',audience:'ALL',goodsDiscountStacking:'ALLOW'},limits:{merchantPerOrder:m('1000'),platformPerOrder:m('2500'),merchantBudget:m('2000'),platformBudget:m('3000'),perCustomerUses:1},onUnavailable:'NORMAL_TARIFF'};}
function fixture(p=policy()){
 const rows=new Map(),key=k=>JSON.stringify({pk:k.pk,sk:k.sk});let clock=Date.parse('2026-10-18T00:00:00.000Z');
 const commit=ops=>{const seen=new Set();for(const {Put:o} of ops){const k=key(o.Item);assert.ok(!seen.has(k));seen.add(k);const old=rows.get(k);if(o.ConditionExpression==='attribute_not_exists(pk)'){if(old)throw Error('CONFLICT');}else{if(!old||old.version!==o.ExpressionAttributeValues[':v']||old.digest!==o.ExpressionAttributeValues[':digest'])throw Error('CONFLICT');}}for(const {Put:o} of ops)rows.set(key(o.Item),structuredClone(o.Item));};
 commit([init(p)]);
 const db={send:async c=>{assert.equal(c.constructor.name,'GetCommand');assert.equal(c.input.ConsistentRead,true);return {Item:structuredClone(rows.get(key(c.input.Key)))};}};
 const service=create({db,now:()=>clock}),input={orderId:'order-one',customerId:'customer',policy:p,referenceFee:m('4000'),customerFee:m('1500')};
 const budget=()=>rows.get(key({pk:'DELIVERY_BUDGET#campaign',sk:'VERSION#1'}));
 return {rows,commit,service,input,budget,clock:v=>clock=v};
}
test('reserves both shares and a use; repeated order does not reserve twice',async()=>{
 const f=fixture(),r=await f.service.reserve(f.input);assert.equal(r.operations.length,3);assert.equal(f.budget().merchantReserved,0);f.commit(r.operations);
 assert.equal(f.budget().merchantReserved,1000000);assert.equal(f.budget().platformReserved,1500000);
 const again=await f.service.reserve(f.input);assert.equal(again.replayed,true);assert.deepEqual(again.operations,[]);
 await assert.rejects(f.service.reserve({...f.input,customerId:'other'}),e=>e.code==='DELIVERY_RESERVATION_CONFLICT');
});
test('completion consumes budget once and cannot subsequently release',async()=>{
 const f=fixture();f.commit((await f.service.reserve(f.input)).operations);f.clock(Date.parse('2026-12-01T00:00:00.000Z'));
 f.commit((await f.service.settle({orderId:'order-one',outcome:'CAPTURED'})).operations);
 assert.equal(f.budget().merchantReserved,0);assert.equal(f.budget().merchantSpent,1000000);assert.equal(f.budget().platformSpent,1500000);
 assert.equal((await f.service.settle({orderId:'order-one',outcome:'CAPTURED'})).replayed,true);
 await assert.rejects(f.service.settle({orderId:'order-one',outcome:'RELEASED'}),e=>e.code==='DELIVERY_RESERVATION_CONFLICT');
});
test('cancellation releases both allowances and usage; same order cannot re-reserve',async()=>{
 const f=fixture();f.commit((await f.service.reserve(f.input)).operations);f.commit((await f.service.settle({orderId:'order-one',outcome:'RELEASED'})).operations);
 assert.equal(f.budget().merchantAvailable,2000000);assert.equal(f.budget().platformAvailable,3000000);assert.equal(f.budget().merchantSpent,0);
 assert.equal((await f.service.settle({orderId:'order-one',outcome:'RELEASED'})).replayed,true);
 await assert.rejects(f.service.reserve(f.input),e=>e.code==='DELIVERY_RESERVATION_CONFLICT');
 f.commit((await f.service.reserve({...f.input,orderId:'order-two'})).operations);
});
test('reserved and completed usage prevent another discounted order',async()=>{
 for(const capture of [false,true]){const f=fixture();f.commit((await f.service.reserve(f.input)).operations);if(capture)f.commit((await f.service.settle({orderId:'order-one',outcome:'CAPTURED'})).operations);await assert.rejects(f.service.reserve({...f.input,orderId:'order-two'}),e=>e.code==='DELIVERY_USAGE_EXHAUSTED');}
});
test('concurrent prepared admissions conflict atomically and cannot overspend',async()=>{
 const f=fixture();const first=await f.service.reserve(f.input),second=await f.service.reserve({...f.input,orderId:'order-two',customerId:'other'});f.commit(first.operations);assert.throws(()=>f.commit(second.operations),/CONFLICT/);
 f.commit((await f.service.reserve({...f.input,orderId:'order-two',customerId:'other'})).operations);
 await assert.rejects(f.service.reserve({...f.input,orderId:'order-three',customerId:'third'}),e=>e.code==='DELIVERY_BUDGET_EXHAUSTED');
 assert.equal(f.rows.has(JSON.stringify({pk:'DELIVERY_RESERVATION#order-three',sk:'META'})),false);
});
test('capture versus release race permits only one terminal outcome',async()=>{
 const f=fixture();f.commit((await f.service.reserve(f.input)).operations);const a=await f.service.settle({orderId:'order-one',outcome:'CAPTURED'}),b=await f.service.settle({orderId:'order-one',outcome:'RELEASED'});f.commit(a.operations);assert.throws(()=>f.commit(b.operations),/CONFLICT/);assert.equal(f.budget().merchantSpent,1000000);
});
test('corrupt state, missing budget, expired policy and invalid subsidy reject',async()=>{
 const f=fixture();f.budget().platformAvailable=999;await assert.rejects(f.service.reserve(f.input));
 const g=fixture();g.rows.clear();await assert.rejects(g.service.reserve(g.input),e=>e.code==='DELIVERY_BUDGET_UNAVAILABLE');
 const h=fixture();h.clock(Date.parse('2026-10-25T00:00:00.000Z'));await assert.rejects(h.service.reserve(h.input),e=>e.code==='DELIVERY_POLICY_EXPIRED');
 const j=fixture();await assert.rejects(j.service.reserve({...j.input,customerFee:m('4000')}),e=>e.code==='DELIVERY_SUBSIDY_REQUIRED');
});
test('new policy version budget never overwrites historical reservation',async()=>{
 const f=fixture();f.commit((await f.service.reserve(f.input)).operations);const p={...policy(),version:2};f.commit([init(p)]);f.commit((await f.service.settle({orderId:'order-one',outcome:'RELEASED'})).operations);
 assert.equal(f.budget().merchantAvailable,2000000);const newer=f.rows.get(JSON.stringify({pk:'DELIVERY_BUDGET#campaign',sk:'VERSION#2'}));assert.equal(newer.merchantReserved,0);assert.equal(newer.merchantAvailable,2000000);
});

test('editing campaign terms does not reset per-customer usage',async()=>{
 const f=fixture();f.commit((await f.service.reserve(f.input)).operations);f.commit((await f.service.settle({orderId:'order-one',outcome:'CAPTURED'})).operations);
 const next={...policy(),version:2};f.commit([init(next)]);await assert.rejects(f.service.reserve({...f.input,orderId:'order-two',policy:next}),e=>e.code==='DELIVERY_USAGE_EXHAUSTED');
});
