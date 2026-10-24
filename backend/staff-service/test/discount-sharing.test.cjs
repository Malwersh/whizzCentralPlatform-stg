'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {service}=require('../commercial-management');
const {fixture,owner,staff,call,P,S}=require('./helpers/commercial-fixture.cjs');
const editor=()=>staff('editor','funding_editor'),reviewer=()=>staff('reviewer','funding_approver');
// Use the existing dedicated catalog role names.
const catalog=require('../catalog');
const roles=Object.keys(catalog.ROLES);const er=roles.find(r=>catalog.allowed({...editor().actor,roles:[r]},'commercial.funding.request')),ar=roles.find(r=>catalog.allowed({...reviewer().actor,roles:[r]},'commercial.funding.approve'));
const writer=()=>staff('editor',er),approver=()=>staff('reviewer',ar);
const campaign=()=>({discountId:'offer',version:1,type:'fixedAmount',value:500,usageLimit:100,usage_limit:100,businessId:'branch',title:'خصم الاختبار',status:'active',valid_from:'2026-10-01T00:00:00.000Z',valid_to:'2026-11-01T00:00:00.000Z'});
const values=()=>({campaignId:'offer',campaignVersion:1,source:'MERCHANT',effectiveFrom:campaign().valid_from,effectiveTo:campaign().valid_to,merchantNumerator:30,denominator:100,merchantShareFinalRounding:{incrementIqd:1,mode:'TOWARD_ZERO'}});
const save=(v=values())=>({businessId:'branch',action:'SAVE_FUNDING',id:'share',requestId:randomUUID(),draftVersion:0,baseVersion:0,businessIds:['branch'],values:v,reason:'مشاركة خصم الاختبار'});
const decide=(r,action)=>({businessId:'branch',action,id:'share',requestId:randomUUID(),draftVersion:r.draftVersion,baseVersion:0,hash:r.hash,...(action==='ACCEPT_FUNDING'?{}:{reason:'اعتماد المشاركة'})});
function setup(){const f=fixture();f.put('WhizzMerchants_Discounts',campaign());f.ctx.employee=async()=>writer().actor;return f;}
test('sharing requires actual owner consent separately from commission agreement and does not mutate campaign',async()=>{
 const f=setup(),before=structuredClone(campaign()),saved=await call(f,writer(),save());
 assert.equal(f.get(S,{pk:'DISCOUNT_FUNDING#share',sk:'CURRENT'}),undefined);
 await assert.rejects(call(f,approver(),decide(saved,'APPROVE_FUNDING')),/OWNER_ACCEPTANCE_REQUIRED/);
 const items=await service(f.ctx,owner,'GET',{businessId:'branch'});assert.equal(items.items[0].draft.kind,'FUNDING');assert.equal(items.items[0].campaignLabel,'خصم الاختبار');
 await call(f,owner,decide(saved,'ACCEPT_FUNDING'));await call(f,approver(),decide(saved,'APPROVE_FUNDING'));
 const policy=f.get(S,{pk:'DISCOUNT_FUNDING#share',sk:'CURRENT'});assert.equal(policy.schemaVersion,3);assert.equal(policy.acceptedBy,'owner');assert.equal(policy.merchantNumerator,30);
 const binding=f.get(P,{pk:'BRANCH#branch',sk:'COMMERCIAL_SHARING#MERCHANT#offer'});assert.equal(binding.policyId,'share');
 assert.deepEqual(f.get('WhizzMerchants_Discounts',{discountId:'offer'}),before);assert.equal(f.get(P,{pk:'COMMERCIAL_AGREEMENT#contract',sk:'CURRENT'}),undefined);
});
test('sharing rejects zero/full shares, foreign campaigns, invented dates and campaign changes before consent',async()=>{
 for(const patch of [{merchantNumerator:0},{merchantNumerator:100},{effectiveTo:'2026-12-01T00:00:00.000Z'},{campaignVersion:2}]){const f=setup();await assert.rejects(call(f,writer(),save({...values(),...patch})));}
 const f=setup(),saved=await call(f,writer(),save());f.put('WhizzMerchants_Discounts',{...campaign(),version:2});await assert.rejects(call(f,owner,decide(saved,'ACCEPT_FUNDING')),/CAMPAIGN_VERSION_REQUIRED/);
 const g=setup();g.put('WhizzMerchants_Discounts',{...campaign(),businessId:'sibling'});await assert.rejects(call(g,writer(),save()),/CAMPAIGN_VERSION_REQUIRED/);
});
test('direct mode saves pending sharing and publishes recorded staff intent only after owner acceptance; retry is stable',async()=>{
 const old={...process.env};process.env.PLATFORM_ENVIRONMENT='staging';process.env.PLATFORM_WRITE_MODE='DIRECT';process.env.PLATFORM_DIRECT_OPERATOR_IDS='editor';
 try{const f=setup();f.put(S,{pk:'EMPLOYEE#editor',sk:'PROFILE',...writer().actor});const saved=await call(f,writer(),save());assert.equal(f.get(S,{pk:'DISCOUNT_FUNDING#share',sk:'CURRENT'}),undefined);const input=decide(saved,'ACCEPT_FUNDING');assert.equal((await call(f,owner,input)).publishedVersion,1);assert.equal((await call(f,owner,input)).publishedVersion,1);}finally{for(const k of ['PLATFORM_ENVIRONMENT','PLATFORM_WRITE_MODE','PLATFORM_DIRECT_OPERATOR_IDS'])if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];}
});
test('a platform campaign can share independently with two branches without overwriting campaign linkage',async()=>{
 const f=setup();f.put('WizzCentral_Platform_Discounts',{...campaign(),businessId:undefined});const v={...values(),source:'PLATFORM'};
 for(const branch of ['branch','sibling']){const body={...save(v),id:'share-'+branch,businessId:branch,businessIds:[branch]},r=await call(f,writer(),body);for(const action of ['ACCEPT_FUNDING','APPROVE_FUNDING'])await call(f,action==='ACCEPT_FUNDING'?owner:approver(),{...decide(r,action),businessId:branch,id:body.id});}
 assert.equal(f.get(P,{pk:'BRANCH#branch',sk:'COMMERCIAL_SHARING#PLATFORM#offer'}).policyId,'share-branch');assert.equal(f.get(P,{pk:'BRANCH#sibling',sk:'COMMERCIAL_SHARING#PLATFORM#offer'}).policyId,'share-sibling');assert.equal(f.get('WizzCentral_Platform_Discounts',{discountId:'offer'}).fundingPolicyId,undefined);
});
test('owner pending-sharing view contains only live unaccepted current campaign requests',async()=>{
 const f=setup(),r=await call(f,writer(),save());assert.equal((await service(f.ctx,owner,'GET',{businessId:'branch',view:'pending-sharing'})).items.length,1);await call(f,owner,decide(r,'ACCEPT_FUNDING'));assert.equal((await service(f.ctx,owner,'GET',{businessId:'branch',view:'pending-sharing'})).items.length,0);
 const g=setup();await call(g,writer(),save());g.put('WhizzMerchants_Discounts',{...campaign(),version:2});assert.equal((await service(g.ctx,owner,'GET',{businessId:'branch',view:'pending-sharing'})).items.length,0);
 await assert.rejects(service(g.ctx,{kind:'OWNER',sub:'other'},'GET',{businessId:'branch',view:'pending-sharing'}),/BUSINESS_UNAVAILABLE/);
});

test('missing total campaign cap rejects sharing before saving or asking for consent',async()=>{const f=setup();f.put('WhizzMerchants_Discounts',{...campaign(),usageLimit:null,usage_limit:null,perCustomerLimit:1});await assert.rejects(call(f,writer(),save()),/FUNDING_TOTAL_USAGE_LIMIT_REQUIRED/);assert.equal(f.get(S,{pk:'DISCOUNT_FUNDING#share',sk:'DRAFT'}),undefined);});
