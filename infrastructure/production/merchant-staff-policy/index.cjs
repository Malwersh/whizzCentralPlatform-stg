'use strict';

const {CognitoJwtVerifier} = require('aws-jwt-verify');
const {CognitoIdentityProviderClient, AdminGetUserCommand} = require('@aws-sdk/client-cognito-identity-provider');
const {DynamoDBClient} = require('@aws-sdk/client-dynamodb');
const {DynamoDBDocumentClient} = require('@aws-sdk/lib-dynamodb');
const {identities: {admin}} = require('../wallet-identity-bindings.json');
const {createApi} = require('./api.cjs');

const options = {region: 'us-east-1', maxAttempts: 2};
const db = DynamoDBDocumentClient.from(new DynamoDBClient(options), {marshallOptions: {removeUndefinedValues: true}});
const cognito = new CognitoIdentityProviderClient(options);
const verifier = CognitoJwtVerifier.create({userPoolId: admin.poolId, clientId: admin.clientId, tokenUse: 'access'});
exports.handler = createApi({
  db, verifyStaff: token => verifier.verify(token),
  getStaff: username => cognito.send(new AdminGetUserCommand({UserPoolId: admin.poolId, Username: username})),
});
