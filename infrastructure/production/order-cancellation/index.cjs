'use strict';

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { CognitoIdentityProviderClient } = require('@aws-sdk/client-cognito-identity-provider');
const { LambdaClient } = require('@aws-sdk/client-lambda');
const { invokeCustomerCancellation } = require('../../../backend/order-service/financial-cancellation-client');
const { route } = require('../../../../whizzMerchants-stg/backend/functions/auth/order_returns');
const { authenticateFinancialIdentity } = require('../../../backend/wallet-service/src/financialIdentity');
const { createHandler } = require('./api.cjs');

const options = { region: 'us-east-1', maxAttempts: 2 };
const db = DynamoDBDocumentClient.from(new DynamoDBClient(options));
const cognito = new CognitoIdentityProviderClient(options);
const lambda = new LambdaClient(options);
exports.handler = createHandler({
  customer: (event, body) => invokeCustomerCancellation(event, body, lambda),
  merchant: ({ subjectId }, event, body) => route({ db, sub: subjectId }, event, body, lambda),
  authenticateMerchant: token => authenticateFinancialIdentity(cognito, token, 'MERCHANT_OWNER'),
});
