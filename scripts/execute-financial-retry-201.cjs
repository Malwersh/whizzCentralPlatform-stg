'use strict';
// Execute ONLY the real authenticated decision already recorded by the operator.
// No public handler, fabricated claims, manual job reset or money/hold writer.
const fs=require('node:fs');const req=require('node:module').createRequire(require.resolve('../backend/wallet-service/dist/dispatchReviewExecutor'));
const {DynamoDBClient}=req('@aws-sdk/client-dynamodb'),{DynamoDBDocumentClient,GetCommand}=req('@aws-sdk/lib-dynamodb'),{CognitoIdentityProviderClient}=req('@aws-sdk/client-cognito-identity-provider');
const {createStagingDispatchReviewExecutor}=require('../backend/wallet-service/dist/dispatchReviewExecutor'),{createFinanceRollout}=require('../backend/wallet-service/dist/financeRollout'),{quoteHash}=require('../backend/wallet-service/dist/deliveryQuoteRecord');
const dir='/private/tmp/financial-retry-201/',orderId='17f87a39-0edf-57c8-8971-c2d6d7dd42aa',caseId='1df20fd56657623bafdb1a9605794c67054992102049fc6991985345dc9379b4',requestId='526bba74-fdc9-4cd6-a1e2-d81450f3d24c';
(async()=>{
 if(!process.argv.includes('--execute-recorded-decision')||process.env.AWS_PROFILE!=='Wizz_stg_UserApp'||process.env.AWS_REGION!=='us-east-1')throw Error('EXPLICIT_RECORDED_STAGING_DECISION_REQUIRED');
 const published=JSON.parse(fs.readFileSync('docs/discount-tip-test-199.json'));if(!published.activated||!published.finalVerificationPassed)throw Error('COORDINATED_CODE_REQUIRED');
 const raw=DynamoDBDocumentClient.from(new DynamoDBClient({region:'us-east-1'}),{marshallOptions:{removeUndefinedValues:true}});
 const get=async(table,key)=>(await raw.send(new GetCommand({TableName:table,Key:key,ConsistentRead:true}))).Item;
 const before=await get('WizzOrders',{PK:'ORDER#'+orderId,SK:'META'}),hold=await get('staging-Holds',{orderId,sk:'DELIVERY_PROMOTION_FUNDING'}),decision=await get('staging-PlatformStaff',{pk:'DISPATCH_REVIEW#'+caseId,sk:'DECISION'});
 if(decision?.requestId!==requestId||decision.orderId!==orderId||decision.action!=='RETRY_SEARCH'||!['PENDING_EXECUTION','BLOCKED_DEPENDENCY','EXECUTED'].includes(decision.status))throw Error('RECORDED_DECISION_CHANGED');
 const cfg=JSON.parse(fs.readFileSync(dir+'WaveSystem_StartWave.private.json')),env={...cfg.Environment.Variables,AWS_REGION:'us-east-1'};await createFinanceRollout({db:raw,env}).order(orderId,'DRAIN');
 const db={send:async c=>{
  if(c.constructor.name==='TransactWriteCommand')for(const op of c.input.TransactItems){const mutation=op.Update??op.Put??op.Delete;if(!mutation)continue;if(op.Delete)throw Error('NO_DELETION');const t=mutation.TableName;if(!['WizzOrders','WizzDispatchJobs_staging','staging-PlatformStaff'].includes(t))throw Error('NO_FINANCIAL_WRITER');const row=mutation.Key??mutation.Item;if(t==='WizzOrders'&&(row.PK!=='ORDER#'+orderId||row.SK!=='META'))throw Error('ORDER_SCOPE');if(t==='WizzDispatchJobs_staging'&&row.orderId!==orderId)throw Error('JOB_SCOPE');if(t==='staging-PlatformStaff'&&!['DISPATCH_REVIEW#'+caseId,'AUDIT'].includes(row.pk))throw Error('DECISION_SCOPE');}
  return raw.send(c);
 }};
 const result=await createStagingDispatchReviewExecutor({db,cognito:new CognitoIdentityProviderClient({region:'us-east-1'}),mode:'SAFE_FINANCIAL_INITIAL_RETRY'}).process(caseId);
 const after=await get('WizzOrders',{PK:'ORDER#'+orderId,SK:'META'}),afterHold=await get('staging-Holds',{orderId,sk:'DELIVERY_PROMOTION_FUNDING'}),job=await get('WizzDispatchJobs_staging',{orderId,SK:'METADATA'});
 if(quoteHash(before.financialSnapshot)!==quoteHash(after.financialSnapshot)||quoteHash(hold)!==quoteHash(afterHold)||quoteHash(before.commercialPricing)!==quoteHash(after.commercialPricing)||quoteHash(before.financeRollout)!==quoteHash(after.financeRollout))throw Error('IMMUTABLE_EVIDENCE_CHANGED');
 const report={...result,orderId,originalPricePreserved:true,originalFundingHoldPreserved:true,originalAdmissionPinPreserved:true,searchDeadline:job.dispatchCycle.searchDeadline,driverOfferSent:false};fs.writeFileSync(dir+'decision-executed.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
 if(result.status!=='EXECUTED')throw Error('DECISION_NOT_EXECUTED');
 const proof={schemaVersion:1,orderId,caseId,requestId,cycleId:job.dispatchCycle.id,expiresAt:job.dispatchCycle.searchDeadline};fs.writeFileSync(dir+'recovery-proof.json',JSON.stringify(proof,null,2)+'\n');
})().catch(error=>{console.error(error.name,error.message);process.exitCode=1;});
