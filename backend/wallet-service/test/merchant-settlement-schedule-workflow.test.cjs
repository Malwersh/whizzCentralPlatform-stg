'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {createMerchantSettlementScheduleWorkflow:create}=require('../dist/merchantSettlementScheduleWorkflow');
const {createMerchantSettlementScheduleHistoryReader:history}=require('../dist/merchantSettlementScheduleHistory');
const {createMerchantSettlementScheduleReader:reader}=require('../dist/merchantSettlementScheduleReader');
const P='staging-MerchantPlatform',S='staging-PlatformStaff',B='WhizzMerchants_Businesses',D='staging-AccountDeletion';
const maker='11111111-1111-4111-8111-111111111111',reviewer='22222222-2222-4222-8222-222222222222';
const effectiveFrom='2026-10-21T21:00:00.000Z';
const {fixture}=require('./helpers/merchant-settlement-schedule-fixture.cjs');
test('request, owner consent and independent approval publish immutable version and readable current policy atomically',async()=>{
 const f=fixture(),v=f.input(),p=await f.staff(maker).propose(v);assert.equal(p.proposal.status,'AWAITING_OWNER');assert.equal(f.get(P,{pk:'BRANCH#branch1',sk:'SETTLEMENT_SCHEDULE#CURRENT'}),undefined);
 const decision=f.choice(p.proposal);await f.owner().consent(decision);const out=await f.staff(reviewer).approve(decision);assert.equal(out.current.acceptedBy,'owner1');assert.equal(out.current.approvedBy,reviewer);
 const selected=await reader(f.db)('branch1','2026-10-23T12:00:00.000Z');assert.equal(selected.schedule.version,1);
 const hist=await history(f.db)('branch1','2026-10-23T12:00:00.000Z');assert.equal(hist.guards.length,1);
 const count=f.writes.length;assert.equal((await f.staff(maker).propose(v)).replayed,true);assert.equal((await f.owner().consent(decision)).replayed,true);assert.equal((await f.staff(reviewer).approve(decision)).replayed,true);assert.equal(f.writes.length,count);
 assert(f.writes.flat().every(op=>[P,S,B,D].includes((op.Put||op.ConditionCheck).TableName)));
});
test('wrong owner, missing consent and requester self approval never publish a policy',async()=>{
 const f=fixture(),p=(await f.staff(maker).propose(f.input())).proposal,decision=f.choice(p);
 await assert.rejects(f.owner('other').consent(decision),/OWNER_REQUIRED/);
 await assert.rejects(f.staff(reviewer).approve(decision),/INDEPENDENT_APPROVAL_REQUIRED|OWNER_CONSENT_REQUIRED/);
 await f.owner().consent(decision);const person=f.get(S,{pk:'EMPLOYEE#'+maker,sk:'PROFILE'});person.roles.push('finance_settings_approver');f.put(S,person);
 await assert.rejects(f.staff(maker).approve(decision),/INDEPENDENT_APPROVAL_REQUIRED/);assert.equal(f.writes.length,2);
});
test('requester cannot replace immutable proposal payload by reusing its UUID',async()=>{
 const f=fixture(),v=f.input();await f.staff(maker).propose(v);await assert.rejects(f.staff(maker).propose({...v,effectiveFrom:'2026-10-28T21:00:00.000Z'}),/PROPOSAL_CONFLICT/);assert.equal(f.writes.length,1);
});
test('invalid, retroactive and non-boundary periods cannot be proposed',async()=>{
 for(const change of [{effectiveFrom:'2026-10-15T21:00:00.000Z'},{effectiveFrom:'2026-10-22T12:00:00.000Z'},{effectiveTo:'2026-10-23T21:00:00.000Z'},{schedule:{timezone:'UTC',frequency:'WEEKLY',anchorLocalDate:'2026-10-01'}},{baseVersion:1}]){const f=fixture();await assert.rejects(f.staff(maker).propose(f.input(change)));assert.equal(f.writes.length,0);}
});
test('role revocation, deletion fences, agreement changes and source races reject the whole publication',async()=>{
 for(const mode of ['role','branch','agreement','proposal','ownerFence']){const f=fixture(),p=(await f.staff(maker).propose(f.input())).proposal;await f.owner().consent(f.choice(p));
  const base=f.writes.length;f.db.beforeWrite=()=>{if(mode==='role'){const r=f.get(S,{pk:'EMPLOYEE#'+reviewer,sk:'PROFILE'});r.roles=[];f.put(S,r);}if(mode==='branch'){const b=f.get(B,{businessId:'branch1'});b.ownerId='other';f.put(B,b);}if(mode==='agreement'){const k={pk:'COMMERCIAL_AGREEMENT#agreement1',sk:'CURRENT'},r=f.get(P,k);r.version=2;f.put(P,r);}if(mode==='proposal'){const k={pk:p.pk,sk:p.sk},r=f.get(P,k);r.status='REJECTED';f.put(P,r);}if(mode==='ownerFence')f.put(D,{pk:'ACCOUNT_LIFECYCLE#MERCHANT#owner1',sk:'META'});};
  await assert.rejects(f.staff(reviewer).approve(f.choice(p)),/CONFLICT_OR_UNKNOWN/);assert.equal(f.writes.length,base);assert.equal(f.get(P,{pk:'BRANCH#branch1',sk:'SETTLEMENT_SCHEDULE#CURRENT'}),undefined);
 }
});
test('two competing proposals against the same version cannot both publish',async()=>{
 const f=fixture(),a=(await f.staff(maker).propose(f.input())).proposal,b=(await f.staff(maker).propose(f.input())).proposal;
 await f.owner().consent(f.choice(a));await f.owner().consent(f.choice(b));await f.staff(reviewer).approve(f.choice(a));await assert.rejects(f.staff(reviewer).approve(f.choice(b)),/BASE_VERSION_CONFLICT/);
});
test('lost approval reply is recovered by retry without duplicate versions or audit records',async()=>{
 const f=fixture(),p=(await f.staff(maker).propose(f.input())).proposal;await f.owner().consent(f.choice(p));f.db.loseReply=true;
 await assert.rejects(f.staff(reviewer).approve(f.choice(p)),/UNKNOWN_OUTCOME/);const count=f.rows.size;assert.equal((await f.staff(reviewer).approve(f.choice(p))).replayed,true);assert.equal(f.rows.size,count);
});
test('superseding schedule preserves old version and exact cutover; history returns applicable policy',async()=>{
 const f=fixture();await f.publish();const old=f.get(P,{pk:'BRANCH#branch1',sk:'SETTLEMENT_SCHEDULE#VERSION#1'});
 f.setNow('2026-10-23T12:00:00.000Z');await f.publish(f.input({baseVersion:1,effectiveFrom:'2026-10-28T21:00:00.000Z'}));
 assert.deepEqual(f.get(P,{pk:old.pk,sk:old.sk}),old);
 const read=history(f.db);assert.equal((await read('branch1','2026-10-23T12:00:00.000Z')).schedule.version,1);assert.equal((await read('branch1','2026-10-29T12:00:00.000Z')).schedule.version,2);
 f.put(P,{...f.get(P,{pk:'BRANCH#branch1',sk:'SETTLEMENT_SCHEDULE#CLOSED#1'}),untilExclusive:'2026-10-27T21:00:00.000Z'});await assert.rejects(read('branch1','2026-10-23T12:00:00.000Z'),/CUTOVER_INVALID/);
});
test('missing history or pagination limit never falls back to current rules',async()=>{
 const f=fixture();await f.publish();f.db.incomplete=true;await assert.rejects(history(f.db,1)('branch1','2026-10-23T12:00:00.000Z'),/HISTORY_INCOMPLETE/);
 const g=fixture();await g.publish();g.rows.delete([...g.rows.keys()].find(k=>k.includes('SETTLEMENT_SCHEDULE#VERSION#1')));await assert.rejects(history(g.db)('branch1','2026-10-23T12:00:00.000Z'),/HISTORY_INVALID/);
});
module.exports={fixture};


test('revoked requester, expired proposal, changed consent digest and commercial acceptance cannot publish',async()=>{
 for(const mode of ['requester','expired','digest','agreementConsent']){
  const f=fixture(),p=(await f.staff(maker).propose(f.input())).proposal,decision=f.choice(p);
  if(mode==='digest'){await assert.rejects(f.owner().consent({...decision,proposalDigest:'bad'}),/PROPOSAL_CONFLICT/);continue;}
  await f.owner().consent(decision);const before=f.writes.length;
  if(mode==='requester'){const k={pk:'EMPLOYEE#'+maker,sk:'PROFILE'},r=f.get(S,k);r.roles=[];f.put(S,r);}
  if(mode==='expired')f.setNow('2026-10-22T00:00:00.000Z');
  if(mode==='agreementConsent'){const k={pk:'COMMERCIAL_AGREEMENT#agreement1',sk:'ACCEPTANCE#1'},r=f.get(P,k);r.subjectId='other';f.put(P,r);}
  await assert.rejects(f.staff(reviewer).approve(decision),/REQUESTER_PERMISSION_REVOKED|FUTURE_BOUNDARY_REQUIRED|AGREEMENT_UNAVAILABLE/);assert.equal(f.writes.length,before);
 }
});
