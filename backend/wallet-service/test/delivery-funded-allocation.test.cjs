const {test}=require('node:test'),assert=require('node:assert/strict');
const {allocateDeliveryFundedOrder:allocate}=require('../dist/deliveryFundedAllocation');
const {allocateOrder:legacy}=require('../dist/orderAllocation');const {parseIqd:m,formatIqd:f}=require('../dist/money');
const base=()=>({allocationSchemaVersion:1,paymentMethod:'COD',goodsGross:m('10000'),merchantGoodsDiscount:m('0'),platformGoodsDiscount:m('0'),merchantCommission:m('700'),serviceFee:m('500'),customerDeliveryFee:m('1500'),driverEarning:m('4000'),driverTip:m('0'),merchantOtherCharges:m('0'),platformOtherCharges:m('0'),thirdPartyOtherCharges:m('0')});
function input(merchant='0',platform='2500'){return {allocationSchemaVersion:2,base:base(),deliveryFunding:{policyPin:{policyId:'policy',version:1,termsHash:'a'.repeat(64)},allocation:{schemaVersion:1,referenceFee:m('4000'),customerFee:m('1500'),subsidy:m('2500'),merchantShare:m(merchant),platformShare:m(platform)}}};}
const balance=r=>assert.equal(r.customerTotal.minorAmount,r.merchantPayable.minorAmount+r.driverTotalEntitlement.minorAmount+r.thirdPartyPayable.minorAmount+r.platformNetContribution.minorAmount);
test('customer pays 12000 driver gets 4000 platform funds 2500 without duplicate expense',()=>{const r=allocate(input());assert.equal(f(r.customerTotal),'12000');assert.equal(f(r.merchantPayable),'9300');assert.equal(f(r.driverTotalEntitlement),'4000');assert.equal(f(r.platformNetContribution),'-1300');assert.equal(f(r.platformPromotionCashReservation),'2500');balance(r);});
test('merchant-funded and shared delivery reduce merchant payable once',()=>{for(const [ms,ps,net,pn]of [['2500','0','6800','1200'],['1000','1500','8300','-300']]){const r=allocate(input(ms,ps));assert.equal(f(r.merchantPayable),net);assert.equal(f(r.platformNetContribution),pn);assert.equal(f(r.driverEarningEntitlement),'4000');balance(r);}});
test('free delivery preserves driver earning and service fee',()=>{const v=input('4000','0');Object.assign(v.deliveryFunding.allocation,{customerFee:m('0'),subsidy:m('4000'),merchantShare:m('4000')});v.base.customerDeliveryFee=m('0');const r=allocate(v);assert.equal(f(r.customerTotal),'10500');assert.equal(f(r.merchantPayable),'5300');assert.equal(f(r.driverEarningEntitlement),'4000');balance(r);});
test('baseline route cost mismatch is separate from promotional support',()=>{const v=input();v.base.driverEarning=m('5000');const r=allocate(v);assert.equal(f(r.baselineDeliveryMargin),'-1000');assert.equal(f(r.platformBaselineDeliverySubsidy),'1000');assert.equal(f(r.platformDeliveryPromotionFunding),'2500');assert.equal(f(r.platformSubsidy),'3500');balance(r);});
test('COD and prepaid reuse original driver cash and credits with equal economic entitlement',()=>{for(const paymentMethod of ['COD','PREPAID']){const v=input('1000','1500');v.base.paymentMethod=paymentMethod;v.base.driverTip=m('300');const original=legacy(v.base),r=allocate(v);for(const k of ['driverWalletHold','driverCashRetained','driverWalletCreditTotal','customerTotal','merchantCommission'])assert.equal(r[k].minorAmount,original[k].minorAmount);balance(r);}});
test('goods discounts remain distinct and commission is not recalculated by delivery support',()=>{const v=input('1000','1500');v.base.merchantGoodsDiscount=m('1000');v.base.platformGoodsDiscount=m('500');const r=allocate(v);assert.equal(f(r.customerGoodsPayment),'8500');assert.equal(f(r.merchantCommission),'700');assert.equal(f(r.merchantPayable),'7300');assert.equal(f(r.platformPromotionCashReservation),'2000');balance(r);});
test('reject funding mismatches, unsupported schema and merchant payable deficit',()=>{for(const edit of [v=>v.deliveryFunding.allocation.merchantShare=m('1'),v=>v.base.customerDeliveryFee=m('1400'),v=>v.deliveryFunding.policyPin.version=0,v=>v.allocationSchemaVersion=1,v=>{v.deliveryFunding.allocation.merchantShare=m('2500');v.deliveryFunding.allocation.platformShare=m('0');v.base.goodsGross=m('1000');}]){const v=input();edit(v);assert.throws(()=>allocate(v));}});
test('legacy allocator rejects V2 rather than silently dropping funding fields',()=>{assert.throws(()=>legacy(input()));const r=allocate(input('1000','1500'));assert.equal(r.ruleVersion,'ORDER_ALLOCATION_V2_DELIVERY_FUNDING');assert.ok(Object.isFrozen(r.deliveryFundingPin));});

test('matrix conserves cash across reference tariffs, driver costs, splits and payment methods',()=>{
 for(const paymentMethod of ['COD','PREPAID'])for(const reference of [4000,6000])for(const customer of [0,1500,4000])for(const earning of [0,2000,8000])for(const numerator of [0,1,2]){
  const subsidy=reference-customer,merchant=subsidy*numerator/2,platform=subsidy-merchant,v=input(String(merchant),String(platform));
  Object.assign(v.deliveryFunding.allocation,{referenceFee:m(String(reference)),customerFee:m(String(customer)),subsidy:m(String(subsidy))});
  Object.assign(v.base,{paymentMethod,customerDeliveryFee:m(String(customer)),driverEarning:m(String(earning)),driverTip:m('300'),merchantGoodsDiscount:m('500'),platformGoodsDiscount:m('100'),thirdPartyOtherCharges:m('200')});
  const r=allocate(v);balance(r);assert.equal(r.driverTotalEntitlement.minorAmount,(earning+300)*1000);assert.equal(r.merchantPayable.minorAmount,(10000-500-700-merchant)*1000);
 }
});

test('rounding uplift stays with platform without increasing driver or merchant amounts',()=>{
 const before=input('0','2900');before.base.customerDeliveryFee=m('1100');before.deliveryFunding.allocation.customerFee=m('1100');before.deliveryFunding.allocation.subsidy=m('2900');
 const after=input('0','2750');after.base.customerDeliveryFee=m('1250');after.deliveryFunding.allocation.customerFee=m('1250');after.deliveryFunding.allocation.subsidy=m('2750');
 const a=allocate(before),b=allocate(after);
 assert.equal(b.platformNetContribution.minorAmount-a.platformNetContribution.minorAmount,150000);
 assert.deepEqual(b.merchantPayable,a.merchantPayable);assert.deepEqual(b.driverTotalEntitlement,a.driverTotalEntitlement);
 assert.equal(b.customerTotal.minorAmount-a.customerTotal.minorAmount,150000);balance(b);
});
