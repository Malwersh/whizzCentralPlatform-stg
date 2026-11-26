'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'../../..');
const runtime=path.resolve(root,'../wizzuser-stg/backend/src/functions/create-order/quote-runtime');
test('customer Lambda package includes transitive pricing and funding dependencies',()=>{
 execFileSync(process.execPath,[path.join(root,'scripts/sync-delivery-quote-order-runtime.cjs'),'--check'],{cwd:root});
 const source=`const p=${JSON.stringify(runtime)};for(const name of ['orderCommercialSource','deliveryQuoteOrder','deliveryPromotionSelection'])require(p+'/'+name);const authority=require(p+'/authority/catalog');if(!authority.allowed({status:'ACTIVE',roles:['commercial_editor']},'commercial.funding.request'))throw Error('PACKAGED_AUTHORITY_FAILED');`;
 // Fresh process catches missing imports that VM handler fixtures can hide with mocks.
 execFileSync(process.execPath,['-e',source],{cwd:root});
 assert.equal(typeof require(path.join(runtime,'deliveryPromotionSelection')).createStagingDeliveryPromotionSelection,'function');
});
test('packaged authority matches the canonical staff and branch-manager rules',()=>{
 for(const name of ['catalog','commercial-party','write-workflow'])assert.equal(
  fs.readFileSync(path.join(runtime,'authority',name+'.js'),'utf8'),
  fs.readFileSync(path.join(root,'backend/staff-service',name+'.js'),'utf8'));
 const source=fs.readFileSync(path.join(runtime,'deliveryFundingReader.js'),'utf8');
 assert.ok(source.includes('./authority/catalog'));
 assert.ok(source.includes('./authority/commercial-party'));
 assert.ok(!source.includes('../../staff-service/'));
});
