const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixture:funded}=require('./helpers/delivery-funded-driver-fixture.cjs');
const {createMerchantPendingResponse:create}=require('../dist/merchantPendingResponse');
const orderKey={PK:'ORDER#order1',SK:'META'};
async function fixture(split='SHARED',goods=0){
 const f=await funded(true,split,goods),o=f.get('WizzOrders',orderKey),b=f.get('WhizzMerchants_Businesses',{businessId:'branch1'});
 Object.assign(o,{status:'pending',orderStatus:'pending',paymentMethod:'cod',paymentStatus:'pending',merchantAcceptanceDeadlineAt:new Date(f.time+300000).toISOString(),merchantResponsePolicy:{schemaVersion:1,acceptanceSeconds:300,autoAccept:true,defaultPreparationMinutes:20},storeStatus:'branch1#pending#b1',holdId:null,holdAmount:0,holdStatus:'NONE'});
 Object.assign(o.commercialPricing,{schemaVersion:2,deliveryFunding:o.financialSnapshot.deliveryFunding});Object.assign(b,{isActive:true,acceptingOrders:true,orderReceptionSettings:{schemaVersion:1,autoAccept:true,defaultPreparationMinutes:20}});
 f.put('staging-WalletLifecycle',{operationId:'MERCHANT_RESPONSE#order1',kind:'MERCHANT_RESPONSE',merchantResponseSchemaVersion:1,orderId:'order1',branchId:'branch1',ownerId:'owner1',status:'PENDING',queuePartition:'MERCHANT_RESPONSE',nextAttemptAt:Math.floor(f.time/1000)});
 f.engine=(kind='SYSTEM',enabled=true)=>create({db:f.db,now:()=>f.time,enableDeliveryFunding:enabled,authenticate:async()=>({kind,subjectId:kind==='SYSTEM'?'MERCHANT_RESPONSE_WORKER':'owner1',businessId:'branch1',ownerId:'owner1',guards:[]})});return f;
}
const reserve=f=>f.get('staging-PlatformStaff',{pk:'DELIVERY_RESERVATION#order1',sk:'META'});
const driver=f=>JSON.stringify([...f.rows].filter(([k])=>k.startsWith('staging-Wallets|')&&k.includes('DRIVER')));
test('customer cancellation releases combined goods/delivery reservations without touching driver or merchant wallets',async()=>{
 for(const split of ['MERCHANT','PLATFORM','SHARED']){
  const f=await fixture(split,700),o=f.get('WizzOrders',orderKey);
  Object.assign(o,{userId:'customer',userSub:'subject',isGuestOrder:false});
  f.put('WizzUser_users_staging',{userId:'customer',version:1});
  const before=driver(f),merchant=JSON.stringify(f.get('staging-Wallets',{walletId:'WALLET#MERCHANT#branch1',sk:'META'}));
  const engine=create({db:f.db,now:()=>f.time,enableDeliveryFunding:true,authenticate:async()=>({kind:'CUSTOMER',subjectId:'subject',customerId:'customer',businessId:'branch1',ownerId:'owner1',
   guards:[{ConditionCheck:{TableName:'WizzUser_users_staging',Key:{userId:'customer'},ConditionExpression:'#v=:v',ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':v':1}}}]})});
  await engine.run('order1','CUSTOMER_CANCEL','reason');
  assert.equal(reserve(f).status,'RELEASED');assert.equal(driver(f),before);
  assert.equal(JSON.stringify(f.get('staging-Wallets',{walletId:'WALLET#MERCHANT#branch1',sk:'META'})),merchant);
  const wallet=f.get('staging-Wallets',{walletId:'WALLET#PLATFORM',sk:'META'});
  assert.equal(wallet.availableBalance,10000);assert.equal(wallet.lockedBalance,0);
  assert.equal((await engine.run('order1','CUSTOMER_CANCEL','reason')).replayed,true);
 }
});
test('pending V2 expiry or merchant rejection releases original campaign and platform cash once',async()=>{
 for(const split of ['MERCHANT','PLATFORM','SHARED'])for(const mode of ['EXPIRE','REJECT']){
  const f=await fixture(split),before=driver(f);if(mode==='EXPIRE')f.time+=300000;
  const engine=f.engine(mode==='REJECT'?'MERCHANT':'SYSTEM');await engine.run('order1',mode,'صنف غير متوفر');
  assert.equal(f.get('WizzOrders',orderKey).status,mode==='EXPIRE'?'expired':'cancelled');assert.equal(reserve(f).status,'RELEASED');assert.equal(f.get('staging-PlatformStaff',{pk:'DELIVERY_USAGE#delivery',sk:'CUSTOMER#customer'}).reservedUses,0);
  const wallet=f.get('staging-Wallets',{walletId:'WALLET#PLATFORM',sk:'META'});assert.equal(wallet.availableBalance,10000);assert.equal(wallet.lockedBalance,0);assert.equal(driver(f),before);
  assert.equal(f.get('staging-Holds',{orderId:'order1',sk:'MERCHANT_PAYABLE'}),undefined);const journal=f.get('staging-Holds',{orderId:'order1',sk:'FINANCIAL_OUTCOME'});assert.equal(journal.financialSchemaVersion,3);assert.equal(journal.journalLines.reduce((n,l)=>n+l.delta,0),0);
  assert.equal((await engine.run('order1',mode,'صنف غير متوفر')).replayed,true);assert.equal(wallet.availableBalance,10000);
 }
});
test('automatic acceptance preserves all original reservations for dispatch',async()=>{
 const f=await fixture(),before=JSON.stringify([...f.rows].filter(([k])=>/^(staging-Wallets|staging-PlatformStaff|staging-Holds|staging-LedgerEntries)\|/.test(k)));
 await f.engine().run('order1','AUTO_ACCEPT');assert.equal(f.get('WizzOrders',orderKey).status,'confirmed');assert.equal(reserve(f).status,'RESERVED');
 assert.equal(JSON.stringify([...f.rows].filter(([k])=>/^(staging-Wallets|staging-PlatformStaff|staging-Holds|staging-LedgerEntries)\|/.test(k))),before);
});
test('capability off and changed original funding block release without partial mutations',async()=>{
 for(const tamper of [false,true]){
  const f=await fixture();f.time+=300000;if(tamper)f.get('WizzOrders',orderKey).commercialPricing.deliveryFunding.policyPin.policyId='foreign';
  await assert.rejects(f.engine('SYSTEM',tamper).run('order1','EXPIRE'));assert.equal(reserve(f).status,'RESERVED');assert.equal(f.get('staging-Holds',{orderId:'order1',sk:'FINANCIAL_OUTCOME'}),undefined);
 }
});
test('campaign version conflict or simultaneous manual acceptance rolls back pending release',async()=>{
 for(const race of ['budget','accept']){
  const f=await fixture();f.time+=300000;f.beforeCommit=()=>{if(race==='accept')f.get('WizzOrders',orderKey).status='confirmed';else f.get('staging-PlatformStaff',{pk:'DELIVERY_BUDGET#delivery',sk:'VERSION#1'}).version++;};
  await assert.rejects(f.engine().run('order1','EXPIRE'));assert.equal(reserve(f).status,'RESERVED');assert.equal(f.get('staging-Wallets',{walletId:'WALLET#PLATFORM',sk:'META'}).lockedBalance,500);
 }
});

test('pending combined goods and delivery promotions release one platform wallet update and both original holds',async()=>{
 const f=await fixture('SHARED',700);f.time+=300000;
 await f.engine().run('order1','EXPIRE');
 const wallet=f.get('staging-Wallets',{walletId:'WALLET#PLATFORM',sk:'META'});assert.equal(wallet.availableBalance,10000);assert.equal(wallet.lockedBalance,0);
 for(const sk of ['PROMOTION_FUNDING','DELIVERY_PROMOTION_FUNDING'])assert.equal(f.get('staging-Holds',{orderId:'order1',sk}).status,'RELEASED');
 const tx=f.calls.at(-1).input.TransactItems;assert.equal(tx.filter(o=>o.Update?.TableName==='staging-Wallets').length,1);assert.equal(reserve(f).status,'RELEASED');
});
test('concurrent expiry and lost acknowledgement cannot release campaign or cash twice',async()=>{
 for(const lost of [false,true]){
  const f=await fixture();f.time+=300000;
  if(lost){const send=f.db.send;let once=false;f.db.send=async c=>{const result=await send(c);if(!once&&c.input.TransactItems?.some(o=>o.Put?.Item.kind==='MERCHANT_PENDING_CANCEL_JOURNAL')){once=true;throw Error('synthetic lost acknowledgement');}return result;};}
  await Promise.allSettled([f.engine().run('order1','EXPIRE'),f.engine().run('order1','EXPIRE')]);
  assert.equal((await f.engine().run('order1','EXPIRE')).replayed,true);
  assert.equal(f.get('staging-Wallets',{walletId:'WALLET#PLATFORM',sk:'META'}).availableBalance,10000);
  assert.equal([...f.rows.values()].filter(r=>r.kind==='MERCHANT_PENDING_CANCEL_JOURNAL').length,1);assert.equal(reserve(f).status,'RELEASED');
 }
});
