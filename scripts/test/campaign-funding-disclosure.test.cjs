'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {describe}=require('../../frontend/campaign-funding-disclosure');
test('source funding is disclosed without treating a funding reference as proof of sharing',()=>{
 for(const source of ['merchant','platform','campaign']){
  const before=describe({source,type:'percentage'},true);
  const withReference=describe({source,type:'percentage',fundingPolicyId:'historical',fundingPolicyVersion:2},true);
  assert.deepEqual(before,withReference);
  assert.ok(before.summary.includes(source==='merchant'?'المتجر':'المنصة'));
  assert.ok(before.summary.includes('افتراضياً'));
  assert.ok(before.changeNotice.includes('جدّد الموافقة'));
 }
});
test('activation does not claim new consent, and delivery funding is separately authorized',()=>{
 assert.ok(describe({source:'merchant',type:'percentage'}).changeNotice.includes('لا ينشئ اتفاقية'));
 for(const type of ['freeDelivery','free_delivery','free-delivery']){
  const text=describe({source:'merchant',type},true);
  assert.ok(text.summary.includes('سياسة تمويل توصيل معتمدة'));
  assert.ok(!text.summary.includes('يتحمل المتجر'));
 }
 assert.ok(!describe({source:'unknown',type:'percentage'}).summary.includes('يتحمل المنصة'));
});
