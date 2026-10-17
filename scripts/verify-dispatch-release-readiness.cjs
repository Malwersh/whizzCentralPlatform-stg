'use strict';
// AWS read/simulation only. Never mutates code, configuration, IAM or policy rows.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {LambdaClient,GetFunctionConfigurationCommand}=require('@aws-sdk/client-lambda');
const {IAMClient,SimulatePrincipalPolicyCommand}=require('@aws-sdk/client-iam');
const {DynamoDBClient}=require('@aws-sdk/client-dynamodb');
const {DynamoDBDocumentClient,GetCommand}=require('@aws-sdk/lib-dynamodb');
const {STSClient,GetCallerIdentityCommand}=require('@aws-sdk/client-sts');
const account='699561669180',region='us-east-1',hash=b=>crypto.createHash('sha256').update(b).digest('hex'),resource=t=>`arn:aws:dynamodb:${region}:${account}:table/${t}`;
async function verify(audit,out){
 if(!path.isAbsolute(audit)||!path.isAbsolute(out)||process.env.AWS_PROFILE!=='Wizz_stg_UserApp'||process.env.AWS_REGION!==region)throw Error('STAGING_SCOPE_REQUIRED');
 if((await new STSClient({region}).send(new GetCallerIdentityCommand({}))).Account!==account)throw Error('STAGING_ACCOUNT_REQUIRED');
 const inventory=JSON.parse(fs.readFileSync(path.join(audit,'inventory.json'))),lambda=new LambdaClient({region}),iam=new IAMClient({region});
 const result={schemaVersion:1,account,region,checkedAt:new Date().toISOString(),published:false,iamGranted:false,functions:[],permissionChecks:[]};
 const requests=await Promise.allSettled(inventory.functions.map(async f=>{const c=await lambda.send(new GetFunctionConfigurationCommand({FunctionName:f.name})),env=c.Environment?.Variables??{};const environmentDigest=hash(JSON.stringify(Object.fromEntries(Object.keys(env).sort().map(k=>[k,env[k]]))));const featureGates=Object.fromEntries(Object.keys(env).filter(k=>/^(FINANCIAL_|DISPATCH_|PINNED_).*_MODE$/.test(k)||k==='DELIVERY_QUOTES_ENABLED').map(k=>[k,env[k]]));return {name:f.name,codeUnchanged:c.CodeSha256===f.codeSha256,revisionUnchanged:c.RevisionId===f.revisionId,environmentUnchanged:environmentDigest===f.environmentDigest,role:c.Role,featureGates,timeout:c.Timeout};}));
 for(const r of requests){if(r.status==='rejected')throw Error('FRESH_FUNCTION_READ_FAILED');result.functions.push(r.value);}
 const check=async(f,action,table,gateOffRequired)=>{const arn=resource(table),r=await iam.send(new SimulatePrincipalPolicyCommand({PolicySourceArn:f.role,ActionNames:[action],ResourceArns:[arn],ContextEntries:[{ContextKeyName:'dynamodb:LeadingKeys',ContextKeyType:'stringList',ContextKeyValues:[table==='staging-PlatformStaff'?'DISPATCH_REVIEW#'+'a'.repeat(64):'order1']},{ContextKeyName:'dynamodb:Select',ContextKeyType:'string',ContextKeyValues:['SPECIFIC_ATTRIBUTES']},{ContextKeyName:'dynamodb:Attributes',ContextKeyType:'stringList',ContextKeyValues:['orderId','SK','kind','state','status','dispatchCycle']}]}));const e=r.EvaluationResults?.[0],specific=e?.ResourceSpecificResults?.find(x=>x.EvalResourceName===arn);return {function:f.name,action,resource:arn,requiredWithGatesOff:gateOffRequired,decision:specific?.EvalResourceDecision??e?.EvalDecision,missingContext:[...new Set([...(e?.MissingContextValues??[]),...(specific?.MissingContextValues??[])])]};};
 const checks=[];for(const f of result.functions){if(f.name.startsWith('WaveSystem_')||f.name==='DriversApi-staging')checks.push(()=>check(f,'dynamodb:GetItem','WizzDispatchJobs_staging',true));if(f.name==='WaveSystem_HandleWaveTimeout'){for(const t of ['WizzOrders','WhizzMerchants_Businesses','staging-AccountDeletion','staging-PlatformStaff'])checks.push(()=>check(f,'dynamodb:GetItem',t,false));checks.push(()=>check(f,'dynamodb:UpdateItem','WizzOrders',false));checks.push(()=>check(f,'dynamodb:Scan','WizzDispatchJobs_staging',false));}}
 for(const run of checks){try{result.permissionChecks.push(await run());}catch(e){const failure=Error('PRINCIPAL_SIMULATION_FAILED');failure.name=/^[A-Za-z0-9_]+$/.test(e.name??'')?e.name:'AWS_ERROR';console.error('IAM_SIMULATION_ERROR_TYPE:',failure.name);throw failure;}}
 const db=DynamoDBDocumentClient.from(new DynamoDBClient({region})),policy=(await db.send(new GetCommand({TableName:'staging-PlatformStaff',Key:{pk:'OPERATIONAL_SETTINGS#DELIVERY_OPERATIONS',sk:'CURRENT'},ConsistentRead:true,ProjectionExpression:'#v,#values',ExpressionAttributeNames:{'#v':'version','#values':'values'}}))).Item;
 let valid=false;try{const {validateDispatchPolicy}=require('../backend/wallet-service/dist/dispatchPolicy');validateDispatchPolicy(policy?.values?.dispatch);valid=true;}catch{/* absent/unpublished profiles cannot be treated as configured */}
 result.operatingPolicy={exists:!!policy,version:policy?.version??null,hasDispatch:!!policy?.values?.dispatch,dispatchValid:valid};
 result.packageSnapshotStillCurrent=result.functions.every(f=>f.codeUnchanged&&f.revisionUnchanged&&f.environmentUnchanged);
 result.gateOffReadPermissions=result.permissionChecks.filter(c=>c.requiredWithGatesOff).every(c=>c.decision==='allowed'&&!c.missingContext.length);
 result.activationReady=false;result.liveWriteOperations=0;
 fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({packageSnapshotStillCurrent:result.packageSnapshotStillCurrent,gateOffReadPermissions:result.gateOffReadPermissions,operatingPolicy:result.operatingPolicy,denied:result.permissionChecks.filter(c=>c.decision!=='allowed').map(c=>({function:c.function,action:c.action,resource:c.resource})),published:false}));return result;
}
if(require.main===module)verify(process.argv[2],process.argv[3]).catch(e=>{console.error('READINESS_FAILED:',/^[A-Z_]+$/.test(e.message??'')?e.message:e.name);process.exitCode=1;});
module.exports={verify};
