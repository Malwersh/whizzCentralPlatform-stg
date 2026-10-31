const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./helpers/delivery-funded-fixture.cjs');const {w}=require('./helpers/cod-fixture.cjs');
const {createStagingCodReassignment:reassign}=require('../dist/codReassignment');const {createStagingCodReturn:returns}=require('../dist/codReturn');
const driver={kind:'DRIVER',subjectId:'driver1'},owner={kind:'MERCHANT_OWNER',subjectId:'owner1'};
const selector=f=>({orderId:'order1',offerId:f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'}).financialAcceptance.offerId,attempt:1});
const assignment=(f,actor=owner,enabled=true)=>reassign({db:f.db,authenticate:async()=>actor,now:()=>f.time,reassignmentWindowSeconds:120,enableDeliveryFunding:enabled});
const returning=(f,actor=driver)=>returns({db:f.db,authenticate:async()=>actor,now:()=>f.time,enableDeliveryFunding:true});
const campaign=f=>f.get('staging-PlatformStaff',{pk:'DELIVERY_RESERVATION#order1',sk:'META'});
async function before(){const f=await fixture();f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'}).status='arrived_at_store';return f;}
async function arrival(f){const v=selector(f),r=await returning(f).requestReturn({...v,reason:'CUSTOMER_UNREACHABLE',cashCollected:false});await returning(f).arriveReturn({...v,returnId:r.returnId});return {...v,branchId:'branch1',returnId:r.returnId,expectedVersion:2,allItemsReceived:true,condition:'INTACT',driverResponsibility:'NONE',cashCollected:false};}
test('before-pickup cancellation atomically releases driver cash, both campaign shares and use',async()=>{
 const f=await before(),v={...selector(f),branchId:'branch1',goodsRetainedByBranch:true,cashCollected:false};await assignment(f).cancelBeforePickup(v);
 assert.equal(campaign(f).status,'RELEASED');assert.equal(w(f,'WALLET#DRIVER#driver1').availableBalance,20000);assert.equal(w(f,'WALLET#PLATFORM').availableBalance,10000);assert.equal(w(f,'WALLET#PLATFORM').lockedBalance,0);
 assert.equal(f.get('staging-Holds',{orderId:'order1',sk:'MERCHANT_PAYABLE'}),undefined);assert.equal(f.get('staging-PlatformStaff',{pk:'DELIVERY_USAGE#delivery',sk:'CUSTOMER#customer'}).reservedUses,0);
 const outcome=f.get('staging-Holds',{orderId:'order1',sk:'FINANCIAL_OUTCOME'});assert.equal(outcome.schemaVersion,2);assert.equal(outcome.journalLines.reduce((s,r)=>s+r.delta,0),0);assert.equal((await assignment(f).cancelBeforePickup(v)).replayed,true);
});
test('driver unassignment preserves order promotion funding and usage for the next assignment',async()=>{
 const f=await before(),pw=structuredClone(w(f,'WALLET#PLATFORM'));await assignment(f,driver).unassign({...selector(f),reason:'VehicleIssue',cashCollected:false});
 assert.equal(campaign(f).status,'RESERVED');assert.deepEqual(w(f,'WALLET#PLATFORM'),pw);assert.equal(f.get('staging-Holds',{orderId:'order1',sk:'DELIVERY_PROMOTION_FUNDING'}).status,'ACTIVE');assert.equal(f.get('staging-PlatformStaff',{pk:'DELIVERY_USAGE#delivery',sk:'CUSTOMER#customer'}).reservedUses,1);
 assert.equal(w(f,'WALLET#DRIVER#driver1').lockedBalance,0);assert.equal(f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'}).status,'ready_for_pickup');
});
test('clean returned-goods receipt releases funding without paying merchant or driver earning',async()=>{
 const f=await fixture(),v=await arrival(f),r=await returning(f,owner).confirmReceipt(v);assert.equal(r.status,'CONFIRMED');assert.equal(campaign(f).status,'RELEASED');assert.equal(w(f,'WALLET#PLATFORM').availableBalance,10000);assert.equal(w(f,'WALLET#DRIVER#driver1').availableBalance,20000);assert.equal(w(f,'WALLET#MERCHANT#branch1').lockedBalance,10);assert.equal((await returning(f,owner).confirmReceipt(v)).replayed,true);await assert.rejects(f.completeV2());
});
test('damaged return requires review and retains original funding/holds',async()=>{
 const f=await fixture(),v=await arrival(f),r=await returning(f,owner).confirmReceipt({...v,condition:'DAMAGED'});assert.equal(r.status,'REVIEW_REQUIRED');assert.equal(campaign(f).status,'RESERVED');assert.equal(f.get('staging-Holds',{orderId:'order1',sk:'DELIVERY_PROMOTION_FUNDING'}).status,'ACTIVE');assert.ok(w(f,'WALLET#DRIVER#driver1').lockedBalance>0);
});
test('cancellation capability closed by default and collected cash cannot auto-release',async()=>{
 const f=await before(),v={...selector(f),branchId:'branch1',goodsRetainedByBranch:true,cashCollected:false};await assert.rejects(assignment(f,owner,false).cancelBeforePickup(v));assert.equal(campaign(f).status,'RESERVED');
 const g=await fixture();g.get('WizzOrders',{PK:'ORDER#order1',SK:'META'}).cashCollected=true;await assert.rejects(returning(g).requestReturn({...selector(g),reason:'CUSTOMER_UNREACHABLE',cashCollected:false}));assert.equal(campaign(g).status,'RESERVED');
});
test('campaign conflict prevents partial cancellation release',async()=>{
 const f=await before();f.beforeCommit=()=>f.get('staging-PlatformStaff',{pk:'DELIVERY_BUDGET#delivery',sk:'VERSION#1'}).version++;
 await assert.rejects(assignment(f).cancelBeforePickup({...selector(f),branchId:'branch1',goodsRetainedByBranch:true,cashCollected:false}));assert.equal(campaign(f).status,'RESERVED');assert.ok(w(f,'WALLET#DRIVER#driver1').lockedBalance>0);assert.equal(f.get('staging-Holds',{orderId:'order1',sk:'FINANCIAL_OUTCOME'}),undefined);
});

test('merchant-only platform-only and combined goods funding all release exact original amounts',async()=>{
 for(const [split,goods]of [['MERCHANT',0],['PLATFORM',0],['SHARED',700]]){const f=await fixture(split,goods);f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'}).status='arrived_at_store';await assignment(f).cancelBeforePickup({...selector(f),branchId:'branch1',goodsRetainedByBranch:true,cashCollected:false});assert.equal(w(f,'WALLET#PLATFORM').availableBalance,10000);assert.equal(w(f,'WALLET#PLATFORM').lockedBalance,0);assert.equal(campaign(f).status,'RELEASED');}
});

test('suspended platform wallet can release its own reserved funds without enabling new spending',async()=>{
 const f=await before();w(f,'WALLET#PLATFORM').status='SUSPENDED';await assignment(f).cancelBeforePickup({...selector(f),branchId:'branch1',goodsRetainedByBranch:true,cashCollected:false});assert.equal(w(f,'WALLET#PLATFORM').availableBalance,10000);assert.equal(w(f,'WALLET#PLATFORM').status,'SUSPENDED');assert.equal(campaign(f).status,'RELEASED');
});
