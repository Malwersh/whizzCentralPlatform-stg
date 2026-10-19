const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixture:quoteFixture,m}=require('./helpers/delivery-quote-fixture.cjs');const {createStagingQuoteOrder:create}=require('../dist/deliveryQuoteOrder');
const {deliveryCampaignBudgetInitialization:init,createStagingDeliveryCampaignBudget:budgets}=require('../dist/deliveryCampaignBudget');const {calculatePolicyDeliveryFunding:funding}=require('../dist/deliveryFundingPolicy');
const {prepareDeliveryFundedFinancialSnapshot:snapshot}=require('../dist/deliveryFundedOffer');
async function fixture(enabled=true){
 const f=quoteFixture(),quote=await f.create(),records=new Map(),key=k=>k.pk+'|'+k.sk;
 f.extraLookup=(t,k)=>t==='staging-PlatformStaff'&&k.pk!=='OPERATIONAL_SETTINGS#DELIVERY_PRICING'?(records.get(key(k))??null):undefined;
 f.extraPut=o=>{if(o.TableName!=='staging-PlatformStaff')return false;records.set(key(o.Item),structuredClone(o.Item));return true;};
 const service=create({db:f.db,authenticateCustomer:f.auth,now:()=>f.time,enableDeliveryFunding:enabled}),request={quoteId:quote.quoteId,branchId:'b1',addressId:'a1',requestId:'abcdefab-1234-4123-8123-123456789abc',requestContent:{userId:'u1',storeId:'b1',deliveryAddress:{id:'a1',latitude:31.925,longitude:44.457},items:[{id:'product',price:3500,quantity:1}]}};
 const prepared=await service.prepare(request),policy={schemaVersion:1,id:'delivery',version:1,merchantId:'org1',branchId:'b1',origin:'MERCHANT',effectiveFrom:'2026-10-01T00:00:00.000Z',effectiveTo:'2026-11-01T00:00:00.000Z',customerRule:{kind:'CAPPED_PRICE',amount:m('2100')},funding:{kind:'MERCHANT'},eligibility:{regionIds:['zone'],maximumRoadMeters:5000,minimumGoods:m('0'),minimumGoodsBasis:'GOODS_GROSS',audience:'ALL',goodsDiscountStacking:'ALLOW'},limits:{merchantPerOrder:m('1000'),platformPerOrder:m('0'),merchantBudget:m('10000'),platformBudget:m('0'),perCustomerUses:2},onUnavailable:'NORMAL_TARIFF'};
 const support=funding(policy,m('3100'),m('2100')),gen=init(policy).Put.Item;records.set(key(gen),gen);
 const plan=await budgets({db:f.db,now:()=>f.time}).reserve({orderId:prepared.orderId,customerId:'u1',policy,referenceFee:m('3100'),customerFee:m('2100')});
 const allocation={allocationSchemaVersion:1,paymentMethod:'COD',goodsGross:m('3500'),merchantGoodsDiscount:m('0'),platformGoodsDiscount:m('0'),merchantCommission:m('0'),serviceFee:m('0'),customerDeliveryFee:m('2100'),driverTip:m('0'),merchantOtherCharges:m('0'),platformOtherCharges:m('0'),thirdPartyOtherCharges:m('0')};
 const financialSnapshot=snapshot({order:{snapshotId:'snapshot',revision:1,orderId:prepared.orderId,branchId:'b1',merchantId:'org1',zoneId:'zone',cityId:'district',governorateId:'governorate',branchPoint:prepared.origin,customerPoint:prepared.destination,confirmedCustomerTotal:m('5600'),allocation,paymentEvidence:null},deliveryFunding:support});
 const order={PK:'ORDER#'+prepared.orderId,SK:'META',orderId:prepared.orderId,userId:'u1',userSub:'sub1',storeId:'b1',merchantId:'org1',isGuestOrder:false,currency:'IQD',deliveryType:'delivery',deliveryAddress:{lat:31.925,lng:44.457},restaurantLat:31.925,restaurantLng:44.457,status:'pending',pricing:{goodsSubtotal:3500000,deliveryFee:2100000,total:5600000,serviceFee:0,tip:0,discount:0,packagingFee:0,tax:0,rounding:0},financialSnapshot};
 return {f,records,prepared,service,request,order,support,plan};
}
test('discounted order quote consumption and campaign reservation commit atomically',async()=>{
 const x=await fixture(),r=await x.prepared.commit(x.order,x.plan.operations,x.support);assert.equal(r.order.deliveryQuote.kind,'DELIVERY_PROMOTION_BOUND');assert.equal(r.order.deliveryQuote.referenceDeliveryFee.minorAmount,3100000);assert.equal(r.order.deliveryQuote.deliveryFee.minorAmount,2100000);assert.equal(x.records.get('DELIVERY_RESERVATION#'+x.prepared.orderId+'|META').status,'RESERVED');assert.equal(x.f.orders.size,1);assert.equal(x.prepared.deliveryPromotionPricingRequest().context.branchId,'b1');
});
test('missing funding operations wrong identity or hidden V2 snapshot cannot bypass normal quote fee',async()=>{
 for(const kind of ['missing','identity','no-proof','wrong-fee','wrong-goods','wrong-location']){const x=await fixture();if(kind==='identity')x.plan.operations.find(o=>o.Put.Item.pk.startsWith('DELIVERY_RESERVATION#')).Put.Item.customerId='other';if(kind==='wrong-fee')x.order.pricing.deliveryFee=1000;if(kind==='wrong-goods')x.order.pricing.goodsSubtotal=1;if(kind==='wrong-location'){x.order.financialSnapshot=structuredClone(x.order.financialSnapshot);x.order.financialSnapshot.order.customerPoint.latitude=0;}
 await assert.rejects(x.prepared.commit(x.order,kind==='missing'?[]:x.plan.operations,kind==='no-proof'?undefined:x.support));assert.equal(x.f.orders.size,0);}
});
test('capability is server-only and default closed',async()=>{const x=await fixture(false);await assert.rejects(x.prepared.commit(x.order,x.plan.operations,x.support));assert.equal(x.f.orders.size,0);});
test('budget race cannot consume quote or create a partial order',async()=>{
 const x=await fixture();x.f.beforeTransaction=tx=>{if(tx.TransactItems.some(o=>o.Put?.TableName==='WizzOrders'))x.records.get('DELIVERY_BUDGET#delivery|VERSION#1').version++;};await assert.rejects(x.prepared.commit(x.order,x.plan.operations,x.support));assert.equal(x.f.orders.size,0);assert.equal([...x.f.saved.values()][0].consumption,undefined);
});
test('lost acknowledgement replays same discounted order without another reservation',async()=>{
 const x=await fixture();x.f.loseResponse=true;const r=await x.prepared.commit(x.order,x.plan.operations,x.support);const retry=await x.service.prepare(x.request);assert.deepEqual(retry.replayedOrder,r.order);assert.equal(x.records.get('DELIVERY_USAGE#delivery|CUSTOMER#u1').reservedUses,1);assert.equal(x.f.orders.size,1);
});
