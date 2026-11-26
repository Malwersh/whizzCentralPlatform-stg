'use strict';

const { CognitoJwtVerifier } = require('aws-jwt-verify');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { CognitoIdentityProviderClient, AdminGetUserCommand, GetUserCommand } = require('@aws-sdk/client-cognito-identity-provider');
const { identities } = require('../wallet-identity-bindings.json');
const { createApi } = require('./api.cjs');

const db = DynamoDBDocumentClient.from(new DynamoDBClient({ maxAttempts: 2 }), {
  marshallOptions: { removeUndefinedValues: true },
});
const cognito = new CognitoIdentityProviderClient({ maxAttempts: 2 });
function tokenVerifier(audience, tokenUse = 'access') {
  const { poolId, clientId } = identities[audience];
  const verifier = CognitoJwtVerifier.create({ userPoolId: poolId, clientId, tokenUse });
  return token => verifier.verify(token);
}
const staff = createApi({
  db, verifyAccess: tokenVerifier('admin'), liveIdentity: claims => cognito.send(new AdminGetUserCommand({
    UserPoolId: identities.admin.poolId, Username: claims.username,
  })),
}, 'staff');
const owner = createApi({
  db, verifyAccess: tokenVerifier('merchant'), verifyMerchantId: tokenVerifier('merchant', 'id'),
  liveIdentity: token => cognito.send(new GetUserCommand({ AccessToken: token })),
}, 'owner');
const production = handler => event => process.env.ENVIRONMENT === 'production' ? handler(event)
  : { statusCode: 503, body: JSON.stringify({ error: 'COMMERCIAL_UNAVAILABLE' }) };
exports.staff = production(staff);
exports.owner = production(owner);
