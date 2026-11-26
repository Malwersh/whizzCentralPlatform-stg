'use strict';
const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict'),test=require('node:test');
test('live Arabic RBAC shell preserves dedicated pricing editor/approver/viewer boundaries',()=>{
 const context={window:{location:{pathname:'/index.html'}},console:{log(){},warn(){}},sessionStorage:{getItem:()=>null},localStorage:{getItem:()=>null}};
 vm.runInNewContext(fs.readFileSync('frontend/assets/js/rbac.js','utf8'),context);
 const r=context.window.RBAC;
 for(const [role,permissions,write] of [['pricing_editor',['pricing.read','pricing.request'],true],['pricing_approver',['pricing.read','pricing.approve'],true],['pricing_viewer',['pricing.read','pricing.simulate'],false]]){
  r.staff={employee:{roles:[role]},permissions};assert.equal(r.hasPageAccess('delivery-pricing.html'),true);assert.equal(r.can('pricing','read'),true);assert.equal(r.can('pricing','write'),write);assert.equal(r.can('financial','write'),false);
 }
 r.staff={employee:{roles:['finance_settings']},permissions:['finance.read','finance.settings.request']};assert.equal(r.hasPageAccess('delivery-pricing.html'),false);assert.equal(r.can('pricing','write'),false);
});
test('commercial roles can open existing merchant/campaign areas without gaining their legacy writes',()=>{
 const context={window:{location:{pathname:'/index.html'}},console:{log(){},warn(){}},sessionStorage:{getItem:()=>null},localStorage:{getItem:()=>null}};vm.runInNewContext(fs.readFileSync('frontend/assets/js/rbac.js','utf8'),context);const r=context.window.RBAC;
 r.staff={employee:{roles:['commercial_editor']},permissions:['commercial.read','commercial.request','commercial.funding.request']};
 for(const page of ['merchants.html','promotions.html'])assert.equal(r.hasPageAccess(page),true);
 for(const domain of ['merchants','campaigns','financial'])assert.equal(r.can(domain,'write'),false);
 r.staff={employee:{roles:['finance_operator']},permissions:['finance.read','finance.request']};assert.equal(r.hasPageAccess('merchants.html'),false);
});
