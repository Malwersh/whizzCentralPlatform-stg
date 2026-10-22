'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./helpers/commercial-source-fixture.cjs');
const {createStagingCommercialSource:create}=require('../dist/orderCommercialSource');
const source=o=>create({...o,enableFullCash:true});
test('new order pins budget commitment with no platform cash dependency',async()=>{
 const f=fixture('org','owner',source);f.funded();Object.assign(f.input.discount.campaign,{usage_limit:10,type:'fixedAmount',value:1000});f.records.delete('staging-Wallets|'+JSON.stringify({walletId:'WALLET#PLATFORM',sk:'META'}));
 const r=await f.prepare();assert.equal(r.financialSnapshot.schemaVersion,3);assert.equal(r.funding.holdId,null);
 assert.equal(f.calls.some(c=>c.input.Key?.walletId==='WALLET#PLATFORM'),false);
 const commitment=r.operations.find(x=>x.Put?.Item.sk==='FULL_CASH_FUNDING_COMMITMENT')?.Put.Item;
 assert.equal(commitment.status,'COMMITTED');assert.equal(commitment.snapshotDigest,r.financialSnapshot.digest);
 assert.equal(commitment.platformGoodsFunding.minorAmount,500000);
 assert.equal(r.operations.some(x=>x.Update?.TableName==='staging-Wallets'),false);
 assert.equal(r.operations.some(x=>x.Put?.Item.sk==='PROMOTION_FUNDING'),false);
});
test('budget model preserves agreement and owner consent checks',async()=>{
 const f=fixture('org','owner',source);f.funded();f.change('staging-MerchantPlatform',{pk:'COMMERCIAL_AGREEMENT#a1',sk:'ACCEPTANCE#1'}).subjectId='foreign';
 await assert.rejects(f.prepare());
});
test('platform-funded goods require a finite approved campaign exposure instead of falling back to wallet cash',async()=>{
 const f=fixture('org','owner',source);f.funded();await assert.rejects(f.prepare(),/PLATFORM_GOODS_EXPOSURE_LIMIT_REQUIRED/);
 assert.equal(f.calls.some(c=>c.input.Key?.walletId==='WALLET#PLATFORM'),false);
});
