const {test}=require('node:test'),assert=require('node:assert/strict');
const {setup}=require('./helpers/driver-financial-fixture.cjs');const {parseIqd:m}=require('../dist/money');
const {calculatePolicyDeliveryFunding:calculate}=require('../dist/deliveryFundingPolicy');const {deliveryCampaignBudgetInitialization:init,createStagingDeliveryCampaignBudget:budget}=require('../dist/deliveryCampaignBudget');
const {preparePlatformPromotionFunding:cash}=require('../dist/platformPromotionFunding');const {createStagingCodCompletion:complete}=require('../dist/codCompletion');const {createStagingCodReassignment:reassign}=require('../dist/codReassignment');
const {deriveMerchantCodAccrual:accrual}=require('../dist/merchantSettlementAccrual');
const {TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {fixture}=require('./helpers/delivery-funded-driver-fixture.cjs');
const getOrder=f=>f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'});
test('real wave issuance and atomic acceptance preserve funding, then complete and prove merchant accrual',async()=>{
 const f=await fixture();await f.run();assert.equal(f.sent.length,2);assert.equal(f.sent[0].message.offer.schemaVersion,2);assert.equal(f.sent[0].message.offer.deliveryFunding,undefined);await f.accept();
 const order=getOrder(f);assert.equal(order.financialAcceptance.schemaVersion,2);assert.equal(f.get('staging-PlatformStaff',{pk:'DELIVERY_USAGE#delivery',sk:'CUSTOMER#customer'}).reservedUses,1);order.status='arrived_at_customer';
 await complete({db:f.db,now:()=>f.time,enableDeliveryFunding:true,authenticateDriver:async()=>({driverId:'driver1',subjectId:'driver1'})}).complete({orderId:'order1',cashCollected:true});
 const line=accrual({branchId:'branch1',order:getOrder(f),acceptedOffer:f.get('WaveOffers_staging',{orderId:'order1',SK:'FINANCIAL#driver1#WAVE#1'}),outcome:f.get('staging-Holds',{orderId:'order1',sk:'FINANCIAL_OUTCOME'}),payable:f.get('staging-Holds',{orderId:'order1',sk:'MERCHANT_PAYABLE'})});assert.equal(line.amounts.merchantNet.minorAmount,9500000);assert.equal(line.amounts.merchantDeliverySupport.minorAmount,500000);
});
test('two simultaneous driver accepts choose one winner and one wallet hold',async()=>{
 const f=await fixture();await f.run();const results=await Promise.allSettled([f.accept('driver1'),f.accept('driver2')]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal([...f.rows.values()].filter(x=>x.action==='FINANCIAL_DRIVER_OFFER_ACCEPTED').length,1);assert.equal(f.get('staging-PlatformStaff',{pk:'DELIVERY_USAGE#delivery',sk:'CUSTOMER#customer'}).reservedUses,1);
});
test('missing or raced funding blocks acceptance without driver debit',async()=>{
 for(const mode of ['cash','race']){const f=await fixture();await f.run();if(mode==='cash')f.get('staging-Holds',{orderId:'order1',sk:'DELIVERY_PROMOTION_FUNDING'}).amount=1;else f.beforeCommit=()=>f.get('staging-PlatformStaff',{pk:'DELIVERY_RESERVATION#order1',sk:'META'}).version++;
 await assert.rejects(f.accept());assert.equal(f.get('staging-Wallets',{walletId:'WALLET#DRIVER#driver1',sk:'META'}).availableBalance,20000);assert.equal(getOrder(f).driverId,undefined);}
});
test('new wave after unassignment uses original funding without a second campaign reservation',async()=>{
 const f=await fixture();await f.run();await f.accept();getOrder(f).status='arrived_at_store';const offerId=getOrder(f).financialAcceptance.offerId;
 await reassign({db:f.db,now:()=>f.time,enableDeliveryFunding:true,reassignmentWindowSeconds:120,authenticate:async()=>({kind:'DRIVER',subjectId:'driver1'})}).unassign({orderId:'order1',offerId,attempt:1,cashCollected:false,reason:'VehicleIssue'});
 await f.wave.run({orderId:'order1',branchId:'branch1',waveNumber:2,driverIds:['driver2']});const message=f.sent.find(x=>x.driverId==='driver2'&&x.message.waveNumber===2);
 const {createStagingDriverOfferAcceptance:create}=require('../dist/driverOfferAcceptance');await create({db:f.db,context:f.context,enableDeliveryFunding:true,now:()=>f.time,authenticateDriver:async()=>({driverId:'driver2',subjectId:'driver2'})}).accept({orderId:'order1',waveNumber:2,offerId:message.message.offer.offerId});
 assert.equal(getOrder(f).assignmentAttemptCounter,2);assert.equal(getOrder(f).driverId,'driver2');assert.equal(f.get('staging-PlatformStaff',{pk:'DELIVERY_USAGE#delivery',sk:'CUSTOMER#customer'}).reservedUses,1);
});
test('default capability cannot issue V2 offers',async()=>{const f=await fixture(false);await assert.rejects(f.run());assert.equal(f.sent.length,0);});
