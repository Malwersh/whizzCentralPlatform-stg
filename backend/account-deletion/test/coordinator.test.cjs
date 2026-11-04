const test=require('node:test'),assert=require('node:assert/strict');
const {coordinator}=require('../coordinator');
const actor={sub:'one',type:'CUSTOMER'},id='11111111-1111-4111-8111-111111111111';
function fixture({failStep,credit=0,policy=true,proofError=false}={}){
 let record,proofCalls=0,completed={},executed=[];
 const adapter={requiredSteps:()=>['devices','profile','identity'],evidence:async()=>({complete:true,wallets:[{walletId:'wallet',available:credit,locked:0}]}),lock:async()=>({}),execute:async step=>{executed.push(step);if(failStep===step){failStep=null;throw Error('Provider secret must not leak');}}};
 const store={get:async()=>record,createVerified:async(r)=>{record=r;return r;},update:async(r,p)=>{record={...r,...p,version:r.version+1};return record;},steps:async()=>completed,completeStep:async(r,step)=>{completed[step]={status:'COMPLETED'};}};
 const service=coordinator({store,adapters:{CUSTOMER:adapter},settings:async()=>({inventoryApproved:policy,retentionPolicyVersion:policy?1:null}),verifyDeletionChallenge:async()=>{proofCalls++;if(proofError)throw Error('INVALID_CODE');return {guard:'atomic-consumption'};}});
 return {service,executed,adapter,store,proofCalls:()=>proofCalls,record:()=>record,input:{scope:{kind:'ACCOUNT'},requestId:id}};
}
test('refresh removes resolved blockers without executing cleanup or consuming OTP',async()=>{const f=fixture({credit:5000});await f.service.request(actor,f.input);f.adapter.evidence=async()=>({complete:true,wallets:[]});assert.equal((await f.service.refresh(actor,id)).status,'READY');assert.deepEqual(f.record().blockers,[]);assert.deepEqual(f.executed,[]);assert.equal(f.proofCalls(),1);});
test('refresh cannot overwrite an active worker manifest',async()=>{const f=fixture();await f.service.request(actor,f.input);await f.store.update(f.record(),{job:{subjectId:actor.sub},status:'PROCESSING'});f.adapter.evidence=()=>{throw Error('unexpected read');};assert.equal((await f.service.refresh(actor,id)).status,'PROCESSING');});
test('refresh retains policy wait after money is settled if inventory is not approved',async()=>{const f=fixture({credit:5000,policy:false});await f.service.request(actor,f.input);f.adapter.evidence=async()=>({complete:true,wallets:[]});assert.equal((await f.service.refresh(actor,id)).status,'PENDING_POLICY');assert.deepEqual(f.executed,[]);});
test('verified request is idempotent without consuming another OTP',async()=>{const f=fixture();assert.equal((await f.service.request(actor,f.input)).status,'READY');assert.equal((await f.service.request(actor,f.input)).status,'READY');assert.equal(f.proofCalls(),1);});
test('failed proof cannot create deletion request',async()=>{const f=fixture({proofError:true});await assert.rejects(f.service.request(actor,f.input),/INVALID_CODE/);assert.equal(f.record(),undefined);});
test('pending refund is visible and cannot execute deletion',async()=>{const f=fixture({credit:5000});assert.equal((await f.service.request(actor,f.input)).status,'PENDING_SETTLEMENT');assert.equal((await f.service.process(actor,id)).status,'PENDING_SETTLEMENT');assert.deepEqual(f.executed,[]);});
test('unapproved inventory/policy cannot execute deletion',async()=>{const f=fixture({policy:false});await f.service.request(actor,f.input);assert.equal((await f.service.process(actor,id)).status,'PENDING_POLICY');assert.deepEqual(f.executed,[]);});
test('failed provider step records retry and preserves completed steps',async()=>{const f=fixture({failStep:'profile'});await f.service.request(actor,f.input);await assert.rejects(f.service.process(actor,id),/CLEANUP_RETRY_REQUIRED/);assert.equal(f.record().status,'RETRY_REQUIRED');assert.equal((await f.service.process(actor,id)).status,'COMPLETED');assert.deepEqual(f.executed,['devices','profile','profile','identity']);});
test('other actor cannot read or execute a deletion request',async()=>{const f=fixture();await f.service.request(actor,f.input);await assert.rejects(f.service.process({sub:'other',type:'CUSTOMER'},id),/FORBIDDEN/);await assert.rejects(f.service.request({sub:'other',type:'CUSTOMER'},f.input),/FORBIDDEN/);assert.deepEqual(f.executed,[]);});
test('retry after profile removal resumes manifest without resolving deleted identity',async()=>{
 let record,profileExists=true,failIdentity=true,evidenceCalls=0;
 const completed={},executed=[];
 const manifest={subjectId:actor.sub,profileIds:['legacy-profile']};
 const store={get:async()=>record,createVerified:async r=>(record=r),update:async(r,p)=>(record={...r,...p,version:r.version+1}),steps:async()=>completed,completeStep:async(r,s)=>{completed[s]={status:'COMPLETED'};}};
 const adapter={requiredSteps:()=>['profile','identity'],evidence:async()=>{evidenceCalls++;if(!profileExists)throw Error('PROFILE_NOT_FOUND');return {complete:true,wallets:[]};},lock:async()=>manifest,execute:async(step,r,job)=>{assert.deepEqual(job,manifest);executed.push(step);if(step==='profile')profileExists=false;if(step==='identity'&&failIdentity){failIdentity=false;throw Error('temporary provider failure');}}};
 const service=coordinator({store,adapters:{CUSTOMER:adapter},settings:async()=>({inventoryApproved:true,retentionPolicyVersion:1}),verifyDeletionChallenge:async()=>({})});
 await service.request(actor,{scope:{kind:'ACCOUNT'},requestId:id});
 await assert.rejects(service.process(actor,id),/CLEANUP_RETRY_REQUIRED/);
 assert.equal(evidenceCalls,2);
 assert.equal((await service.process(actor,id)).status,'COMPLETED');
 assert.equal(evidenceCalls,2);
 assert.deepEqual(executed,['profile','identity','identity']);
 assert.equal(record.job,null);
});
