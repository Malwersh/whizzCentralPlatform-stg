'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{prepareGoodsPromotionExposure:prepare,verifyGoodsPromotionExposure:verify}=require('../dist/goodsPromotionExposure'),{fromWholeIqd:m}=require('../dist/money');
const campaign={discountId:'campaign',version:1,type:'fixedAmount',value:1000,usageLimit:10};
test('approved per-use amount and finite use count bound aggregate goods promotion exposure',()=>{
 const e=prepare(campaign,'PLATFORM',m(500));assert.equal(e.maximumCampaignExposure.minorAmount,10000000);assert.equal(e.platformAmount.minorAmount,500000);assert.deepEqual(verify(e,m(500)),e);
 const percent=prepare({...campaign,type:'percentage',value:10,maxDiscount:2000},'PLATFORM',m(700));assert.equal(percent.perUseCap.minorAmount,2000000);
});
test('unbounded, contradictory, overflowed or tampered exposure cannot authorize funding',()=>{
 for(const edit of [{usageLimit:0},{usageLimit:null},{type:'percentage',maxDiscount:null},{value:100},{usageLimit:Number.MAX_SAFE_INTEGER}])assert.throws(()=>prepare({...campaign,...edit},'PLATFORM',m(500)));
 const e=prepare(campaign,'PLATFORM',m(500));assert.throws(()=>verify({...e,usageLimit:100},m(500)));assert.throws(()=>verify(e,m(501)));
});
