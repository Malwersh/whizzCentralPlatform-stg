const {test}=require('node:test'),assert=require('node:assert/strict');
const {preparePlatformPromotionFunding:prepare}=require('../dist/platformPromotionFunding');
const {composeQuoteOrderOperations:compose}=require('../dist/deliveryQuoteOrder');
const {parseIqd:m}=require('../dist/money');
const wallet=()=>({walletId:'WALLET#PLATFORM',sk:'META',ownerType:'PLATFORM',ownerId:'platform',currency:'IQD',status:'ACTIVE',version:1,availableBalance:10000,lockedBalance:0});
const input=()=>({orderId:'order',at:'2026-10-18T12:00:00.000Z',wallet:wallet(),components:[{kind:'GOODS',amount:m('700'),metadata:{agreementId:'a',agreementVersion:1,fundingPolicy:null}},{kind:'DELIVERY',amount:m('2500'),metadata:{policyId:'delivery',version:1}}]});
test('goods and delivery share exactly one wallet debit with separately identifiable holds',()=>{
 const r=prepare(input());assert.equal(r.amount.minorAmount,3200000);assert.equal(r.operations.filter(x=>x.Update).length,1);
 const u=r.operations[0].Update;assert.equal(u.ExpressionAttributeValues[':available'],6800);assert.equal(u.ExpressionAttributeValues[':locked'],3200);
 const holds=r.operations.filter(x=>x.Put?.TableName==='staging-Holds').map(x=>x.Put.Item);assert.deepEqual(holds.map(x=>[x.sk,x.amount]),[['PROMOTION_FUNDING',700],['DELIVERY_PROMOTION_FUNDING',2500]]);
 assert.ok(holds.every(x=>x.sk!=='HOLD'));assert.equal(compose(r.operations).length,r.operations.length);
});
test('ledger balances chain and conservation match a single wallet transition',()=>{
 const r=prepare(input()),lines=r.operations.filter(x=>x.Put?.TableName==='staging-LedgerEntries').map(x=>x.Put.Item);
 assert.equal(lines.reduce((s,l)=>s+l.amount,0),0);
 for(const bucket of ['AVAILABLE','LOCKED']){const selected=lines.filter(l=>l.metadata.balanceType===bucket);assert.equal(selected[0].balanceAfter,selected[1].balanceBefore);assert.equal(selected.at(-1).balanceAfter,bucket==='AVAILABLE'?6800:3200);}
});
test('insufficient combined liquidity, duplicate components, precision and closing wallets fail',()=>{
 for(const edit of [x=>x.wallet.availableBalance=3000,x=>x.components[1].kind='GOODS',x=>x.components[1].amount=m('0.001'),x=>x.wallet.status='SUSPENDED',x=>x.wallet.deletionRequestId='closing',x=>x.wallet.version=Number.MAX_SAFE_INTEGER]){const x=input();edit(x);assert.throws(()=>prepare(x));}
});
test('single goods component preserves legacy hold and ledger identifiers',()=>{
 const x=input();x.components=x.components.slice(0,1);const r=prepare(x);assert.equal(r.operations.find(x=>x.Put?.TableName==='staging-Holds').Put.Item.holdId,'PROMO#order');assert.ok(r.operations.some(x=>x.Put?.Item.sk==='ts#2026-10-18T12:00:00.000Z#PROMO_AVAILABLE#order'));
});
test('duplicate authority checks combine without losing predicates or colliding aliases',()=>{
 const a={ConditionCheck:{TableName:'WhizzMerchants_Businesses',Key:{businessId:'branch'},ConditionExpression:'#v=:v',ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':v':1}}};
 const b=structuredClone(a);b.ConditionCheck.ExpressionAttributeValues[':v']=2;const r=compose([a,b]);assert.equal(r.length,1);assert.match(r[0].ConditionCheck.ConditionExpression,/ AND /);assert.deepEqual(Object.values(r[0].ConditionCheck.ExpressionAttributeValues).sort(),[1,2]);assert.equal(a.ConditionCheck.ConditionExpression,'#v=:v');
});
test('conflicting wallet writers or check-plus-write never silently merge',()=>{
 const ops=prepare(input()).operations;assert.throws(()=>compose([ops[0],ops[0]]));assert.throws(()=>compose([ops[0],{ConditionCheck:{TableName:'staging-Wallets',Key:ops[0].Update.Key,ConditionExpression:'attribute_exists(walletId)'}}]));
});
test('campaign records use actual pk/sk identity; duplicate budget writes reject',()=>{
 const put={Put:{TableName:'staging-PlatformStaff',Item:{pk:'DELIVERY_BUDGET#p',sk:'VERSION#1'},ConditionExpression:'attribute_not_exists(pk)'}};assert.equal(compose([put]).length,1);assert.throws(()=>compose([put,put]));
});
