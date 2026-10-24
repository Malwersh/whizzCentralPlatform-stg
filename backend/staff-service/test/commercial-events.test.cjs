'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {service}=require('../commercial-management');
const {fixture,save,decision,owner,editor,staff,call,P,S,B}=require('./helpers/commercial-fixture.cjs');
const read=f=>service(f.ctx,editor(),'GET',{view:'platform-events'});
test('platform events require commercial read and global scope; owner cannot subscribe',async()=>{
 const f=fixture();await assert.rejects(service(f.ctx,owner,'GET',{view:'platform-events'}),/PERMISSION/);
 await assert.rejects(service(f.ctx,staff('support','customer_service'),'GET',{view:'platform-events'}),/PERMISSION/);
 const p=editor();p.actor.scope={allRegions:false};await assert.rejects(service(f.ctx,p,'GET',{view:'platform-events'}),/PERMISSION/);
 await assert.rejects(service(f.ctx,editor(),'GET',{view:'platform-events',businessId:'branch'}),/INVALID/);
 assert.equal(f.commands.length,0);
});
test('real consent audit yields one stable notification and actual owner name without raw credential data',async()=>{
 const f=fixture(),r=await call(f,editor(),save());f.put(P,{pk:'PERSON#owner',sk:'PROFILE',fullName:'مالك الاختبار'});
 const body=decision(r,'ACCEPT_AGREEMENT');await call(f,owner,body);
 const a=await read(f),b=await read(f);assert.equal(a.items.length,1);assert.equal(a.items[0].eventId,b.items[0].eventId);assert.deepEqual(a.items[0].acceptedBy,{role:'OWNER',name:'مالك الاختبار'});assert.equal(a.items[0].kind,'AGREEMENT');assert.equal(a.items[0].businessId,'branch');assert.equal(JSON.stringify(a).includes('OWNER#'),false);
 await call(f,owner,body);assert.equal((await read(f)).items.length,1);
});
test('audit without durable matching consent or branch authority never becomes an apparent approval',async()=>{
 const f=fixture(),r=await call(f,editor(),save());await call(f,owner,decision(r,'ACCEPT_AGREEMENT'));
 f.put(P,{pk:'COMMERCIAL_AGREEMENT#contract',sk:'CONSENT#1',subjectId:'another-owner'});assert.equal((await read(f)).items.length,0);
});
test('deleted branch is excluded; incomplete audit pagination fails explicitly',async()=>{
 const f=fixture(),r=await call(f,editor(),save());await call(f,owner,decision(r,'ACCEPT_AGREEMENT'));f.put(B,{...f.get(B,{businessId:'branch'}),isDeleted:true});assert.equal((await read(f)).items.length,0);
 const g=fixture();g.paginate();await assert.rejects(read(g),/INCOMPLETE/);
});
test('unimplemented manager cannot be presented as accepting a commercial request',async()=>{
 const f=fixture();f.put(S,{pk:'AUDIT',sk:'2026-10-16T12:00:00.000Z#fake',action:'COMMERCIAL_ACCEPT_AGREEMENT',actorId:'OWNER#owner',before:{businessId:'branch',id:'contract'},after:{actorKind:'MANAGER',draftVersion:1}});assert.equal((await read(f)).items.length,0);
});
