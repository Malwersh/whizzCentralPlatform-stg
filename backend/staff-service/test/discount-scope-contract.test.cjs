'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const engine=require('../discount-engine');
const {supported}=require('../discount-contract');
const merchant={type:'percentage',value:10,status:'active',usage_count:0,minimum_order_amount:0};
const platform={type:'percentage',value:10,status:'active',usage:0,currentUsage:0,minOrderAmount:0};

for(const [applicability,key] of [['specificItems','applicable_item_ids'],['specificCategories','applicable_category_ids']]) {
 test(applicability+' rejects empty and malformed selections for both discount sources',()=>{
  for(const selection of [undefined,null,[],[''],['   '],[42],'product']) {
   for(const [raw,normalize,validate] of [[merchant,engine.normalizeDiscount,engine.validateDiscount],[platform,engine.normalizePlatformPromo,engine.validatePlatformPromo]]) {
    const row={...raw,applicability,[key]:selection};
    assert.equal(supported(row),false);
    assert.equal(validate(normalize(row),1000000).valid,false);
   }
  }
 });
 test(applicability+' accepts selected IDs and calculates only eligible lines',()=>{
  for(const [raw,normalize,validate] of [[merchant,engine.normalizeDiscount,engine.validateDiscount],[platform,engine.normalizePlatformPromo,engine.validatePlatformPromo]]) {
   const d=normalize({...raw,applicability,[key]:['selected']});
   assert.equal(supported(d),true);
   assert.equal(validate(d,3000000).valid,true);
   assert.equal(engine.calculateDiscountAmount(d,3000000,[
    {itemId:'selected',categoryId:'selected',price:1000000,quantity:1},
    {itemId:'other',categoryId:'other',price:2000000,quantity:1}
   ],0),100000);
  }
 });
}
test('unscoped historical offers still accept absent selection arrays',()=>{
 for(const applicability of [undefined,'allItems','minimumOrder'])assert.equal(supported({...merchant,applicability}),true);
});
