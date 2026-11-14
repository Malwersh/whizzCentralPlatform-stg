const {test}=require('node:test'),assert=require('node:assert/strict');
const {preparePlatformBenefit,platformBenefitBalance}=require('../dist/platformBenefits');
const {TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const campaign={discountId:'goods-benefit',version:1,status:'active',isActive:true,startDate:'2026-01-01T00:00:00.000Z',endDate:'2030-01-01T00:00:00.000Z',benefit:{schemaVersion:1,kind:'GOODS_AMOUNT',amountIqd:750,usesPerCustomer:1,maximumPerOrderIqd:750,minimumGoodsIqd:0,maximumRoadMeters:10000,grantMode:'AUTO',audience:'ALL',branchIds:[],regionIds:[],customerIds:[],allowGoodsStacking:true}};
async function reserve(f){const p=await preparePlatformBenefit(f.db,{campaign,facts:{sub:'customer',branchId:'branch1',regionIds:[],goodsMinor:10000000,firstOrder:false,newCustomer:false,vip:false,inactive:false},orderId:'order1',now:f.time});await f.db.send(new TransactWriteCommand({TransactItems:p.operations}));f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'}).platformBenefitReceipt=p.receipt;}
test('real COD completion commits voucher use atomically with wallet and financial outcome',async()=>{
 const f=await require('./helpers/delivery-funded-fixture.cjs').fixture('PLATFORM',750);await reserve(f);await f.completeV2();const b=await platformBenefitBalance(f.db,campaign,'customer');assert.equal(b.used,1);assert.equal(b.reserved,0);assert.equal(b.remaining,0);assert.equal((await f.completeV2()).replayed,true);assert.equal((await platformBenefitBalance(f.db,campaign,'customer')).used,1);
});
test('a racing voucher counter rolls back the entire COD completion',async()=>{
 const f=await require('./helpers/delivery-funded-fixture.cjs').fixture('PLATFORM',750);await reserve(f);f.beforeCommit=()=>{f.get('staging-WizzOfferJourney',{pk:'USER#customer',sk:'BENEFIT#goods-benefit'}).version++;};await assert.rejects(f.completeV2());assert.equal(f.get('staging-Holds',{orderId:'order1',sk:'FINANCIAL_OUTCOME'}),undefined);assert.equal(f.get('staging-WizzOfferJourney',{pk:'BENEFIT_ORDER#order1',sk:'GOODS'}).status,'RESERVED');
});
test('real financial release preserves accepted use without separate writes',async()=>{
 const {prepareCodRelease}=require('../dist/financialRelease');
 {
  const f=await require('./helpers/delivery-funded-driver-fixture.cjs').fixture(true,'PLATFORM',750);await reserve(f);await f.run();await f.accept();const order=f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'}),saved=f.get('WaveOffers_staging',{orderId:'order1',SK:'FINANCIAL#driver1#WAVE#1'});const {verifyDeliveryFundedAssignment}=require('../dist/deliveryFundedOffer'),v=verifyDeliveryFundedAssignment(order,saved,'driver1'),offer={...v.baseOffer,digest:v.digest,allocation:v.allocation};
  const before=f.calls.filter(c=>c.input.TransactItems).length,p=await prepareCodRelease(f.db,order,offer,new Date(f.time).toISOString(),'CR:benefit',true,true);assert.equal(f.calls.filter(c=>c.input.TransactItems).length,before);await f.db.send(new TransactWriteCommand({TransactItems:p.operations}));const b=await platformBenefitBalance(f.db,campaign,'customer');assert.equal(b.used,1);assert.equal(b.reserved,0);
 }
});

test('pending merchant rejection releases voucher and wallet funding in one transaction',async()=>{
 const f=await require('./helpers/delivery-funded-driver-fixture.cjs').fixture(true,'PLATFORM',750);await reserve(f);const order=f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'}),branch=f.get('WhizzMerchants_Businesses',{businessId:'branch1'});
 Object.assign(order,{status:'pending',orderStatus:'pending',paymentMethod:'cod',paymentStatus:'pending',merchantAcceptanceDeadlineAt:new Date(f.time+300000).toISOString(),merchantResponsePolicy:{schemaVersion:1,acceptanceSeconds:300,autoAccept:true,defaultPreparationMinutes:20},storeStatus:'branch1#pending#b1',holdId:null,holdAmount:0,holdStatus:'NONE'});
 Object.assign(order.commercialPricing,{schemaVersion:2,deliveryFunding:order.financialSnapshot.deliveryFunding});Object.assign(branch,{isActive:true,acceptingOrders:true,orderReceptionSettings:{schemaVersion:1,autoAccept:true,defaultPreparationMinutes:20}});
 f.put('staging-WalletLifecycle',{operationId:'MERCHANT_RESPONSE#order1',kind:'MERCHANT_RESPONSE',merchantResponseSchemaVersion:1,orderId:'order1',branchId:'branch1',ownerId:'owner1',status:'PENDING',queuePartition:'MERCHANT_RESPONSE',nextAttemptAt:Math.floor(f.time/1000)});
 const engine=require('../dist/merchantPendingResponse').createMerchantPendingResponse({db:f.db,now:()=>f.time,enableDeliveryFunding:true,authenticate:async()=>({kind:'MERCHANT',subjectId:'owner1',businessId:'branch1',ownerId:'owner1',guards:[]})});
 await engine.run('order1','REJECT','صنف غير متوفر');const b=await platformBenefitBalance(f.db,campaign,'customer');assert.equal(b.remaining,1);assert.equal(b.used,0);assert.equal(b.reserved,0);assert.equal(f.get('staging-Wallets',{walletId:'WALLET#PLATFORM',sk:'META'}).lockedBalance,0);assert.equal((await engine.run('order1','REJECT','صنف غير متوفر')).replayed,true);
});
