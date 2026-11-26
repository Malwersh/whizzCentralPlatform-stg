const {test}=require('node:test'),assert=require('node:assert/strict');
const {build}=require('../../../frontend/delivery-policy-form');
const {readDeliveryFundingPolicy}=require('../dist/deliveryFundingPolicy');
const {calculatePolicyDeliveryFunding}=require('../dist/deliveryFundingPolicy');
const {parseIqd:m}=require('../dist/money');
const scope={id:'delivery',version:1,businessId:'branch',merchantId:'merchant',regions:[{id:'zone',label:'بغداد — المركز'}]};
const base={rule:'CAPPED_PRICE',amount:'1500',funder:'PLATFORM',merchantPerOrder:'0',platformPerOrder:'4000',merchantBudget:'0',platformBudget:'100000',perCustomerUses:'3',regions:['zone'],from:'2026-10-18T12:00',to:'2026-10-25T12:00',minimumGoods:'5000',basis:'AFTER_GOODS_DISCOUNTS',audience:'ALL',stacking:'ALLOW',maximumRoadMeters:'5000'};
test('platform UI constructs existing canonical policy and independent 4000/1500 funding math',()=>{
 const p=build(base,scope);assert.deepEqual(readDeliveryFundingPolicy(p).policy,p);assert.notEqual(readDeliveryFundingPolicy(p).policy,p);
});
test('sole/shared/contribution UI choices use existing allocator without a second funding calculator',()=>{
 for(const [patch,merchant,platform]of [[{},0,2500],[{funder:'MERCHANT',merchantPerOrder:'4000',merchantBudget:'100000',platformPerOrder:'0',platformBudget:'0'},2500,0],[{funder:'SHARED',merchantPercent:'40',merchantPerOrder:'2000',merchantBudget:'100000'},1000,1500],[{funder:'MERCHANT_THEN_PLATFORM',contribution:'500',merchantPerOrder:'500',merchantBudget:'100000'},500,2000]]){
  const p=build({...base,...patch},scope),r=calculatePolicyDeliveryFunding(p,m('4000'),m('1500'));
  assert.equal(r.allocation.merchantShare.minorAmount,merchant*1000);assert.equal(r.allocation.platformShare.minorAmount,platform*1000);
 }
});
test('free and percentage offers bind cap, UTC dates and named-region identities',()=>{
 for(const rule of ['FREE','PERCENT_OFF']){const p=build({...base,rule,percent:'25',maximumDiscount:'2000'},scope);readDeliveryFundingPolicy(p);assert.equal(p.effectiveFrom,'2026-10-18T12:00:00.000Z');assert.deepEqual(p.eligibility.regionIds,['zone']);}
});
test('foreign regions, unsafe money, invalid percentages and disguised other-party liability reject before sending',()=>{
 for(const patch of [{regions:['foreign']},{platformBudget:'9007199254740991'},{funder:'MERCHANT'},{funder:'SHARED',merchantPercent:'100'},{to:'2026-10-01T00:00'},{rule:'FIXED_TARIFF'},{platformPerOrder:'200000'},{regions:['zone','zone']}])assert.throws(()=>build({...base,...patch},scope));
});
