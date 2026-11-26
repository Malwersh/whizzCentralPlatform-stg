const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {patch}=require('../../../scripts/patch-platform-benefits-lifecycle.cjs');
for(const suffix of ['', '8'])test('delivery lifecycle patch accepts published renamed bindings '+(suffix||'original'),async()=>{
 const source=`async function strongGet(db,table,key){return db.order;}
 function createStagingDeliveryCampaignBudget(options){const {db}=options;${'/* known factory body */'.repeat(50)}return {async settle(value){const r${suffix}=value;const h=await get${suffix}(holdKey(r${suffix}.orderId));return h;}};}
 module.exports={createStagingDeliveryCampaignBudget};`;
 const p=patch(source,'./benefits.js');assert.equal(p.proofs.length,1);let call;const module={exports:{}};
 vm.runInNewContext(p.source,{module,require:()=>({settlePlatformBenefit:async(db,input)=>{call=input;return {operations:[],replayed:false};}})});
 const order={status:'assigned',platformDeliveryBenefitReceipt:{target:'DELIVERY',campaignId:'gift'}};
 await module.exports.createStagingDeliveryCampaignBudget({db:{order}}).settle({orderId:'order',outcome:'CAPTURED',expectedFunding:{policyPin:{policyId:'PLATFORM_BENEFIT#gift'}}});assert.equal(call.orderId,'order');assert.equal(call.keepUse,true);assert.equal(call.outcome,'CAPTURED');assert.equal(patch(p.source,'./benefits.js').source,p.source);
});
