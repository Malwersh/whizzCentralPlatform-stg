'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {service,hash}=require('../commercial-management');
const {fixture,save,decision,owner,editor,approver,staff,values,call,P,S,B}=require('./helpers/commercial-fixture.cjs');
test('closed by default; global dedicated role, MFA and recent authentication required',async()=>{
 const f=fixture();f.ctx.enabled=false;await assert.rejects(call(f,editor(),save()),/DISABLED/);f.ctx.enabled=true;
 await assert.rejects(call(f,staff('finance','finance_approver'),save()),/PERMISSION/);
 f.ctx.enrolled=false;await assert.rejects(call(f,editor(),save()),/ENROLLMENT/);f.ctx.enrolled=true;f.ctx.recent=()=>{throw Error('REAUTH_REQUIRED');};await assert.rejects(call(f,editor(),save()),/REAUTH/);
 assert.equal(f.get(P,{pk:'COMMERCIAL_AGREEMENT#contract',sk:'CURRENT'}),undefined);
});
test('draft then verified owner consent then independent approval; canonical hashes and branch reference match',async()=>{
 const f=fixture(),r=await call(f,editor(),save());assert.equal(f.get(B,{businessId:'branch'}).commercialAgreementId,undefined);
 await assert.rejects(call(f,approver(),decision(r,'APPROVE_AGREEMENT')),/OWNER_ACCEPTANCE_REQUIRED/);
 await call(f,owner,decision(r,'ACCEPT_AGREEMENT'));assert.equal(f.get(P,{pk:'COMMERCIAL_AGREEMENT#contract',sk:'CURRENT'}),undefined);
 await call(f,approver(),decision(r,'APPROVE_AGREEMENT'));
 const k={pk:'COMMERCIAL_AGREEMENT#contract'},v=f.get(P,{...k,sk:'VERSION#1'}),a=f.get(P,{...k,sk:'ACCEPTANCE#1'}),approval=f.get(S,{...k,sk:'APPROVAL#1'});
 assert.equal(v.termsHash,hash({terms:v.terms,otherCharges:v.otherCharges,allowedFundingPolicyIds:v.allowedFundingPolicyIds,fundingPolicySnapshots:v.fundingPolicySnapshots}));assert.equal(a.termsHash,v.termsHash);assert.equal(approval.termsHash,a.termsHash);assert.equal(a.subjectId,'owner');assert.equal(approval.staffId,'reviewer');assert.equal(f.get(B,{businessId:'branch'}).commercialAgreementVersion,1);assert.equal(f.get(B,{businessId:'sibling'}).commercialAgreementId,undefined);
});
test('owner cannot save or approve; another owner cannot read or accept; self-approval rejected',async()=>{
 const f=fixture();await assert.rejects(call(f,owner,save()),/PERMISSION/);const r=await call(f,editor(),save());
 await assert.rejects(call(f,{kind:'OWNER',sub:'other'},decision(r,'ACCEPT_AGREEMENT')),/BUSINESS_UNAVAILABLE/);
 await assert.rejects(call(f,owner,decision(r,'APPROVE_AGREEMENT')),/PERMISSION/);
 await assert.rejects(call(f,staff('editor','commercial_approver'),decision(r,'APPROVE_AGREEMENT')),/SELF_APPROVAL/);
});
test('replay is stable; changed contents with same request id rejected and stale version cannot publish',async()=>{
 const f=fixture(),body=save(),r=await call(f,editor(),body);assert.equal((await call(f,editor(),body)).replayed,true);
 await assert.rejects(call(f,editor(),{...body,reason:'سبب مختلف'}),/REQUEST_ID_CONFLICT/);
 await assert.rejects(call(f,owner,{...decision(r,'ACCEPT_AGREEMENT'),draftVersion:99}),/VERSION_OR_STATE/);
});
test('new agreements cannot embed discount participation policies',async()=>{const f=fixture(),v=values();v.allowedFundingPolicyIds=['promo'];await assert.rejects(call(f,editor(),save(v)),/FUNDING_SEPARATE_FROM_AGREEMENT/);});
test('multi-branch owner consent fences sibling ownership and closing lifecycle',async()=>{
 const f=fixture(),v=values();v.scope='MERCHANT';const body=save(v);body.businessIds=['branch','sibling'];const r=await call(f,editor(),body);
 f.put(B,{...f.get(B,{businessId:'sibling'}),ownerId:'other'});await assert.rejects(call(f,owner,decision(r,'ACCEPT_AGREEMENT')),/SCOPE_MISMATCH/);
});
test('failed consent/approval transaction gives no success; current remains unchanged',async()=>{
 const f=fixture(),r=await call(f,editor(),save());f.break();await assert.rejects(call(f,owner,decision(r,'ACCEPT_AGREEMENT')),/VERSION_OR_STATE/);assert.equal(f.get(P,{pk:'COMMERCIAL_AGREEMENT#contract',sk:'CONSENT#1'}),undefined);
});
test('empty pages with cursor are bounded and failed reads return no apparent empty success',async()=>{const f=fixture();f.paginate();await assert.rejects(service(f.ctx,owner,'GET',{businessId:'branch'}),/LIST_TOO_LARGE/);assert.equal(f.commands.filter(c=>c.constructor.name==='QueryCommand').length,5);});
test('explicit zero commission accepted; unknown/implicit/fractional funding policy rejected',async()=>{
 const f=fixture(),v=values();v.commission.rate.numerator=0;await call(f,editor(),save(v));
 const g=fixture(),invalid=values();delete invalid.commission.finalRounding;await assert.rejects(call(g,editor(),save(invalid)),/WHOLE_IQD/);
});
test('soft-deleted sibling cannot be included in a draft or accepted/published shared contract',async()=>{
 for(const field of ['isDeleted','deletedAt']){
  const f=fixture(),v=values();v.scope='MERCHANT';const body=save(v);body.businessIds=['branch','sibling'];
  f.put(B,{...f.get(B,{businessId:'sibling'}),[field]:field==='isDeleted'?true:'2026-10-16T10:00:00.000Z'});await assert.rejects(call(f,editor(),body),/SCOPE_MISMATCH/);
  const g=fixture(),r=await call(g,editor(),body);await call(g,owner,decision(r,'ACCEPT_AGREEMENT'));g.put(B,{...g.get(B,{businessId:'sibling'}),[field]:field==='isDeleted'?true:'2026-10-16T10:00:00.000Z'});await assert.rejects(call(g,approver(),decision(r,'APPROVE_AGREEMENT')),/SCOPE_MISMATCH/);assert.equal(g.get(P,{pk:'COMMERCIAL_AGREEMENT#contract',sk:'CURRENT'}),undefined);
 }
});
