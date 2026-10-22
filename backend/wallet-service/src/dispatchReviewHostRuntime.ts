import {createFinanceRollout} from './financeRollout';
import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';
import {CognitoIdentityProviderClient} from '@aws-sdk/client-cognito-identity-provider';
import {createStagingDispatchReviewHost} from './dispatchReviewHost';
export async function handler(event:Record<string,unknown>,context:{awsRequestId?:string;invokedFunctionArn?:string;getRemainingTimeInMillis?:()=>number}){
 if(!['SAFE_INITIAL_LEGACY','SAFE_LEGACY_RETRY','SAFE_FINANCIAL_INITIAL_RETRY'].includes(process.env.DISPATCH_REVIEW_EXECUTION_MODE??''))return {disabled:true};
 const arn='arn:aws:lambda:us-east-1:699561669180:function:staging-cod-integration';
 if(process.env.STAGE!=='staging'||process.env.AWS_REGION!=='us-east-1'||process.env.DISPATCH_REVIEW_HOST_ACCOUNT_ID!=='699561669180'||!context||context.invokedFunctionArn!==arn||!context.awsRequestId||typeof context.getRemainingTimeInMillis!=='function')throw Error('DISPATCH_REVIEW_HOST_SCOPE_INVALID');
 const rule=process.env.DISPATCH_REVIEW_HOST_RULE_ARN;
 if(!rule||!rule.startsWith('arn:aws:events:us-east-1:699561669180:rule/')||event.source!=='aws.events'||event['detail-type']!=='Scheduled Event'||event.account!=='699561669180'||event.region!=='us-east-1'||!Array.isArray(event.resources)||event.resources.length!==1||event.resources[0]!==rule)throw Error('DISPATCH_REVIEW_HOST_TRIGGER_INVALID');
 if(context.getRemainingTimeInMillis()<20000)return {deferred:true};
 const rawDb=DynamoDBDocumentClient.from(new DynamoDBClient({region:'us-east-1'}),{marshallOptions:{removeUndefinedValues:true}}),db=createFinanceRollout({db:rawDb}).db,cognito=new CognitoIdentityProviderClient({region:'us-east-1'});
 return createStagingDispatchReviewHost({db,cognito,enableFullCash:process.env.FINANCIAL_SETTLEMENT_MODEL==='FULL_CASH_AT_DELIVERY_V1',remainingMs:()=>context.getRemainingTimeInMillis!()}).tick(context.awsRequestId);
}
