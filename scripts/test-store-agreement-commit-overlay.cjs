'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {agreementPredicate,customerExpression}=require('./store-agreement-commit-overlay.cjs');
for(const name of ['c','c4','customer99'])test('agreement proof uses bundled customer '+name,()=>{
 const original=`!reservation || reservation.customerId !== ${name}.userId || !writes.some(x=>x.pk==='DELIVERY_BUDGET#') || !writes.some(x=>x.pk==='DELIVERY_USAGE#')`;
 const code=agreementPredicate(original,'../../agreement-runtime182.js');
 let calls=0;const ctx={deliveryFunding:{allocation:{schemaVersion:2}},operations:[],orderId:'order', [name]:{userId:'real-customer'}, require:()=>({hasStoreAgreementOrderEvidence:(ops,funding,id,user)=>{calls++;assert.equal(user,'real-customer');assert.equal(id,'order');return true;}})};
 assert.equal(vm.runInNewContext(code,ctx),false);assert.equal(calls,1);
 ctx.require=()=>({hasStoreAgreementOrderEvidence:()=>false});assert.equal(vm.runInNewContext(code,ctx),true);
 ctx.deliveryFunding.allocation.schemaVersion=1;ctx.reservation={customerId:'wrong'};assert.equal(vm.runInNewContext(code,ctx),true);
});
test('missing or ambiguous customer anchors refuse packaging',()=>{assert.throws(()=>customerExpression('no customer'),/CUSTOMER_BINDING_ANCHOR/);assert.throws(()=>customerExpression('reservation.customerId !== c.userId || reservation.customerId !== other.userId'),/CUSTOMER_BINDING_ANCHOR/);});
