const {test}=require('node:test'),assert=require('node:assert/strict');
const {closedEnvironment,assertConfiguration,validatePolicy,digest,gates}=require('../publish-dispatch-closed-staging.cjs');
test('closed rollout preserves existing finance and provider configuration and rejects active dispatch',()=>{
 const env={FINANCIAL_COD_INTEGRATION_MODE:'OFF',NOTIFICATIONS_INTERNAL_KEY:'synthetic-private',CUSTOM:'keep'},next=closedEnvironment(env);
 for(const [k,v]of Object.entries(env))assert.equal(next[k],v);for(const k of gates)assert.equal(next[k],'OFF');assert.equal(env.DISPATCH_CYCLE_MODE,undefined);
 for(const flag of ['DISPATCH_CYCLE_MODE','DISPATCH_LEGACY_HOST_MODE','PINNED_LEGACY_PUSH_MODE','FINANCIAL_DISPATCH_MODE'])assert.throws(()=>closedEnvironment({[flag]:'REQUIRED'}),/ACTIVE_DISPATCH/);
});
function fixture(){const env={STAGE:'staging'},f={name:'DriversApi-staging',handler:'lambda_driver_api_v2.handler',runtime:'nodejs20.x',baseCodeSha256:'base',candidateCodeSha256:'candidate',baseRevisionId:'original',baseEnvironmentDigest:digest(env)},base={role:'role',timeout:30,closedEnvironmentDigest:digest(closedEnvironment(env))},c={FunctionArn:'arn:aws:lambda:us-east-1:699561669180:function:DriversApi-staging',Role:'role',Runtime:f.runtime,Handler:f.handler,Timeout:30,State:'Active',LastUpdateStatus:'Successful',RevisionId:'original',CodeSha256:'base',Environment:{Variables:env}};return {f,base,c};}
test('rollout fails on stale code, revision, unrelated env, role, runtime, timeout or unstable Lambda',()=>{
 const {f,base,c}=fixture();assertConfiguration(c,f,base);
 for(const [k,v]of Object.entries({CodeSha256:'coworker-code',RevisionId:'new-revision',Role:'other',Runtime:'nodejs22.x',Timeout:60,LastUpdateStatus:'InProgress'}))assert.throws(()=>assertConfiguration({...c,[k]:v},f,base));
 assert.throws(()=>assertConfiguration({...c,Environment:{Variables:{STAGE:'staging',OTHER:'drift'}}},f,base,{allowClosed:true}),/ENVIRONMENT_DRIFT/);
});
test('resuming accepts only pinned candidate and expected closed environment',()=>{
 const {f,base,c}=fixture(),next={...c,RevisionId:'changed-by-rollout',CodeSha256:'candidate',Environment:{Variables:closedEnvironment(c.Environment.Variables)}};
 assert.throws(()=>assertConfiguration(next,f,base));assertConfiguration(next,f,base,{allowCandidate:true,allowClosed:true});
 assert.throws(()=>assertConfiguration({...next,CodeSha256:'other'},f,base,{allowCandidate:true,allowClosed:true}),/LIVE_CODE_DRIFT/);
});
test('grant proposal admits exactly GetItem on staging jobs and rejects wider scopes',()=>{
 const p={function:'DriversApi-staging',role:'arn:aws:iam::699561669180:role/drivers-api-staging-DriversApiFunctionRole-ngkzZnWAPRS0',policyName:'PinnedDispatchJobRead',policy:{Version:'2012-10-17',Statement:[{Sid:'PinnedDispatchJobRead',Effect:'Allow',Action:'dynamodb:GetItem',Resource:'arn:aws:dynamodb:us-east-1:699561669180:table/WizzDispatchJobs_staging'}]}};
 validatePolicy(p);for(const patch of [{Action:'dynamodb:*'},{Resource:'*'},{Effect:'Deny'},{NotResource:'foreign'}])assert.throws(()=>validatePolicy({...p,policy:{...p.policy,Statement:[{...p.policy.Statement[0],...patch}]}}),/READ_POLICY_SCOPE/);
 assert.throws(()=>validatePolicy({...p,function:'DriversApi-production'}),/READ_POLICY_SCOPE/);
});
