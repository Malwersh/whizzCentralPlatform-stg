'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {reference,COUNTER}=require('../commercial-reference');
const {fixture,save,editor,owner,call,P,S}=require('./helpers/commercial-fixture.cjs');
test('reference is stable across reads, draft updates and branch ordering; canonical terms untouched',async()=>{
 const f=fixture(),body=save();await call(f,editor(),body);const before=f.get(P,{pk:'COMMERCIAL_AGREEMENT#contract',sk:'DRAFT'});
 const read=()=>require('../commercial-management').service(f.ctx,owner,'GET',{businessId:'branch'});
 assert.equal((await read()).items[0].supportReference,'AG-000001');assert.equal((await read()).items[0].supportReference,'AG-000001');
 assert.deepEqual(f.get(P,{pk:before.pk,sk:'DRAFT'}),before);
 await call(f,editor(),{...save(),requestId:require('node:crypto').randomUUID(),draftVersion:1});assert.equal((await read()).items[0].supportReference,'AG-000001');assert.equal(f.get(S,COUNTER).value,1);
});
test('concurrent allocations retry atomic conflicts; each agreement has one unique number',async()=>{
 const rows=new Map(),key=(t,k)=>t+'|'+k.pk+'|'+k.sk,drafts=Array.from({length:8},(_,i)=>({id:'c'+i,ownerId:'owner',businessIds:['branch']}));
 for(const d of drafts){const item={pk:'BRANCH#branch',sk:'COMMERCIAL#AGREEMENT#'+d.id,kind:'AGREEMENT',recordPk:'COMMERCIAL_AGREEMENT#'+d.id,ownerId:'owner'};rows.set(key(P,item),item);}
 const ctx={db:{send:async command=>{const x=command.input;if(command.constructor.name==='GetCommand')return {Item:structuredClone(rows.get(key(x.TableName,x.Key)))};
 const counter=x.TransactItems[0].Put,index=x.TransactItems[1].Put,old=rows.get(key(S,COUNTER)),row=rows.get(key(P,index.Item));
 if((old?.value||0)!==(counter.Item.value-1)||row.supportReference)throw Object.assign(Error('conflict'),{name:'TransactionCanceledException'});
 rows.set(key(S,COUNTER),structuredClone(counter.Item));rows.set(key(P,index.Item),structuredClone(index.Item));return {};}}};
 const refs=await Promise.all(drafts.map(async d=>{for(let n=0;n<3;n++){try{return await reference(ctx,d,[]);}catch(e){if(n===2)throw e;}}}));
 assert.equal(new Set(refs).size,drafts.length);for(let i=0;i<drafts.length;i++)assert.equal(await reference(ctx,drafts[i],[]),refs[i]);
 // Deleting an agreement index never decrements or recycles the global sequence.
 rows.delete(key(P,{pk:'BRANCH#branch',sk:'COMMERCIAL#AGREEMENT#c0'}));assert.equal(rows.get(key(S,COUNTER)).value,8);
});
test('foreign indexes, malformed counters and failed authorization fences fail closed',async()=>{
 const f=fixture(),body=save();await call(f,editor(),body);const d=f.get(P,{pk:'COMMERCIAL_AGREEMENT#contract',sk:'DRAFT'});
 f.put(S,{...COUNTER,value:-1});await assert.rejects(reference(f.ctx,d,[]),/UNAVAILABLE/);
 f.put(S,{...COUNTER,value:1});f.break();await assert.rejects(reference(f.ctx,d,[]),/UNAVAILABLE/);
});
test('shared reference survives closing one of the covered branches',async()=>{const f=fixture(),body=save();body.values.scope='MERCHANT';body.businessIds=['branch','sibling'];await call(f,editor(),body);const d=f.get(P,{pk:'COMMERCIAL_AGREEMENT#contract',sk:'DRAFT'});assert.equal(await reference(f.ctx,d,[]),'AG-000001');assert.equal(f.get(P,{pk:'BRANCH#sibling',sk:'COMMERCIAL#AGREEMENT#contract'}).supportReference,'AG-000001');const send=f.ctx.db.send;f.ctx.db.send=async c=>c.constructor.name==='GetCommand'&&c.input.Key.pk==='BRANCH#branch'?{}:send(c);assert.equal(await reference(f.ctx,d,[]),'AG-000001');assert.equal(f.get(S,COUNTER).value,1);});
