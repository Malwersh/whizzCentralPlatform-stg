'use strict';
const {error}=require('./policy');
const KINDS=new Set(['delivery_funding','delivery_usage']);
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,150}$/.test(v);
// No source deletion is permitted by this classifier. A hashed source locator is
// not proof that settlement retries and other parties' claims can be discarded.
function classify(row,now){
 if(!KINDS.has(row?.kind))return null;
 if(!Number.isSafeInteger(now)||now<0||!uuid(row.requestId)||row.pk!=='REQUEST#'+row.requestId||
    !digest(row.sourceKeyDigest)||row.sk!=='DELIVERY_FUNDING#'+row.sourceKeyDigest||
    row.sourceTable!=='staging-PlatformStaff'||row.subjectAlias!=='DELETED#'+row.requestId||
    !Number.isSafeInteger(row.expiresAt)||row.expiresAt<1||!Number.isFinite(Date.parse(row.archivedAt||''))||
    !row.policyVersion||row.data?.kind!==row.kind||!digest(row.data?.sourceDigest)||
    !Number.isSafeInteger(row.data?.version)||row.data.version<1)
   throw error('FUNDING_RETENTION_SCOPE_INVALID');
 if(row.kind==='delivery_funding'){
  if(!id(row.data.orderId)||!['CAPTURED','RELEASED'].includes(row.data.status)||![1,2].includes(row.data.schemaVersion))throw error('FUNDING_RETENTION_SCOPE_INVALID');
 }else if(row.data.schemaVersion!==1||!id(row.data.campaignId)||row.data.reservedUses!==0||!Number.isSafeInteger(row.data.completedUses)||row.data.completedUses<0)throw error('FUNDING_RETENTION_SCOPE_INVALID');
 if(row.legalHold===true||row.retentionHold===true)return 'DOCUMENTED_HOLD';
 return row.expiresAt>now?'WITHIN_RETENTION':'SOURCE_LIFECYCLE_REVIEW_REQUIRED';
}
// Pure review of the complete archive inventory. Never returns permission to
// delete: settlement/replay closure needs independent, transaction-fenced proof.
function reviewGroups(rows, now, {complete=false}={}) {
 if(!Array.isArray(rows))throw error('FUNDING_RETENTION_SCOPE_INVALID');
 const groups=new Map();
 for(const row of rows){
  const reason=classify(row,now);if(!reason)continue;
  if(!groups.has(row.sourceKeyDigest))groups.set(row.sourceKeyDigest,[]);
  groups.get(row.sourceKeyDigest).push(row);
 }
 const counts={INCOMPLETE_INVENTORY:0,DOCUMENTED_HOLD:0,SHARED_RETENTION_ACTIVE:0,SOURCE_EVIDENCE_CONFLICT:0,REPLAY_CLOSURE_REQUIRED:0,USAGE_LIFECYCLE_REQUIRED:0};
 for(const group of groups.values()){
  let reason;
  if(!complete)reason='INCOMPLETE_INVENTORY';
  else if(group.some(r=>r.legalHold===true||r.retentionHold===true))reason='DOCUMENTED_HOLD';
  else if(group.some(r=>r.kind!==group[0].kind||r.sourceTable!==group[0].sourceTable||r.data.sourceDigest!==group[0].data.sourceDigest||r.data.version!==group[0].data.version||r.data.orderId!==group[0].data.orderId||r.data.campaignId!==group[0].data.campaignId))reason='SOURCE_EVIDENCE_CONFLICT';
  else if(group.some(r=>r.expiresAt>now))reason='SHARED_RETENTION_ACTIVE';
  else reason=group[0].kind==='delivery_usage'?'USAGE_LIFECYCLE_REQUIRED':'REPLAY_CLOSURE_REQUIRED';
  counts[reason]++;
 }
 // Only aggregate counts leave this helper; no owner or source keys leak.
 return {sources:groups.size,deleteEligible:0,complete,blockedBy:counts};
}
module.exports={classify,KINDS,reviewGroups};
