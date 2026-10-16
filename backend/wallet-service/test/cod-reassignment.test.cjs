const {test}=require('node:test'),assert=require('node:assert/strict');
const {ready,w}=require('./helpers/cod-fixture.cjs');
const {createStagingCodReassignment}=require('../dist/codReassignment');
const {createStagingDriverOfferAcceptance}=require('../dist/driverOfferAcceptance');
const driver={kind:'DRIVER',subjectId:'driver1'},owner={kind:'MERCHANT_OWNER',subjectId:'owner1'};
const service=(f,actor=driver)=>createStagingCodReassignment({db:f.db,now:()=>f.time,reassignmentWindowSeconds:120,authenticate:async()=>actor});
const key={PK:'ORDER#order1',SK:'META'};
async function before(){const f=await ready('4000',2000);f.get('WizzOrders',key).status='arrived_at_store';return f;}
const input=f=>({orderId:'order1',offerId:f.get('WizzOrders',key).financialAcceptance.offerId,attempt:1,cashCollected:false,reason:'VehicleIssue'});
test('unassignment releases only H, preserves discount funding/customer price, archives terms and schedules redispatch',async()=>{
 const f=await before(),v=input(f),snapshot=structuredClone(f.get('WizzOrders',key).financialSnapshot);await service(f).unassign(v);
 assert.equal(w(f,'WALLET#DRIVER#driver1').availableBalance,20000);assert.equal(w(f,'WALLET#PLATFORM').lockedBalance,2000);
 assert.deepEqual(f.get('WizzOrders',key).financialSnapshot,snapshot);assert.equal(f.get('WizzOrders',key).status,'ready_for_pickup');
 assert.equal(f.get('staging-Holds',{orderId:'order1',sk:'FINANCIAL_OUTCOME'}),undefined);
 const archive=f.get('staging-Holds',{orderId:'order1',sk:'ASSIGNMENT_RELEASE#1'});assert.equal(archive.acceptedTerms.driverEarning.minorAmount,4000000);
 assert.equal(f.get('WizzDispatchJobs_staging',{orderId:'order1',SK:'METADATA'}).financialRedispatch.waveNumber,2);
 assert.equal((await service(f).unassign(v)).replayed,true);assert.equal(w(f,'WALLET#DRIVER#driver1').version,3);
});
test('replacement accepts a fresh offer with attempt 2 and old callbacks never release its hold',async()=>{
 const f=await before(),v=input(f);await service(f).unassign(v);
 await assert.rejects(f.context.prepare({orderId:'order1',branchId:'branch1',driverId:'driver1',waveNumber:2,offerId:'new-offer'}));
 await f.wave.run({orderId:'order1',branchId:'branch1',waveNumber:2,driverIds:['driver2']});
 const offer=f.sent.find(r=>r.driverId==='driver2'&&r.message.offer.waveNumber===2).message.offer;
 const accepted=await createStagingDriverOfferAcceptance({db:f.db,context:f.context,now:()=>f.time,authenticateDriver:async()=>({driverId:'driver2',subjectId:'driver2'})}).accept({orderId:'order1',offerId:offer.offerId,waveNumber:2});
 assert.equal(f.get('WizzOrders',key).assignmentAttemptCounter,2);assert.equal(f.get('staging-Holds',{orderId:'order1',sk:'HOLD'}).metadata.assignmentAttempt,2);
 await service(f).unassign(v);assert.equal(w(f,'WALLET#DRIVER#driver2').lockedBalance,accepted.holdAmount);
 assert.equal(f.get('WizzDriverLiveState_staging',{driverId:'driver2'}).currentOrderId,'order1');
});
test('owner cancellation before pickup releases H and funding atomically and claims no fee payment',async()=>{
 const f=await before(),{reason,...base}=input(f),v={...base,branchId:'branch1',goodsRetainedByBranch:true};const result=await service(f,owner).cancelBeforePickup(v);
 assert.equal(result.kind,'COD_CANCELLED');assert.equal(result.compensationStatus,'PENDING_POLICY_REVIEW');
 assert.equal(w(f,'WALLET#DRIVER#driver1').availableBalance,20000);assert.equal(w(f,'WALLET#PLATFORM').lockedBalance,0);assert.equal(w(f,'WALLET#PLATFORM').availableBalance,7000);
 assert.equal(f.get('WizzOrders',key).status,'cancelled');assert.equal(f.get('staging-Holds',{orderId:'order1',sk:'FINANCIAL_OUTCOME'}).outcome,'CANCELLED');
 assert.equal((await service(f,owner).cancelBeforePickup(v)).replayed,true);await assert.rejects(f.complete());
});
test('pickup, cash, return, owner scope and journal races prevent cancellation/unassignment and partial money',async()=>{
 for(const mode of ['picked','cash','return','foreign','audit','wallet']){
  const f=await before(),v=input(f);
  if(mode==='picked')f.get('WizzOrders',key).pickedUpAt=new Date(f.time).toISOString();
  if(mode==='cash')f.get('WizzOrders',key).cashCollected=true;
  if(mode==='return')f.get('WizzOrders',key).returnCaseId='ret1';
  if(mode==='audit'||mode==='wallet')f.beforeCommit=tx=>{if(mode==='wallet')w(f,'WALLET#DRIVER#driver1').version++;else f.put('staging-AuditLog',tx.find(o=>o.Put?.Item.action==='COD_DRIVER_UNASSIGNED').Put.Item);};
  await assert.rejects(service(f,mode==='foreign'?{kind:'DRIVER',subjectId:'driver2'}:driver).unassign(v));
  assert.equal(w(f,'WALLET#DRIVER#driver1').lockedBalance,8500);assert.equal(f.get('WizzOrders',key).status,'arrived_at_store');
 }
});
test('replacement delivery settles attempt 2 while prior released hold and terms remain archived',async()=>{
 const f=await before(),v=input(f);await service(f).unassign(v);await f.wave.run({orderId:'order1',branchId:'branch1',waveNumber:2,driverIds:['driver2']});
 const offer=f.sent.find(r=>r.driverId==='driver2'&&r.message.offer.waveNumber===2).message.offer;
 await createStagingDriverOfferAcceptance({db:f.db,context:f.context,now:()=>f.time,authenticateDriver:async()=>({driverId:'driver2',subjectId:'driver2'})}).accept({orderId:'order1',offerId:offer.offerId,waveNumber:2});
 f.get('WizzOrders',key).status='arrived_at_customer';
 const {createStagingCodCompletion}=require('../dist/codCompletion');
 const complete=createStagingCodCompletion({db:f.db,now:()=>f.time,authenticateDriver:async()=>({driverId:'driver2',subjectId:'driver2'})});
 await complete.complete({orderId:'order1',cashCollected:true});
 assert.equal(w(f,'WALLET#DRIVER#driver1').availableBalance,20000);assert.equal(w(f,'WALLET#DRIVER#driver2').lockedBalance,0);
 assert.equal(f.get('staging-Holds',{orderId:'order1',sk:'ASSIGNMENT_RELEASE#1'}).releasedHold.status,'RELEASED');
 assert.equal(f.get('WizzOrders',key).status,'delivered');
 assert.equal((await complete.complete({orderId:'order1',cashCollected:true})).replayed,true);
});
test('late pickup recorded between planning and release wins over cancellation without a partial release',async()=>{
 const f=await before(),{reason,...v}=input(f);f.beforeCommit=()=>{f.get('WizzOrders',key).status='picked_up';};
 await assert.rejects(service(f,owner).cancelBeforePickup({...v,branchId:'branch1',goodsRetainedByBranch:true}));assert.equal(w(f,'WALLET#DRIVER#driver1').lockedBalance,8500);
});
test('zero-hold reassignment preserves the absence of money movements and cancellation can close attempt 2',async()=>{
 const {setup}=require('./helpers/driver-financial-fixture.cjs'),{parseIqd}=require('../dist/money');
 const f=setup('3000',s=>{s.order.allocation.goodsGross=parseIqd('0');s.order.allocation.serviceFee=parseIqd('0');s.order.confirmedCustomerTotal=parseIqd('4000');});
 await f.run();await f.accept();f.get('WizzOrders',key).status='arrived_at_store';
 const v=input(f);await service(f).unassign(v);assert.equal(f.get('staging-Holds',{orderId:'order1',sk:'ASSIGNMENT_RELEASE#1'}).releasedHold,null);
 await f.wave.run({orderId:'order1',branchId:'branch1',waveNumber:2,driverIds:['driver2']});
 const offer=f.sent.find(r=>r.driverId==='driver2'&&r.message.offer.waveNumber===2).message.offer;
 const result=await createStagingDriverOfferAcceptance({db:f.db,context:f.context,now:()=>f.time,authenticateDriver:async()=>({driverId:'driver2',subjectId:'driver2'})}).accept({orderId:'order1',offerId:offer.offerId,waveNumber:2});
 assert.equal(result.holdAmount,0);
 await service(f,owner).cancelBeforePickup({orderId:'order1',offerId:offer.offerId,attempt:2,branchId:'branch1',goodsRetainedByBranch:true,cashCollected:false});
 assert.equal(w(f,'WALLET#DRIVER#driver1').version,1);assert.equal(w(f,'WALLET#DRIVER#driver2').version,1);
 assert.equal([...f.rows.keys()].filter(k=>k.startsWith('staging-LedgerEntries|')).length,0);
});
