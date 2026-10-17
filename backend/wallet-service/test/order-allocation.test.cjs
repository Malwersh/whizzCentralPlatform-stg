const test=require('node:test'),assert=require('node:assert/strict');
const {allocateOrder,AllocationError}=require('../dist/orderAllocation');
const {fromWholeIqd:iqd,moneyFromMinor:minor,toWholeIqdExact:whole,MoneyError}=require('../dist/money');
const input=(overrides={})=>({allocationSchemaVersion:1,paymentMethod:'COD',goodsGross:iqd(10000),merchantGoodsDiscount:iqd(0),platformGoodsDiscount:iqd(0),merchantCommission:iqd(0),serviceFee:iqd(500),customerDeliveryFee:iqd(3000),driverEarning:iqd(3000),driverTip:iqd(1000),merchantOtherCharges:iqd(0),platformOtherCharges:iqd(0),thirdPartyOtherCharges:iqd(0),...overrides});
const n=(r,key)=>BigInt(r[key].minorAmount);
function balanced(r){
 assert.equal(n(r,'customerTotal'),n(r,'merchantPayable')+n(r,'driverTotalEntitlement')+n(r,'thirdPartyPayable')+n(r,'platformNetContribution'));
 assert.equal(n(r,'driverCashRetained')+n(r,'driverWalletCreditTotal'),n(r,'driverTotalEntitlement'));
 assert.equal(n(r,'platformFundsAfterDriverCredit'),n(r,'merchantPayable')+n(r,'thirdPartyPayable')+n(r,'platformNetContribution'));
 assert.equal(n(r,'driverCashTipRetained')+n(r,'driverWalletTipCredit'),n(r,'driverTipEntitlement'));
}
test('COD tips example retains cash without duplicate wallet credits',()=>{
 const r=allocateOrder(input());balanced(r);
 for(const [key,value] of Object.entries({customerTotal:14500,driverWalletHold:10500,driverCashRetained:4000,driverCashEarningRetained:3000,driverCashTipRetained:1000,driverWalletCreditTotal:0,merchantPayable:10000,platformNetContribution:500}))assert.equal(whole(r[key]),value);
});
test('higher driver earning funds only the delivery shortfall',()=>{
 const r=allocateOrder(input({driverEarning:iqd(4000)}));balanced(r);
 assert.equal(whole(r.driverWalletHold),10500);assert.equal(whole(r.driverCashRetained),4000);
 assert.equal(whole(r.driverWalletEarningCredit),1000);assert.equal(whole(r.driverWalletTipCredit),0);
 assert.equal(whole(r.platformNetContribution),-500);
});
test('lower driver earning captures the positive delivery difference',()=>{
 const r=allocateOrder(input({driverEarning:iqd(2500)}));balanced(r);
 assert.equal(whole(r.driverWalletHold),11000);assert.equal(whole(r.driverCashRetained),3500);
 assert.equal(whole(r.deliverySurplus),500);assert.equal(whole(r.platformNetContribution),1000);
});
test('prepaid separates earning and tip with no driver hold or cash collection',()=>{
 const r=allocateOrder(input({paymentMethod:'PREPAID'}));balanced(r);
 assert.equal(whole(r.platformCollection),14500);assert.equal(whole(r.driverWalletHold),0);
 assert.equal(whole(r.driverCashRetained),0);assert.equal(whole(r.driverWalletEarningCredit),3000);
 assert.equal(whole(r.driverWalletTipCredit),1000);assert.equal(whole(r.driverWalletCreditTotal),4000);
 assert.equal(r.withdrawable,undefined);assert.equal(r.paymentStatus,undefined);
});
test('merchant and platform funded discounts preserve the merchant entitlement independently',()=>{
 for(const paymentMethod of ['COD','PREPAID']){
  const r=allocateOrder(input({paymentMethod,merchantGoodsDiscount:iqd(1000),platformGoodsDiscount:iqd(2000),merchantCommission:iqd(900)}));balanced(r);
  assert.equal(whole(r.customerGoodsPayment),7000);assert.equal(whole(r.merchantGoodsEntitlement),9000);
  assert.equal(whole(r.merchantPayable),8100);assert.equal(whole(r.platformNetContribution),-600);
  assert.equal(whole(r.platformGoodsDiscountFunding),2000);
 }
});
test('fully platform subsidized goods and free delivery never produce fictitious customer cash',()=>{
 const r=allocateOrder(input({platformGoodsDiscount:iqd(10000),serviceFee:iqd(0),customerDeliveryFee:iqd(0),driverTip:iqd(0)}));balanced(r);
 assert.equal(whole(r.customerTotal),0);assert.equal(whole(r.driverWalletHold),0);
 assert.equal(whole(r.merchantPayable),10000);assert.equal(whole(r.driverWalletEarningCredit),3000);
 assert.equal(whole(r.platformSubsidy),13000);assert.equal(whole(r.platformFundsAfterDriverCredit),-3000);
});
test('other charges have explicit merchant, platform and third party beneficiaries',()=>{
 const r=allocateOrder(input({merchantOtherCharges:iqd(250),platformOtherCharges:iqd(100),thirdPartyOtherCharges:iqd(50)}));balanced(r);
 assert.equal(whole(r.customerTotal),14900);assert.equal(whole(r.driverWalletHold),10900);
 assert.equal(whole(r.merchantPayable),10250);assert.equal(whole(r.platformNetContribution),600);assert.equal(whole(r.thirdPartyPayable),50);
});
test('tip changes affect only customer total and the dedicated driver tip channel',()=>{
 for(const paymentMethod of ['COD','PREPAID']){
  const a=allocateOrder(input({paymentMethod,driverTip:iqd(0)})),b=allocateOrder(input({paymentMethod,driverTip:iqd(2000)}));balanced(a);balanced(b);
  for(const key of ['merchantPayable','merchantCommission','driverEarningEntitlement','driverWalletHold','deliveryMargin','platformNetContribution','platformSubsidy'])assert.deepEqual(a[key],b[key]);
  assert.equal(whole(b.customerTotal)-whole(a.customerTotal),2000);
 }
});
test('zero delivery earning and zero tip are valid without default replacements',()=>{
 const r=allocateOrder(input({driverEarning:iqd(0),driverTip:iqd(0)}));balanced(r);
 assert.equal(whole(r.driverWalletHold),13500);assert.equal(whole(r.driverCashRetained),0);
});
test('invalid discounts and unsupported commission deficits are rejected instead of clamped',()=>{
 for(const changes of [{merchantGoodsDiscount:iqd(10001)},{merchantGoodsDiscount:iqd(9000),platformGoodsDiscount:iqd(1001)},{merchantCommission:iqd(10001)}])assert.throws(()=>allocateOrder(input(changes)),AllocationError);
});
test('every monetary component requires known units, safe integers and nonnegative values',()=>{
 const base=input();
 for(const field of Object.keys(base).filter(k=>typeof base[k]==='object')){
  assert.throws(()=>allocateOrder(input({[field]:minor(-1)})),AllocationError);
  assert.throws(()=>allocateOrder(input({[field]:{...minor(1),scale:1}})),MoneyError);
  const missing={...base};delete missing[field];assert.throws(()=>allocateOrder(missing),MoneyError);
 }
});
test('unknown payment modes, versions and extra fees cannot silently disappear',()=>{
 for(const x of [null,[],input({paymentMethod:'CARD'}),input({allocationSchemaVersion:2}),input({tax:iqd(10)}),input({driverId:'untrusted'})])assert.throws(()=>allocateOrder(x),AllocationError);
});
test('allocation retains thousandths without per-component rounding',()=>{
 const r=allocateOrder(input({goodsGross:minor(1001),merchantCommission:minor(1),serviceFee:minor(1),customerDeliveryFee:minor(2),driverEarning:minor(3),driverTip:minor(1)}));balanced(r);
 assert.equal(r.customerTotal.minorAmount,1005);assert.equal(r.driverWalletHold.minorAmount,1002);assert.equal(r.driverWalletEarningCredit.minorAmount,1);
});
test('unsafe outputs fail before returning a partial allocation and input is unchanged',()=>{
 const x=input({goodsGross:minor(Number.MAX_SAFE_INTEGER)}),before=structuredClone(x);
 assert.throws(()=>allocateOrder(x),e=>e.code==='MONEY_OVERFLOW');assert.deepEqual(x,before);
 const r=allocateOrder(input());assert.equal(Object.isFrozen(r),true);assert.equal(Object.isFrozen(r.merchantPayable),true);
 assert.deepEqual(r,allocateOrder(input()));assert.doesNotThrow(()=>JSON.stringify(r));
});
test('both methods balance across delivery margins, discounts and tip combinations',()=>{
 for(const paymentMethod of ['COD','PREPAID'])for(const d of [0,1,3000,5000])for(const e of [0,1,3000,6000])for(const tip of [0,500,2000])for(const [md,pd] of [[0,0],[1000,0],[0,2000],[1000,2000]]){
  balanced(allocateOrder(input({paymentMethod,customerDeliveryFee:iqd(d),driverEarning:iqd(e),driverTip:iqd(tip),merchantGoodsDiscount:iqd(md),platformGoodsDiscount:iqd(pd),merchantCommission:iqd(900)})));
 }
});
