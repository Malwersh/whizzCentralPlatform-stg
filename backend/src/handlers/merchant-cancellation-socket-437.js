'use strict';
const {GetCommand,QueryCommand}=require('@aws-sdk/lib-dynamodb');
const {ApiGatewayManagementApiClient,PostToConnectionCommand}=require('@aws-sdk/client-apigatewaymanagementapi');
const TABLE='WizzUser_websocket_connections_staging';
async function send(db,notice,api=new ApiGatewayManagementApiClient({endpoint:'https://igcrhwc84c.execute-api.us-east-1.amazonaws.com/staging'})){
 const branch=notice.businessId;
 const business=(await db.send(new GetCommand({TableName:'WhizzMerchants_Businesses',Key:{businessId:branch},ConsistentRead:true,ProjectionExpression:'businessId,ownerId,cognitoUserId,deletionRequestId'}))).Item;
 if(!business?.ownerId||business.ownerId!==business.cognitoUserId||business.deletionRequestId)return {sent:0};
 for(const pk of ['ACCOUNT_LIFECYCLE#MERCHANT#'+business.ownerId,'BUSINESS_LIFECYCLE#MERCHANT#'+branch])if((await db.send(new GetCommand({TableName:'staging-AccountDeletion',Key:{pk,sk:'META'},ConsistentRead:true,ProjectionExpression:'pk'}))).Item)return {sent:0};
 let cursor,sent=0;
 do{
  const result=await db.send(new QueryCommand({TableName:TABLE,IndexName:'userId-connectedAt-index',KeyConditionExpression:'userId=:id',ExpressionAttributeValues:{':id':business.ownerId},ProjectionExpression:'connectionId',ExclusiveStartKey:cursor}));cursor=result.LastEvaluatedKey;
  for(const candidate of result.Items||[]){
   const row=(await db.send(new GetCommand({TableName:TABLE,Key:{connectionId:candidate.connectionId},ConsistentRead:true}))).Item;
   const scope=row?.merchantScope345;
   if(!scope||scope.subjectId!==business.ownerId||scope.businessId!==branch||scope.expiresAt<=Date.now()/1000||row.isActive===false)continue;
   const data={type:'ORDER_UPDATE',businessId:branch,orderId:notice.orderId,status:notice.status,action:notice.action,eventId:notice.eventId,cancellationState:notice.cancellationState,cancellationVersion:notice.cancellationVersion,updatedAt:notice.updatedAt};
   try{await api.send(new PostToConnectionCommand({ConnectionId:row.connectionId,Data:Buffer.from(JSON.stringify(data))}));sent++;}catch(e){if(e.$metadata?.httpStatusCode!==410&&e.statusCode!==410)throw e;}
  }
 }while(cursor);
 return {sent};
}
module.exports={send};
