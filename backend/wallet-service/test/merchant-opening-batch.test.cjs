'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {fixture}=require('./helpers/merchant-settlement-batch-fixture.cjs');
const {createMerchantSettlementBatchService:create}=require('../dist/merchantSettlementBatch');
const {merchantOpeningPeriod}=require('../dist/merchantOpeningPeriod');
const {assembleMerchantSettlementPreview,readMerchantAccrualEvidence}=require('../dist/merchantSettlementPreview');
async function opening(){
 const x=await fixture(),row=x.f.get('staging-MerchantPlatform',{pk:'BRANCH#branch1',sk:'SETTLEMENT_SCHEDULE#CURRENT'});row.schedule.anchorLocalDate='2026-10-20';
 const period=merchantOpeningPeriod(row.schedule,'2026-10-01');
 const evidence=await readMerchantAccrualEvidence(x.db,'branch1','order1');
 const preview=assembleMerchantSettlementPreview('branch1',period,[evidence.accrual]);
 let clock=Date.parse('2026-10-21T00:00:00.000Z');
 const service=create({db:x.db,authorizeBranch:x.authorize,readSchedule:x.readSchedule,readOpeningSchedule:x.readSchedule,now:()=>clock});
 const request={kind:'OPENING',fromLocalDate:'2026-10-01',branchId:'branch1',at:period.untilExclusiveUtc,orderIds:['order1'],previewId:preview.previewId,requestId:randomUUID()};
 return {...x,service,request,clock:v=>clock=Date.parse(v)};
}
test('independent opening statement freezes old rights, leaves recurring anchor intact, and cannot claim twice',async()=>{
 const x=await opening(),r=await x.service.create(x.request);assert.equal(r.header.period.kind,'MERCHANT_OPENING_PERIOD');
 assert.equal(r.header.summary.amounts.merchantNet.minorAmount,9000000);assert.equal(r.header.payoutAuthorized,false);
 assert.equal(x.f.get('staging-MerchantPlatform',{pk:'BRANCH#branch1',sk:'SETTLEMENT_SCHEDULE#CURRENT'}).schedule.anchorLocalDate,'2026-10-20');
 assert.equal((await x.service.read({branchId:'branch1',batchId:r.header.batchId})).header.batchDigest,r.header.batchDigest);
 assert.equal((await x.service.create(x.request)).replayed,true);
 await assert.rejects(x.service.create({...x.request,requestId:randomUUID()}));
});
test('opening statement cannot freeze before cutoff or substitute a client-selected cutoff',async()=>{
 const x=await opening();x.clock('2026-10-19T20:00:00.000Z');await assert.rejects(x.service.create(x.request),/SETTLEMENT_PERIOD_STILL_OPEN/);
 x.clock('2026-10-21T00:00:00.000Z');await assert.rejects(x.service.create({...x.request,at:'2026-10-15T21:00:00.000Z'}),/INVALID_SETTLEMENT_BATCH_REQUEST/);
});
