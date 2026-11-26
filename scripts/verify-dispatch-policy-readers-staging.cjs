'use strict';
// Execute ONLY extracted pure policy reader functions with a real, read-only DynamoDB Get.
// Does not execute the financial handlers or impersonate Lambda execution roles.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('../backend/wallet-service/node_modules/typescript');
const {STSClient,GetCallerIdentityCommand}=require('@aws-sdk/client-sts');
const {DynamoDBClient}=require('@aws-sdk/client-dynamodb'),{DynamoDBDocumentClient,GetCommand}=require('@aws-sdk/lib-dynamodb');
const {LambdaClient,GetFunctionConfigurationCommand}=require('@aws-sdk/client-lambda');
(async()=>{
 assert.equal(process.env.AWS_PROFILE,'Wizz_stg_UserApp');assert.equal(process.env.AWS_REGION,'us-east-1');assert.equal((await new STSClient({region:'us-east-1'}).send(new GetCallerIdentityCommand({}))).Account,'699561669180');
 const base='/private/tmp/dispatch50-release-final',manifest=JSON.parse(fs.readFileSync(base+'/manifest.json')),contract=require(base+'/artifacts/dispatch-settings-contract.js'),proposal=JSON.parse(fs.readFileSync('docs/finance-dispatch-policy-transition-50.json')).values,db=DynamoDBDocumentClient.from(new DynamoDBClient({region:'us-east-1'})),lambda=new LambdaClient({region:'us-east-1'}),readers=[];
 for(const f of manifest.functions.filter(f=>f.addedFiles.includes('dispatch-settings-contract.js'))){
  assert.equal((await lambda.send(new GetFunctionConfigurationCommand({FunctionName:f.name}))).CodeSha256,f.candidateCodeSha256);
  const file=f.replacedFiles[0],source=fs.readFileSync(base+'/artifacts/'+f.name+'/'+file,'utf8'),ast=ts.createSourceFile('bundle.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),found=[];
  function visit(n){if(ts.isFunctionDeclaration(n)&&/^readDeliveryOperations\d*$/.test(n.name?.text??''))found.push(n);ts.forEachChild(n,visit);}visit(ast);assert.equal(found.length,1);
  const text=found[0].getText(ast),ctx={process:{env:{}},OPERATIONS_PK:'OPERATIONAL_SETTINGS#DELIVERY_OPERATIONS',validateOperationsValues:contract.validateOperationsValues};
  for(const alias of new Set(text.match(/import_lib_dynamodb\d*/g)??[]))ctx[alias]={GetCommand};ctx.GetCommand=GetCommand;
  vm.runInNewContext(text+';this.read='+found[0].name.text+';',ctx);const value=await ctx.read(db,{DELIVERY_OPERATIONS_MODE:'CENTRAL'});assert.equal(value.version,2);assert.deepEqual(JSON.parse(JSON.stringify(value.values)),proposal);assert(value.condition.ConditionCheck.ExpressionAttributeValues[':values'].dispatch);readers.push({function:f.name,version:value.version,centralValuesMatched:true,transactionPinsWholeExpandedPolicy:true});
 }
 assert.equal(readers.length,4);const report={scope:'EXTRACTED_PUBLISHED_READER_FUNCTIONS_REAL_CENTRAL_GET',readers,realLambdaHandlerInvoked:false,lambdaRoleAssumed:false,financialWrites:false,activation:false};fs.writeFileSync(base+'/readers-live-verification.json',JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({readers:4,policyVersion:2,activation:false}));
})().catch(e=>{console.error('POLICY_READ_VERIFICATION_FAILED:',e.name);process.exitCode=1;});
