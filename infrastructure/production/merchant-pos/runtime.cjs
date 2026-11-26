'use strict';

const { createMerchantPosApi } = require('./api.cjs');
let handler;

exports.handler = async event => {
  if (process.env.ENVIRONMENT !== 'production' || process.env.AWS_REGION !== 'us-east-1' ||
      process.env.MERCHANT_POS_ENABLED !== 'true') {
    return { statusCode: 503, body: JSON.stringify({ code: 'POS_UNAVAILABLE' }) };
  }
  if (!handler) {
    const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
    const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
    const { CognitoIdentityProviderClient, AdminGetUserCommand } = require('@aws-sdk/client-cognito-identity-provider');
    const { createAuthenticator } = require('../merchant-profile/authenticate.cjs');
    const db = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
    const authenticate = createAuthenticator({ cognito: new CognitoIdentityProviderClient({}), AdminGetUserCommand });
    const approvedEndpoints = (process.env.MERCHANT_POS_APPROVED_ENDPOINTS || '').split(',').filter(Boolean);
    handler = createMerchantPosApi({ db, authenticate, approvedEndpoints });
  }
  return handler(event);
};
