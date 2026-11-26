'use strict';

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { CognitoIdentityProviderClient } = require('@aws-sdk/client-cognito-identity-provider');
const { S3Client } = require('@aws-sdk/client-s3');
const { ApiGatewayManagementApiClient } = require('@aws-sdk/client-apigatewaymanagementapi');
const { runDeletionSweep } = require('../../../backend/account-deletion/scheduler');
const { error } = require('../../../backend/account-deletion/policy');
const { createDriverDeletionWorker } = require('./driver-worker.cjs');
const { tables } = require('./evidence.cjs');
const settlement = require('../../../backend/wallet-service/dist/merchantSettlementPreview');

async function handler(event, context) {
  const { ENVIRONMENT,AWS_REGION,DRIVER_DELETION_ENABLED,ORDER_SOCKET_ENDPOINT } = process.env;
  if (ENVIRONMENT!=='production'||AWS_REGION!=='us-east-1'||DRIVER_DELETION_ENABLED!=='true'||
      !/^https:\/\/[a-z0-9]{10}\.execute-api\.us-east-1\.amazonaws\.com\/production$/.test(ORDER_SOCKET_ENDPOINT)||
      event?.operation!=='DRIVER_DELETION_SWEEP'||Object.keys(event).length!==1) throw error('WORKER_NOT_ENABLED');
  const db=DynamoDBDocumentClient.from(new DynamoDBClient({}),{marshallOptions:{removeUndefinedValues:true}});
  const processDriver=createDriverDeletionWorker({
    db,settlement,verifiedMutationGuards:true,verifiedEnrollmentGuards:true,
    cognito:new CognitoIdentityProviderClient({}),s3:new S3Client({}),
    orderSocket:new ApiGatewayManagementApiClient({endpoint:ORDER_SOCKET_ENDPOINT}),
  });
  return runDeletionSweep({
    db,table:tables.deletion,environment:'production',enabledTypes:['DRIVER'],
    processRequest:request=>processDriver(request.subjectId,request.requestId),
    remainingTime:()=>context.getRemainingTimeInMillis(),
    onError:info=>console.warn('DRIVER_DELETION_RETRY',info),
  });
}

module.exports={handler};
