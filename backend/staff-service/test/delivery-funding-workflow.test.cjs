'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {service}=require('../commercial-management');
const {fixture,owner,staff,call,P,S}=require('./helpers/commercial-fixture.cjs');
const {parseIqd:m}=require('../pricing-runtime/money');
const {readDeliveryFundingPolicy:read}=require('../pricing-runtime/deliveryFundingPolicy');
const catalog=require('../catalog'),roles=Object.keys(catalog.ROLES);
const er=roles.find(r=>catalog.allowed(staff('editor',r).actor,'commercial.funding.request'));
const ar=roles.find(r=>catalog.allowed(staff('reviewer',r).actor,'commercial.funding.approve'));
const editor=()=>staff('editor',er),reviewer=()=>staff('reviewer',ar);
const policy=()=>({schemaVersion:1,id:'delivery',version:1,merchantId:'merchant',branchId:'branch',origin:'PLATFORM',effectiveFrom:'2026-10-16T00:00:00.000Z',effectiveTo:'2026-10-25T00:00:00.000Z',customerRule:{kind:'CAPPED_PRICE',amount:m('1500')},funding:{kind:'PLATFORM'},eligibility:{regionIds:['zone'],maximumRoadMeters:5000,minimumGoods:m('10000'),minimumGoodsBasis:'AFTER_GOODS_DISCOUNTS',audience:'ALL',goodsDiscountStacking:'ALLOW'},limits:{merchantPerOrder:m('0'),platformPerOrder:m('2500'),merchantBudget:m('0'),platformBudget:m('100000'),perCustomerUses:3},onUnavailable:'NORMAL_TARIFF'});
const save=()=>({businessId:'branch',action:'SAVE_DELIVERY',id:'delivery',requestId:randomUUID(),draftVersion:0,baseVersion:0,businessIds:['branch'],values:policy(),reason:'اقتراح تمويل توصيل'});
const decision=(r,action)=>({businessId:'branch',action,id:'delivery',requestId:randomUUID(),draftVersion:r.draftVersion,baseVersion:0,hash:r.hash,...(action==='ACCEPT_DELIVERY'?{}:{reason:'اعتماد تمويل التوصيل'})});
function setup(){const f=fixture();f.ctx.deliveryFundingEnabled=true;f.ctx.employee=async()=>editor().actor;f.put(S,{pk:'EMPLOYEE#editor',sk:'PROFILE',...editor().actor});return f;}
test('staff sends and owner acceptance atomically activates exact immutable policy',async()=>{
 const f=setup(),r=await call(f,editor(),save());assert.equal(f.get(S,{pk:'DELIVERY_FUNDING#delivery',sk:'CURRENT'}),undefined);
 const result=await call(f,owner,decision(r,'ACCEPT_DELIVERY'));assert.equal(result.publishedVersion,1);
 const current=f.get(S,{pk:'DELIVERY_FUNDING#delivery',sk:'CURRENT'});assert.equal(current.acceptedBy,'owner');assert.equal(current.approvedBy,'editor');assert.equal(current.activationMode,'STAFF_SEND_MERCHANT_ACCEPT');assert.equal(current.termsHash,read(policy()).termsHash);
 assert.deepEqual(f.get(S,{pk:current.pk,sk:'VERSION#1'}).policy,current.policy);
 const activation=f.commands.filter(c=>c.constructor.name==='TransactWriteCommand').at(-1).input.TransactItems;
 assert.ok(activation.some(x=>x.Put?.Item.pk==='DELIVERY_BUDGET#delivery'));assert.ok(activation.some(x=>x.Put?.Item.sk==='CONSENT#1'));assert.ok(activation.some(x=>x.Put?.Item.sk==='CURRENT'));assert.ok(activation.some(x=>x.ConditionCheck?.Key.pk==='EMPLOYEE#editor'));
 await assert.rejects(call(f,reviewer(),decision(r,'APPROVE_DELIVERY')),/INVALID_COMMERCIAL_ACTION/);
});
test('gate permissions branch merchant and version stay enforced',async()=>{
 const f=setup();f.ctx.deliveryFundingEnabled=false;await assert.rejects(call(f,editor(),save()),/DELIVERY_FUNDING_MANAGEMENT_DISABLED/);
 f.ctx.deliveryFundingEnabled=true;await assert.rejects(call(f,owner,save()),/PERMISSION_REQUIRED/);await assert.rejects(call(f,staff('outsider','unknown'),save()),/PERMISSION_REQUIRED/);
 for(const edit of [x=>x.values.branchId='sibling',x=>x.values.merchantId='foreign',x=>x.values.version=2,x=>x.businessIds.push('sibling')]){const g=setup(),x=save();edit(x);await assert.rejects(call(g,editor(),x));}
});
test('changed pending terms require acceptance of the new hash',async()=>{
 const f=setup(),r=await call(f,editor(),save()),x=save();x.draftVersion=r.draftVersion;x.values.limits.platformBudget=m('200000');const next=await call(f,editor(),x);
 await assert.rejects(call(f,owner,decision({...next,hash:r.hash},'ACCEPT_DELIVERY')),/VERSION_OR_STATE_CONFLICT/);
 assert.equal(f.get(S,{pk:'DELIVERY_FUNDING#delivery',sk:'CURRENT'}),undefined);
 assert.equal((await call(f,owner,decision(next,'ACCEPT_DELIVERY'))).publishedVersion,1);
});
test('revoked or changed sender prevents consent and activation together',async()=>{
 for(const patch of [{status:'REVOKED'},{roles:['unknown']},{version:2}]){const f=setup(),r=await call(f,editor(),save());f.put(S,{pk:'EMPLOYEE#editor',sk:'PROFILE',...editor().actor,...patch});await assert.rejects(call(f,owner,decision(r,'ACCEPT_DELIVERY')),/REQUESTER_PERMISSION_REVOKED/);assert.equal(f.get(S,{pk:'DELIVERY_FUNDING#delivery',sk:'CONSENT#1'}),undefined);assert.equal(f.get(S,{pk:'DELIVERY_FUNDING#delivery',sk:'CURRENT'}),undefined);}
});
test('owner retry and another authorized party never activate twice or replace signer',async()=>{
 const f=setup(),x=save(),r=await call(f,editor(),x);assert.equal((await call(f,editor(),x)).replayed,true);
 const accept=decision(r,'ACCEPT_DELIVERY');await call(f,owner,accept);assert.equal((await call(f,owner,accept)).replayed,true);
 assert.equal((await call(f,owner,decision(r,'ACCEPT_DELIVERY'))).alreadyAccepted,true);
 assert.equal(f.get(S,{pk:'DELIVERY_FUNDING#delivery',sk:'CURRENT'}).version,1);
});
test('two-step activation works independently of global direct mode',async()=>{
 const before={...process.env};try{process.env.PLATFORM_ENVIRONMENT='staging';process.env.PLATFORM_WRITE_MODE='DIRECT';const f=setup(),r=await call(f,editor(),save());assert.equal((await call(f,owner,decision(r,'ACCEPT_DELIVERY'))).publishedVersion,1);}finally{for(const k of Object.keys(process.env))if(!(k in before))delete process.env[k];Object.assign(process.env,before);}
});
test('active manager activates while revoked manager cannot consent',async()=>{
 for(const status of ['ACTIVE','REVOKED']){const f=setup();f.put(P,{pk:'BRANCH#branch',sk:'MEMBER#manager',subjectId:'manager',businessId:'branch',ownerId:'owner',role:'MANAGER',status,version:1});const r=await call(f,editor(),save());if(status==='REVOKED')await assert.rejects(call(f,{kind:'OWNER',sub:'manager'},decision(r,'ACCEPT_DELIVERY')),/BUSINESS_UNAVAILABLE/);else{await call(f,{kind:'OWNER',sub:'manager'},decision(r,'ACCEPT_DELIVERY'));assert.equal(f.get(S,{pk:'DELIVERY_FUNDING#delivery',sk:'CURRENT'}).acceptedBy,'manager');assert.equal((await call(f,owner,decision(r,'ACCEPT_DELIVERY'))).alreadyAccepted,true);}}
});
test('approved terms appear in existing view',async()=>{
 const f=setup(),r=await call(f,editor(),save());await call(f,owner,decision(r,'ACCEPT_DELIVERY'));const view=await service(f.ctx,owner,'GET',{businessId:'branch'});assert.deepEqual(view.items.find(x=>x.draft.kind==='DELIVERY').current.policy,policy());
});
test('transaction conflict leaves no consent or published policy',async()=>{
 const f=setup(),r=await call(f,editor(),save());f.break();await assert.rejects(call(f,owner,decision(r,'ACCEPT_DELIVERY')),/VERSION_OR_STATE_CONFLICT/);assert.equal(f.get(S,{pk:'DELIVERY_FUNDING#delivery',sk:'CURRENT'}),undefined);assert.equal(f.get(S,{pk:'DELIVERY_FUNDING#delivery',sk:'CONSENT#1'}),undefined);
});

test('delivery send commits notice and appears pending until merchant activates',async()=>{
 const f=setup(),r=await call(f,editor(),save());const n=f.get(S,{pk:'DELIVERY_FUNDING#delivery',sk:'NOTICE#1'});assert.equal(n.eventId,'delivery:delivery:1');
 assert.equal((await service(f.ctx,owner,'GET',{businessId:'branch',view:'pending-sharing'})).items.length,1);
 await call(f,owner,decision(r,'ACCEPT_DELIVERY'));assert.equal((await service(f.ctx,owner,'GET',{businessId:'branch',view:'pending-sharing'})).items.length,0);
});

test('dated agreement consent publishes commission and public terms without campaign budget',async()=>{
 const f=setup(),input=save(),p=input.values;delete p.limits;delete p.onUnavailable;p.schemaVersion=2;p.customerRule={kind:'FIXED_TARIFF',amount:m('1500')};p.eligibility={regionIds:['zone'],minimumGoods:m('7000')};p.commission={kind:'PERCENT',basis:'GOODS_GROSS',fixed:null,rate:{numerator:5,denominator:100},rounding:'TOWARD_ZERO',finalRounding:{incrementIqd:1,mode:'TOWARD_ZERO'}};
 const pending=await call(f,editor(),input);assert.equal(f.get('WhizzMerchants_Businesses',{businessId:'branch'}).storefrontDeliveryAgreements,undefined);
 await call(f,owner,decision(pending,'ACCEPT_DELIVERY'));
 const current=f.get(S,{pk:'DELIVERY_FUNDING#delivery',sk:'CURRENT'});assert.equal(current.policy.commission.rate.numerator,5);assert.equal(f.get(S,{pk:'DELIVERY_BUDGET#delivery',sk:'VERSION#1'}),undefined);
 const b=f.get('WhizzMerchants_Businesses',{businessId:'branch'});assert.equal(b.storefrontDeliveryAgreements[0].deliveryFeeIqd,1500);assert.equal(b.storefrontDeliveryAgreements[0].minimumOrderAmountIqd,7000);assert.equal(b.storefrontDeliveryAgreements[0].commission,undefined);
});
