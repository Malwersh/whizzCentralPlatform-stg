'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {setup}=require('./helpers/driver-financial-fixture.cjs');
const {fromWholeIqd:m}=require('../dist/money');
const {createFullCashCompletion}=require('../dist/fullCashCompletion');
function fixture(){const deliveryFunding={policyPin:{policyId:'p1',version:1,termsHash:'a'.repeat(64)},allocation:{schemaVersion:1,referenceFee:m(2500),customerFee:m(1500),subsidy:m(1000),merchantShare:m(0),platformShare:m(1000)}};return setup('2750',s=>{Object.assign(s.order.allocation,{goodsGross:m(10500),merchantGoodsDiscount:m(1050),merchantCommission:m(1575),customerDeliveryFee:m(1500),driverTip:m(500)});s.order.confirmedCustomerTotal=m(11950);},'order1',{enableFullCash:true,enableDeliveryFunding:true,deliveryFunding});}
test('real shared issuance and acceptance adapters honor V3 amounts and atomic completion',async()=>{const f=fixture();await f.run(['driver1']);const wire=f.sent[0].message.offer;assert.equal(wire.schemaVersion,3);assert.equal(wire.driverWalletHold.minorAmount,8700000);assert.equal(wire.driverCashRetained.minorAmount,3250000);const r=await f.accept();assert.equal(r.holdAmount,8700);const order=f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'});assert.equal(order.financialAcceptance.schemaVersion,3);assert.equal(f.get('staging-Holds',{orderId:'order1',sk:'HOLD'}).financialSchemaVersion,4);assert.equal(f.get('staging-Wallets',{walletId:'WALLET#DRIVER#driver1',sk:'META'}).availableBalance,11300);order.status=order.orderStatus='arrived_at_customer';order.commercialPricing={agreement:{id:'a1',version:1,termsHash:'a'.repeat(64)}};f.put('staging-Wallets',{walletId:'WALLET#MERCHANT#branch1',sk:'META',ownerType:'MERCHANT',ownerId:'branch1',currency:'IQD',status:'ACTIVE',availableBalance:0,lockedBalance:0,version:1});const completed=await createFullCashCompletion({db:f.db,enabled:true,now:()=>f.time,authenticateDriver:async()=>({driverId:'driver1',subjectId:'driver1'})}).complete({orderId:'order1',cashCollected:true});assert.equal(completed.retainedCash,3250);assert.equal(f.get('staging-Holds',{orderId:'order1',sk:'MERCHANT_PAYABLE'}).amount,7875);assert.equal(f.calls.some(c=>c.input.Key?.walletId==='WALLET#PLATFORM'),false);});
test('missing new-model capability cannot issue or accept a V3 order through legacy adapters',async()=>{const f=fixture();const {createStagingDriverOfferOrderReader}=require('../dist/driverOfferOrderReader');await assert.rejects(createStagingDriverOfferOrderReader({db:f.db,enableDeliveryFunding:true}).read({orderId:'order1',branchId:'branch1'}));});
test('general release guard admits atomic new-model journal and merchant accrual without a test-order allowlist',async()=>{
 const f=fixture();await f.run(['driver1']);await f.accept();
 const order=f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'}),{quoteHash}=require('../dist/deliveryQuoteRecord');
 order.userSub='new-customer';order.status=order.orderStatus='arrived_at_customer';order.commercialPricing={agreement:{id:'a1',version:1,termsHash:'a'.repeat(64)}};
 const release={id:'GENERAL_STAGING_FULL_CASH_V1',version:1,orders:[{orderId:'order1',branchId:'branch1',customerSubjectId:'new-customer'}]};
 order.financeRollout={schemaVersion:2,scopeId:release.id,version:1,digest:quoteHash({release:release.id,version:1,orders:release.orders})};
 const env={...require('./helpers/finance-rollout-fixture.cjs').scopeEnv(),FINANCE_GENERAL_RELEASE_MODE:'REQUIRED',FINANCIAL_SETTLEMENT_MODEL:'FULL_CASH_AT_DELIVERY_V1'};
 const rollout=require('../dist/financeRollout').createFinanceRollout({db:f.db,env,now:()=>f.time});
 let underlying;const guarded={send:async c=>{try{return await rollout.db.send(c);}catch(e){underlying=e;throw e;}}};
 await createFullCashCompletion({db:guarded,enabled:true,now:()=>f.time,authenticateDriver:async()=>({driverId:'driver1',subjectId:'driver1'})}).complete({orderId:'order1',cashCollected:true}).catch(e=>{throw underlying||e;});
 assert.equal(f.get('staging-Holds',{orderId:'order1',sk:'MERCHANT_PAYABLE'}).amount,7875);
 assert.equal(f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'}).status,'delivered');
});
test('funded goods exposure stays pinned through offer acceptance and completion without platform cash',async()=>{
 const {prepareGoodsPromotionExposure}=require('../dist/goodsPromotionExposure'),f=setup('3000',s=>{s.order.allocation.platformGoodsDiscount=m(500);s.order.confirmedCustomerTotal=m(14000);},'order1',{enableFullCash:true});
 const exposure=prepareGoodsPromotionExposure({discountId:'goods',version:1,type:'fixedAmount',value:1000,usageLimit:10},'PLATFORM',m(500));
 const o=f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'});o.commercialPricing={agreement:{id:'a1',version:1,termsHash:'a'.repeat(64)},funding:{exposure}};
 f.get('staging-Holds',{orderId:'order1',sk:'FULL_CASH_FUNDING_COMMITMENT'}).goodsExposure=exposure;
 await f.run(['driver1']);await f.accept();const assigned=f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'});assigned.status=assigned.orderStatus='arrived_at_customer';
 await createFullCashCompletion({db:f.db,enabled:true,now:()=>f.time,authenticateDriver:async()=>({driverId:'driver1',subjectId:'driver1'})}).complete({orderId:'order1',cashCollected:true});
 assert.equal(f.get('staging-Holds',{orderId:'order1',sk:'FULL_CASH_FUNDING_COMMITMENT'}).status,'CONSUMED');
 assert.equal(f.calls.some(c=>c.input.Key?.walletId==='WALLET#PLATFORM'),false);
});
