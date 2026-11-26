'use strict';

const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { CognitoIdentityProviderClient, AdminGetUserCommand } = require('@aws-sdk/client-cognito-identity-provider');
const { createAuthenticator } = require('../merchant-profile/authenticate.cjs');
const { createHandler } = require('./api.cjs');
const { merchantRequestContext } = require('../../../../whizzMerchants-stg/backend/functions/shared/merchant-lifecycle');
const { authorizedHandler: catalog } = require('../../../../whizzMerchants-stg/backend/functions/products/product_management_handler');
const { authorizedHandler: upload } = require('../../../../whizzMerchants-stg/backend/functions/upload/image_upload_handler');
const { authorizedHandler: discounts } = require('../../../../whizzMerchants-stg/backend/functions/discounts/discount_management_handler');

const db = DynamoDBDocumentClient.from(new DynamoDBClient({ maxAttempts: 2 }), {
  marshallOptions: { removeUndefinedValues: true },
});
const authenticate = createAuthenticator({ cognito: new CognitoIdentityProviderClient({ maxAttempts: 2 }), AdminGetUserCommand });
const media = new S3Client({ maxAttempts: 2 });
const handler = createHandler({ db, authenticate,
  redirectMedia: Key => getSignedUrl(media, new GetObjectCommand({
    Bucket: process.env.BUSINESS_PHOTOS_BUCKET, Key,
  }), { expiresIn: 180 }),
  runCatalog: (actor, event) => merchantRequestContext.run(actor, () => catalog(event)),
  runUpload: (actor, event) => merchantRequestContext.run(actor, () => upload(event)),
  runDiscounts: (actor, event) => merchantRequestContext.run({
    ...actor, campaignBaseRevision: event.queryStringParameters?.baseRevision,
  }, () => discounts(db, event)),
});

exports.handler = event => process.env.ENVIRONMENT === 'production'
  ? handler(event)
  : { statusCode: 503, body: JSON.stringify({ code: 'CATALOG_UNAVAILABLE' }) };
