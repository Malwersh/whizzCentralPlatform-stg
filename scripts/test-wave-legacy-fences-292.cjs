'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),{AsyncLocalStorage}=require('async_hooks');
const root=process.env.FLOW_AUDIT_ROOT||'/private/tmp/driver-flow-audit-292';
(async()=>{
 for(const name of ['WaveSystem_StartWave','WaveSystem_HandleWaveTimeout']){
  const s=fs.readFileSync(root+'/'+name+'/candidate-index.js','utf8');
  const marker=name==='WaveSystem_StartWave'?"if(process.env.DISPATCH_FINANCIAL_HOST_MODE==='REQUIRED'&&process.env.FINANCE_GENERAL_RELEASE_MODE==='REQUIRED')return":"if(process.env.DISPATCH_FINANCIAL_HOST_MODE==='REQUIRED'&&process.env.FINANCE_GENERAL_RELEASE_MODE==='REQUIRED'){result.skipped=";
  const at=s.indexOf(marker);assert(at>0);const end=s.indexOf('\n',at);const context={process:{env:{DISPATCH_FINANCIAL_HOST_MODE:'REQUIRED',FINANCE_GENERAL_RELEASE_MODE:'REQUIRED'}},result:{}};
  vm.runInNewContext('this.test=()=>{'+s.slice(at,end)+';throw Error("LEGACY_SELECTION_REACHED")}',context);const answer=context.test();assert(name==='WaveSystem_StartWave'?answer.statusCode===409:answer.skipped==='UNPINNED_LEGACY_CYCLE_DISABLED');
 }
 for(const field of ['financialSnapshot','commercialPricing','financialAcceptance','financialOutcome','codFinancialEvidence']){
  const s=fs.readFileSync(root+'/WaveSystem_HandleDriverReject/candidate-index.js','utf8');let writes=0;class GetCommand{constructor(input){this.input=input;}}class UpdateCommand{constructor(input){this.input=input;}}
  const db={async send(c){if(c instanceof UpdateCommand)writes++;assert(c instanceof GetCommand);assert.equal(c.input.ConsistentRead,true);return {Item:{[field]:{}}};}};
  const context={exports:{},console:{log(){},error(){}},process:{env:{DISPATCH_JOBS_TABLE:'jobs',WAVE_OFFERS_TABLE:'offers',DRIVER_LIVE_STATE_TABLE:'WizzDriverLiveState_staging'}},require:n=>n==='./finance-rollout-config-208.js'?{restoreFinanceRolloutConfig(){}}:n==='./driver-lifecycle'?{driverRequestContext:new AsyncLocalStorage(),driverLifecycleClient:x=>x}:n==='@aws-sdk/client-dynamodb'?{DynamoDBClient:class{}}:n==='@aws-sdk/lib-dynamodb'?{DynamoDBDocumentClient:{from:()=>db},GetCommand,UpdateCommand}:n==='@aws-sdk/client-lambda'?{LambdaClient:class{},InvokeCommand:class{}}:(()=>{throw Error(n)})()};
  vm.runInNewContext(s,context);const r=await context.exports.handler({driverId:'driver',orderId:'order',offerId:'offer'});assert.equal(r.statusCode,409);assert.equal(JSON.parse(r.body).code,'FINANCIAL_DECLINE_REQUIRED');assert.equal(writes,0);
 }
 console.log('PASS 7 actual-package legacy fences: no legacy selection or metrics writes for modern requests');
})().catch(e=>{console.error(e);process.exitCode=1;});
