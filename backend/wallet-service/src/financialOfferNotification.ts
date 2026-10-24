import {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';
import {LambdaClient,InvokeCommand} from '@aws-sdk/client-lambda';
import {readFinancialPushReference} from './financialPushReference';
import {equal,FinancialRow as Row} from './driverFinancialTransaction';
export {readFinancialPushReference} from './financialPushReference';
const fail=():never=>{throw Error('FINANCIAL_PUSH_NOT_ALLOWED');};
const TARGET='arn:aws:lambda:us-east-1:699561669180:function:staging-driver-financial-accept';
export function createFinancialPushValidatorClient(client:Pick<LambdaClient,'send'>=new LambdaClient({region:'us-east-1'})){
 return async(reference:Row)=>{
  const result=await client.send(new InvokeCommand({FunctionName:TARGET,InvocationType:'RequestResponse',Payload:Buffer.from(JSON.stringify({action:'validate_push_reference',body:reference}))}));
  if(result.FunctionError)return fail();
  let response:Row;try{response=JSON.parse(Buffer.from(result.Payload??[]).toString());}catch{return fail();}
  if(response.statusCode!==200||response.result?.success!==true||!equal(response.result.reference,reference))return fail();
 };
}
/** Notification role reads tokens/sound settings only; financial proof stays in its owning service. */
export function createStagingFinancialPushHandler(options:{db:Pick<DynamoDBDocumentClient,'send'>;getMessaging:()=>Promise<any>;now?:()=>number;env?:Row;verifyReference?:(reference:Row)=>Promise<void>}){
 const {db}=options,now=options.now??Date.now,env=options.env??process.env;
 return async(body:Row)=>{
  if(env.STAGE!=='staging'||env.AWS_REGION!=='us-east-1'||env.PINNED_DISPATCH_ACCOUNT_ID!=='699561669180'||env.PINNED_FINANCIAL_PUSH_MODE!=='REQUIRED'||env.PUSH_TOKENS_TABLE!=='WizzCentral_PushDeviceTokens_staging')return fail();
  const reference=readFinancialPushReference(body),verify=options.verifyReference??createFinancialPushValidatorClient();
  async function allowed(){if(Date.parse(reference.expiresAt)<=now())return fail();await verify(reference);}
  const data=Object.fromEntries(Object.entries({...reference,type:'financial_wave_offer_available',eventId:reference.offerId}).map(([k,v])=>[k,String(v)]));
  return require('../../src/utils/guarded-wave-push-delivery').sendGuardedWavePush({db,getMessaging:options.getMessaging,now,env,data,allowed,echo:{offerId:reference.offerId,eventId:reference.offerId,cycleId:reference.cycleId,driverId:reference.driverId}});
 };
}
