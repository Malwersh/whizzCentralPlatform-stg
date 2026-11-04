'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {hasDiscountCustomizations:has}=require('../discount-contract');
test('all selection aliases require authoritative option pricing, including free choices',()=>{
 for(const key of ['modifiers','customizations','selectedOptions','selected_options','variantId','variant_id','sizeId','size_id']){
  const value=key==='modifiers'?[{id:'extra',price:0}]:key.includes('Id')||key.includes('_id')?'large':{group:['choice']};
  assert.equal(has([{id:'product',[key]:value}]),!['customizations','selectedOptions','selected_options'].includes(key),key);
 }
 assert.equal(has([{modifiers:{}}]),true);
 assert.equal(has([{selectedOptions:{group:[]},selected_options:{other:['choice']}}]),true);
});
test('plain products, empty groups and instructions remain supported',()=>{
 for(const row of [{id:'product'},{selected_options:{}},{selected_options:{group:[]}},{modifiers:[],customizations:[]},
  {selectedOptions:{group:[]},specialInstructions:'بدون ملح'}])assert.equal(has([row]),false);
});

test('canonical selections survive both aliases while conflicts and injected prices are rejected',()=>{
 const {discountGoodsSelection:select}=require('../discount-contract');
 assert.deepEqual(select({id:'p',quantity:2,selected_options:{sides:['salad'],empty:[]},selectedOptions:{sides:['salad']}}),{productId:'p',quantity:2,selectedOptions:{sides:['salad']}});
 for(const item of [{selected_options:{sides:['salad']},customizations:{sides:['rice']}},{selected_options:{sides:['salad','salad']}},{selected_options:{sides:[{id:'salad',price:1}]}}])assert.equal(has([item]),true);
});
