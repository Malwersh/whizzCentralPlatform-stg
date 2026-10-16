const {test}=require('node:test'),assert=require('node:assert/strict');
const {createStagingCodCompletion}=require('../dist/codCompletion');
const {parseIqd}=require('../dist/money');
const {setup}=require('./helpers/driver-financial-fixture.cjs');
const {ready,w}=require('./helpers/cod-fixture.cjs');
test('COD completion settles H, funds locked merchant entitlement, commission and service revenue with balanced journal',async()=>{
 const f=await ready('2500',0,1000);const result=await f.complete();assert.equal(result.capturedAmount,11000);
 assert.equal(w(f,'WALLET#DRIVER#driver1').lockedBalance,0);assert.equal(w(f,'WALLET#DRIVER#driver1').availableBalance,9000);
 assert.equal(w(f,'WALLET#MERCHANT#branch1').availableBalance,100);assert.equal(w(f,'WALLET#MERCHANT#branch1').lockedBalance,9010);
 assert.equal(w(f,'WALLET#PLATFORM').availableBalance,7000);
 const journal=f.get('staging-Holds',{orderId:'order1',sk:'FINANCIAL_OUTCOME'});
 assert.equal(journal.journalLines.reduce((s,r)=>s+r.delta,0),0);
 assert.equal(journal.allocation.platformNetContribution.minorAmount,2000000);
 assert.equal(f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'}).status,'delivered');
 assert.equal(f.get('WizzDispatchJobs_staging',{orderId:'order1',SK:'METADATA'}).status,'completed');
 assert.equal(f.get('WizzDriverLiveState_staging',{driverId:'driver1'}).currentOrderId,null);
 assert.equal(f.get('staging-Holds',{orderId:'order1',sk:'MERCHANT_PAYABLE'}).status,'LOCKED_PENDING_SETTLEMENT');
});
test('E>D credits only difference, tip stays cash; reserved discount funds full merchant right once',async()=>{
 const f=await ready('4000',2000,1000);await f.complete();
 assert.equal(w(f,'WALLET#DRIVER#driver1').availableBalance,12500); // 20000 -8500 +1000
 assert.equal(w(f,'WALLET#PLATFORM').availableBalance,5500);assert.equal(w(f,'WALLET#PLATFORM').lockedBalance,0);
 assert.equal(w(f,'WALLET#MERCHANT#branch1').lockedBalance,9010);
 const a=f.get('staging-Holds',{orderId:'order1',sk:'FINANCIAL_OUTCOME'}).allocation;
 assert.equal(a.driverCashRetained.minorAmount,4000000);assert.equal(a.driverWalletCreditTotal.minorAmount,1000000);
 assert.equal(a.driverTotalEntitlement.minorAmount,5000000);
 assert.equal(f.get('staging-Holds',{orderId:'order1',sk:'PROMOTION_FUNDING'}).status,'SETTLED');
});
test('concurrent completion and lost response replay commit only one journal and wallet version',async()=>{
 const f=await ready();f.loseCompletion=true;
 const results=await Promise.all([f.complete(),f.complete()]);assert.ok(results.some(r=>r.replayed));
 f.time+=86400000;assert.equal((await f.complete()).replayed,true);
 assert.equal(w(f,'WALLET#DRIVER#driver1').version,3);assert.equal(w(f,'WALLET#MERCHANT#branch1').version,2);
 assert.equal([...f.rows.values()].filter(r=>r.action==='COD_ORDER_COMPLETED').length,1);
});
test('insufficient platform funding, missing merchant wallet, invalid hold and unconfirmed cash fail without terminal writes',async()=>{
 for(const kind of ['funding','merchant','hold','cash','callerAmount','agreement']){
  const f=await ready('9000');
  if(kind==='funding')w(f,'WALLET#PLATFORM').availableBalance=0;
  if(kind==='merchant')w(f,'WALLET#MERCHANT#branch1').status='SUSPENDED';
  if(kind==='hold')f.get('staging-Holds',{orderId:'order1',sk:'HOLD'}).status='RELEASED';
  if(kind==='agreement')delete f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'}).commercialPricing;
  await assert.rejects(f.complete(kind==='cash'?{cashCollected:false}:kind==='callerAmount'?{amount:1}:{}));
  assert.equal(f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'}).status,'arrived_at_customer');
  assert.equal(f.get('staging-Holds',{orderId:'order1',sk:'FINANCIAL_OUTCOME'}),undefined);
 }
});
test('cancellation, return, hold, wallet, deletion and audit races abort the entire completion',async()=>{
 for(const kind of ['cancel','return','wallet','hold','delete','audit']){
  const f=await ready();f.beforeCommit=tx=>{
   if(kind==='cancel')f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'}).status='cancelled';
   if(kind==='return')f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'}).returnStatus='REQUESTED';
   if(kind==='wallet')w(f,'WALLET#DRIVER#driver1').version++;
   if(kind==='hold')f.get('staging-Holds',{orderId:'order1',sk:'HOLD'}).status='RELEASED';
   if(kind==='delete')f.put('staging-AccountDeletion',{pk:'ACCOUNT_LIFECYCLE#DRIVER#driver1',sk:'META'});
   if(kind==='audit')f.put('staging-AuditLog',tx.find(o=>o.Put?.Item.action==='COD_ORDER_COMPLETED').Put.Item);
  };
  await assert.rejects(f.complete());
  assert.equal(f.get('staging-Holds',{orderId:'order1',sk:'FINANCIAL_OUTCOME'}),undefined);
  assert.equal(w(f,'WALLET#MERCHANT#branch1').lockedBalance,10);
  assert.equal(w(f,'WALLET#DRIVER#driver1').lockedBalance,10500);
 }
});
test('foreign actor, return in progress, changed frozen terms and assigned pre-pickup order cannot complete',async()=>{
 for(const kind of ['actor','return','terms','status']){
  const f=await ready(),order=f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'});
  if(kind==='return')order.returnCaseId='return1';if(kind==='terms')order.financialAcceptance.allocation.merchantPayable.minorAmount++;
  if(kind==='status')order.status='assigned';
  await assert.rejects(f.complete({},kind==='actor'?{driverId:'driver2',subjectId:'driver2'}:undefined));
 }
});
test('fractional merchant entitlement rejects without rounding balances',async()=>{
 const f=await ready('3000',0,0.001);await assert.rejects(f.complete());assert.equal(w(f,'WALLET#MERCHANT#branch1').lockedBalance,10);
});

test('new completion ledger rows have explicit classified bucket effects and reject contradictory proof',async()=>{
 const f=await ready('4000',2000,1000);await f.complete();const {ledgerEffect}=require('../dist/ledgerEffects');
 const rows=[...f.rows.values()].filter(r=>r.category==='COD_COMPLETED');assert.ok(rows.length>=3);
 for(const row of rows){assert.deepEqual(ledgerEffect(row),{status:'CLASSIFIED',bucket:row.metadata.balanceType,delta:row.amount});assert.equal(ledgerEffect({...row,balanceAfter:row.balanceAfter+1}).status,'UNCLASSIFIED');}
});

test('zero H completion funds subsidy without creating a driver hold or double-crediting cash tip',async()=>{
 const f=setup('4000',source=>{source.order.allocation.goodsGross=parseIqd('0');source.order.allocation.serviceFee=parseIqd('0');source.order.confirmedCustomerTotal=parseIqd('4000');});
 await f.run();await f.accept();const order=f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'});order.status='picked_up';order.commercialPricing={agreement:{id:'agreement1',version:1,termsHash:'a'.repeat(64)}};
 for(const ownerType of ['MERCHANT','PLATFORM'])f.put('staging-Wallets',{walletId:ownerType==='MERCHANT'?'WALLET#MERCHANT#branch1':'WALLET#PLATFORM',sk:'META',ownerType,ownerId:ownerType==='MERCHANT'?'branch1':'PLATFORM',status:'ACTIVE',currency:'IQD',availableBalance:5000,lockedBalance:0,version:1});
 const result=await createStagingCodCompletion({db:f.db,now:()=>f.time,authenticateDriver:async()=>({driverId:'driver1',subjectId:'driver1'})}).complete({orderId:'order1',cashCollected:true});
 assert.equal(result.capturedAmount,0);assert.equal(result.holdCaptured,false);assert.equal(w(f,'WALLET#DRIVER#driver1').availableBalance,21000);assert.equal(w(f,'WALLET#PLATFORM').availableBalance,4000);assert.equal(f.get('staging-Holds',{orderId:'order1',sk:'HOLD'}),undefined);
});

test('changed live actor at commit and an opposing terminal outcome cannot complete',async()=>{
 const f=await ready();let reads=0;
 const service=createStagingCodCompletion({db:f.db,now:()=>f.time,authenticateDriver:async()=>({driverId:++reads===1?'driver1':'driver2',subjectId:reads===1?'driver1':'driver2'})});
 await assert.rejects(service.complete({orderId:'order1',cashCollected:true}),/UNAUTHORIZED/);
 assert.equal(w(f,'WALLET#DRIVER#driver1').lockedBalance,10500);
 f.put('staging-Holds',{orderId:'order1',sk:'FINANCIAL_OUTCOME',outcome:'CANCELLED'});
 await assert.rejects(f.complete());assert.equal(w(f,'WALLET#MERCHANT#branch1').lockedBalance,10);
});
