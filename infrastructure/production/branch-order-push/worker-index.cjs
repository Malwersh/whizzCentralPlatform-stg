'use strict';
const {DynamoDBClient}=require('@aws-sdk/client-dynamodb');
const {DynamoDBDocumentClient}=require('@aws-sdk/lib-dynamodb');
const {getMessaging}=require('../../../backend/src/utils/firebase');
const {firebaseBinding}=require('../../../backend/src/utils/notification-provider-bindings');
const {createWorker}=require('./worker.cjs');
const db=DynamoDBDocumentClient.from(new DynamoDBClient({maxAttempts:2}),{marshallOptions:{removeUndefinedValues:true}});
exports.handler=(event,context)=>{
  if (process.env.STAGE!=='production'||process.env.AWS_REGION!=='us-east-1') throw Error('PRODUCTION_ORDER_PUSH_NOT_CONFIGURED');
  firebaseBinding();
  return createWorker({db,messaging:getMessaging,stream:process.env.ORDERS_STREAM_ARN,
    canRun:()=>context.getRemainingTimeInMillis()>8000})(event);
};
