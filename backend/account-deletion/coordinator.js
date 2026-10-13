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
 async function process(actor,id){
  const r=await store.get(actor,id);if(!r)throw error('REQUEST_NOT_FOUND');
  if(r.subjectId!==actor.sub||r.actorType!==actor.type)throw error('FORBIDDEN');
  if(r.status==='COMPLETED')return receipt(r);
  const adapter=adapters[r.actorType];if(!adapter)throw error('APPLICATION_NOT_READY');
  const config=await settings(r.actorType,r.policyVersion);
  const evidence=await adapter.evidence(actor,r.scope),issues=blockers(actor,r.scope,evidence),next=decision(issues,config);
  if(next!=='READY'){return receipt(await store.update(r,{status:next,blockers:issues,updatedAt:clock()}));}
  // lock checks the same versions/eligibility read above; a stale snapshot cannot authorize deletion.
  const job=await adapter.lock(r,evidence,config);
  let current=await store.update(r,{status:'PROCESSING',blockers:[],policyVersion:config.retentionPolicyVersion,updatedAt:clock()});
  try{
   for(const step of current.requiredSteps){
    const steps=await store.steps(current);
    if(steps[step]?.status==='COMPLETED')continue;
    await adapter.execute(step,current,job);
    await store.completeStep(current,step,clock());
   }
   if(!canFinish(current,await store.steps(current)))throw error('CLEANUP_INCOMPLETE');
   current=await store.update(current,{status:'COMPLETED',updatedAt:clock()});
  }catch(e){
   await store.update(current,{status:'RETRY_REQUIRED',updatedAt:clock()});
   throw error('CLEANUP_RETRY_REQUIRED'); // Never expose raw provider errors or report success.
  }
  return receipt(current);
 }
 return {request,process};
}
module.exports={coordinator};
