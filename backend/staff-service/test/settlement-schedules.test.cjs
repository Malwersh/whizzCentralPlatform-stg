'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const routes=require('../settlement-schedules');
const {fixture}=require('../../wallet-service/test/helpers/merchant-settlement-schedule-fixture.cjs');
const maker='11111111-1111-4111-8111-111111111111',reviewer='22222222-2222-4222-8222-222222222222';
const S='staging-PlatformStaff';
const person=(f,id)=>f.get(S,{pk:'EMPLOYEE#'+id,sk:'PROFILE'});
const ctx=f=>({enabled:true,db:f.db,enrolled:true,claims:{auth_time:Math.floor(Date.now()/1000)}});
test('closed activation gate rejects staff and owner without reading data',async()=>{const db={send:()=>{throw Error('must not read');}};await assert.rejects(routes.staff({db},null,'GET',{}),/ADMIN_DISABLED/);await assert.rejects(routes.owner({db},'owner','GET',{}),/ADMIN_DISABLED/);});
test('authenticated route workflow publishes through separate staff and owner endpoints',async()=>{
 const f=fixture(),c=ctx(f),from='2030-10-02T21:00:00.000Z',input=f.input({effectiveFrom:from,schedule:{timezone:'Asia/Baghdad',frequency:'WEEKLY',anchorLocalDate:'2030-10-03'}});
 const p=await routes.staff(c,person(f,maker),'POST',{action:'PROPOSE',...input});
 const owner=await routes.owner(c,'owner1','GET',{branchId:'branch1'});assert.equal(owner.proposals.length,1);assert.equal(owner.proposals[0].requestHash,undefined);assert.equal(owner.proposals[0].pk,undefined);
 const decision={branchId:'branch1',proposalId:p.proposal.proposalId,proposalDigest:p.proposal.proposalDigest};
 await routes.owner(c,'owner1','POST',{action:'CONSENT',...decision});await routes.staff(c,person(f,reviewer),'POST',{action:'APPROVE',...decision});
 const read=await routes.staff(c,person(f,maker),'GET',{branchId:'branch1'});assert.equal(read.current.schedule.version,1);assert.equal(read.versions.length,1);assert.equal(read.agreement.id,'agreement1');assert.equal(read.can.request,true);assert.equal(read.can.approve,false);
});
test('owner from another restaurant and client supplied principal cannot read or consent',async()=>{
 const f=fixture(),c=ctx(f);await assert.rejects(routes.owner(c,'another','GET',{branchId:'branch1'}),e=>e.status===403);await assert.rejects(routes.owner(c,'owner1','GET',{branchId:'branch1',subjectId:'owner1'}),e=>e.status===400);
 await assert.rejects(routes.staff(c,person(f,maker),'POST',{action:'CONSENT',branchId:'branch1'}),e=>e.status===400);
});
test('stale session, disabled MFA and revoked employee fail before mutation; pagination is bounded',async()=>{
 for(const mode of ['stale','mfa','revoked']){const f=fixture(),c=ctx(f);if(mode==='stale')c.claims.auth_time-=301;if(mode==='mfa')c.enrolled=false;if(mode==='revoked'){const actor=person(f,maker);actor.roles=[];f.put(S,actor);}await assert.rejects(routes.staff(c,person(f,maker),'POST',{action:'PROPOSE',...f.input()}),e=>e.status===403);assert.equal(f.writes.length,0);}
 const f=fixture();f.db.incomplete=true;await assert.rejects(routes.staff(ctx(f),person(f,maker),'GET',{branchId:'branch1'}),e=>e.status===503);assert.equal(f.writes.length,0);
});

test('financial-only employee gets approved branch names without merchant administration permissions or private fields',async()=>{
 const f=fixture(),c=ctx(f),send=f.db.send.bind(f.db);
 f.db.send=async command=>{if(command.constructor.name==='ScanCommand'){assert.equal(command.input.TableName,'WhizzMerchants_Businesses');assert.equal(command.input.Select,'SPECIFIC_ATTRIBUTES');assert(!command.input.ProjectionExpression.includes('phone'));return {Items:[{businessId:'branch1',businessName:'فتوش',status:'approved',phone:'PRIVATE',ownerId:'PRIVATE'},{businessId:'closed',status:'approved',isDeleted:true},{businessId:'pending',status:'pending'}]};}return send(command);};
 const out=await routes.branches(c,person(f,maker),'GET',{});assert.deepEqual(out,{items:[{businessId:'branch1',businessName:'فتوش'}]});assert(!JSON.stringify(out).includes('PRIVATE'));assert.equal(f.writes.length,0);
});
test('branch directory suppresses partial results after revocation and enforces pagination bound',async()=>{
 for(const mode of ['revoke','incomplete']){const f=fixture(),c=ctx(f),send=f.db.send.bind(f.db);f.db.send=async command=>{if(command.constructor.name==='ScanCommand'){if(mode==='revoke'){const actor=person(f,maker);actor.roles=[];f.put(S,actor);return {Items:[{businessId:'branch1',status:'approved'}]};}return {Items:[],LastEvaluatedKey:{businessId:'next'}};}return send(command);};await assert.rejects(routes.branches(c,person(f,maker),'GET',{}),e=>e.status===(mode==='revoke'?403:503));assert.equal(f.writes.length,0);}
});
