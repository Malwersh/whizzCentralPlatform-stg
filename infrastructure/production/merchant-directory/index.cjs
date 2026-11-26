'use strict';

const { CognitoJwtVerifier } = require('aws-jwt-verify');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const sdk = require('@aws-sdk/lib-dynamodb');
const { CognitoIdentityProviderClient, AdminGetUserCommand } = require('@aws-sdk/client-cognito-identity-provider');
const { S3Client, GetObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { createRegionResolver } = require('../../../backend/region-management/covered-region-entry');
const { createRegions, TABLES } = require('../merchant-branches/regions.cjs');
const { BUCKET } = require('../merchant-branches/assets.cjs');
const { identities } = require('../wallet-identity-bindings.json');
const { createApi } = require('./api.cjs');

const db = sdk.DynamoDBDocumentClient.from(new DynamoDBClient({ maxAttempts: 2 }), {
  marshallOptions: { removeUndefinedValues: true },
});
const { poolId, clientId } = identities.admin;
const verifier = CognitoJwtVerifier.create({ userPoolId: poolId, clientId, tokenUse: 'access' });
const cognito = new CognitoIdentityProviderClient({ maxAttempts: 2 });
const s3 = new S3Client({ maxAttempts: 2 });
async function signDocument(asset) {
  const destination = { Bucket: BUCKET, Key: asset.key, ExpectedBucketOwner: '746727375268' };
  const info = await s3.send(new HeadObjectCommand(destination)).catch(error => {
    if (['NotFound', 'NoSuchKey', 'Forbidden'].includes(error.name)) return null;
    throw error;
  });
  if (info?.ContentType !== asset.contentType || info?.ContentLength !== asset.size) {
    throw Object.assign(Error('ASSET_UNAVAILABLE'), { status: 404 });
  }
  return getSignedUrl(s3, new GetObjectCommand({
    ...destination, ResponseContentDisposition: asset.contentType === 'application/pdf' ? 'attachment' : 'inline',
  }), { expiresIn: 60 });
}
const regions = createRegions({ db, sdk, resolveCoverage: createRegionResolver({ db, sdk, tables: TABLES }) });
const api = createApi({
  db, regions, signDocument, verifyAccess: token => verifier.verify(token),
  liveIdentity: claims => cognito.send(new AdminGetUserCommand({ UserPoolId: poolId, Username: claims.username })),
});
exports.handler = event => process.env.ENVIRONMENT === 'production'
  ? api(event)
  : { statusCode: 503, body: JSON.stringify({ error: 'MERCHANT_DIRECTORY_UNAVAILABLE' }) };
