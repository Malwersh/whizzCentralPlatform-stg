'use strict';

const { createRoutes } = require('./actions.cjs');
let handler;

exports.handler = async event => {
 if (process.env.ENVIRONMENT !== 'production' || process.env.KITCHEN_ENVIRONMENT !== 'production' ||
     process.env.KITCHEN_DISPLAY_ENABLED !== 'true' || process.env.AWS_REGION !== 'us-east-1') {
  return { statusCode: 503, body: JSON.stringify({ code: 'KITCHEN_NOT_ENABLED' }) };
 }
 if (!handler) {
  const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
  const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
  const { CognitoIdentityProviderClient, AdminGetUserCommand } = require('@aws-sdk/client-cognito-identity-provider');
  const { createAuthenticator } = require('../merchant-profile/authenticate.cjs');
  const { createProductionMerchantOrderResponses } = require('../../../backend/wallet-service/dist/productionMerchantOrderResponses');
  const { createService } = require('../../../../whizzMerchants-stg/backend/kitchen-display/pairing');
  const { createProductionKitchenAdvance } = require('../../../../whizzMerchants-stg/backend/kitchen-display/production-advance');
  const db = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
  const service = createService({ db });
  handler = createRoutes({
   service, authenticate: createAuthenticator({ cognito: new CognitoIdentityProviderClient({}), AdminGetUserCommand }),
   advance: createProductionKitchenAdvance({ db, service, createWriter: createProductionMerchantOrderResponses }),
  });
 }
 return handler(event);
};
