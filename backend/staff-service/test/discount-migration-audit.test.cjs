'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {audit}=require('../../../scripts/audit-discount-records.cjs');
test('pre-migration audit identifies aliases and duplicate codes without mutating exports',()=>{
 const rows=[{discountId:'a',type:'percentage',value:10,code:'SAVE',minOrderAmount:1,minOrderValue:2},{discountId:'b',type:'percentage',value:10,code:'SAVE'}];const original=JSON.stringify(rows);const report=audit(rows);
 assert.equal(report.readOnly,true);assert(report.issues.some(x=>x.code==='DISCOUNT_ALIASES_CONFLICT'));assert.equal(report.issues.filter(x=>x.code==='DUPLICATE_CODE').length,2);assert.equal(JSON.stringify(rows),original);
});
