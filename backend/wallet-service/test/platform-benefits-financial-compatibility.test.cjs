const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {patch}=require('../../../scripts/patch-platform-benefits-financial-compatibility.cjs');
const source=`function allocateDeliveryFundedOrder(value){return {legacy:true,value};}\nfunction verifyGoodsPromotionExposure(row,amount){return {legacy:true,row,amount};}\nmodule.exports={allocateDeliveryFundedOrder,verifyGoodsPromotionExposure};`;
function load(p){const calls=[],module={exports:{}};vm.runInNewContext(p.source,{module,require:name=>{assert.equal(name,'./compat.js');return {allocateDeliveryFundedOrder:v=>{calls.push(v);return 'gift-delivery';},verifyGoodsPromotionExposure:(r,a)=>{calls.push([r,a]);return 'gift-goods';}};}});return {api:module.exports,calls};}
test('compatibility patch delegates only new benefit contracts and preserves legacy paths',()=>{
 const p=patch(source,'./compat.js');assert.equal(p.proofs.length,2);const {api,calls}=load(p);
 assert.equal(api.allocateDeliveryFundedOrder({deliveryFunding:{policyPin:{policyId:'PLATFORM_BENEFIT#gift'}}}),'gift-delivery');assert.equal(api.allocateDeliveryFundedOrder({deliveryFunding:{policyPin:{policyId:'legacy'}}}).legacy,true);
 assert.equal(api.verifyGoodsPromotionExposure({schemaVersion:2,kind:'GOODS_BENEFIT_EXPOSURE'},750),'gift-goods');assert.equal(api.verifyGoodsPromotionExposure({schemaVersion:1,kind:'GOODS_PROMOTION_EXPOSURE'},750).legacy,true);assert.equal(calls.length,2);
 assert.equal(patch(p.source,'./compat.js').source,p.source);
});
test('compatibility patch refuses duplicate or changed factory signatures',()=>{
 assert.throws(()=>patch(source+'\nfunction allocateDeliveryFundedOrder(value){}','./compat.js'),/DUPLICATE/);
 assert.throws(()=>patch('function allocateDeliveryFundedOrder({value}){}','./compat.js'),/SIGNATURE/);
});
