'use strict';
const fs=require('fs'),path=require('path'),Module=require('module'),assert=require('node:assert/strict');
process.env.AWS_REGION='us-east-1';
function runtime(file){const m=new Module(file,module);m.filename=file;m.paths=module.paths;m._compile(fs.readFileSync(file,'utf8')+'\nmodule.exports.testResolve=require_discount_reservation().resolveDiscount;',file);return m.exports.testResolve;}
(async()=>{
 for(const name of ['WizzUser-ApplyPromoCode-staging','WizzUser-ValidatePromoCode-staging','WizzUser-CreateOrder-staging']){
  const dir=path.join('/tmp/discount430',name),before=runtime(path.join(dir,'bundle-before.js')),after=runtime(path.join(dir,'bundle-after.js'));
  const base={discountId:'offer',businessId:'branch',status:'active',type:'percentage',value:40,applicability:'specificItems',applicable_item_ids:['burger'],calculationMode:'perItem',usage_count:0,usage_limit:null,version:1};
  const args=(row)=>({db:{async send(c){assert(c.input.Key);return {Item:row};}},branchId:'branch',discountId:'offer',subtotal:15000000,items:[{itemId:'burger',price:3000000,quantity:5}],deliveryFee:1500000,preview:true});
  await assert.rejects(before(args(base)),/calculationMode/);
  let r=await after(args(base));assert.equal(r.amount,5000000);assert.equal(r.lines.length,1);assert.equal(r.lines[0].savingsFils,5000000);assert.equal(r.lines[0].netFils,10000000);
  r=await after(args({...base,calculationMode:'order',applicability:'allItems',type:'fixedAmount',value:1000,minimum_order_amount:5000,applicable_item_ids:[]}));assert.equal(r.amount,1000000);assert.equal(r.lines.reduce((s,l)=>s+l.savingsFils,0),1000000);
  await assert.rejects(after({...args(base),branchId:'other'}),/DISCOUNT_UNAVAILABLE/);
  await assert.rejects(after({...args(base),items:[{itemId:'pizza',price:3000000,quantity:5}]}),/OFFER_NO_MATCHING_ITEMS/);
  await assert.rejects(after(args({...base,calculationMode:'order',applicability:'allItems',minimum_order_amount:20000})),/OFFER_MINIMUM_ORDER/);
  console.log('PASS',name,'live defect reproduced; per-item and fixed offer allocation, branch and product scope checked without writes');
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
