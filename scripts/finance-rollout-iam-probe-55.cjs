'use strict';
const {DynamoDBClient}=require('@aws-sdk/client-dynamodb');
const {DynamoDBDocumentClient,GetCommand,QueryCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {createFinanceRollout}=require('./finance-rollout');
const raw=DynamoDBDocumentClient.from(new DynamoDBClient({region:'us-east-1'}));
exports.handler=async(event)=>{
 if(process.env.STAGE!=='staging'||process.env.AWS_REGION!=='us-east-1'||event?.probeId!==process.env.PROBE_ID)throw Error('INVALID_PROBE');
 const cfg=JSON.parse(process.env.FINANCE_ROLLOUT_CONFIG),scope=cfg.scopes[0],order=scope.orders[0],key={PK:'ORDER#'+order.orderId,SK:'META'};
 const guard=createFinanceRollout({db:raw});await guard.order(order.orderId,'NOTIFY');guard.driver(order.orderId,scope.drivers[0].driverId,scope.drivers[0].subjectId);
 const checks={projectedIdentityRead:true,driverPairBound:true};
 const denied=async action=>{try{await action();throw Error('UNEXPECTED_ACCESS');}catch(e){if(e.name!=='AccessDeniedException')throw e;}};
 if(process.env.PROBE_ROLE!=='writer'){
  await denied(()=>raw.send(new GetCommand({TableName:'WizzOrders',Key:key,ConsistentRead:true,ProjectionExpression:'PK,SK,metadata'})));checks.unapprovedProjectionDenied=true;
 }
 if(['writer','staff'].includes(process.env.PROBE_ROLE)){
  await guard.db.send(new TransactWriteCommand({TransactItems:[{ConditionCheck:{TableName:'WizzOrders',Key:key,ConditionExpression:'attribute_exists(PK)'}}]}));checks.realScopedConditionalTransaction=true;
 }
 if(process.env.PROBE_ROLE==='staff'){
  const jobFields=['orderId','SK','kind','status','state','restaurantId','dispatchJobId','dispatchCycle','dispatchReview','financialDispatch','financialSearchVersion','noDriverReason','attemptId','cycleId','branchId','version','reason','updatedAt','createdAt','dispatchReviewOutcome'];
  const projection=fields=>({ProjectionExpression:fields.map((_,i)=>'#p'+i).join(','),ExpressionAttributeNames:Object.fromEntries(fields.map((x,i)=>['#p'+i,x]))});
  await raw.send(new GetCommand({TableName:'WizzDispatchJobs_staging',Key:{orderId:order.orderId,SK:'METADATA'},ConsistentRead:true,...projection(jobFields)}));
  await raw.send(new QueryCommand({TableName:'WizzDispatchJobs_staging',KeyConditionExpression:'orderId=:id',ExpressionAttributeValues:{':id':order.orderId},ConsistentRead:true,Limit:1,...projection(jobFields)}));
  await raw.send(new GetCommand({TableName:'staging-Holds',Key:{orderId:order.orderId,sk:'HOLD'},ConsistentRead:true,...projection(['orderId','sk','holdId','status','version','updatedAt'])}));
  await raw.send(new GetCommand({TableName:'staging-AccountDeletion',Key:{pk:'BUSINESS_LIFECYCLE#MERCHANT#'+order.branchId,sk:'META'},ConsistentRead:true,ProjectionExpression:'pk,sk'}));
  await raw.send(new TransactWriteCommand({TransactItems:[
   {ConditionCheck:{TableName:'WizzDispatchJobs_staging',Key:{orderId:order.orderId,SK:'METADATA'},ConditionExpression:'attribute_not_exists(orderId)'}},
   {ConditionCheck:{TableName:'staging-Holds',Key:{orderId:order.orderId,sk:'HOLD'},ConditionExpression:'attribute_not_exists(orderId)'}},
   {ConditionCheck:{TableName:'WhizzMerchants_Businesses',Key:{businessId:order.branchId},ConditionExpression:'attribute_not_exists(businessId)'}},
  ]}));checks.reviewReadsAndFences=true;
 }
 try{await guard.order(order.orderId+'-outside','NOTIFY');throw Error('OUTSIDE_ACCEPTED');}catch(e){if(e.code!=='FINANCE_ROLLOUT_OUT_OF_SCOPE')throw e;checks.foreignOrderDeniedBeforeRead=true;}
 return {ok:true,checks,providerCalls:0,financialWrites:0};
};
