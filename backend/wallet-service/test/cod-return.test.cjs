const {test}=require('node:test'),assert=require('node:assert/strict');
const {createStagingCodReturn}=require('../dist/codReturn');
const {ready,w}=require('./helpers/cod-fixture.cjs');
const driver={kind:'DRIVER',subjectId:'driver1'},owner={kind:'MERCHANT_OWNER',subjectId:'owner1'};
function service(f,actor=driver){return createStagingCodReturn({db:f.db,now:()=>f.time,authenticate:async()=>actor});}
function selectors(f){const o=f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'});return {orderId:'order1',offerId:o.financialAcceptance.offerId,attempt:1};}
async function returning(f){const v=selectors(f);const result=await service(f).requestReturn({...v,reason:'CUSTOMER_UNREACHABLE',cashCollected:false});return {...v,returnId:result.returnId};}
async function arrived(f){const v=await returning(f);await service(f).arriveReturn(v);return {...v,branchId:'branch1',expectedVersion:2,allItemsReceived:true,condition:'INTACT',driverResponsibility:'NONE',cashCollected:false};}
const record=f=>f.get('staging-Holds',{orderId:'order1',sk:'RETURN#1'});
test('driver requests return and records arrival without releasing H or paying any earning/tip',async()=>{
 const f=await ready();const before=structuredClone(w(f,'WALLET#DRIVER#driver1'));
 const v=await returning(f);assert.equal(record(f).status,'RETURNING');assert.equal(f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'}).status,'returning');
 assert.equal((await service(f).requestReturn({...selectors(f),reason:'CUSTOMER_UNREACHABLE',cashCollected:false})).replayed,true);
 await service(f).arriveReturn(v);assert.equal(record(f).status,'ARRIVED_AT_BRANCH');
 assert.deepEqual(w(f,'WALLET#DRIVER#driver1'),before);assert.equal(f.get('staging-Holds',{orderId:'order1',sk:'HOLD'}).status,'ACTIVE');
 await assert.rejects(f.complete());
});
test('independent owner receipt atomically releases driver H and reserved promo funding, no merchant payable/refund/earning',async()=>{
 const f=await ready('4000',2000,1000),v=await arrived(f);
 const result=await service(f,owner).confirmReceipt(v);assert.equal(result.holdReleased,true);assert.equal(result.status,'CONFIRMED');
 assert.equal(w(f,'WALLET#DRIVER#driver1').availableBalance,20000);assert.equal(w(f,'WALLET#DRIVER#driver1').lockedBalance,0);
 assert.equal(w(f,'WALLET#PLATFORM').availableBalance,7000);assert.equal(w(f,'WALLET#PLATFORM').lockedBalance,0);
 assert.equal(w(f,'WALLET#MERCHANT#branch1').lockedBalance,10);
 const outcome=f.get('staging-Holds',{orderId:'order1',sk:'FINANCIAL_OUTCOME'});assert.equal(outcome.outcome,'RETURNED');assert.equal(outcome.journalLines.reduce((n,r)=>n+r.delta,0),0);
 assert.equal(f.get('staging-Holds',{orderId:'order1',sk:'MERCHANT_PAYABLE'}),undefined);
 assert.equal(f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'}).status,'returned');assert.equal(f.get('WizzDriverLiveState_staging',{driverId:'driver1'}).currentOrderId,null);
 assert.equal(result.driverCompensationStatus,'PENDING_POLICY_REVIEW');await assert.rejects(f.complete());
});
test('owner receipt is versioned and cannot be submitted by driver, foreign owner or before arrival',async()=>{
 for(const kind of ['driver','foreign','early','version','differentReturn','attempt']){
  const f=await ready(),v=await arrived(f);
  if(kind==='early'){record(f).status='RETURNING';f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'}).status='returning';}
  if(kind==='version')v.expectedVersion=1;if(kind==='differentReturn')v.returnId='other';if(kind==='attempt')v.attempt=2;
  await assert.rejects(service(f,kind==='driver'?driver:kind==='foreign'?{...owner,subjectId:'owner2'}:owner).confirmReceipt(v));
  assert.equal(w(f,'WALLET#DRIVER#driver1').lockedBalance,10500);
 }
});
test('partial, damaged or disputed receipt records review and leaves driver and funding locked',async()=>{
 for(const override of [{allItemsReceived:false},{condition:'DAMAGED'},{driverResponsibility:'REVIEW'}]){
  const f=await ready('4000',2000),v=await arrived(f),result=await service(f,owner).confirmReceipt({...v,...override});
  assert.equal(result.financialReviewRequired,true);assert.equal(result.holdReleased,false);assert.equal(record(f).status,'REVIEW_REQUIRED');
  assert.equal(w(f,'WALLET#DRIVER#driver1').lockedBalance,8500);assert.equal(w(f,'WALLET#PLATFORM').lockedBalance,2000);
  assert.equal(f.get('staging-Holds',{orderId:'order1',sk:'FINANCIAL_OUTCOME'}),undefined);
  await assert.rejects(service(f,owner).confirmReceipt(v)); // no overwrite of the disputed attestation
 }
});
test('cash collection, unsupported selectors and pre-pickup phases cannot enter the no-cash return path',async()=>{
 for(const kind of ['cashBody','cashOrder','cashAmount','status','amount','reason']){
  const f=await ready(),order=f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'}),v={...selectors(f),reason:'CUSTOMER_REFUSED',cashCollected:false};
  if(kind==='cashBody')v.cashCollected=true;if(kind==='cashOrder')order.cashCollected=true;if(kind==='cashAmount')order.cashCollectedAmount=1;
  if(kind==='status')order.status='assigned';if(kind==='amount')v.holdAmount=1;if(kind==='reason')v.reason='INVALID';
  await assert.rejects(service(f).requestReturn(v));assert.equal(record(f),undefined);assert.equal(w(f,'WALLET#DRIVER#driver1').lockedBalance,10500);
 }
});
test('lost reply and concurrent receipt release only once; stale receipt cannot be reused with a different declaration',async()=>{
 const f=await ready(),v=await arrived(f);f.loseReturnConfirmation=true;
 const results=await Promise.all([service(f,owner).confirmReceipt(v),service(f,owner).confirmReceipt(v)]);assert.ok(results.some(r=>r.replayed));
 assert.equal(w(f,'WALLET#DRIVER#driver1').version,3);assert.equal([...f.rows.values()].filter(r=>r.action==='COD_RETURN_CONFIRMED').length,1);
 f.time+=86400000;assert.equal((await service(f,owner).confirmReceipt(v)).replayed,true);
 await assert.rejects(service(f,owner).confirmReceipt({...v,condition:'DAMAGED'}));
});
test('wallet, hold, owner, deletion, cash, final outcome and audit races roll back receipt and all balances',async()=>{
 for(const kind of ['wallet','hold','owner','deletion','cash','outcome','audit']){
  const f=await ready(),v=await arrived(f);f.beforeCommit=tx=>{
   if(kind==='wallet')w(f,'WALLET#DRIVER#driver1').version++;
   if(kind==='hold')f.get('staging-Holds',{orderId:'order1',sk:'HOLD'}).status='SETTLED';
   if(kind==='owner')f.get('WhizzMerchants_Businesses',{businessId:'branch1'}).ownerId='owner2';
   if(kind==='deletion')f.put('staging-AccountDeletion',{pk:'ACCOUNT_LIFECYCLE#MERCHANT#owner1',sk:'META'});
   if(kind==='cash')f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'}).cashCollectedAmount=100;
   if(kind==='outcome')f.put('staging-Holds',{orderId:'order1',sk:'FINANCIAL_OUTCOME',outcome:'COMPLETED'});
   if(kind==='audit')f.put('staging-AuditLog',tx.find(o=>o.Put?.Item.action==='COD_RETURN_CONFIRMED').Put.Item);
  };
  await assert.rejects(service(f,owner).confirmReceipt(v));assert.equal(w(f,'WALLET#DRIVER#driver1').lockedBalance,10500);assert.equal(record(f).status,'ARRIVED_AT_BRANCH');
 }
});
test('completion racing return request permits one transition and never releases an unconfirmed return',async()=>{
 const f=await ready(),v={...selectors(f),reason:'DELIVERY_BLOCKED',cashCollected:false};
 const result=await Promise.allSettled([f.complete(),service(f).requestReturn(v)]);assert.equal(result.filter(r=>r.status==='fulfilled').length,1);
 const order=f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'});
 assert.ok(['delivered','returning'].includes(order.status));if(order.status==='returning')assert.equal(w(f,'WALLET#DRIVER#driver1').lockedBalance,10500);
});
test('owner case read projects a fixed view and checks branch scope and ownership again before reply',async()=>{
 const f=await ready(),v=await arrived(f),q={...selectors(f),branchId:'branch1'};record(f).internalSecret='hidden';
 const view=await service(f,owner).readReturn(q);assert.equal(view.version,2);assert.equal(view.returnId,v.returnId);assert.equal(view.internalSecret,undefined);assert.equal(view.driverSubjectId,undefined);
 await assert.rejects(service(f,owner).readReturn({...q,branchId:'other'}));await assert.rejects(service(f,driver).readReturn(q));
 f.beforeCommit=()=>{f.get('WhizzMerchants_Businesses',{businessId:'branch1'}).ownerId='other';};await assert.rejects(service(f,owner).readReturn(q));
});

test('return release ledger is classified as bucket transfers, not merchant income or additional driver earnings',async()=>{
 const f=await ready('4000',2000),v=await arrived(f);await service(f,owner).confirmReceipt(v);const {ledgerEffect}=require('../dist/ledgerEffects');
 const rows=[...f.rows.values()].filter(r=>r.category==='COD_RETURN_RELEASED');assert.equal(rows.length,4);
 for(const row of rows){assert.deepEqual(ledgerEffect(row),{status:'CLASSIFIED',bucket:row.metadata.balanceType,delta:row.amount});assert.equal(ledgerEffect({...row,type:row.type==='CREDIT'?'DEBIT':'CREDIT'}).status,'UNCLASSIFIED');}
});

test('zero H return confirms without creating a driver hold, a wallet credit or a fictitious refund',async()=>{
 const {setup}=require('./helpers/driver-financial-fixture.cjs'),{parseIqd}=require('../dist/money');
 const f=setup('4000',source=>{source.order.allocation.goodsGross=parseIqd('0');source.order.allocation.serviceFee=parseIqd('0');source.order.confirmedCustomerTotal=parseIqd('4000');});
 await f.run();await f.accept();f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'}).status='picked_up';
 const v=await arrived(f),result=await service(f,owner).confirmReceipt(v);
 assert.equal(result.status,'CONFIRMED');assert.equal(result.holdReleased,false);assert.equal(result.holdStatus,'NOT_REQUIRED');
 assert.equal(w(f,'WALLET#DRIVER#driver1').availableBalance,20000);assert.equal(f.get('staging-Holds',{orderId:'order1',sk:'HOLD'}),undefined);
 assert.equal(f.get('staging-Holds',{orderId:'order1',sk:'FINANCIAL_OUTCOME'}).journalLines.length,0);
});
test('a competing confirmation completing during preflight hold reads returns its existing receipt',async()=>{
 const {GetCommand}=require('@aws-sdk/lib-dynamodb'),f=await ready(),v=await arrived(f),send=f.db.send.bind(f.db);let once=false;
 f.db.send=async c=>{if(c instanceof GetCommand&&c.input.TableName==='staging-Holds'&&c.input.Key.sk==='HOLD'&&!once){once=true;await service(f,owner).confirmReceipt(v);}return send(c);};
 assert.equal((await service(f,owner).confirmReceipt(v)).replayed,true);assert.equal(w(f,'WALLET#DRIVER#driver1').version,3);
});
