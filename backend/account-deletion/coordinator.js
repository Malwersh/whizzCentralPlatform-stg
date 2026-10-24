'use strict';
const {target,blockers,decision,canFinish,receipt,error}=require('./policy');
const {createHash}=require('node:crypto');
// Adapters must validate identity and gather live, complete evidence. store.createVerified
// atomically consumes the scoped OTP proof AND creates the durable request. The worker
// is gated until each application has an approved inventory and a retention policy.
function coordinator({store,adapters,settings,verifyDeletionChallenge,clock=()=>new Date().toISOString()}){
 async function request(actor,input){
  const scope=target(actor,input.scope);
  if(!/^[a-f0-9-]{36}$/.test(input.requestId||''))throw error('INVALID_REQUEST_ID');
  const fingerprint=createHash('sha256').update(JSON.stringify([actor.type,actor.sub,scope,input.requestId])).digest('hex');
  const existing=await store.get(actor,input.requestId);
  if(existing){if(existing.subjectId!==actor.sub||existing.actorType!==actor.type)throw error('FORBIDDEN');if(existing.fingerprint!==fingerprint)throw error('REQUEST_CONFLICT');return receipt(existing);}
  const adapter=adapters[actor.type];if(!adapter)throw error('APPLICATION_NOT_READY');
  const evidence=await adapter.evidence(actor,scope);
  const issues=blockers(actor,scope,evidence);
  const proof=await verifyDeletionChallenge(actor,{...input,scope,fingerprint});
  const config=await settings(actor.type),time=clock();
  const record={requestId:input.requestId,actorType:actor.type,subjectId:actor.sub,scope,fingerprint,status:decision(issues,config),blockers:issues,policyVersion:config.retentionPolicyVersion||null,requiredSteps:adapter.requiredSteps(scope),version:1,createdAt:time,updatedAt:time};
  return receipt(await store.createVerified(record,proof));
 }
 async function refresh(actor,id){
  const r=await store.get(actor,id);if(!r)throw error('REQUEST_NOT_FOUND');
  if(r.subjectId!==actor.sub||r.actorType!==actor.type)throw error('FORBIDDEN');
  // Read-only progress after locking: never replace a durable job or overwrite a worker.
  if(r.job||r.leaseOwner||!['PENDING_SETTLEMENT','PENDING_EXTERNAL_ASSET','PENDING_POLICY','READY'].includes(r.status))return receipt(r);
  const adapter=adapters[r.actorType];if(!adapter)throw error('APPLICATION_NOT_READY');
  const evidence=await adapter.evidence(actor,r.scope),issues=blockers(actor,r.scope,evidence);
  const config=await settings(r.actorType,r.policyVersion);
  return receipt(await store.update(r,{status:decision(issues,config),blockers:issues,updatedAt:clock()}));
 }
 async function process(actor,id){
  let r=await store.get(actor,id);if(!r)throw error('REQUEST_NOT_FOUND');
  if(r.subjectId!==actor.sub||r.actorType!==actor.type)throw error('FORBIDDEN');
  if(r.status==='COMPLETED')return receipt(r);
  const adapter=adapters[r.actorType];if(!adapter)throw error('APPLICATION_NOT_READY');
  if(store.acquireLease)r=await store.acquireLease(r);
  try{
   const config=await settings(r.actorType,r.policyVersion);
   let job=r.job;
   // Once locked, resume the durable manifest. Profiles may already be deleted:
   // rerunning eligibility at that point would incorrectly prevent recovery.
   if(!job){
    const evidence=await adapter.evidence(actor,r.scope),issues=blockers(actor,r.scope,evidence),next=decision(issues,config);
    if(next!=='READY')return receipt(await store.update(r,{status:next,blockers:issues,updatedAt:clock()}));
    job=await adapter.lock(r,evidence,config);
    // Production lock must atomically persist the manifest with the eligibility fence.
    if(store.acquireLease){r=await store.get(actor,id);if(!r.job)throw error('DURABLE_LOCK_REQUIRED');job=r.job;}
    else r=await store.update(r,{job,status:'PROCESSING',blockers:[],policyVersion:config.retentionPolicyVersion,updatedAt:clock()});
   }
   if(r.status!=='PROCESSING')r=await store.update(r,{status:'PROCESSING',updatedAt:clock()});
   for(const step of r.requiredSteps){
    const steps=await store.steps(r);
    if(steps[step]?.status==='COMPLETED')continue;
    if(store.renewLease)r=await store.renewLease(r);
    await adapter.execute(step,r,job);
    await store.completeStep(r,step,clock());
   }
   if(!canFinish(r,await store.steps(r)))throw error('CLEANUP_INCOMPLETE');
   r=await store.update(r,{status:'COMPLETED',restoreManifest:{subjectId:r.subjectId,actorType:r.actorType,scope:r.scope,profileIds:job.profileIds||[],walletIds:job.walletIds||[],completedAt:clock()},job:null,updatedAt:clock()});
   return receipt(r);
  }catch(e){
   await store.update(r,{status:'RETRY_REQUIRED',updatedAt:clock()});
   throw error('CLEANUP_RETRY_REQUIRED');
  }finally{if(store.releaseLease)await store.releaseLease(r);}
 }

 return {request,refresh,process};
}
module.exports={coordinator};
