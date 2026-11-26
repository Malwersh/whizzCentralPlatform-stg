'use strict';

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const sdk = require('@aws-sdk/lib-dynamodb');
const { CognitoIdentityProviderClient, AdminGetUserCommand } = require('@aws-sdk/client-cognito-identity-provider');
const { createAuthenticator } = require('../merchant-profile/authenticate.cjs');
const { createRegionResolver } = require('../../../backend/region-management/covered-region-entry.js');
const { createRegions, TABLES } = require('../merchant-branches/regions.cjs');
const { createApi } = require('./api.cjs');

const db = sdk.DynamoDBDocumentClient.from(new DynamoDBClient({ maxAttempts: 2 }), {
  marshallOptions: { removeUndefinedValues: true },
});
const regions = createRegions({ db, sdk, resolveCoverage: createRegionResolver({ db, sdk, tables: TABLES }) });
const authenticate = createAuthenticator({ cognito: new CognitoIdentityProviderClient({ maxAttempts: 2 }), AdminGetUserCommand });
const handler = createApi({ db, authenticate, regions });

exports.handler = event => process.env.ENVIRONMENT === 'production'
  ? handler(event)
  : { statusCode: 503, body: JSON.stringify({ code: 'SETUP_UNAVAILABLE' }) };
