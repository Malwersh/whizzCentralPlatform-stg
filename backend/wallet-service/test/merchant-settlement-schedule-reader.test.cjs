'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createMerchantSettlementScheduleReader:create}=require('../dist/merchantSettlementScheduleReader');
const {quoteHash}=require('../dist/deliveryQuoteRecord');
function fixture(){
 const body={schemaVersion:1,kind:'MERCHANT_SETTLEMENT_SCHEDULE',branchId:'branch1',ownerId:'owner1',enabled:true,status:'APPROVED',schedule:{schemaVersion:1,version:1,frequency:'WEEKLY',timezone:'Asia/Baghdad',anchorLocalDate:'2026-10-01'},agreement:{id:'agreement1',version:2,termsHash:'a'.repeat(64)},effectiveFrom:'2026-09-30T21:00:00.000Z',effectiveTo:null,acceptedBy:'owner1',acceptedAt:'2026-09-29T12:00:00.000Z',approvedBy:'finance1',approvedAt:'2026-09-29T13:00:00.000Z'};
 const row={pk:'BRANCH#branch1',sk:'SETTLEMENT_SCHEDULE#CURRENT',...body,digest:quoteHash(body)},branch={ownerId:'owner1',cognitoUserId:'owner1'},calls=[];
 const db={async send(c){calls.push(c);assert.equal(c.constructor.name,'GetCommand');assert.equal(c.input.ConsistentRead,true);return {Item:structuredClone(c.input.TableName==='staging-MerchantPlatform'?db.missing?undefined:row:branch)};}};
 const hash=()=>{const {pk,sk,digest,...rest}=row;row.digest=quoteHash(rest);};
 return {row,branch,db,hash,calls,read:create(db)};
}
test('approved explicit schedule is pinned with agreement, and no policy or account writes occur',async()=>{
 const f=fixture(),v=await f.read('branch1','2026-10-15T12:00:00.000Z');assert.deepEqual(v.schedule,f.row.schedule);assert.deepEqual(v.agreementBinding,f.row.agreement);assert.equal(v.guard.ConditionCheck.Key.sk,'SETTLEMENT_SCHEDULE#CURRENT');assert(Object.values(v.guard.ConditionCheck.ExpressionAttributeValues).includes(f.row.digest));
});
test('missing and disabled schedules do not invent a default',async()=>{const f=fixture();f.db.missing=true;assert.equal(await f.read('branch1','2026-10-15T12:00:00.000Z'),null);f.db.missing=false;f.row.enabled=false;assert.equal(await f.read('branch1','2026-10-15T12:00:00.000Z'),null);});
test('unapproved, corrupt, foreign or incomplete agreement/consent policy fails closed',async()=>{
 for(const mode of ['approval','consent','hash','branch','terms','version','field','acceptDate','approveDate','effectiveTo']){const f=fixture();if(mode==='approval')f.row.status='DRAFT';if(mode==='consent')f.row.acceptedBy='other';if(mode==='branch')f.row.branchId='other';if(mode==='terms')f.row.agreement.termsHash='bad';if(mode==='version')f.row.schedule.version=0;if(mode==='field')f.row.extra='unknown';if(mode==='acceptDate')f.row.acceptedAt='2026-10-20T00:00:00.000Z';if(mode==='approveDate')f.row.approvedAt='2026-10-20T00:00:00.000Z';if(mode==='effectiveTo')f.row.effectiveTo=f.row.effectiveFrom;f.hash();if(mode==='hash')f.row.digest='bad';await assert.rejects(f.read('branch1','2026-10-15T12:00:00.000Z'),/SCHEDULE_APPROVAL_REQUIRED|INVALID_MERCHANT_SETTLEMENT_PERIOD/);}
});
test('ownership changes and deletion stop reads',async()=>{for(const mode of ['owner','delete']){const f=fixture();if(mode==='owner')f.branch.ownerId='other';else f.branch.deletionRequestId='r';await assert.rejects(f.read('branch1','2026-10-15T12:00:00.000Z'),/OWNER_CHANGED/);}});
test('policy must cover the whole selected calendar period; historical schedules are never inferred',async()=>{
 const f=fixture();f.row.effectiveFrom='2026-10-15T00:00:00.000Z';f.hash();await assert.rejects(f.read('branch1','2026-10-15T12:00:00.000Z'),/HISTORICAL_SCHEDULE_REQUIRED/);
 const g=fixture();g.row.effectiveTo='2026-10-20T21:00:00.000Z';g.hash();await assert.rejects(g.read('branch1','2026-10-15T12:00:00.000Z'),/HISTORICAL_SCHEDULE_REQUIRED/);
 const h=fixture();h.row.effectiveTo='2026-10-21T21:00:00.000Z';h.hash();assert(await h.read('branch1','2026-10-15T12:00:00.000Z'));
});
