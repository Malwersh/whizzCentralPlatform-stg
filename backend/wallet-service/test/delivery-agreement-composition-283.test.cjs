const {test}=require('node:test'),assert=require('node:assert/strict');
const {composeDeliveryFunding:compose,verifyDeliveryFundingComposition:verify}=require('../dist/deliveryFundingComposition');
const {calculateStoreDeliveryAgreement}=require('../dist/storeDeliveryAgreement');
const {allocateDeliveryFunding}=require('../dist/deliveryFunding');
const {prepareFullCashSettlement,prepareFullCashJournal}=require('../dist/fullCashSettlement');
const {createStagingDeliveryCampaignBudget:budget}=require('../dist/deliveryCampaignBudget');
const {preparePlatformBenefit,platformBenefitBalance}=require('../dist/platformBenefits');
const {parseIqd:m}=require('../dist/money');
const contract=()=>({schemaVersion:2,id:'contract',version:1,merchantId:'merchant',branchId:'branch',origin:'PLATFORM',effectiveFrom:'2026-10-01T00:00:00.000Z',effectiveTo:'2026-11-01T00:00:00.000Z',customerRule:{kind:'FIXED_TARIFF',amount:m('1500')},funding:{kind:'PLATFORM'},eligibility:{regionIds:['zone'],minimumGoods:m('7000')},commission:{kind:'PERCENT',basis:'GOODS_GROSS',fixed:null,rate:{numerator:15,denominator:100},rounding:'TOWARD_ZERO',finalRounding:{incrementIqd:1,mode:'TOWARD_ZERO'}}});
const extra=(kind='PLATFORM')=>({policyPin:{policyId:'promo',version:1,termsHash:'b'.repeat(64)},allocation:allocateDeliveryFunding({schemaVersion:1,referenceFee:m('1500'),customerFee:m('0'),funding:kind==='SHARED_RATIO'?{kind,merchantNumerator:1,denominator:2,merchantCap:m('5000'),platformCap:m('5000')}:{kind}})});
function base(){return {allocationSchemaVersion:1,paymentMethod:'COD',goodsGross:m('7000'),merchantGoodsDiscount:m('0'),platformGoodsDiscount:m('0'),merchantCommission:m('1050'),serviceFee:m('500'),customerDeliveryFee:m('0'),driverEarning:m('2750'),driverTip:m('500'),merchantOtherCharges:m('0'),platformOtherCharges:m('0'),thirdPartyOtherCharges:m('0')};}
function memory(){const rows=new Map(),key=(t,k)=>t+'|'+(k.pk??k.PK)+'|'+(k.sk??k.SK),db={send:async c=>({Item:structuredClone(rows.get(key(c.input.TableName,c.input.Key)))})};return {db,rows,put:(t,r)=>rows.set(key(t,r),structuredClone(r)),apply:ops=>{for(const o of ops)if(o.Put)rows.set(key(o.Put.TableName,o.Put.Item),structuredClone(o.Put.Item));}};}
for(const reference of [1000,1500,2000])for(const kind of ['PLATFORM','MERCHANT','SHARED_RATIO'])test(`283 ${kind} conserves actual cash and balanced GL at road fee ${reference}`,()=>{
 const agreement=calculateStoreDeliveryAgreement(contract(),m(String(reference))),promotion=extra(kind),funding=compose(agreement,promotion);assert.deepEqual(verify(funding),funding);
 const result=prepareFullCashSettlement({settlementSchemaVersion:1,base:base(),deliveryFunding:funding}),a=result.allocation,j=prepareFullCashJournal(result);
 assert.equal(a.customerTotal.minorAmount,8000000);assert.equal(a.driverTotalEntitlement.minorAmount,3250000);assert.equal(a.merchantCommission.minorAmount,1050000);assert.equal(j.debit.minorAmount,j.credit.minorAmount);
 assert.equal(a.customerTotal.minorAmount,a.merchantPayable.minorAmount+a.driverTotalEntitlement.minorAmount+a.platformNetContribution.minorAmount);
 assert.equal(a.merchantDeliverySupport.minorAmount,kind==='MERCHANT'?1500000:kind==='SHARED_RATIO'?750000:0);
 assert.equal(a.platformDeliveryPromotionFunding.minorAmount,agreement.allocation.platformShare.minorAmount+promotion.allocation.platformShare.minorAmount);
});
test('283 rejects changed totals, components and pins',()=>{const f=compose(calculateStoreDeliveryAgreement(contract(),m('2000')),extra());for(const edit of [x=>x.allocation.platformShare.minorAmount++,x=>x.components.reverse(),x=>x.components[1].allocation.referenceFee.minorAmount++,x=>x.components.push(x.components[1]),x=>x.extra=true,x=>x.components[1].policyPin.termsHash='bad']){const x=structuredClone(f);edit(x);assert.throws(()=>verify(x));}assert.throws(()=>compose(calculateStoreDeliveryAgreement({...contract(),customerRule:{kind:'FREE'}},m('2000')),extra()));});
const benefit=()=>({discountId:'free',version:1,status:'active',isActive:true,startDate:'2026-01-01T00:00:00.000Z',endDate:'2030-01-01T00:00:00.000Z',benefit:{schemaVersion:1,kind:'FREE_DELIVERIES',amountIqd:0,usesPerCustomer:3,maximumPerOrderIqd:5000,minimumGoodsIqd:2000,maximumRoadMeters:10000,grantMode:'AUTO',audience:'ALL',branchIds:[],regionIds:['zone'],customerIds:[],allowGoodsStacking:false}});
for(const outcome of ['CAPTURED','RELEASED'])test('283 '+outcome+' plans both contract and entitlement once',async()=>{
 const f=memory(),p=contract(),at=Date.parse('2026-10-22T00:00:00.000Z'),b=budget({db:f.db,now:()=>at});
 const agreement=calculateStoreDeliveryAgreement(p,m('2000'));f.apply((await b.reserve({orderId:'order',customerId:'customer',policy:p,referenceFee:m('2000'),customerFee:m('1500')})).operations);
 const promo=await preparePlatformBenefit(f.db,{campaign:benefit(),facts:{sub:'subject',branchId:'branch',regionIds:['zone'],goodsMinor:7000000,roadMeters:2000,firstOrder:false,newCustomer:false,vip:false,inactive:false},referenceDeliveryMinor:1500000,orderId:'order',now:at});f.apply(promo.operations);
 f.put('WizzOrders',{PK:'ORDER#order',SK:'META',orderId:'order',status:'pending',platformDeliveryBenefitReceipt:promo.receipt});
 const funding=compose(agreement,promo.deliveryFunding),before=JSON.stringify([...f.rows]),plan=await b.settle({orderId:'order',outcome,expectedFunding:funding});assert.equal(JSON.stringify([...f.rows]),before);assert.equal(plan.operations.length,3);f.apply(plan.operations);
 assert.equal((await b.settle({orderId:'order',outcome,expectedFunding:funding})).replayed,true);await assert.rejects(b.settle({orderId:'order',outcome:outcome==='CAPTURED'?'RELEASED':'CAPTURED',expectedFunding:funding}));
 const balance=await platformBenefitBalance(f.db,benefit(),'subject');assert.equal(balance.reserved,0);assert.equal(balance.used,outcome==='CAPTURED'?1:0);
});
