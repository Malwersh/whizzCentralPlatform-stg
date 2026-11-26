'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{setup}=require('./helpers/driver-financial-fixture.cjs');
const {createMerchantPendingResponse:create}=require('../dist/merchantPendingResponse'),{fromWholeIqd:m}=require('../dist/money');
function pending(){
 const f=setup('2750',undefined,'order1',{enableFullCash:true}),at=new Date(f.time).toISOString(),order=f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'}),branch=f.get('WhizzMerchants_Businesses',{businessId:'branch1'});
 Object.assign(order,{status:'pending',paymentMethod:'cash',paymentStatus:'pending',createdAt:at,merchantAcceptanceDeadlineAt:new Date(f.time+300000).toISOString(),merchantResponsePolicy:{schemaVersion:1,acceptanceSeconds:300,autoAccept:true,defaultPreparationMinutes:20},storeStatus:'branch1#pending#b1',holdId:null,holdAmount:0,holdStatus:'NONE',commercialPricing:{schemaVersion:1,funding:{amount:m(0),holdId:null,state:'BUDGET_COMMITTED_WITH_ORDER'}}});
 Object.assign(branch,{isActive:true,acceptingOrders:true,orderReceptionSettings:{autoAccept:true}});
 f.put('staging-WalletLifecycle',{operationId:'MERCHANT_RESPONSE#order1',kind:'MERCHANT_RESPONSE',orderId:'order1',branchId:'branch1',status:'PENDING',queuePartition:'MERCHANT_RESPONSE',nextAttemptAt:Math.floor(f.time/1000)});
 const engine=create({db:f.db,now:()=>f.time,enableFullCash:true,enableDeliveryFunding:true,authenticate:async()=>({kind:'SYSTEM',subjectId:'MERCHANT_RESPONSE_WORKER',businessId:'branch1',ownerId:'owner1',guards:[]})});return {f,engine};
}
test('pending full-cash timeout releases only budget commitment, without driver or platform cash',async()=>{
 const {f,engine}=pending();f.time+=300000;await engine.run('order1','EXPIRE');
 assert.equal(f.get('staging-Holds',{orderId:'order1',sk:'FULL_CASH_FUNDING_COMMITMENT'}).status,'RELEASED');
 assert.equal(f.get('staging-Holds',{orderId:'order1',sk:'FINANCIAL_OUTCOME'}).financialSchemaVersion,4);
 assert.equal(f.calls.some(c=>c.input.Key?.walletId==='WALLET#PLATFORM'),false);
 assert.equal((await engine.run('order1','EXPIRE')).replayed,true);
});
test('missing commitment prevents timeout from falsely reporting financial release',async()=>{
 const {f,engine}=pending();f.get('staging-Holds',{orderId:'order1',sk:'FULL_CASH_FUNDING_COMMITMENT'}).snapshotDigest='wrong';f.time+=300000;
 await assert.rejects(engine.run('order1','EXPIRE'));assert.equal(f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'}).status,'pending');
});
