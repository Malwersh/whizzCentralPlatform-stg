'use strict';
// Live-package adapter: preserve the already deployed dispatch executor byte for
// byte and append observation only after its existing scheduled guard succeeds.
async function handler(event,context){
 const review=await require('./dispatch-review-host-298.js').handler(event,context);
 if(process.env.DISPATCH_FOLLOWUP_MODE!=='REQUIRED'||review.disabled||review.deferred)return {...review,followup:{disabled:true}};
 const arn='arn:aws:lambda:us-east-1:699561669180:function:staging-cod-integration',rule=process.env.DISPATCH_REVIEW_HOST_RULE_ARN;
 if(context?.invokedFunctionArn!==arn||!context.awsRequestId||process.env.STAGE!=='staging'||process.env.AWS_REGION!=='us-east-1'||!rule||event.source!=='aws.events'||event.account!=='699561669180'||event.region!=='us-east-1'||event['detail-type']!=='Scheduled Event'||!Array.isArray(event.resources)||event.resources.length!==1||event.resources[0]!==rule)throw Error('FOLLOWUP_MONITOR_TRIGGER_INVALID');
 if(context.getRemainingTimeInMillis()<20000)return {...review,followup:{deferred:true}};
 const {DynamoDBClient}=require('@aws-sdk/client-dynamodb'),{DynamoDBDocumentClient}=require('@aws-sdk/lib-dynamodb');
 const db=DynamoDBDocumentClient.from(new DynamoDBClient({region:'us-east-1'}),{marshallOptions:{removeUndefinedValues:true}});
 const rollout=require('./finance-rollout.js').createFinanceRollout({db});
 const followup=await require('./dispatch-followup-monitor-340.js').createMonitor({db,remainingMs:()=>context.getRemainingTimeInMillis(),historicalContainsOrder:rollout.containsOrder}).tick(context.awsRequestId);
 console.info('DISPATCH_FOLLOWUP_SUMMARY',JSON.stringify(followup));
 if(followup.failed>0)throw Error('DISPATCH_FOLLOWUP_OBSERVATION_FAILED');
 return {...review,followup};
}
module.exports={handler};
