import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { createStagingDispatchCreator } from './dispatchCreator';
import { createStagingDispatchFinancialHost } from './dispatchLegacyHost';
import { strongGet, FinancialRow as Row } from './driverFinancialTransaction';
import { validateDispatchCycle } from './dispatchCycle';
import { createStagingPinnedFinancialRunner } from './dispatchWaveExecutor';
import { createStagingFinancialOfferDelivery } from './financialOfferDelivery';
import { createStagingFinancialPushHandler } from './financialOfferNotification';
import { createStagingFinancialPushValidation } from './financialPushValidation';
import { createFinanceRollout } from './financeRollout';
import { createMapboxSecretReader } from './routingCredentials';
import { createMapboxRoadRouter } from './roadRouting';
import { financialDispatchTables } from './walletBindings';

const account = '746727375268';
const region = 'us-east-1';
const { getMessaging } = require('../../src/utils/firebase');
const { firebaseBinding } = require('../../src/utils/notification-provider-bindings');
type Context = { awsRequestId: string; getRemainingTimeInMillis: () => number };
type Start = (orderId: string, assignmentId: string, cycleId: string) => Promise<unknown>;

export function createDispatchTrigger({streamArn,ruleArn,ready,tick}:{
  streamArn:string;ruleArn:string;ready:(record:Row)=>Promise<unknown>;tick:()=>Promise<unknown>;
}) {
  return async (event:Row) => {
    if (event?.source==='aws.events' && event.account===account && event.region===region &&
        event['detail-type']==='Scheduled Event' && Array.isArray(event.resources) && event.resources.includes(ruleArn)) return tick();
    if (!Array.isArray(event?.Records) || event.Records.length>10 ||
        event.Records.some((r:Row)=>r.eventSource!=='aws:dynamodb'||r.eventSourceARN!==streamArn)) {
      throw Error('INVALID_PRODUCTION_DISPATCH_TRIGGER');
    }
    let readyOrders=0;
    for (const record of event.Records) {
      const data=record.dynamodb;
      if (record.eventName!=='MODIFY' || data?.Keys?.SK?.S!=='META' ||
          data.NewImage?.status?.S!=='ready_for_pickup' || data.OldImage?.status?.S==='ready_for_pickup') continue;
      await ready(record);
      readyOrders++;
    }
    return {readyOrders};
  };
}

export async function handler(event:Row, context:Context) {
  const env=process.env, streamArn=env.PRODUCTION_ORDERS_STREAM_ARN??'', ruleArn=env.PRODUCTION_DISPATCH_RULE_ARN??'';
  const socketUrl=env.REALTIME_MANAGEMENT_URL??'';
  if (env.STAGE!=='production'||env.AWS_REGION!==region||env.FINANCIAL_COD_ACCOUNT_ID!==account||
      env.DISPATCH_FINANCIAL_HOST_MODE!=='REQUIRED'||env.FINANCE_GENERAL_RELEASE_MODE!=='REQUIRED'||
      env.FINANCIAL_SETTLEMENT_MODEL!=='FULL_CASH_AT_DELIVERY_V1'||env.FINANCIAL_DELIVERY_FUNDING_MODE!=='REQUIRED'||
      env.DRIVER_WORK_REGION_ENFORCE!=='true'||
      !/^arn:aws:dynamodb:us-east-1:746727375268:table\/wizz-production-Orders\/stream\/[\w.:-]+$/.test(streamArn)||
      ruleArn!=='arn:aws:events:us-east-1:746727375268:rule/wizz-production-dispatch-cycle'||
      socketUrl!=='https://9plheg8f1h.execute-api.us-east-1.amazonaws.com/production') {
    throw Error('PRODUCTION_DISPATCH_NOT_CONFIGURED');
  }
  firebaseBinding(env);
  const raw = DynamoDBDocumentClient.from(new DynamoDBClient({maxAttempts:2}),{marshallOptions:{removeUndefinedValues:true}});
  const rollout=createFinanceRollout({db:raw,dispatch:true}), {db}=rollout;
  const tables=financialDispatchTables();
  const enableDeliveryFunding=true,enableFullCash=true;
  const socket=new ApiGatewayManagementApiClient({endpoint:socketUrl,maxAttempts:2});
  const cognito=new CognitoIdentityProviderClient({maxAttempts:2});
  const routing=createMapboxSecretReader({secrets:new SecretsManagerClient({maxAttempts:2}),
    secretArn:env.FINANCIAL_ROUTING_SECRET_ARN??'',accountId:account,region,timeoutMs:1500});
  const validatePush=createStagingFinancialPushValidation({db,env});
  const sendPush=createStagingFinancialPushHandler({db:raw,env,getMessaging,verifyReference:async reference=>{await validatePush(reference);}});
  const sendOffer=createStagingFinancialOfferDelivery({db,enableDeliveryFunding,enableFullCash,
    beforeSend:async (orderId,driverId)=>{await rollout.order(orderId,'SEND');rollout.driver(orderId,driverId);},
    postSocket:(ConnectionId,message)=>socket.send(new PostToConnectionCommand({ConnectionId,Data:Buffer.from(JSON.stringify(message))})),
    postPush:sendPush,
  });
  const start:Start=async (orderId,assignmentId,cycleId)=>{
    await rollout.order(orderId,'OFFER');
    const job=await strongGet(db,tables.jobs,{orderId,SK:'METADATA'});
    const cycle=validateDispatchCycle(job?.dispatchCycle);
    if(job?.dispatchJobId!==assignmentId||cycle.id!==cycleId||cycle.engine!=='FINANCIAL'||job.financialDispatch!==true) {
      throw Error('PRODUCTION_DISPATCH_CYCLE_CHANGED');
    }
    const router=createMapboxRoadRouter({getAccessToken:routing,profile:'driving',
      ttlSeconds:cycle.policy.values.dispatch!.profiles.FINANCIAL.offerTtlSeconds,timeoutMs:5000});
    return createStagingPinnedFinancialRunner({db,cognito,router,enableFullCash,enableDeliveryFunding,sendOffer})
      .run({orderId,assignmentId,owner:context.awsRequestId,leaseSeconds:20});
  };
  return createDispatchTrigger({streamArn,ruleArn,
    ready:async record=>{
      const image=unmarshall(record.dynamodb.NewImage);
      if (!rollout.containsOrder(image.orderId,image)) throw Error('PRODUCTION_DISPATCH_ORDER_NOT_ELIGIBLE');
      await rollout.order(image.orderId,'ADMIT');
      return createStagingDispatchCreator({db,enableFullCash,enableDeliveryFunding,
        invokeStart:async ({orderId,dispatchJobId,cycleId})=>{await start(orderId,dispatchJobId,cycleId);},
      }).process(record);
    },
    tick:()=>createStagingDispatchFinancialHost({db,enableFullCash,enableDeliveryFunding,
      remainingMs:()=>context.getRemainingTimeInMillis(),
      start:({orderId,assignmentId,cycleId})=>start(orderId,assignmentId,cycleId),
    }).tick(context.awsRequestId),
  })(event);
}
