'use strict';
const {DynamoDBClient}=require('@aws-sdk/client-dynamodb');
const {DynamoDBDocumentClient}=require('@aws-sdk/lib-dynamodb');
const {createDeviceAuthority}=require('../../../backend/wallet-service/src/productionBranchDeviceAuthority');
const {createRegistry}=require('./registration.cjs');
const db=DynamoDBDocumentClient.from(new DynamoDBClient({maxAttempts:2}),{marshallOptions:{removeUndefinedValues:true}});
const handle=createRegistry({db,authorize:createDeviceAuthority(db)});
exports.handler=event=>process.env.ENVIRONMENT==='production' && process.env.AWS_REGION==='us-east-1'
  ? handle(event) : {statusCode:503,body:'{"code":"BRANCH_PUSH_UNAVAILABLE"}'};
