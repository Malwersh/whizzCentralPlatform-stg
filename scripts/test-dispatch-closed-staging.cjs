'use strict';
// Invokes only empty/unauthenticated early-return branches. Never invokes the periodic Timeout worker.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {STSClient,GetCallerIdentityCommand}=require('@aws-sdk/client-sts');
const {LambdaClient,InvokeCommand}=require('@aws-sdk/client-lambda');
async function run(out,baseline){
 if(!path.isAbsolute(out)||process.env.AWS_PROFILE!=='Wizz_stg_UserApp'||process.env.AWS_REGION!=='us-east-1')throw Error('STAGING_SCOPE_REQUIRED');
 if((await new STSClient({region:'us-east-1'}).send(new GetCallerIdentityCommand({}))).Account!=='699561669180')throw Error('STAGING_ACCOUNT_REQUIRED');
 const client=new LambdaClient({region:'us-east-1'}),cases=[
  {name:'WaveSystem_CreateDispatchJob',event:{Records:[]},status:200},
  {name:'WaveSystem_StartWave',event:{},expectedError:'Missing dispatchJobId in event'}, // Missing job selector; fails before any reads/writes.
  {name:'WaveSystem_HandleDriverAccept',event:{body:'{}'},status:400},
  {name:'WaveSystem_HandleDriverReject',event:{body:'{}'},status:500,expectedMessage:'Missing required parameters: driverId, orderId, or offerId'},
  {name:'wizzcentral-notifications-staging-pushSendWaveOffer',event:{httpMethod:'POST',headers:{},body:'{}'},status:401},
  {name:'staging-wizz-staff-service',event:{httpMethod:'GET',path:'/staff/dispatch-reviews',headers:{}},status:401},
  {name:'DriversApi-staging',event:{httpMethod:'GET',path:'/driver/profile',headers:{}},status:401},
  {name:'staging-cod-integration',event:{},disabled:true}
 ];
 const results=[];
 for(const c of cases){
  const r=await client.send(new InvokeCommand({FunctionName:c.name,InvocationType:'RequestResponse',Payload:Buffer.from(JSON.stringify(c.event))}));
  if(c.expectedError){const value=JSON.parse(Buffer.from(r.Payload).toString());if(r.StatusCode!==200||!r.FunctionError||value.errorMessage!==c.expectedError)throw Error('UNEXPECTED_STARTWAVE_FAILURE');results.push({name:c.name,expectedRejection:true,errorType:value.errorType,errorMessage:value.errorMessage});continue;}
  if(r.FunctionError||r.StatusCode!==200){fs.writeFileSync(out+'.failure.private.json',JSON.stringify({name:c.name,response:JSON.parse(Buffer.from(r.Payload??[]).toString()||'{}')},null,2),{mode:0o600});console.error('FAILED_CASE:',c.name);throw Error('CLOSED_SMOKE_LAMBDA_ERROR');}
  const value=JSON.parse(Buffer.from(r.Payload).toString());if(c.disabled?value.disabled!==true||value.processed!==0:value.statusCode!==c.status){fs.writeFileSync(out+'.response.private.json',JSON.stringify({name:c.name,response:value},null,2),{mode:0o600});console.error('FAILED_CASE_STATUS:',c.name,value.statusCode??'NON_PROXY');throw Error('CLOSED_SMOKE_RESPONSE_MISMATCH');}
  if(c.expectedMessage&&JSON.parse(value.body).message!==c.expectedMessage)throw Error('UNEXPECTED_REJECTION_FAILURE');
  results.push({name:c.name,statusCode:value.statusCode??null,disabled:value.disabled??null,responseSha256:crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')});
 }
 if(baseline){const old=JSON.parse(fs.readFileSync(baseline));if(JSON.stringify(old.cases)!==JSON.stringify(results))throw Error('BASELINE_RESPONSE_CHANGED');}
 const report={checkedAt:new Date().toISOString(),scope:'EMPTY_OR_UNAUTHENTICATED_EARLY_RETURNS',cases:results,baselineMatched:!!baseline,timeoutWorkerInvoked:false,humanRecordsUsed:false,providerMessagesSent:false};
 fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({safeSmokePassed:results.length,baselineMatched:!!baseline,timeoutWorkerInvoked:false}));
}
if(require.main===module)run(...process.argv.slice(2)).catch(e=>{console.error('CLOSED_SMOKE_FAILED:',/^[A-Z_]+$/.test(e.message??'')?e.message:e.name);process.exitCode=1;});
module.exports={run};
