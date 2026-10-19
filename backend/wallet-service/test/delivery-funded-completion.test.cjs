const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./helpers/delivery-funded-fixture.cjs');
const {w}=require('./helpers/cod-fixture.cjs');
const {parseIqd:m}=require('../dist/money');
test('V2 atomic completion captures support budget and cash, credits merchant net and driver with balanced journal',async()=>{
 const f=await fixture();await f.completeV2();const outcome=f.get('staging-Holds',{orderId:'order1',sk:'FINANCIAL_OUTCOME'});
 assert.equal(outcome.schemaVersion,2);assert.equal(outcome.journalLines.reduce((s,x)=>s+x.delta,0),0);
 assert.equal(w(f,'WALLET#MERCHANT#branch1').lockedBalance,8510);assert.equal(w(f,'WALLET#DRIVER#driver1').availableBalance,10500);assert.equal(w(f,'WALLET#PLATFORM').availableBalance,11000);assert.equal(w(f,'WALLET#PLATFORM').lockedBalance,0);
 assert.equal(f.get('staging-PlatformStaff',{pk:'DELIVERY_RESERVATION#order1',sk:'META'}).status,'CAPTURED');assert.equal(f.get('staging-Holds',{orderId:'order1',sk:'DELIVERY_PROMOTION_FUNDING'}).status,'SETTLED');assert.equal(f.get('staging-Holds',{orderId:'order1',sk:'MERCHANT_PAYABLE'}).financialSchemaVersion,3);
});
test('sole funders and combined goods/delivery funding settle with correct merchant net',async()=>{
 for(const [split,goods,net]of [['MERCHANT',0,8000],['PLATFORM',0,9000],['SHARED',700,8500]]){const f=await fixture(split,goods);await f.completeV2();assert.equal(w(f,'WALLET#MERCHANT#branch1').lockedBalance,net+10);assert.equal(w(f,'WALLET#PLATFORM').lockedBalance,0);}
});
test('capability stays closed by default',async()=>{const f=await fixture();await assert.rejects(f.complete(),e=>e.code==='DELIVERY_FUNDED_COMPLETION_DISABLED');assert.equal(f.get('staging-Holds',{orderId:'order1',sk:'FINANCIAL_OUTCOME'}),undefined);});
test('lost response and concurrent completion commit only one journal and campaign use',async()=>{
 const f=await fixture();f.loseCompletion=true;await Promise.all([f.completeV2(),f.completeV2()]);assert.equal((await f.completeV2()).replayed,true);assert.equal([...f.rows.values()].filter(x=>x.action==='COD_ORDER_COMPLETED').length,1);assert.equal(f.get('staging-PlatformStaff',{pk:'DELIVERY_USAGE#delivery',sk:'CUSTOMER#customer'}).completedUses,1);
});
test('budget or cash evidence races roll back the complete V2 transaction',async()=>{
 for(const target of ['DELIVERY_BUDGET#delivery','DELIVERY_PROMOTION_FUNDING']){const f=await fixture();f.beforeCommit=tx=>{const op=tx.find(x=>(x.Put?.Item.pk===target)||(x.Update?.Key.sk===target));assert.ok(op);if(op.Put)f.get(op.Put.TableName,{pk:op.Put.Item.pk,sk:op.Put.Item.sk}).version++;else f.get(op.Update.TableName,op.Update.Key).amount++;};await assert.rejects(f.completeV2());assert.equal(f.get('staging-Holds',{orderId:'order1',sk:'FINANCIAL_OUTCOME'}),undefined);assert.equal(w(f,'WALLET#MERCHANT#branch1').lockedBalance,10);}
});

test('V2 merchant accrual proves net payable and reports delivery support separately',async()=>{
 const {deriveMerchantCodAccrual:derive,summarizeMerchantAccruals:sum}=require('../dist/merchantSettlementAccrual');const f=await fixture();await f.completeV2();
 const sources={branchId:'branch1',order:f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'}),acceptedOffer:f.get('WaveOffers_staging',{orderId:'order1',SK:'FINANCIAL#driver1#WAVE#1'}),outcome:f.get('staging-Holds',{orderId:'order1',sk:'FINANCIAL_OUTCOME'}),payable:f.get('staging-Holds',{orderId:'order1',sk:'MERCHANT_PAYABLE'})};
 const r=derive(sources);assert.equal(r.schemaVersion,2);assert.equal(r.amounts.merchantNet.minorAmount,8500000);assert.equal(r.amounts.merchantDeliverySupport.minorAmount,500000);assert.equal(r.amounts.platformDeliveryPromotionFunding.minorAmount,500000);assert.equal(r.payoutAuthorized,false);assert.equal(sum('branch1',[r]).amounts.merchantNet.minorAmount,8500000);
 const bad=structuredClone(sources);bad.payable.merchantDeliverySupport=m('0');assert.throws(()=>derive(bad));
 const {quoteHash}=require('../dist/deliveryQuoteRecord');const altered=structuredClone(r);altered.amounts.merchantDeliverySupport=m('0');const {digest,...content}=altered;altered.digest=quoteHash(content);assert.throws(()=>sum('branch1',[altered]));
});
test('campaign reservation must match original accepted funding proof',async()=>{
 const f=await fixture(),{quoteHash}=require('../dist/deliveryQuoteRecord'),h=f.get('staging-PlatformStaff',{pk:'DELIVERY_RESERVATION#order1',sk:'META'});
 h.allocation.merchantShare=m('400');h.allocation.platformShare=m('600');h.requestDigest=quoteHash({orderId:h.orderId,customerId:h.customerId,policyPin:h.policyPin,allocation:h.allocation});const {digest,...content}=h;h.digest=quoteHash(content);
 await assert.rejects(f.completeV2());assert.equal(f.get('staging-Holds',{orderId:'order1',sk:'FINANCIAL_OUTCOME'}),undefined);assert.equal(w(f,'WALLET#MERCHANT#branch1').lockedBalance,10);
});
test('inconsistent delivery cash hold cannot capture budget or credit merchant',async()=>{
 const f=await fixture();f.get('staging-Holds',{orderId:'order1',sk:'DELIVERY_PROMOTION_FUNDING'}).metadata.policyPin.version=2;await assert.rejects(f.completeV2());assert.equal(f.get('staging-PlatformStaff',{pk:'DELIVERY_RESERVATION#order1',sk:'META'}).status,'RESERVED');assert.equal(w(f,'WALLET#MERCHANT#branch1').lockedBalance,10);
});
