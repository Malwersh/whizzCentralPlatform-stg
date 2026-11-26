'use strict';

const { CognitoJwtVerifier } = require('aws-jwt-verify');
const { CognitoIdentityProviderClient, AdminGetUserCommand, GetUserCommand } = require('@aws-sdk/client-cognito-identity-provider');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { cashAccountingDeduplicate } = require('../../../backend/wallet-service/src/cashboxAccounting');
const { identities: {merchant} } = require('../wallet-identity-bindings.json');
const { createHandler } = require('./api.cjs');

const options = {region: 'us-east-1', maxAttempts: 2};
const db = DynamoDBDocumentClient.from(new DynamoDBClient(options), {marshallOptions: {removeUndefinedValues: true}});
const cognito = new CognitoIdentityProviderClient(options);
const verify = tokenUse => {
  const verifier = CognitoJwtVerifier.create({userPoolId: merchant.poolId, clientId: merchant.clientId, tokenUse});
  return token => verifier.verify(token);
};
const shared = {db, deduplicate: cashAccountingDeduplicate};

exports.access = createHandler({
  ...shared, cognito, verifyAccess: verify('access'), verifyId: verify('id'),
  getUser: token => cognito.send(new GetUserCommand({AccessToken: token})),
  getIdentity: username => cognito.send(new AdminGetUserCommand({UserPoolId: merchant.poolId, Username: username})),
}, 'access');
exports.finance = createHandler(shared, 'finance');
