import {createStagingFinancialOfferDelivery} from './financialOfferDelivery';
function deliveryFundingCapability(){const mode=process.env.FINANCIAL_DELIVERY_FUNDING_MODE??'OFF';if(!['OFF','REQUIRED'].includes(mode))throw Error('DELIVERY_FUNDING_NOT_CONFIGURED');return mode==='REQUIRED';}
import {createFinanceRollout} from './financeRollout';
import {unmarshall} from '@aws-sdk/util-dynamodb';
import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';
import {createStagingDispatchCoordinator} from './dispatchCoordinator';
/** PLAN_ONLY entry remains isolated from the separately gated hosted executors. */
export async function coordinateUnifiedDispatch(input:{orderId:string;assignmentId:string;source:'START'|'TIMEOUT'|'DECLINE'}) {
 if(process.env.STAGE!=='staging'||process.env.AWS_REGION!=='us-east-1'||process.env.DISPATCH_CYCLE_MODE!=='PLAN_ONLY')throw Error('UNIFIED_DISPATCH_NOT_READY');
 if(input?.source==='DECLINE')throw Error('UNIFIED_DECLINE_NOT_READY');
 const enableDeliveryFunding=deliveryFundingCapability();
 const db=DynamoDBDocumentClient.from(new DynamoDBClient({region:'us-east-1'}),{marshallOptions:{removeUndefinedValues:true}});
 const rollout=createFinanceRollout({db});return createStagingDispatchCoordinator({db:rollout.db,enableDeliveryFunding,enableFullCash:process.env.FINANCIAL_SETTLEMENT_MODEL==='FULL_CASH_AT_DELIVERY_V1'}).plan(input);
}

// Export the dependency-injected server adapter for coordinated verification and
// packaging. The deployed entry point above remains PLAN_ONLY and cannot send.
export {createStagingDispatchWaveExecutor,createStagingPinnedFinancialRunner} from './dispatchWaveExecutor';

import {createStagingDispatchCreator} from './dispatchCreator';
export async function createUnifiedDispatchFromStream(record:Record<string,any>,invokeStart:Parameters<typeof createStagingDispatchCreator>[0]['invokeStart']) {
 const imageSource=unmarshall(record?.dynamodb?.NewImage??{}),financialHosted=process.env.DISPATCH_FINANCIAL_HOST_MODE==='REQUIRED'&&require('../../order-service/legacy-order-policy').isFinancialOrder(imageSource);
 const hosted=process.env.DISPATCH_LEGACY_HOST_MODE==='REQUIRED';
 if(process.env.DISPATCH_FINANCIAL_HOST_MODE==='REQUIRED'&&!financialHosted&&!hosted){hostedFinancialScope();return {legacyFallback:true};}
 if(financialHosted){hostedFinancialScope();}
 else if(hosted){hostedLegacyScope();const image=unmarshall(record?.dynamodb?.NewImage??{});if(require('../../order-service/legacy-order-policy').isFinancialOrder(image))throw Error('FINANCIAL_HOST_NOT_READY');}
 else if(process.env.STAGE!=='staging'||process.env.AWS_REGION!=='us-east-1'||process.env.DISPATCH_CYCLE_MODE!=='PLAN_ONLY')throw Error('UNIFIED_DISPATCH_NOT_READY');
 const enableDeliveryFunding=deliveryFundingCapability();
 const db=DynamoDBDocumentClient.from(new DynamoDBClient({region:'us-east-1'}),{marshallOptions:{removeUndefinedValues:true}});
 const rollout=createFinanceRollout({db}),image=unmarshall(record?.dynamodb?.NewImage??{});
 if(!rollout.containsOrder(image.orderId,image)){if(require('../../order-service/legacy-order-policy').isFinancialOrder(image))throw Error('FINANCE_ROLLOUT_OUT_OF_SCOPE');return {legacyFallback:true};}
 await rollout.order(image.orderId,'ADMIT');
 return createStagingDispatchCreator({db:rollout.db,invokeStart,enableDeliveryFunding,enableFullCash:process.env.FINANCIAL_SETTLEMENT_MODEL==='FULL_CASH_AT_DELIVERY_V1'}).process(record);
}

export {createStagingLegacyWaveExecutor,createStagingLegacyResponses} from './dispatchLegacy';
import {createStagingLegacyResponses} from './dispatchLegacy';
import {authenticateFinancialIdentity} from './financialIdentity';
import {CognitoIdentityProviderClient} from '@aws-sdk/client-cognito-identity-provider';
/** Response-only release gate; does not enable creation or sending. Never use the
 * old pre-hold/release wrapper with these cycles before coordinated rollout. */
export async function respondPinnedLegacyOffer(action:'ACCEPT'|'DECLINE',input:{orderId:string;offerId:string;waveNumber:number},accessToken:string,acceptanceAttemptId?:string){
 if(process.env.STAGE!=='staging'||process.env.AWS_REGION!=='us-east-1'||process.env.DISPATCH_CYCLE_MODE!=='LEGACY_RESPONSES')throw Error('UNIFIED_LEGACY_RESPONSES_NOT_READY');
 if(action==='ACCEPT'&&(!acceptanceAttemptId||!/^LA:[A-Za-z0-9]+$/.test(acceptanceAttemptId)))throw Error('LEGACY_ACCEPTANCE_ATTEMPT_REQUIRED');
 const db=DynamoDBDocumentClient.from(new DynamoDBClient({region:'us-east-1'}),{marshallOptions:{removeUndefinedValues:true}}),cognito=new CognitoIdentityProviderClient({region:'us-east-1'});
 const rollout=createFinanceRollout({db});await rollout.order(input.orderId,action==='ACCEPT'?'ADMIT':'DRAIN');
 return createStagingLegacyResponses({db:rollout.db,acceptanceAttemptId,authenticateDriver:async()=>{const identity=await authenticateFinancialIdentity(cognito,accessToken,'DRIVER');rollout.driver(input.orderId,identity.subjectId,identity.subjectId);return {driverId:identity.subjectId,subjectId:identity.subjectId};}}).respond(action,input);
}

export {createStagingPinnedLegacyRunner,buildLegacySourcePush} from './dispatchLegacySource';
export {createStagingLegacyTransportRunner,createStagingLegacyExistingTransportRunner} from './dispatchLegacyDelivery';

import {createStagingDispatchLegacyHost} from './dispatchLegacyHost';
import {createStagingLegacyExistingTransportRunner} from './dispatchLegacyDelivery';
function hostedLegacyScope(){
 if(process.env.STAGE!=='staging'||process.env.AWS_REGION!=='us-east-1'||process.env.DISPATCH_HOST_ACCOUNT_ID!=='699561669180'||process.env.DISPATCH_LEGACY_HOST_MODE!=='REQUIRED'||process.env.DISPATCH_CYCLE_MODE!=='LEGACY_RESPONSES'||process.env.DISPATCH_RESTART_START_MODE!=='REQUIRED')throw Error('DISPATCH_LEGACY_HOST_DISABLED');
}
function hostDB(){const db=DynamoDBDocumentClient.from(new DynamoDBClient({region:'us-east-1'}),{marshallOptions:{removeUndefinedValues:true}});return createFinanceRollout({db}).db;}
/** Existing StartWave supplies its original websocket/notification transport. */
export async function runHostedLegacyWave(input:{orderId:string;assignmentId:string;cycleId:string},api:Parameters<typeof createStagingLegacyExistingTransportRunner>[0]['api'],owner:string){
 hostedLegacyScope();const raw=DynamoDBDocumentClient.from(new DynamoDBClient({region:'us-east-1'}),{marshallOptions:{removeUndefinedValues:true}}),rollout=createFinanceRollout({db:raw});await rollout.order(input.orderId,'OFFER');const db=rollout.db,job=await strongGet(db,'WizzDispatchJobs_staging',{orderId:input.orderId,SK:'METADATA'});
 if(!job||job.dispatchJobId!==input.assignmentId||job.dispatchCycle?.id!==input.cycleId||job.dispatchCycle?.engine!=='LEGACY')throw Error('DISPATCH_HOST_SOURCE_INVALID');
 const runner=createStagingLegacyExistingTransportRunner({db,api,beforeSend:async(orderId,driverId)=>{await rollout.order(orderId,'SEND');rollout.driver(orderId,driverId);},notificationsBase:process.env.NOTIFICATIONS_API_BASE??'',internalKey:process.env.NOTIFICATIONS_INTERNAL_KEY??''});
 return runner.run({orderId:input.orderId,assignmentId:input.assignmentId,owner,leaseSeconds:20});
}
/** Called only by the existing timeout's configured EventBridge rule. */
export async function runHostedLegacyTick(event:Row,context:{awsRequestId?:string;getRemainingTimeInMillis?:()=>number}|undefined,invokeStart:(input:{orderId:string;assignmentId:string;cycleId:string})=>Promise<unknown>){
 hostedLegacyScope();const rule=process.env.DISPATCH_HOST_RULE_ARN;
 if(!rule||!rule.startsWith('arn:aws:events:us-east-1:699561669180:rule/')||event?.source!=='aws.events'||event['detail-type']!=='Scheduled Event'||event.account!=='699561669180'||event.region!=='us-east-1'||!Array.isArray(event.resources)||!event.resources.includes(rule))throw Error('DISPATCH_HOST_TRIGGER_INVALID');
 if(!context?.awsRequestId||!context.getRemainingTimeInMillis)throw Error('DISPATCH_HOST_CONTEXT_REQUIRED');
 return createStagingDispatchLegacyHost({db:hostDB(),remainingMs:()=>context.getRemainingTimeInMillis!(),start:invokeStart}).tick(context.awsRequestId);
}
import {strongGet,FinancialRow as Row} from './driverFinancialTransaction';

// Financial host uses independent gates; the Legacy host cannot enable it.
import {createStagingDispatchFinancialHost} from './dispatchLegacyHost';
import {createStagingPinnedFinancialRunner} from './dispatchWaveExecutor';
import {validateDispatchCycle} from './dispatchCycle';
import {SecretsManagerClient} from '@aws-sdk/client-secrets-manager';
import {createMapboxSecretReader} from './routingCredentials';
import {createMapboxRoadRouter} from './roadRouting';
function hostedFinancialScope(){
 if(process.env.STAGE!=='staging'||process.env.AWS_REGION!=='us-east-1'||process.env.DISPATCH_HOST_ACCOUNT_ID!=='699561669180'||process.env.DISPATCH_FINANCIAL_HOST_MODE!=='REQUIRED'||process.env.DISPATCH_CYCLE_MODE!=='FINANCIAL_RESPONSES'||process.env.FINANCIAL_DISPATCH_MODE!=='REQUIRED')throw Error('DISPATCH_FINANCIAL_HOST_DISABLED');
}
export async function runHostedFinancialTick(event:Row,context:{awsRequestId?:string;getRemainingTimeInMillis?:()=>number}|undefined,invokeStart:(input:{orderId:string;assignmentId:string;cycleId:string})=>Promise<unknown>){
 hostedFinancialScope();const enableDeliveryFunding=deliveryFundingCapability(),rule=process.env.DISPATCH_HOST_RULE_ARN;
 if(!rule||!rule.startsWith('arn:aws:events:us-east-1:699561669180:rule/')||event?.source!=='aws.events'||event['detail-type']!=='Scheduled Event'||event.account!=='699561669180'||event.region!=='us-east-1'||!Array.isArray(event.resources)||!event.resources.includes(rule))throw Error('DISPATCH_HOST_TRIGGER_INVALID');
 if(!context?.awsRequestId||!context.getRemainingTimeInMillis)throw Error('DISPATCH_HOST_CONTEXT_REQUIRED');
 const raw=DynamoDBDocumentClient.from(new DynamoDBClient({region:'us-east-1'}),{marshallOptions:{removeUndefinedValues:true}}),rollout=createFinanceRollout({db:raw});
 return createStagingDispatchFinancialHost({db:rollout.db,enableDeliveryFunding,enableFullCash:process.env.FINANCIAL_SETTLEMENT_MODEL==='FULL_CASH_AT_DELIVERY_V1',remainingMs:()=>context.getRemainingTimeInMillis!(),start:async input=>{await rollout.order(input.orderId,'OFFER');return invokeStart(input);}}).tick(context.awsRequestId);
}
export async function runHostedFinancialWave(input:{orderId:string;assignmentId:string;cycleId:string},api:{postToConnection:(input:Row)=>{promise:()=>Promise<unknown>}},owner:string){
 hostedFinancialScope();const enableDeliveryFunding=deliveryFundingCapability();
 const raw=DynamoDBDocumentClient.from(new DynamoDBClient({region:'us-east-1'}),{marshallOptions:{removeUndefinedValues:true}}),rollout=createFinanceRollout({db:raw});
 await rollout.order(input.orderId,'OFFER');const db=rollout.db,job=await strongGet(db,'WizzDispatchJobs_staging',{orderId:input.orderId,SK:'METADATA'}),cycle=validateDispatchCycle(job?.dispatchCycle);
 if(job?.dispatchJobId!==input.assignmentId||cycle.id!==input.cycleId||cycle.engine!=='FINANCIAL'||job.financialDispatch!==true)throw Error('DISPATCH_HOST_SOURCE_INVALID');
 const profile=cycle.policy.values.dispatch!.profiles.FINANCIAL;
 const getAccessToken=createMapboxSecretReader({secrets:new SecretsManagerClient({region:'us-east-1'}),secretArn:process.env.FINANCIAL_ROUTING_SECRET_ARN??'',accountId:'699561669180',region:'us-east-1',timeoutMs:1500});
 const router=createMapboxRoadRouter({getAccessToken,profile:'driving',ttlSeconds:profile.offerTtlSeconds,timeoutMs:5000}),cognito=new CognitoIdentityProviderClient({region:'us-east-1'});
 const transport=require('../../../lambda/WaveSystem_StartWave/wave-offer-transport').createWaveOfferTransport({api,notificationsBase:process.env.NOTIFICATIONS_API_BASE??'',internalKey:process.env.NOTIFICATIONS_INTERNAL_KEY??''});
 const sendOffer=createStagingFinancialOfferDelivery({db,enableDeliveryFunding,enableFullCash:process.env.FINANCIAL_SETTLEMENT_MODEL==='FULL_CASH_AT_DELIVERY_V1',beforeSend:async(orderId,driverId)=>{await rollout.order(orderId,'SEND');rollout.driver(orderId,driverId);},postSocket:transport.postSocket,postPush:transport.postPush});
 return createStagingPinnedFinancialRunner({db,cognito,router,enableDeliveryFunding,enableFullCash:process.env.FINANCIAL_SETTLEMENT_MODEL==='FULL_CASH_AT_DELIVERY_V1',sendOffer}).run({orderId:input.orderId,assignmentId:input.assignmentId,owner,leaseSeconds:20});
}
