'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {commercialRetention,commercialPurgeGuards,validateRecord}=require('../commercial-retention');
const {financialPurge,sourceOf}=require('../financial-purge');
const {GetCommand,QueryCommand,ScanCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {service}=require('../../staff-service/commercial-management');
const workflow=require('../../staff-service/test/helpers/commercial-fixture.cjs');
const P='staging-MerchantPlatform',S='staging-PlatformStaff',B='WhizzMerchants_Businesses',L='staging-AccountDeletion',W='staging-Wallets',A='staging-AccountDeletionFinancialArchive';
const when='2026-10-17T12:00:00.000Z',rid='11111111-1111-4111-8111-111111111111';
async function fixture(){
 const f=workflow.fixture(),body=workflow.save();body.businessIds=['branch','sibling'];body.values.scope='MERCHANT';
 const d=await service(f.ctx,workflow.editor(),'POST',body);await service(f.ctx,workflow.owner,'POST',workflow.decision(d,'ACCEPT_AGREEMENT'));await service(f.ctx,workflow.approver(),'POST',workflow.decision(d,'APPROVE_AGREEMENT'));
 const rows=new Map(),writes=[];
 const key=(t,k)=>t+'|'+JSON.stringify(Object.fromEntries(Object.entries(k).sort()));
 const pk=(t,r)=>t===B?{businessId:r.businessId}:t===W?{walletId:r.walletId,sk:r.sk}:{pk:r.pk,sk:r.sk};
 const put=(t,r)=>rows.set(key(t,pk(t,r)),structuredClone(r)),get=(t,k)=>structuredClone(rows.get(key(t,k))),del=(t,k)=>rows.delete(key(t,k));
 for(const c of f.commands)for(const op of c.input.TransactItems||[]){if(op.Put)put(op.Put.TableName,op.Put.Item);}
 for(const b of ['branch','sibling'])put(B,f.get(B,{businessId:b}));
 const r={pk:'SUBJECT#MERCHANT#owner',sk:'REQUEST#'+rid,requestId:rid,actorType:'MERCHANT',subjectId:'owner',scope:{kind:'BUSINESS',id:'branch'},status:'PROCESSING',leaseOwner:randomUUID(),leaseUntil:Math.floor(Date.parse(when)/1000)+300,version:2};
 const job={requestId:rid,subjectId:'owner',businessId:'branch',financialYears:7,policyVersion:3};put(L,r);
 put(B,{...get(B,{businessId:'branch'}),deletionRequestId:rid});put(L,{pk:'BUSINESS_LIFECYCLE#MERCHANT#branch',sk:'META',businessId:'branch',subjectId:'owner',requestId:rid,state:'CLOSING'});
 const db={async send(c){const q=c.input;if(c instanceof GetCommand)return {Item:get(q.TableName,q.Key)};
 if(c instanceof QueryCommand){const all=[...rows].filter(([k])=>k.startsWith(q.TableName+'|')).map(([,v])=>v);return {Items:structuredClone(all.filter(row=>row.pk===q.ExpressionAttributeValues[':pk']&&(!q.ExpressionAttributeValues[':prefix']||row.sk.startsWith(q.ExpressionAttributeValues[':prefix']))))};}
 if(c instanceof ScanCommand)return {Items:[...rows].filter(([k])=>k.startsWith(q.TableName+'|')).map(([,v])=>structuredClone(v))};
 assert(c instanceof TransactWriteCommand);writes.push(q.TransactItems);
 const ids=q.TransactItems.map(op=>{const v=Object.values(op)[0];return key(v.TableName,v.Key||pk(v.TableName,v.Item));});assert.equal(new Set(ids).size,ids.length,'no duplicate transaction targets');
 if(db.fail)throw Object.assign(Error('conditional conflict'),{name:'TransactionCanceledException',CancellationReasons:[{Code:'ConditionalCheckFailed'}]});
 for(const op of q.TransactItems){if(op.Put)put(op.Put.TableName,op.Put.Item);if(op.Delete)del(op.Delete.TableName,op.Delete.Key);}return {};}};
 const run=()=>commercialRetention({db,r,job,clock:()=>when});
 function close(b,id=b==='branch'?rid:'22222222-2222-4222-8222-222222222222'){
 del(B,{businessId:b});put(L,{pk:'BUSINESS_LIFECYCLE#MERCHANT#'+b,sk:'META',businessId:b,subjectId:'owner',requestId:id,state:'CLOSING'});
 put(L,{pk:r.pk,sk:'REQUEST#'+id,requestId:id,actorType:'MERCHANT',subjectId:'owner',scope:{kind:'BUSINESS',id:b},status:'COMPLETED'});
 put(W,{walletId:'WALLET#MERCHANT#'+b,sk:'META',status:'CLOSED',ownerType:'MERCHANT',ownerId:b,deletionRequestId:id,availableBalance:0,lockedBalance:0});
 }
 return {rows,put,get,del,r,job,db,writes,run,close,all:t=>[...rows].filter(([k])=>k.startsWith(t+'|')).map(([,v])=>v)};
}
test('real commercial workflow archives consent, versions and approval; canonical agreement stays byte-identical for sibling',async()=>{
 const f=await fixture(),before=f.all(P).filter(x=>x.pk.startsWith('COMMERCIAL_AGREEMENT#')),result=await f.run();assert(result.archived>=8);assert.equal(result.auditsMoved,3);
 assert.deepEqual(f.all(P).filter(x=>x.pk.startsWith('COMMERCIAL_AGREEMENT#')),before);
 const a=f.all(A);assert(a.some(x=>x.data.sk==='CONSENT#1'));assert(a.some(x=>x.kind==='commercial_approval'));assert.equal(f.all(S).filter(x=>x.pk==='AUDIT').length,0);assert(f.get(B,{businessId:'sibling'}));
 assert(a.every(x=>x.scopeOwnerId==='owner'&&x.scopeBusinessIds.join(',')==='branch,sibling'&&x.policyVersion===3));
 const until=a.map(x=>x.expiresAt);for(const m of f.all(P).filter(x=>x.auditKey)){m.auditKey={sk:m.auditKey.sk,pk:m.auditKey.pk};f.put(P,m);}for(const row of a){row.sourceKey={sk:row.sourceKey.sk,pk:row.sourceKey.pk};f.put(A,row);}await f.run();assert.deepEqual(f.all(A).map(x=>x.expiresAt),until);assert.equal(f.all(A).length,a.length);
 for(const tx of f.writes){assert(tx.some(x=>x.ConditionCheck?.Key.pk===f.r.pk));assert(tx.some(x=>x.ConditionCheck?.TableName===B));if(tx.some(x=>x.Delete?.Key.pk==='AUDIT'))assert(tx.some(x=>x.Put?.TableName===A));}
});
test('full inventory stops before first mutation for holds, missing audit index, unknown source fields and scope mismatch',async()=>{
 for(const mode of ['hold','index','secret','owner','membership']){const f=await fixture();if(mode==='hold')f.put(P,{...f.get(P,{pk:'COMMERCIAL_AGREEMENT#contract',sk:'ACCEPTANCE#1'}),retentionHold:true});if(mode==='index'){const m=f.all(P).find(x=>x.sk.startsWith('COMMERCIAL_REQUEST#'));delete m.auditKey;f.put(P,m);}if(mode==='secret')f.put(P,{...f.get(P,{pk:'COMMERCIAL_AGREEMENT#contract',sk:'VERSION#1'}),secret:'no'});if(mode==='owner')f.put(B,{...f.get(B,{businessId:'branch'}),ownerId:'other'});if(mode==='membership')f.r.scope.kind='MEMBERSHIP';await assert.rejects(f.run(),/HOLD|INDEX_REQUIRED|SCOPE_INVALID|GENERATION_CHANGED|CLEANUP_SCOPE/);assert.equal(f.writes.length,0);assert.equal(f.all(A).length,0);}
});
test('transaction conflict prevents archive success and audit removal; corrupted replay or archive hold blocks',async()=>{
 const f=await fixture();f.db.fail=true;await assert.rejects(f.run(),/conditional conflict/);assert.equal(f.all(A).length,0);assert.equal(f.all(S).filter(x=>x.pk==='AUDIT').length,3);
 for(const mode of ['hold','digest','table']){const g=await fixture();await g.run();const a=g.all(A)[0];if(mode==='hold')a.legalHold=true;if(mode==='digest')a.data.version=987;if(mode==='table')a.sourceTable='other';g.put(A,a);await assert.rejects(g.run(),/HOLD|ARCHIVE_CONFLICT/);}
});
test('expiry requires every sibling closure, completed request, zero closed wallet and exact immutable source proof',async()=>{
 for(const mode of ['activeSibling','pending','balance','hold','changed','valid']){const f=await fixture();await f.run();f.close('branch');if(mode!=='activeSibling')f.close('sibling');if(mode==='pending'){const k={pk:f.r.pk,sk:'REQUEST#22222222-2222-4222-8222-222222222222'};f.put(L,{...f.get(L,k),status:'PROCESSING'});}if(mode==='balance'){const k={walletId:'WALLET#MERCHANT#sibling',sk:'META'};f.put(W,{...f.get(W,k),availableBalance:1});}if(mode==='hold'){const k={walletId:'WALLET#MERCHANT#sibling',sk:'META'};f.put(W,{...f.get(W,k),legalHold:true});}
 const a=f.all(A).find(x=>x.data.sk==='VERSION#1'),source=f.get(P,a.sourceKey);if(mode==='changed')source.termsHash='changed';
 const guards=await commercialPurgeGuards({db:f.db,group:{table:P,key:a.sourceKey,archives:[a]},source});assert.equal(guards?.length,mode==='valid'?8:undefined);
 }
});
test('purger deletes contracts and expired copies together; races and newer archives block without deleting proof',async()=>{
 for(const mode of ['valid','race','newer']){const f=await fixture();await f.run();f.close('branch');f.close('sibling');if(mode==='race')f.db.fail=true;if(mode==='newer'){const a=f.all(A)[0],other=structuredClone(a);other.requestId='33333333-3333-4333-8333-333333333333';other.pk='REQUEST#'+other.requestId;other.expiresAt=9999999999;f.put(A,other);}
 const before=f.all(A).length,result=await financialPurge({db:f.db,clock:()=>3000000000,dryRun:false})();if(mode==='valid'){assert.equal(result.archivesRemoved,before);assert.equal(f.all(A).length,0);assert.equal(f.all(P).filter(x=>x.pk.startsWith('COMMERCIAL_AGREEMENT#')).length,0);}if(mode==='race'){assert.equal(result.archivesRemoved,0);assert.equal(f.all(A).length,before);}if(mode==='newer'){assert(result.blocked>0);assert(f.all(A).some(x=>x.expiresAt===9999999999));assert(f.get(P,f.all(A)[0].sourceKey));}
 }
});
test('commercial source keys cannot target person profiles, staff or unrelated audit keys',()=>{
 for(const [kind,table,key] of [['commercial_agreement',P,{pk:'PERSON#owner',sk:'PROFILE'}],['commercial_approval',S,{pk:'EMPLOYEE#s',sk:'PROFILE'}],['commercial_audit',S,{pk:'AUDIT',sk:'DRAFT'}],['commercial_funding',S,{pk:'DISCOUNT_FUNDING#x',sk:'CONSENT#1'}]])assert.throws(()=>sourceOf({pk:'REQUEST#'+rid,requestId:rid,kind,sk:kind.toUpperCase()+'#'+JSON.stringify(key),sourceTable:table,sourceKey:key,expiresAt:1}),/PURGE_SCOPE_INVALID/);
 assert.throws(()=>validateRecord(S,{pk:'AUDIT',sk:'DRAFT',ownerId:'owner'}),/SCOPE_INVALID/);
});
