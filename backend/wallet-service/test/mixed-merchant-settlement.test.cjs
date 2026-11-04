const {test}=require('node:test'),assert=require('node:assert/strict');
const {proof}=require('./helpers/merchant-accrual-fixture.cjs');
const {fixture:funded}=require('./helpers/delivery-funded-fixture.cjs');
const {deriveMerchantCodAccrual:derive,summarizeMerchantAccruals:sum,merchantAccrualReportingAmounts:report}=require('../dist/merchantSettlementAccrual');
const {createMerchantSettlementPreviewReader,exportMerchantSettlementPreview:csv}=require('../dist/merchantSettlementPreview');
const {fixture:batch}=require('./helpers/merchant-settlement-batch-fixture.cjs');
const {quoteHash}=require('../dist/deliveryQuoteRecord');
async function sources(){
 const old=await proof({orderId:'order2',earning:'9000'}),f=await funded();await f.completeV2();
 const input={branchId:'branch1',order:f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'}),outcome:f.get('staging-Holds',{orderId:'order1',sk:'FINANCIAL_OUTCOME'}),payable:f.get('staging-Holds',{orderId:'order1',sk:'MERCHANT_PAYABLE'}),acceptedOffer:f.get('WaveOffers_staging',{orderId:'order1',SK:'FINANCIAL#driver1#WAVE#1'})};
 return {old,f,input,lines:[derive(old.input),derive(input)]};
}
test('mixed summary preserves source proofs and separates support from signed operating margin',async()=>{
 const {lines}=await sources(),before=JSON.stringify(lines),r=sum('branch1',lines);
 assert.equal(r.schemaVersion,3);assert.deepEqual(r.sourceSchemaCounts,{v1:1,v2:1});
 for(const [key,amount]of Object.entries({merchantNet:17500000,merchantDeliverySupport:500000,platformDeliveryPromotionFunding:500000,referenceDeliveryFee:7000000,deliveryPromotionSubsidy:1000000,baselineDeliveryMargin:-6000000,deliveryNetContribution:-6500000}))assert.equal(r.amounts[key].minorAmount,amount,key);
 assert.equal(r.payoutAuthorized,false);assert.equal(JSON.stringify(lines),before);assert.deepEqual(sum('branch1',[...lines].reverse()),r);
 const old=report(lines[0]);assert.equal(old.referenceDeliveryFee.minorAmount,3000000);assert.equal(old.merchantDeliverySupport.minorAmount,0);assert.equal(old.baselineDeliveryMargin.minorAmount,-6000000);
 assert.notEqual(old.merchantNet,lines[0].amounts.merchantNet);
 assert.equal(sum('branch1',[lines[0]]).schemaVersion,1);assert.equal(sum('branch1',[lines[1]]).schemaVersion,2);
});
test('mixed summary rejects duplicate sources, malformed source versions and forged funding equations',async()=>{
 const {lines}=await sources();assert.throws(()=>sum('branch1',[...lines,lines[0]]));
 for(const edit of [r=>r.schemaVersion=3,r=>r.amounts.merchantDeliverySupport.minorAmount=0,r=>delete r.amounts.referenceDeliveryFee]){
 const rows=structuredClone(lines);edit(rows[1]);const {digest,...content}=rows[1];rows[1].digest=quoteHash(content);assert.throws(()=>sum('branch1',rows));
 }
 const legacy=structuredClone(lines[0]);legacy.amounts.merchantDeliverySupport=lines[1].amounts.merchantDeliverySupport;const {digest,...content}=legacy;legacy.digest=quoteHash(content);assert.throws(()=>report(legacy));
});
test('strong evidence preview and CSV report mixed support per order without moving balances',async()=>{
 const {old,f}=await sources();for(const [key,row]of old.f.rows)if(row.orderId==='order2')f.rows.set(key,structuredClone(row));
 const before=JSON.stringify([...f.rows]),service=createMerchantSettlementPreviewReader({db:f.db,authorizeBranch:async()=>{},readSchedule:async()=>({schemaVersion:1,version:1,frequency:'WEEKLY',anchorLocalDate:'2026-10-01',timezone:'Asia/Baghdad'})});
 const p=await service.preview({branchId:'branch1',orderIds:['order1','order2'],at:'2026-10-15T12:00:00.000Z'}),out=csv(p);
 assert.equal(p.summary.schemaVersion,3);assert.match(out.csv,/merchantDeliverySupport_IQD/);assert.match(out.csv,/platformDeliveryPromotionFunding_IQD/);assert.match(out.csv,/"merchantDeliverySupport","500"/);
 assert.equal(out.paymentAuthorized,false);assert.equal(JSON.stringify([...f.rows]),before);
});
test('existing batch writer freezes, reads and replays mixed evidence without rewriting accruals or money',async()=>{
 const x=await batch(2),{f}=await sources();
 for(const [key,row]of f.rows)if(row.orderId==='order1')x.f.rows.set(key,structuredClone(row));
 const money=()=>JSON.stringify([...x.f.rows].filter(([k])=>/^(staging-Wallets|staging-LedgerEntries)\|/.test(k))),before=money();
 const req=await x.request(['order1','order2']),r=await x.service.create(req);
 assert.equal(r.header.summary.schemaVersion,3);assert.deepEqual(r.lines.map(l=>l.accrual.schemaVersion).sort(),[1,2]);assert.equal(r.header.payoutAuthorized,false);
 assert.deepEqual((await x.service.read({branchId:'branch1',batchId:r.header.batchId})).header,r.header);
 assert.equal((await x.service.create(req)).replayed,true);assert.equal(money(),before);
});
