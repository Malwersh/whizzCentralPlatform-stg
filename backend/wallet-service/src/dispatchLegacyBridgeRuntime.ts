import {createFinanceRollout} from './financeRollout';
import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';
import {CognitoIdentityProviderClient} from '@aws-sdk/client-cognito-identity-provider';
import {LambdaClient,InvokeCommand} from '@aws-sdk/client-lambda';
import {authenticateFinancialIdentity} from './financialIdentity';
import {createStagingLegacyAcceptanceBridge} from './dispatchLegacyBridge';
const TARGET='arn:aws:lambda:us-east-1:699561669180:function:WaveSystem_HandleDriverAccept';
export async function acceptPinnedLegacyFromDriver(input:{orderId:string;offerId:string;waveNumber:number},accessToken:string,driverId:string,reserve:Parameters<typeof createStagingLegacyAcceptanceBridge>[0]['reserve']){
 if(process.env.STAGE!=='staging'||process.env.AWS_REGION!=='us-east-1'||process.env.DISPATCH_CYCLE_MODE!=='LEGACY_RESPONSES'||!['WaveSystem_HandleDriverAccept',TARGET].includes(process.env.WAVESYSTEM_HANDLE_DRIVER_ACCEPT_FUNCTION_NAME??''))throw Error('UNIFIED_LEGACY_RESPONSES_NOT_READY');
 const db=DynamoDBDocumentClient.from(new DynamoDBClient({region:'us-east-1'}),{marshallOptions:{removeUndefinedValues:true}}),cognito=new CognitoIdentityProviderClient({region:'us-east-1'}),lambda=new LambdaClient({region:'us-east-1'});
 const rollout=createFinanceRollout({db});await rollout.order(input.orderId,'ADMIT');rollout.driver(input.orderId,driverId);
 return createStagingLegacyAcceptanceBridge({db:rollout.db,reserve,authenticateDriver:async()=>{const id=await authenticateFinancialIdentity(cognito,accessToken,'DRIVER');if(id.subjectId!==driverId)throw Error('UNAUTHORIZED');rollout.driver(input.orderId,driverId,id.subjectId);return {driverId,subjectId:id.subjectId};},assign:async(selectors,attemptId)=>{
  const invoked=await lambda.send(new InvokeCommand({FunctionName:TARGET,InvocationType:'RequestResponse',Payload:Buffer.from(JSON.stringify({headers:{Authorization:'Bearer '+accessToken},body:JSON.stringify({...selectors,acceptanceAttemptId:attemptId})}))}));
  if(invoked.FunctionError)throw Error('LEGACY_ASSIGNMENT_RESPONSE_UNKNOWN');
  let proxy:any;try{proxy=JSON.parse(Buffer.from(invoked.Payload??[]).toString());}catch{throw Error('LEGACY_ASSIGNMENT_RESPONSE_UNKNOWN');}
  const body=typeof proxy.body==='string'?JSON.parse(proxy.body):proxy.body;if(proxy.statusCode!==200||body?.success!==true)throw Error('LEGACY_ASSIGNMENT_RESPONSE_UNKNOWN');
  // The bridge still verifies the atomic record; this envelope alone cannot mark success.
 }}).accept(input);
}
