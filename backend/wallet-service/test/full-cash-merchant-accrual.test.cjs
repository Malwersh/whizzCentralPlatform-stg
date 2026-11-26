'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),ready=require('./helpers/full-cash-flow-fixture.cjs');
const {createFullCashCompletion}=require('../dist/fullCashCompletion');
const {readMerchantAccrualEvidence}=require('../dist/merchantSettlementPreview');
const {summarizeMerchantAccruals}=require('../dist/merchantSettlementAccrual');
async function delivered(){const f=await ready(),o=f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'});o.status=o.orderStatus='arrived_at_customer';await createFullCashCompletion({db:f.db,enabled:true,now:()=>f.time,authenticateDriver:async()=>({driverId:'driver1',subjectId:'driver1'})}).complete({orderId:'order1',cashCollected:true});return f;}
test('new cash merchant statement verifies complete posted GL and preserves merchant payable',async()=>{
 const f=await delivered(),p=await readMerchantAccrualEvidence(f.db,'branch1','order1');
 assert.equal(p.accrual.schemaVersion,4);assert.equal(p.accrual.amounts.merchantNet.minorAmount,7875000);
 assert.equal(p.accrual.amounts.platformNetContribution.minorAmount,825000);
 const total=summarizeMerchantAccruals('branch1',[p.accrual]);assert.equal(total.amounts.merchantNet.minorAmount,7875000);
 assert.equal(p.accrual.payoutAuthorized,false);
});
test('tampered GL cannot be used to prove merchant settlement rights',async()=>{
 const f=await delivered();f.get('staging-MerchantPlatform',{pk:'FULL_CASH_JOURNAL#order1',sk:'META'}).funding.platformNetContribution.minorAmount++;
 await assert.rejects(readMerchantAccrualEvidence(f.db,'branch1','order1'));
});
test('first completed order creates an empty merchant wallet and accrues only proven rights atomically',async()=>{
 const f=await ready(),o=f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'});o.status=o.orderStatus='arrived_at_customer';
 for(const [k,v]of f.rows)if(v.walletId==='WALLET#MERCHANT#branch1'&&v.sk==='META')f.rows.delete(k);
 await createFullCashCompletion({db:f.db,enabled:true,now:()=>f.time,authenticateDriver:async()=>({driverId:'driver1',subjectId:'driver1'})}).complete({orderId:'order1',cashCollected:true});
 const w=f.get('staging-Wallets',{walletId:'WALLET#MERCHANT#branch1',sk:'META'});assert.equal(w.availableBalance,0);assert.equal(w.lockedBalance,7875);assert.equal(w.version,1);
 assert.equal((await readMerchantAccrualEvidence(f.db,'branch1','order1')).accrual.amounts.merchantNet.minorAmount,7875000);
});
test('recorded zero-adjustment rounding is verified consistently with completion and tampering stays rejected',async()=>{
 const f=await ready(),o=f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'});
 o.commercialPricing.cashRounding=require('../dist/cashRounding').calculateCashRounding({policy:{schemaVersion:1,enabled:false,incrementIqd:250,mode:'UP',minimumServiceFeeIqd:250,minimumConflict:'NEXT_COLLECTIBLE_TOTAL'},version:1,paymentMethod:'COD',customerTotal:o.financialSnapshot.order.confirmedCustomerTotal,baseServiceFee:o.financialSnapshot.order.allocation.serviceFee});
 f.get('staging-Holds',{orderId:'order1',sk:'FULL_CASH_FUNDING_COMMITMENT'}).cashRounding=structuredClone(o.commercialPricing.cashRounding);
 o.status=o.orderStatus='arrived_at_customer';
 await createFullCashCompletion({db:f.db,enabled:true,now:()=>f.time,authenticateDriver:async()=>({driverId:'driver1',subjectId:'driver1'})}).complete({orderId:'order1',cashCollected:true});
 assert.equal((await readMerchantAccrualEvidence(f.db,'branch1','order1')).accrual.amounts.merchantNet.minorAmount,7875000);
 f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'}).commercialPricing.cashRounding.digest='bad';await assert.rejects(readMerchantAccrualEvidence(f.db,'branch1','order1'));
});
