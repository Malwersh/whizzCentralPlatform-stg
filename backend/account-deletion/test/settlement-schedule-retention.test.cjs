'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('../../wallet-service/test/helpers/merchant-settlement-schedule-fixture.cjs');
const {settlementRetention}=require('../settlement-retention');
const P='staging-MerchantPlatform',S='staging-PlatformStaff',B='WhizzMerchants_Businesses',D='staging-AccountDeletion',A='staging-AccountDeletionFinancialArchive';
const rid='33333333-3333-4333-8333-333333333333',maker='11111111-1111-4111-8111-111111111111';
async function setup({versions=2,pending=false}={}){
 const f=fixture();await f.publish();if(versions===2){f.setNow('2026-10-23T12:00:00.000Z');await f.publish(f.input({baseVersion:1,effectiveFrom:'2026-10-28T21:00:00.000Z'}));}
 if(pending)f.setNow(versions===1?'2026-10-23T12:00:00.000Z':'2026-10-30T12:00:00.000Z');
 if(pending)await f.staff(maker).propose(f.input({baseVersion:versions,effectiveFrom:'2026-11-04T21:00:00.000Z'}));
 const r={pk:'SUBJECT#MERCHANT#owner1',sk:'REQUEST#'+rid,requestId:rid,subjectId:'owner1',actorType:'MERCHANT',scope:{kind:'BUSINESS',id:'branch1'},status:'PROCESSING',version:2,leaseOwner:'worker',leaseUntil:2000000000};
 const job={requestId:rid,subjectId:'owner1',businessId:'branch1',financialYears:7,policyVersion:3};
 f.put(D,r);f.put(D,{pk:'BUSINESS_LIFECYCLE#MERCHANT#branch1',sk:'META',subjectId:'owner1',businessId:'branch1',requestId:rid});
 f.put(B,{...f.get(B,{businessId:'branch1'}),deletionRequestId:rid});f.writes.length=0;
 const archives=()=>[...f.rows.entries()].filter(([key])=>key.startsWith(A+'|')).map(([,row])=>structuredClone(row));
 const source=()=>[...f.rows.entries()].filter(([key,row])=>(key.startsWith(P+'|')&&row.sk.startsWith('SETTLEMENT_SCHEDULE#'))||(key.startsWith(S+'|')&&row.pk==='SETTLEMENT_SCHEDULE_AUDIT#branch1'));
 const run=()=>settlementRetention({db:f.db,r,job,clock:()=> '2026-10-24T12:00:00.000Z',maxPages:3});
 return {...f,r,job,archives,source,run};
}
test('actual two-version workflow archives current, versions, closure, proposals, approvals and audits without changing sources',async()=>{
 const f=await setup(),before=structuredClone(f.source());assert.equal(before.length,12);assert.equal((await f.run()).archived,12);assert.deepEqual(f.source(),before);
 const a=f.archives();assert.equal(a.filter(x=>x.sourceTable===S).length,6);assert(a.every(x=>x.purgeBlocked===true&&x.expiresAt===undefined&&x.scopeBusinessId==='branch1'&&x.minimumRetainUntil>1800000000));
 const retry=await f.run();assert.equal(retry.archived,0);assert.deepEqual(f.archives(),a);assert.deepEqual(f.source(),before);
 for(const tx of f.writes){assert.equal(tx.length,5);assert(tx.every(op=>!op.Delete&&!op.Update));}
});
test('pending owner consent is retained as a proposal without manufacturing an approval',async()=>{
 const f=await setup({versions:1,pending:true});const out=await f.run();assert.equal(out.archived,8);assert(f.archives().some(a=>a.data.status==='AWAITING_OWNER'));assert.equal(f.archives().filter(a=>a.data.action==='SCHEDULE_APPROVED').length,1);
});
test('missing version, closure, consent/approval event or orphan audit blocks all copies',async()=>{
 for(const mode of ['version','closure','consent','approval','proposal','orphan']){
  const f=await setup(),entries=f.source();let match;
  if(mode==='version')match=entries.find(([,r])=>r.sk==='SETTLEMENT_SCHEDULE#VERSION#1');
  if(mode==='closure')match=entries.find(([,r])=>r.kind==='MERCHANT_SETTLEMENT_SCHEDULE_CLOSURE');
  if(mode==='consent')match=entries.find(([,r])=>r.action==='SCHEDULE_OWNER_CONSENTED');
  if(mode==='approval')match=entries.find(([,r])=>r.action==='SCHEDULE_APPROVED');
  if(mode==='proposal')match=entries.find(([,r])=>r.kind==='MERCHANT_SETTLEMENT_SCHEDULE_PROPOSAL');
  if(match)f.rows.delete(match[0]);if(mode==='orphan')f.put(S,{pk:'SETTLEMENT_SCHEDULE_AUDIT#branch1',sk:'orphan',branchId:'branch1'});
  await assert.rejects(f.run());assert.equal(f.archives().length,0,mode);assert.equal(f.writes.length,0,mode);
 }
});
test('held, foreign, altered or unknown financial evidence blocks the full inventory',async()=>{
 for(const mode of ['hold','owner','digest','auditActor','cutover','unknown','private']){
  const f=await setup();const entry=f.source().find(([,r])=>mode==='hold'||mode==='auditActor'?r.action==='SCHEDULE_OWNER_CONSENTED':mode==='cutover'?r.kind==='MERCHANT_SETTLEMENT_SCHEDULE_CLOSURE':r.sk==='SETTLEMENT_SCHEDULE#VERSION#1');
  const row=structuredClone(entry[1]);if(mode==='hold')row.legalHold=true;if(mode==='owner')row.ownerId='other';if(mode==='digest')row.digest='bad';if(mode==='auditActor')row.actorId='other';if(mode==='cutover')row.untilExclusive='2026-10-27T21:00:00.000Z';if(mode==='unknown')row.kind='UNKNOWN';if(mode==='private')row.customerPhone='PRIVATE';f.rows.set(entry[0],row);
  await assert.rejects(f.run());assert.equal(f.archives().length,0,mode);assert.equal(f.writes.length,0,mode);
 }
});
test('source mutation, lease loss and lifecycle change cannot commit the affected archive transaction',async()=>{
 for(const mode of ['source','lease','lifecycle']){const f=await setup();f.db.beforeWrite=()=>{
  if(mode==='source'){const [key,row]=f.source()[0];f.rows.set(key,{...row,status:'CHANGED'});}
  if(mode==='lease')f.put(D,{...f.r,leaseOwner:'another-worker'});
  if(mode==='lifecycle')f.put(D,{pk:'BUSINESS_LIFECYCLE#MERCHANT#branch1',sk:'META',subjectId:'owner1',businessId:'branch1',requestId:'different'});
 };await assert.rejects(f.run());assert.equal(f.archives().length,0);}
});
test('audit archive conflicts are detected before any retry writes',async()=>{
 const f=await setup();await f.run();f.writes.length=0;
 const a=f.archives().find(x=>x.sourceTable===S);a.data.actorId='changed';f.put(A,a);
 await assert.rejects(f.run(),/ARCHIVE_CONFLICT/);assert.equal(f.writes.length,0);
});
test('incomplete schedule inventory is never accepted as an empty branch',async()=>{
 const f=await setup();f.db.incomplete=true;await assert.rejects(f.run(),/INVENTORY_INCOMPLETE/);assert.equal(f.archives().length,0);
});
