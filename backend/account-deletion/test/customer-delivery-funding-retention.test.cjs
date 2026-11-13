'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {reviewGroups}=require('../customer-delivery-funding-retention');
function row(extra={}){const requestId='11111111-1111-4111-8111-111111111111';return {pk:'REQUEST#'+requestId,sk:'DELIVERY_FUNDING#'+'a'.repeat(64),requestId,kind:'delivery_funding',sourceTable:'staging-PlatformStaff',sourceKeyDigest:'a'.repeat(64),subjectAlias:'DELETED#'+requestId,expiresAt:999,archivedAt:'2026-11-12T12:00:00Z',policyVersion:1,data:{kind:'delivery_funding',sourceDigest:'b'.repeat(64),schemaVersion:1,version:2,orderId:'order',status:'CAPTURED'},...extra};}
const review=rows=>reviewGroups(rows,1000,{complete:true});
test('expired source remains blocked without independently fenced replay closure',()=>{const r=review([row()]);assert.equal(r.deleteEligible,0);assert.equal(r.blockedBy.REPLAY_CLOSURE_REQUIRED,1);});
test('another request extends the same source retention',()=>{const a=row(),requestId='22222222-2222-4222-8222-222222222222';const r=review([a,row({requestId,pk:'REQUEST#'+requestId,subjectAlias:'DELETED#'+requestId,expiresAt:1001})]);assert.equal(r.sources,1);assert.equal(r.blockedBy.SHARED_RETENTION_ACTIVE,1);assert.equal(r.deleteEligible,0);});
test('hold takes precedence over expired or conflicting copies',()=>{const a=row();const r=review([a,row({legalHold:true,data:{...a.data,sourceDigest:'c'.repeat(64)}})]);assert.equal(r.blockedBy.DOCUMENTED_HOLD,1);});
test('different source versions cannot be treated as settled proof',()=>{const a=row();assert.equal(review([a,row({data:{...a.data,version:3}})]).blockedBy.SOURCE_EVIDENCE_CONFLICT,1);});
test('usage requires its own lifecycle even when reserved uses are zero',()=>{const a=row();a.kind='delivery_usage';a.data={kind:a.kind,sourceDigest:'b'.repeat(64),schemaVersion:1,version:2,campaignId:'campaign',reservedUses:0,completedUses:1};assert.equal(review([a]).blockedBy.USAGE_LIFECYCLE_REQUIRED,1);});
test('incomplete inventory cannot declare shared retention complete',()=>{const r=reviewGroups([row()],1000);assert.equal(r.complete,false);assert.equal(r.blockedBy.INCOMPLETE_INVENTORY,1);assert.equal(r.deleteEligible,0);});
test('malformed evidence fails closed',()=>assert.throws(()=>review([row({sourceKeyDigest:'bad'})]),/SCOPE_INVALID/));
test('report contains counts only, never owner or source locators',()=>{const r=review([row()]);assert.ok(!JSON.stringify(r).includes('11111111'));assert.ok(!JSON.stringify(r).includes('order'));});
