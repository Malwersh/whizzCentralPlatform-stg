'use strict';
// Narrow, revision-checked staging rollout. Never activates dispatch or writes order/money tables.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const {STSClient,GetCallerIdentityCommand}=require('@aws-sdk/client-sts');
const {LambdaClient,GetFunctionConfigurationCommand,UpdateFunctionConfigurationCommand,UpdateFunctionCodeCommand,waitUntilFunctionUpdatedV2}=require('@aws-sdk/client-lambda');
const {IAMClient,GetRolePolicyCommand,PutRolePolicyCommand,SimulatePrincipalPolicyCommand}=require('@aws-sdk/client-iam');
const account='699561669180',region='us-east-1';
const names=['WaveSystem_CreateDispatchJob','WaveSystem_StartWave','WaveSystem_HandleWaveTimeout','WaveSystem_HandleDriverAccept','WaveSystem_HandleDriverReject','wizzcentral-notifications-staging-pushSendWaveOffer','staging-wizz-staff-service','staging-cod-integration','DriversApi-staging'];
const gates=['DISPATCH_CYCLE_MODE','DISPATCH_LEGACY_HOST_MODE','DISPATCH_RESTART_START_MODE','DISPATCH_REVIEW_MODE','DISPATCH_REVIEW_EXECUTION_MODE','PINNED_LEGACY_PUSH_MODE','DISPATCH_RESPONSE_INTEGRATION_MODE'];
const digest=env=>crypto.createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.keys(env).sort().map(k=>[k,env[k]])))).digest('hex');
function closedEnvironment(env){
 for(const [k,v] of Object.entries(env))if((/^(DISPATCH_|PINNED_).*_MODE$/.test(k)&&v!=='OFF')||(k==='FINANCIAL_DISPATCH_MODE'&&v!=='OFF'))throw Error('ACTIVE_DISPATCH_GATE');
 return {...env,...Object.fromEntries(gates.map(k=>[k,'OFF']))};
}
function assertConfiguration(c,f,base,{allowCandidate=false,allowClosed=false}={}){
 if(c.FunctionArn!==`arn:aws:lambda:${region}:${account}:function:${f.name}`||c.Role!==base.role||c.Runtime!==f.runtime||c.Handler!==f.handler||c.Timeout!==base.timeout)throw Error('FUNCTION_BINDING_DRIFT');
 if(c.State!=='Active'||c.LastUpdateStatus!=='Successful')throw Error('FUNCTION_NOT_STABLE');
 const env=c.Environment?.Variables??{},d=digest(env);closedEnvironment(env);
 if(d!==f.baseEnvironmentDigest&&!(allowClosed&&d===base.closedEnvironmentDigest))throw Error('ENVIRONMENT_DRIFT');
 if(c.CodeSha256!==f.baseCodeSha256&&!(allowCandidate&&c.CodeSha256===f.candidateCodeSha256))throw Error('LIVE_CODE_DRIFT');
 if(c.CodeSha256===f.baseCodeSha256&&d===f.baseEnvironmentDigest&&c.RevisionId!==f.baseRevisionId)throw Error('LIVE_REVISION_DRIFT');
}
function validatePolicy(p){
 const statement=p?.policy?.Statement;
 if(p.function!=='DriversApi-staging'||p.policyName!=='PinnedDispatchJobRead'||p.role!==`arn:aws:iam::${account}:role/drivers-api-staging-DriversApiFunctionRole-ngkzZnWAPRS0`||p.policy.Version!=='2012-10-17'||statement?.length!==1)throw Error('READ_POLICY_SCOPE');
 const s=statement[0];if(s.Effect!=='Allow'||s.Action!=='dynamodb:GetItem'||s.Resource!==`arn:aws:dynamodb:${region}:${account}:table/WizzDispatchJobs_staging`||Object.keys(s).some(k=>!['Sid','Effect','Action','Resource'].includes(k)))throw Error('READ_POLICY_SCOPE');
}
async function run(audit,release,out,mode){
 if(![audit,release,out].every(path.isAbsolute)||!['--preflight','--grant-read','--publish','--verify'].includes(mode)||process.env.AWS_PROFILE!=='Wizz_stg_UserApp'||process.env.AWS_REGION!==region)throw Error('STAGING_SCOPE_REQUIRED');
 fs.mkdirSync(out,{recursive:true,mode:0o700});
 const save=(n,v)=>fs.writeFileSync(path.join(out,n),JSON.stringify(v,null,2)+'\n',{mode:0o600});
 const inventory=JSON.parse(fs.readFileSync(path.join(audit,'inventory.json'))),manifest=JSON.parse(fs.readFileSync(path.join(release,'manifest.json'))),proposal=JSON.parse(fs.readFileSync(path.join(release,'driver-job-read-plan.json')));
 if(manifest.account!==account||manifest.region!==region||manifest.gates!=='OFF'||manifest.functions.length!==9||names.some(n=>manifest.functions.filter(f=>f.name===n).length!==1))throw Error('PINNED_MANIFEST_REQUIRED');
 validatePolicy(proposal);
 cp.execFileSync('python3',[path.join(__dirname,'verify-dispatch-candidate-archives.py'),audit,release,path.join(out,'archive-verification.json')],{stdio:'pipe'});
 const sts=new STSClient({region}),lambda=new LambdaClient({region}),iam=new IAMClient({region});
 if((await sts.send(new GetCallerIdentityCommand({}))).Account!==account)throw Error('STAGING_ACCOUNT_REQUIRED');
 const refs=Object.fromEntries(inventory.functions.map(f=>[f.name,f]));
 const get=n=>lambda.send(new GetFunctionConfigurationCommand({FunctionName:n}));
 const stable=async n=>{await waitUntilFunctionUpdatedV2({client:lambda,maxWaitTime:180,minDelay:2,maxDelay:4},{FunctionName:n});return get(n);};
 let state;if(fs.existsSync(path.join(out,'preflight.json')))state=JSON.parse(fs.readFileSync(path.join(out,'preflight.json')));
 if(mode==='--preflight'){
  const functions=[];
  for(const f of manifest.functions){const c=await get(f.name),base=refs[f.name];assertConfiguration(c,f,base);functions.push({name:f.name,revisionId:c.RevisionId,baseCodeSha256:c.CodeSha256,baseEnvironmentDigest:f.baseEnvironmentDigest,closedEnvironmentDigest:digest(closedEnvironment(c.Environment?.Variables??{})),role:c.Role,timeout:c.Timeout});}
  save('preflight.json',{account,region,checkedAt:new Date().toISOString(),functions,activation:false,writeOperations:0});return {preflight:true,functions:functions.length};
 }
 if(!state||state.account!==account||state.functions.length!==9)throw Error('PREFLIGHT_REQUIRED');
 const planned=Object.fromEntries(state.functions.map(f=>[f.name,{...refs[f.name],closedEnvironmentDigest:f.closedEnvironmentDigest}]));
 // Validate the full set before any mutation, including resumable closed-state/code matches.
 for(const f of manifest.functions)assertConfiguration(await get(f.name),f,planned[f.name],{allowCandidate:mode!=='--grant-read',allowClosed:mode!=='--grant-read'});
 const role=proposal.role.split('/').pop();
 if(mode==='--grant-read'){
  let existing;try{existing=(await iam.send(new GetRolePolicyCommand({RoleName:role,PolicyName:proposal.policyName}))).PolicyDocument;}catch(e){if(e.name!=='NoSuchEntityException')throw e;}
  if(existing){const decoded=JSON.parse(decodeURIComponent(existing));if(JSON.stringify(decoded)!==JSON.stringify(proposal.policy))throw Error('EXISTING_READ_POLICY_DIFFERS');}
  save('iam-before.json',{role,policyName:proposal.policyName,existed:!!existing,previousPolicy:existing?proposal.policy:null});
  if(!existing)await iam.send(new PutRolePolicyCommand({RoleName:role,PolicyName:proposal.policyName,PolicyDocument:JSON.stringify(proposal.policy)}));
  save('iam-publication.json',{role,policyName:proposal.policyName,policy:proposal.policy,applied:true,alreadyPresent:!!existing,at:new Date().toISOString()});
  return {readPolicyApplied:true,financialPermissionsAdded:false};
 }
 const simulation=await iam.send(new SimulatePrincipalPolicyCommand({PolicySourceArn:proposal.role,ActionNames:['dynamodb:GetItem'],ResourceArns:[proposal.policy.Statement[0].Resource]}));
 const evaluation=simulation.EvaluationResults?.[0];if(evaluation?.EvalDecision!=='allowed'||evaluation.MissingContextValues?.length)throw Error('EFFECTIVE_JOB_READ_REQUIRED');
 save('effective-driver-read.json',{action:evaluation.EvalActionName,decision:evaluation.EvalDecision,resource:proposal.policy.Statement[0].Resource,checkedAt:new Date().toISOString()});
 const results=[];
 if(mode==='--publish'){
  try{for(const f of manifest.functions){
   let c=await get(f.name);assertConfiguration(c,f,planned[f.name],{allowCandidate:true,allowClosed:true});
   const env=c.Environment?.Variables??{},closed=closedEnvironment(env);
   if(digest(env)!==digest(closed)){
    // Config backup is private; public evidence contains only digests and gate values.
    const backup=path.join(out,f.name+'.configuration.private.json');if(!fs.existsSync(backup))save(f.name+'.configuration.private.json',c);
    await lambda.send(new UpdateFunctionConfigurationCommand({FunctionName:f.name,RevisionId:c.RevisionId,Environment:{Variables:closed}}));c=await stable(f.name);
    assertConfiguration(c,f,planned[f.name],{allowCandidate:true,allowClosed:true});
   }
   if(c.CodeSha256!==f.candidateCodeSha256){
    const bytes=fs.readFileSync(path.join(release,f.name+'.candidate.zip'));if(crypto.createHash('sha256').update(bytes).digest('base64')!==f.candidateCodeSha256)throw Error('CANDIDATE_BYTES_CHANGED');
    const r=await lambda.send(new UpdateFunctionCodeCommand({FunctionName:f.name,RevisionId:c.RevisionId,ZipFile:bytes,Publish:false}));if(r.CodeSha256!==f.candidateCodeSha256)throw Error('UPLOAD_HASH_MISMATCH');c=await stable(f.name);
   }
   assertConfiguration(c,f,planned[f.name],{allowCandidate:true,allowClosed:true});
   if(c.CodeSha256!==f.candidateCodeSha256||digest(c.Environment?.Variables??{})!==planned[f.name].closedEnvironmentDigest)throw Error('PUBLICATION_VERIFICATION_FAILED');
   results.push({name:f.name,revisionId:c.RevisionId,codeSha256:c.CodeSha256,closedEnvironmentDigest:planned[f.name].closedEnvironmentDigest,closedGates:Object.fromEntries(gates.map(k=>[k,'OFF'])),unrelatedEnvironmentPreserved:true,timeout:c.Timeout,verifiedAt:new Date().toISOString()});
   save('publication.json',{published:results.length,expected:9,activation:false,functions:results});console.log(JSON.stringify({name:f.name,published:true,gates:'OFF'}));
  }}finally{save('publication.json',{published:results.length,expected:9,activation:false,functions:results});}
  return {published:results.length,activation:false};
 }
 for(const f of manifest.functions){const c=await get(f.name);assertConfiguration(c,f,planned[f.name],{allowCandidate:true,allowClosed:true});if(c.CodeSha256!==f.candidateCodeSha256||digest(c.Environment?.Variables??{})!==planned[f.name].closedEnvironmentDigest)throw Error('FINAL_PUBLICATION_MISMATCH');results.push({name:f.name,codeSha256:c.CodeSha256,revisionId:c.RevisionId,gates:'OFF',unrelatedEnvironmentPreserved:true});}
 save('verification.json',{verifiedAt:new Date().toISOString(),functions:results,published:9,activation:false,financialWrites:false});return {verified:9,activation:false};
}
if(require.main===module)run(...process.argv.slice(2)).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error('CLOSED_RELEASE_FAILED:',/^[A-Z_]+$/.test(e.message??'')?e.message:e.name);process.exitCode=1;});
module.exports={closedEnvironment,assertConfiguration,validatePolicy,digest,gates,names,run};
