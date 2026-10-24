const {test}=require('node:test'),assert=require('node:assert/strict');
const {readStoreDeliveryAgreement:read,calculateStoreDeliveryAgreement:calculate}=require('../dist/storeDeliveryAgreement');
const {createStagingDeliveryCampaignBudget:create}=require('../dist/deliveryCampaignBudget');
const {allocateDeliveryFundedOrder:allocate}=require('../dist/deliveryFundedAllocation');
const {parseIqd:m}=require('../dist/money');
function policy(pct=5){return {schemaVersion:2,id:'agreement',version:1,branchId:'branch',merchantId:'merchant',origin:'PLATFORM',effectiveFrom:'2026-10-18T00:00:00.000Z',effectiveTo:'2026-11-18T00:00:00.000Z',customerRule:{kind:'FIXED_TARIFF',amount:m('1500')},funding:{kind:'PLATFORM'},eligibility:{regionIds:['zone'],minimumGoods:m('7000')},commission:{kind:'PERCENT',basis:'GOODS_GROSS',fixed:null,rate:{numerator:pct,denominator:100},rounding:'TOWARD_ZERO',finalRounding:{incrementIqd:1,mode:'TOWARD_ZERO'}}};}
module.exports={policy};
test('commercial agreement has explicit decreasing or increasing commission and no campaign limits',()=>{
 for(const pct of [0,5,10,15,100])assert.equal(read(policy(pct)).policy.commission.rate.numerator,pct);
 for(const edit of [p=>p.limits={},p=>p.commission.rate.numerator=101,p=>p.effectiveTo=p.effectiveFrom,p=>p.funding.kind='MERCHANT']){const p=policy();edit(p);assert.throws(()=>read(p));}
});
test('fixed price is independent of reference tariff; free and shared agreements conserve whole IQD',()=>{
 for(const reference of ['1000','1500','2000','5000']){const r=calculate(policy(),m(reference));assert.equal(r.allocation.customerFee.minorAmount,1500000);assert.equal(r.allocation.subsidy.minorAmount,Math.max(0,Number(reference)-1500)*1000);}
 const p=policy();p.customerRule={kind:'FREE'};p.origin='SHARED';p.funding={kind:'SHARED_RATIO',merchantNumerator:33,denominator:100};const a=calculate(p,m('2001')).allocation;assert.equal(a.customerFee.minorAmount,0);assert.equal(a.merchantShare.minorAmount,660000);assert.equal(a.platformShare.minorAmount,1341000);
});
test('agreement order reservations have no budget or usage counter; replay and terminal races stay fenced',async()=>{
 let at=Date.parse('2026-10-19T00:00:00.000Z');const rows=new Map(),calls=[],db={send:async c=>{calls.push(c.input.Key.pk);return {Item:structuredClone(rows.get(c.input.Key.pk))};}};
 const service=create({db,now:()=>at}),p=policy(),input={orderId:'order',customerId:'customer',policy:p,referenceFee:m('2000'),customerFee:m('1500')};
 const a=await service.reserve(input);assert.equal(a.operations.length,1);const row=a.operations[0].Put.Item;assert.equal(row.schemaVersion,2);rows.set(row.pk,row);
 assert.equal((await service.reserve(input)).replayed,true);
 const b=await service.reserve({...input,orderId:'second'});assert.equal(b.operations.length,1);
 at=Date.parse('2026-12-01T00:00:00.000Z');const final=await service.settle({orderId:'order',outcome:'CAPTURED',expectedFunding:calculate(p,m('2000'))});assert.equal(final.operations.length,1);assert.match(final.operations[0].Put.ConditionExpression,/#v=:v/);rows.set(row.pk,final.operations[0].Put.Item);
 assert.equal((await service.settle({orderId:'order',outcome:'CAPTURED'})).replayed,true);await assert.rejects(service.settle({orderId:'order',outcome:'RELEASED'}));
 assert.ok(calls.every(k=>k.startsWith('DELIVERY_RESERVATION#')));
 await assert.rejects(service.reserve({...input,orderId:'expired'}),e=>e.code==='DELIVERY_POLICY_EXPIRED');
});
test('higher fixed customer price and driver tip conserve the actual cash',()=>{
 for(const reference of ['1000','2000','5000'])for(const pct of [5,15]){const funding=calculate(policy(pct),m(reference));const base={allocationSchemaVersion:1,paymentMethod:'COD',goodsGross:m('7000'),merchantGoodsDiscount:m('0'),platformGoodsDiscount:m('0'),merchantCommission:m(String(7000*pct/100)),serviceFee:m('500'),customerDeliveryFee:m('1500'),driverEarning:m('2000'),driverTip:m('1000'),merchantOtherCharges:m('0'),platformOtherCharges:m('0'),thirdPartyOtherCharges:m('0')};const r=allocate({allocationSchemaVersion:2,base,deliveryFunding:funding});assert.equal(r.customerTotal.minorAmount,10000000);assert.equal(r.driverTotalEntitlement.minorAmount,3000000);assert.equal(r.customerTotal.minorAmount,r.merchantPayable.minorAmount+r.driverTotalEntitlement.minorAmount+r.thirdPartyPayable.minorAmount+r.platformNetContribution.minorAmount);}
});

test('equivalent condition aliases do not inflate live order transaction expressions or lose predicates',()=>{
 const {composeQuoteOrderOperations:compose}=require('../dist/deliveryQuoteOrder');
 const a={ConditionCheck:{TableName:'WhizzMerchants_Businesses',Key:{businessId:'branch'},ConditionExpression:'(#a=:x OR #a=:y) AND #b=:v',ExpressionAttributeNames:{'#a':'status','#b':'minimum_order'},ExpressionAttributeValues:{':x':'open',':y':'approved',':v':7000}}};
 const b={ConditionCheck:{TableName:'WhizzMerchants_Businesses',Key:{businessId:'branch'},ConditionExpression:'#other = :value',ExpressionAttributeNames:{'#other':'minimum_order'},ExpressionAttributeValues:{':value':7000}}};
 assert.deepEqual(compose([a,b]),[a]);
 const different=structuredClone(b);different.ConditionCheck.ExpressionAttributeValues[':value']=4000;const combined=compose([a,different]);assert.equal(combined.length,1);assert.match(combined[0].ConditionCheck.ConditionExpression,/4000|merge/);assert.ok(Object.values(combined[0].ConditionCheck.ExpressionAttributeValues).includes(4000));assert.ok(Object.values(combined[0].ConditionCheck.ExpressionAttributeValues).includes(7000));
 const or={ConditionCheck:{...b.ConditionCheck,ConditionExpression:'#other = :value OR attribute_not_exists(#other)'}};assert.notDeepEqual(compose([a,or]),[a]);
});
