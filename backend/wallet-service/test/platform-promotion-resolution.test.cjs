const {test}=require('node:test'),assert=require('node:assert/strict');
const {createStagingPlatformPromotionResolution:create}=require('../dist/platformPromotionResolution');
const {preparePlatformPromotionFunding:reserve}=require('../dist/platformPromotionFunding');
const {parseIqd:m}=require('../dist/money');
const at='2026-10-18T12:00:00.000Z',later='2026-10-18T13:00:00.000Z';
function fixture(goods='700',delivery='2500'){
 const rows=new Map(),key=(t,k)=>t+'|'+JSON.stringify(k),wallet={walletId:'WALLET#PLATFORM',sk:'META',ownerId:'platform',ownerType:'PLATFORM',status:'ACTIVE',currency:'IQD',availableBalance:10000,lockedBalance:0,version:1};
 const expected=[{kind:'GOODS',amount:m(goods),metadata:{agreementId:'agreement',agreementVersion:1,fundingPolicy:null}},{kind:'DELIVERY',amount:m(delivery),metadata:{policyId:'delivery-policy',version:1}}];
 const components=expected.filter(c=>c.amount.minorAmount>0);
 if(components.length){const p=reserve({orderId:'order',at,wallet,components});for(const {Put:o}of p.operations.filter(x=>x.Put?.TableName==='staging-Holds'))rows.set(key('staging-Holds',{orderId:o.Item.orderId,sk:o.Item.sk}),o.Item);wallet.availableBalance=p.operations[0].Update.ExpressionAttributeValues[':available'];wallet.lockedBalance=p.operations[0].Update.ExpressionAttributeValues[':locked'];wallet.version++;}
 rows.set(key('staging-Wallets',{walletId:wallet.walletId,sk:'META'}),wallet);
 const calls=[],db={send:async c=>{calls.push(c);assert.equal(c.constructor.name,'GetCommand');assert.equal(c.input.ConsistentRead,true);return {Item:structuredClone(rows.get(key(c.input.TableName,c.input.Key)))};}};
 const service=create({db}),input={orderId:'order',operationId:'completion-one',outcome:'CAPTURED',at:later,expected};
 const hold=kind=>rows.get(key('staging-Holds',{orderId:'order',sk:kind==='GOODS'?'PROMOTION_FUNDING':'DELIVERY_PROMOTION_FUNDING'}));
 const commitHolds=plan=>{for(const {Update:u}of plan.operations.filter(x=>x.Update)){const h=rows.get(key(u.TableName,u.Key));Object.assign(h,{status:u.ExpressionAttributeValues[':s'],settlementOperationId:u.ExpressionAttributeValues[':op'],updatedAt:later,settledAt:later});}};
 return {rows,wallet,input,service,hold,commitHolds,calls};
}
test('capture combines goods and delivery cash release into a single delta, never standalone wallet writes',async()=>{
 const f=fixture(),r=await f.service.prepare(f.input);assert.equal(r.walletDelta.available,3200);assert.equal(r.walletDelta.locked,-3200);assert.equal(r.operations.filter(x=>x.Update).length,2);assert.ok(r.operations.every(x=>x.Update?.TableName!=='staging-Wallets'));assert.equal(r.walletCheck.ConditionCheck.TableName,'staging-Wallets');assert.equal(r.requiresAtomicLifecycleCommit,true);assert.equal(f.hold('DELIVERY').status,'ACTIVE');assert.equal(f.wallet.lockedBalance,3200);
});
test('capture retry gives no second delta; release after capture conflicts',async()=>{
 const f=fixture(),r=await f.service.prepare(f.input);f.commitHolds(r);const retry=await f.service.prepare(f.input);assert.equal(retry.replayed,true);assert.deepEqual(retry.walletDelta,{available:0,locked:0});await assert.rejects(f.service.prepare({...f.input,outcome:'RELEASED'}));
});
test('cancellation release is idempotent with original terms regardless of current campaign',async()=>{
 const f=fixture(),r=await f.service.prepare({...f.input,outcome:'RELEASED'});f.commitHolds(r);assert.equal(f.hold('DELIVERY').status,'RELEASED');assert.equal((await f.service.prepare({...f.input,outcome:'RELEASED'})).replayed,true);assert.ok(f.calls.every(x=>['staging-Holds','staging-Wallets'].includes(x.input.TableName)));
});
test('foreign hold metadata amount identity time or wallet liquidity cannot resolve',async()=>{
 for(const edit of [f=>f.hold('DELIVERY').amount=1,f=>f.hold('DELIVERY').metadata.policyId='other',f=>f.hold('DELIVERY').holdId='PROMO#order',f=>f.hold('DELIVERY').createdAt='2026-10-19T00:00:00.000Z',f=>f.wallet.lockedBalance=100,f=>f.wallet.deletionRequestId='closing',f=>f.wallet.status='SUSPENDED']){const f=fixture();edit(f);await assert.rejects(f.service.prepare(f.input));}
});
test('zero-funded components require absence rather than ignore an unexpected cash hold',async()=>{
 const f=fixture('0','2500'),r=await f.service.prepare(f.input);assert.equal(r.operations[0].ConditionCheck.Key.sk,'PROMOTION_FUNDING');assert.equal(r.walletDelta.available,2500);
 f.rows.set('staging-Holds|'+JSON.stringify({orderId:'order',sk:'PROMOTION_FUNDING'}),{amount:0});await assert.rejects(f.service.prepare(f.input));
 const z=fixture('0','0'),zero=await z.service.prepare(z.input);assert.deepEqual(zero.walletDelta,{available:0,locked:0});assert.equal(zero.operations.length,2);
});
test('mixed terminal states, changed operation or duplicate components reject',async()=>{
 const f=fixture(),r=await f.service.prepare(f.input);f.commitHolds(r);f.hold('GOODS').status='ACTIVE';delete f.hold('GOODS').settlementOperationId;await assert.rejects(f.service.prepare(f.input));
 const g=fixture(),p=await g.service.prepare(g.input);g.commitHolds(p);await assert.rejects(g.service.prepare({...g.input,operationId:'other-operation'}));
 const h=fixture();h.input.expected[1].kind='GOODS';await assert.rejects(h.service.prepare(h.input));
});
test('hold conditions preserve original evidence and wallet fence guards account closing',async()=>{
 const f=fixture(),r=await f.service.prepare(f.input);const hold=r.operations.find(x=>x.Update).Update;assert.ok(Object.values(hold.ExpressionAttributeNames).includes('metadata'));assert.ok(Object.values(r.walletCheck.ConditionCheck.ExpressionAttributeNames).includes('deletionRequestId'));assert.match(r.walletCheck.ConditionCheck.ConditionExpression,/attribute_not_exists/);
});
