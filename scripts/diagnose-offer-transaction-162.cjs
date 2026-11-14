'use strict';
// Capture preparation only. Validate syntax with an extra always-failing guard;
// this diagnostic cannot commit any offer, wallet, or order write.
const fs=require('node:fs'),path=require('node:path');
const base=path.resolve(__dirname,'../backend/wallet-service'),req=n=>require(base+'/node_modules/'+n),dist=n=>require(base+'/dist/'+n);
const {DynamoDBClient}=req('@aws-sdk/client-dynamodb'),{DynamoDBDocumentClient,GetCommand,TransactWriteCommand}=req('@aws-sdk/lib-dynamodb');
const {CognitoIdentityProviderClient}=req('@aws-sdk/client-cognito-identity-provider'),{SecretsManagerClient}=req('@aws-sdk/client-secrets-manager');
(async()=>{
 const p='/private/tmp/dispatch-test-162/',sel=JSON.parse(fs.readFileSync('/private/tmp/financial-device-test-161/selector.private.json')),cfg=JSON.parse(fs.readFileSync('/private/tmp/dispatch-test-160/WaveSystem_StartWave.config.private.json'));
 const db=DynamoDBDocumentClient.from(new DynamoDBClient({region:'us-east-1'}),{marshallOptions:{removeUndefinedValues:true}});
 const get=async(t,k)=>(await db.send(new GetCommand({TableName:t,Key:k,ConsistentRead:true}))).Item;
 const job=await get('WizzDispatchJobs_staging',{orderId:sel.orderId,SK:'METADATA'});job.status='searching';
 const wave=await get('WizzDispatchJobs_staging',{orderId:sel.orderId,SK:'FINANCIAL_WAVE#1'}),driverId=wave.driverIds[0];
 const observed=await get('WizzDriverLiveState_staging',{driverId});const frozenAt=Math.max(Date.parse(wave.createdAt),Date.parse(observed.locationUpdatedAt))+1000,now=()=>frozenAt;
 const token=dist('routingCredentials').createMapboxSecretReader({secrets:new SecretsManagerClient({region:'us-east-1'}),secretArn:cfg.Environment.Variables.FINANCIAL_ROUTING_SECRET_ARN,accountId:'699561669180',region:'us-east-1',timeoutMs:2000});
 const router=dist('roadRouting').createMapboxRoadRouter({getAccessToken:token,profile:'driving',ttlSeconds:60,timeoutMs:5000,now});
 let captured;
 const wrapped={send:async cmd=>{
  if(cmd.input?.TransactItems){captured=cmd.input;throw Error('DIAGNOSTIC_CAPTURE_ONLY');}
  if(cmd.input?.Key&&cmd.input.TableName==='WizzDispatchJobs_staging'&&cmd.input.Key.SK==='METADATA')return {Item:job};
  return db.send(cmd);
 }};
 const activation=JSON.parse(fs.readFileSync('/private/tmp/financial-device-test-161/activation.private.json'));
 const deployed=require(p+'deployed-runtime-diagnostic.cjs');
 const rollout=deployed.diagnosticRollout({db:wrapped,env:{...cfg.Environment.Variables,...activation.changes,AWS_REGION:'us-east-1'},now});
 await rollout.order(sel.orderId,'OFFER');
 const context=deployed.diagnosticContext({db:rollout.db,cognito:new CognitoIdentityProviderClient({region:'us-east-1'}),router,positionMaxAgeSeconds:120,offerTtlSeconds:60,enableDeliveryFunding:true,now});
 const offerId='FINO:'+dist('deliveryQuoteRecord').quoteHash({orderId:sel.orderId,assignmentId:job.dispatchJobId,waveNumber:1,driverId}).slice(0,48);
 const prepared=await context.prepare({orderId:sel.orderId,branchId:sel.branchId,driverId,waveNumber:1,offerId});
 try{await deployed.diagnosticStore({db:rollout.db,enableDeliveryFunding:true,now}).save(prepared);}catch(e){if(!captured)throw e;}
 const blocker=await get('staging-PlatformStaff',{pk:'OPERATIONAL_SETTINGS#DELIVERY_OPERATIONS',sk:'CURRENT'});if(!blocker)throw Error('BLOCKER_REQUIRED');
 captured.TransactItems.push({ConditionCheck:{TableName:'staging-PlatformStaff',Key:{pk:blocker.pk,sk:blocker.sk},ConditionExpression:'attribute_not_exists(pk)'}});delete captured.ClientRequestToken;
 fs.writeFileSync(p+'diagnostic-transaction.private.json',JSON.stringify(captured),{mode:0o600});
 try{await deployed.diagnosticDb().send(deployed.diagnosticCommand(captured));throw Error('IMPOSSIBLE_DIAGNOSTIC_COMMIT');}catch(e){console.log(JSON.stringify({name:e.name,message:e.message,reasons:(e.CancellationReasons??[]).map(r=>r.Code),forcedFailure:true}));}
})().catch(e=>{console.error(e.name,e.message);process.exitCode=1});
