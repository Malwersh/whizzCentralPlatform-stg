'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const workflow=require('../write-workflow'),catalog=require('../catalog'),pricing=require('../delivery-pricing');
const {fixture,save,decision,owner,editor,call,P,S,B}=require('./helpers/commercial-fixture.cjs');
const sample=require('../../../frontend/finance-sample-64.json');
const enabled=async fn=>{const prior={...process.env};process.env.PLATFORM_ENVIRONMENT='staging';process.env.PLATFORM_WRITE_MODE='DIRECT';process.env.PLATFORM_DIRECT_OPERATOR_IDS='editor';try{await fn();}finally{for(const k of ['PLATFORM_ENVIRONMENT','PLATFORM_WRITE_MODE','PLATFORM_DIRECT_OPERATOR_IDS'])if(prior[k]===undefined)delete process.env[k];else process.env[k]=prior[k];}};
test('direct mode is Staging-only, identity allowlisted, active and permission scoped',()=>enabled(async()=>{
 assert.equal(workflow.direct(),true);assert.ok(catalog.allowed(editor().actor,'pricing.request'));
 assert.equal(catalog.allowed({...editor().actor,employeeId:'other'},'pricing.request'),false);
 assert.equal(catalog.allowed({...editor().actor,status:'SUSPENDED'},'pricing.request'),false);
 process.env.PLATFORM_ENVIRONMENT='production';assert.equal(workflow.direct(),false);assert.equal(catalog.allowed(editor().actor,'pricing.request'),false);
}));
test('direct pricing publishes current/history/closed draft/audit atomically, retaining conflict fences',()=>enabled(async()=>{
 const records=new Map(),transactions=[];const ctx={table:'staff',enrolled:true,recent:()=>{},claims:{},guard:a=>({ConditionCheck:{TableName:'staff',Key:{pk:'EMPLOYEE#'+a.employeeId,sk:'PROFILE'}}}),audit:(id,action,before,after,key)=>({Put:{TableName:'staff',Item:{pk:'AUDIT',sk:key,action,actorId:id}}}),db:{send:async c=>{if(c.constructor.name==='GetCommand')return {Item:records.get(c.input.Key.sk)};transactions.push(c.input.TransactItems);for(const x of c.input.TransactItems)if(x.Put?.Item.pk===pricing.PK)records.set(x.Put.Item.sk,x.Put.Item);return {};}}};
 const result=await pricing.route(ctx,editor().actor,'POST','/staff/pricing/draft',{baseVersion:0,draftVersion:0,values:structuredClone(sample.pricing),reason:'Direct test prices'});
 assert.equal(result.status,'PUBLISHED');assert.equal(transactions.length,1);assert.equal(records.get('CURRENT').version,1);assert.equal(records.get('DRAFT').publishedVersion,1);assert.equal(records.get('CURRENT').values.deliveryRules[0].status,'PUBLISHED');assert.ok(records.get('VERSION#000000000001'));
 const at='2026-10-17T12:00:00.000Z',leg={id:'simulated',source:'ADMIN_SIMULATION',quality:'ROAD',fallbackPolicyId:null,distanceMeters:2000,durationSeconds:600,measuredAt:at,expiresAt:'2026-10-17T12:10:00.000Z'};
 const sim={source:'DRAFT',version:1,at,context:{branchId:sample.businessId,merchantId:'test-org',zoneId:sample.pricing.deliveryRules[0].coverage.supportedZoneIds[0],cityId:'city',governorateId:'governorate',vehicleType:'BIKE'},pickupRoute:leg,deliveryRoute:leg};
 const draftSimulation=await pricing.route(ctx,editor().actor,'POST','/staff/pricing/simulate',sim);
 const currentSimulation=await pricing.route(ctx,editor().actor,'POST','/staff/pricing/simulate',{...sim,source:'CURRENT'});
 assert.deepEqual(draftSimulation.delivery,currentSimulation.delivery);assert.deepEqual(draftSimulation.driver,currentSimulation.driver);assert.equal(transactions.length,1);
 records.get('DRAFT').values=structuredClone(records.get('CURRENT').values);assert.deepEqual((await pricing.route(ctx,editor().actor,'POST','/staff/pricing/simulate',sim)).delivery,currentSimulation.delivery);assert.equal(transactions.length,1);
 delete records.get('DRAFT').publishedVersion;await assert.rejects(pricing.route(ctx,editor().actor,'POST','/staff/pricing/simulate',sim),/DRAFT_RULES_REQUIRED/);
 await assert.rejects(pricing.route(ctx,editor().actor,'POST','/staff/pricing/draft',{baseVersion:0,draftVersion:0,values:structuredClone(sample.pricing),reason:'Stale test prices'}),/CONFLICT/);
}));
test('direct agreement retains real owner consent then publishes the recorded staff intent, retry does not duplicate',()=>enabled(async()=>{
 const f=fixture();f.put(S,{pk:'EMPLOYEE#editor',sk:'PROFILE',...editor().actor});const saved=await call(f,editor(),save());
 assert.equal(f.get(P,{pk:'COMMERCIAL_AGREEMENT#contract',sk:'CURRENT'}),undefined);
 assert.equal(f.get(P,{pk:'COMMERCIAL_AGREEMENT#contract',sk:'DRAFT'}).directPublicationAuthorized,true);
 const input=decision(saved,'ACCEPT_AGREEMENT');const accepted=await call(f,owner,input);assert.equal(accepted.publishedVersion,1);assert.equal(f.get(B,{businessId:'branch'}).commercialAgreementVersion,1);
 const approval=f.get(S,{pk:'COMMERCIAL_AGREEMENT#contract',sk:'APPROVAL#1'});assert.deepEqual(Object.keys(approval).sort(),['pk','sk','staffId','termsHash','approvedAt','status'].sort());
 assert.equal((await call(f,owner,input)).publishedVersion,1);
}));
test('revocation of the author blocks automatic publication after owner consent',()=>enabled(async()=>{
 const f=fixture(),saved=await call(f,editor(),save());f.put(S,{pk:'EMPLOYEE#editor',sk:'PROFILE',...editor().actor,version:2});
 await assert.rejects(call(f,owner,decision(saved,'ACCEPT_AGREEMENT')),/REQUESTER_PERMISSION_REVOKED/);
 assert.equal(f.get(P,{pk:'COMMERCIAL_AGREEMENT#contract',sk:'CURRENT'}),undefined);
}));
