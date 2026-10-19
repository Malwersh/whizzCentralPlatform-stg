const {test}=require('node:test'),assert=require('node:assert/strict');
const {setup}=require('./helpers/quote-order-handler-fixture.cjs');
const consent=p=>({digest:p.json.commercial.digest,customerTotalMinor:p.json.commercial.customerTotal.minorAmount});
const get=(f,pk,sk)=>f.commercialRecords.get('staging-PlatformStaff|'+JSON.stringify({pk,sk}));
test('actual handler previews chosen fee without writes then commits original customer and campaign atomically',async()=>{
 const f=await setup();f.enableDeliveryPromotions();const before=f.transactions.length;
 const p=await f.invoke({action:'preview_commercial'});assert.equal(p.statusCode,200,JSON.stringify(p.json));
 assert.equal(p.json.commercial.schemaVersion,2);assert.equal(p.json.commercial.referenceDeliveryFee.minorAmount,3100000);assert.equal(p.json.commercial.deliveryFunding,undefined);
 assert.equal(p.json.commercial.deliveryFee.minorAmount,1500000);assert.equal(p.json.commercial.customerTotal.minorAmount,5500000);
 assert.equal(f.transactions.length,before);assert.equal(get(f,'DELIVERY_BUDGET#delivery','VERSION#1').merchantReserved,0);
 const patch={commercialConsent:consent(p)},r=await f.invoke(patch);assert.equal(r.statusCode,201,JSON.stringify(r.json));
 assert.equal(r.json.order.deliveryQuote.deliveryFundingPin,undefined);
 assert.equal(r.json.order.pricing.deliveryFee,1500000);assert.equal(r.json.order.pricing.total,5500000);
 const saved=[...f.orders.values()][0];assert.equal(saved.financialSnapshot.schemaVersion,2);assert.equal(saved.commercialPricing.schemaVersion,2);
 assert.equal(get(f,'DELIVERY_RESERVATION#'+r.json.orderId,'META').customerId,'u1');
 assert.equal(get(f,'DELIVERY_BUDGET#delivery','VERSION#1').merchantReserved,1600000);
 const retry=await f.invoke(patch);assert.equal(retry.statusCode,200,JSON.stringify(retry.json));assert.equal(retry.json.replayed,true);
 assert.equal(get(f,'DELIVERY_BUDGET#delivery','VERSION#1').merchantReserved,1600000);
});
test('actual handler platform-funded delivery reserves cash once with the order',async()=>{
 const f=await setup();f.enableDeliveryPromotions('PLATFORM');const p=await f.invoke({action:'preview_commercial'});
 assert.equal(p.statusCode,200,JSON.stringify(p.json));const r=await f.invoke({commercialConsent:consent(p)});assert.equal(r.statusCode,201,JSON.stringify(r.json));
 const wallet=f.commercialRecords.get('staging-Wallets|'+JSON.stringify({walletId:'WALLET#PLATFORM',sk:'META'}));assert.equal(wallet.lockedBalance,1600);
 assert.equal([...f.commercialRecords.values()].filter(v=>v.sk==='DELIVERY_PROMOTION_FUNDING').length,1);
});
test('first-order eligibility uses server history and rejects client claims',async()=>{
 const f=await setup();f.enableDeliveryPromotions('MERCHANT','NEW_CUSTOMER');
 f.journey.set('USER#sub1|ORDERS',{pk:'USER#sub1',sk:'ORDERS',count:1,version:1});
 const p=await f.invoke({action:'preview_commercial',isNewCustomer:true,customerUses:0});assert.equal(p.statusCode,200,JSON.stringify(p.json));
 assert.equal(p.json.commercial.deliveryFee.minorAmount,3100000);
});
test('counter race rolls back order, campaign budget and reservation together',async()=>{
 const f=await setup();f.enableDeliveryPromotions('MERCHANT','NEW_CUSTOMER');const p=await f.invoke({action:'preview_commercial'});
 assert.equal(p.statusCode,200,JSON.stringify(p.json));
 f.beforeTransaction=()=>f.journey.set('USER#sub1|ORDERS',{pk:'USER#sub1',sk:'ORDERS',count:1,version:1});
 const r=await f.invoke({commercialConsent:consent(p)});assert.equal(r.statusCode,409,JSON.stringify(r.json));assert.equal(f.orders.size,0);
 assert.equal(get(f,'DELIVERY_BUDGET#delivery','VERSION#1').merchantReserved,0);
 assert.equal([...f.commercialRecords.values()].filter(v=>v.pk?.startsWith('DELIVERY_RESERVATION#')).length,0);
});
test('promotion mode fails closed without required canonical quote and commercial modes',async()=>{
 const f=await setup();f.env.DELIVERY_PROMOTION_MODE='REQUIRED';assert.equal((await f.invoke()).statusCode,503);assert.equal(f.orders.size,0);
});
