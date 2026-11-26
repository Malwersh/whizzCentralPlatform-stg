'use strict';

const { CognitoJwtVerifier } = require('aws-jwt-verify');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { CognitoIdentityProviderClient, AdminGetUserCommand } = require('@aws-sdk/client-cognito-identity-provider');
const {bucket, createAssets} = require('./media.cjs');
const { identities } = require('../wallet-identity-bindings.json');
const { createPublicApi, createStaffApi } = require('./api.cjs');

const db = DynamoDBDocumentClient.from(new DynamoDBClient({ maxAttempts: 2 }), {
  marshallOptions: { removeUndefinedValues: true },
});
function verifier(audience) {
  const { poolId, clientId } = identities[audience];
  return CognitoJwtVerifier.create({ userPoolId: poolId, clientId, tokenUse: 'access' });
}
const customerTokens = verifier('customer');
const staffTokens = verifier('admin');
const cognito = new CognitoIdentityProviderClient({});
const Bucket = process.env.HOME_SLIDE_BUCKET || bucket;
const assets = createAssets();
const publicApi = createPublicApi({ db, assets, verifyAccess: token => customerTokens.verify(token) });
const staffApi = createStaffApi({
  db,
  assets,
  verifyAccess: token => staffTokens.verify(token),
  liveIdentity: claims => cognito.send(new AdminGetUserCommand({
    UserPoolId: identities.admin.poolId, Username: claims.username,
  })),
});

function productionOnly(handler) {
  return event => process.env.ENVIRONMENT === 'production' && Bucket === bucket ? handler(event)
    : { statusCode: 503, body: JSON.stringify({ error: 'HOME_SETTINGS_UNAVAILABLE' }) };
}

exports.public = productionOnly(publicApi);
exports.staff = productionOnly(staffApi);

exports.rankings = productionOnly(() => require('../../../backend/staff-service/home-discovery').rebuild({
  db, table: 'wizz-production-PlatformStaff',
}, { ordersTable: 'wizz-production-Orders' }));
