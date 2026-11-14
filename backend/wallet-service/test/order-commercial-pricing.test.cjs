const {test}=require('node:test');const assert=require('node:assert/strict');
const {calculateOrderCommercialPricing:calc}=require('../dist/orderCommercialPricing');
const {parseIqd:m,formatIqd}=require('../dist/money');
const {prepareDriverOfferFinancialSnapshot:envelope}=require('../dist/driverOfferOrderReader');
const at='2026-10-15T12:00:00.000Z';
const none=()=>({kind:'NONE',basis:null,fixed:null,rate:null,rounding:'EXACT'});
const percent=(basis='AFTER_MERCHANT_DISCOUNT',numerator=10,denominator=100,rounding='EXACT')=>({kind:'PERCENT',basis,fixed:null,rate:{numerator,denominator},rounding});
function input(){return {schemaVersion:1,at,branchId:'b1',merchantId:'m1',goodsGross:m('10000'),
 agreement:{id:'agreement1',version:1,status:'ACTIVE',merchantId:'m1',branchId:null,effectiveFrom:'2026-10-01T00:00:00.000Z',effectiveTo:null,acceptedAt:at,approvedAt:at,commission:percent(),serviceFee:{kind:'FIXED',basis:null,fixed:m('500'),rate:null,rounding:'EXACT'}},
 goodsDiscounts:[{id:'campaign1',version:1,target:'GOODS',amount:m('2000'),merchantShare:m('500'),platformShare:m('1500')}],paymentMethod:'COD',customerDeliveryFee:m('3000'),driverTip:m('1000'),merchantOtherCharges:m('0'),platformOtherCharges:m('0'),thirdPartyOtherCharges:m('0')};}
const code=(f,c='INVALID_COMMERCIAL_PRICING')=>assert.throws(f,e=>e.code===c);
test('commission, customer fees and funding shares stay separate and reuse the allocation equation',()=>{
 const o=calc(input());assert.equal(formatIqd(o.commission.amount),'950');assert.equal(formatIqd(o.serviceFee.amount),'500');assert.equal(formatIqd(o.customerTotal),'12500');assert.equal(formatIqd(o.merchantPayableOnSuccessfulDelivery),'8550');assert.deepEqual(o.platformGoodsDiscountFundingRequired,m('1500'));assert.equal(o.provesFunding,false);assert.equal(o.performsWrites,false);assert.equal(o.allocationInput.driverEarning,undefined);
});
test('all three explicit goods bases produce distinct commissions with no silent basis default',()=>{
 for(const [basis,expected] of [['GOODS_GROSS','1000'],['AFTER_MERCHANT_DISCOUNT','950'],['CUSTOMER_GOODS_PAYMENT','800']]){const i=input();i.agreement.commission=percent(basis);assert.equal(formatIqd(calc(i).commission.amount),expected);}
 const i=input();i.agreement.commission=percent('TOTAL');code(()=>calc(i));delete i.agreement.commission.basis;code(()=>calc(i));
});
test('tip, delivery and other charges never enter percentage commission or service-fee bases',()=>{
 const i=input();i.agreement.serviceFee=percent('CUSTOMER_GOODS_PAYMENT',5);const before=calc(i);i.driverTip=m('9000');i.customerDeliveryFee=m('7000');i.merchantOtherCharges=m('100');i.platformOtherCharges=m('200');i.thirdPartyOtherCharges=m('300');const after=calc(i);assert.deepEqual(before.commission,after.commission);assert.deepEqual(before.serviceFee,after.serviceFee);assert.equal(after.customerTotal.minorAmount-before.customerTotal.minorAmount,m('12600').minorAmount);
});
test('zero charges and absence of discounts are explicit and missing agreement or charge does not mean zero',()=>{
 const i=input();i.agreement.commission=none();i.agreement.serviceFee=none();i.goodsDiscounts=[];const o=calc(i);assert.deepEqual(o.commission.amount,m('0'));assert.deepEqual(o.serviceFee.amount,m('0'));assert.equal(formatIqd(o.customerTotal),'14000');
 for(const field of ['agreement','goodsDiscounts','merchantOtherCharges']){const bad=input();delete bad[field];code(()=>calc(bad));}const bad=input();delete bad.agreement.serviceFee;code(()=>calc(bad));
});
test('merchant/platform split must exactly fund every discount and cannot exceed the goods value',()=>{
 for(const change of [i=>i.goodsDiscounts[0].platformShare=m('1499'),i=>i.goodsDiscounts[0].merchantShare=m('-1'),i=>{i.goodsDiscounts[0].amount=m('11000');i.goodsDiscounts[0].merchantShare=m('9500');}]){const i=input();change(i);assert.throws(()=>calc(i));}
 const i=input();i.goodsDiscounts[0].platformShare=m('1500.001');code(()=>calc(i),'DISCOUNT_FUNDING_MISMATCH');
});
test('duplicate campaigns, delivery-target discounts and unknown policy fields are not silently merged',()=>{
 for(const change of [i=>i.goodsDiscounts.push({...i.goodsDiscounts[0],version:2}),i=>i.goodsDiscounts[0].target='DELIVERY',i=>i.goodsDiscounts[0].unknown=true,i=>i.agreement.extra=true,i=>i.driverEarning=m('3000')]){const i=input();change(i);code(()=>calc(i));}
});
test('agreement scope, active status, acceptance, approval and effective interval are required',()=>{
 for(const change of [i=>i.agreement.status='DRAFT',i=>i.agreement.merchantId='other',i=>i.agreement.branchId='other',i=>i.agreement.effectiveTo=at,i=>i.agreement.effectiveFrom='2026-10-16T00:00:00.000Z',i=>i.agreement.acceptedAt='2026-10-16T00:00:00.000Z',i=>i.agreement.approvedAt='2026-10-16T00:00:00.000Z']){const i=input();change(i);code(()=>calc(i),'COMMERCIAL_TERMS_UNAVAILABLE');}
 const i=input();i.agreement.branchId='b1';assert.ok(calc(i));i.agreement.acceptedAt=null;code(()=>calc(i));
});
test('fractional percentage results require explicit rounding with no floating arithmetic',()=>{
 const i=input();i.goodsGross=m('1.001');i.goodsDiscounts=[];i.agreement.commission=percent('GOODS_GROSS',1,2);code(()=>calc(i));
 i.agreement.commission.rounding='TOWARD_ZERO';assert.deepEqual(calc(i).commission.amount,m('0.500'));i.agreement.commission.rounding='HALF_AWAY_FROM_ZERO';assert.deepEqual(calc(i).commission.amount,m('0.501'));
});
test('fixed commission cannot exceed merchant goods entitlement; no clamp to available amount',()=>{
 const i=input();i.agreement.commission={kind:'FIXED',basis:null,fixed:m('9501'),rate:null,rounding:'EXACT'};code(()=>calc(i));i.agreement.commission.fixed=m('9500');assert.deepEqual(calc(i).merchantPayableOnSuccessfulDelivery,m('0'));
});
test('rates, discriminated charge forms and malformed Money reject ambiguous calculations',()=>{
 for(const change of [i=>i.agreement.commission.rate.numerator=101,i=>i.agreement.commission.rate.denominator=0,i=>i.agreement.commission.rate.numerator=1.5,i=>i.agreement.commission.fixed=m('1'),i=>i.agreement.serviceFee.basis='GOODS_GROSS',i=>i.agreement.serviceFee.rounding='TOWARD_ZERO',i=>i.customerDeliveryFee=3000,i=>i.goodsGross={...i.goodsGross,scale:1},i=>i.paymentMethod='CARD']){const i=input();change(i);code(()=>calc(i));}
});
test('commercial output fits the existing full snapshot validator without introducing another money schema',()=>{
 const o=calc(input());const e=envelope({snapshotId:'s1',revision:1,orderId:'o1',branchId:'b1',merchantId:'m1',zoneId:'z1',cityId:'c1',governorateId:'g1',branchPoint:{latitude:31,longitude:44},customerPoint:{latitude:32,longitude:44},confirmedCustomerTotal:o.customerTotal,allocation:o.allocationInput,paymentEvidence:null});assert.deepEqual(e.snapshot.allocation.merchantCommission,m('950'));
});
test('discount order does not alter digest, source mutation does not mutate the returned values',()=>{
 const i=input();i.goodsDiscounts.push({id:'campaign2',version:1,target:'GOODS',amount:m('100'),merchantShare:m('100'),platformShare:m('0')});const a=calc(i);i.goodsDiscounts.reverse();assert.equal(calc(i).digest,a.digest);i.agreement.version++;i.goodsGross=m('1');assert.deepEqual(a.allocationInput.goodsGross,m('10000'));assert.equal(a.agreement.version,1);
});
test('PREPAID arithmetic remains a proposal and does not assert captured funds or provider verification',()=>{
 const i=input();i.paymentMethod='PREPAID';const o=calc(i);assert.equal(o.provesFunding,false);assert.equal(o.requiresTrustedSourcesAndAtomicFences,true);assert.equal(o.paymentEvidence,undefined);assert.equal(o.withdrawable,undefined);
});
test('invalid times, identifiers, version and array bounds fail without operational defaults',()=>{
 for(const change of [i=>i.at='2026-02-30T00:00:00.000Z',i=>i.agreement.id='',i=>i.agreement.version=0,i=>i.branchId='../x',i=>i.goodsDiscounts=null,i=>i.goodsDiscounts=Array(21).fill(i.goodsDiscounts[0]),i=>i.agreement.effectiveTo='2026-09-01T00:00:00.000Z']){const i=input();change(i);assert.throws(()=>calc(i));}
});
test('catalog goods source, commercial calculation and snapshot envelope compose without client price input',async()=>{
 const {createStagingOrderGoodsPricing}=require('../dist/orderGoodsPricing');
 const calls=[];const goods=await createStagingOrderGoodsPricing({db:{async send(c){calls.push(c);return {Item:c.input.TableName==='WhizzMerchants_Products'?{productId:'p1',businessId:'b1',price:2500,isAvailable:true,categoryId:'cat1'}:{categoryId:'cat1',isActive:true}};}}}).price({branchId:'b1',items:[{productId:'p1',quantity:4}]});
 const request=input();request.goodsGross=goods.goodsGross;const commercial=calc(request);
 const saved=envelope({snapshotId:'s1',revision:1,orderId:'o1',branchId:'b1',merchantId:'m1',zoneId:'z1',cityId:'c1',governorateId:'g1',branchPoint:{latitude:31,longitude:44},customerPoint:{latitude:32,longitude:44},confirmedCustomerTotal:commercial.customerTotal,allocation:commercial.allocationInput,paymentEvidence:null});
 assert.equal(calls.length,3);assert.equal(goods.conditions.length,2);assert.deepEqual(saved.snapshot.allocation.goodsGross,m('10000'));assert.deepEqual(saved.snapshot.allocation.merchantCommission,m('950'));assert.deepEqual(saved.snapshot.confirmedCustomerTotal,m('12500'));
});
