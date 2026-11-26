'use strict';

const { error } = require('../../../backend/account-deletion/policy');

async function handler(event, context) {
  const { ENVIRONMENT, AWS_REGION, MERCHANT_DELETION_ENABLED, MERCHANT_DELETION_MUTATION_GUARDS_VERIFIED,
    MERCHANT_DELETION_ENROLLMENT_GUARDS_VERIFIED, MERCHANT_CATALOG_ORIGIN } = process.env;
  if (ENVIRONMENT !== 'production' || AWS_REGION !== 'us-east-1' || MERCHANT_DELETION_ENABLED !== 'true' ||
      MERCHANT_DELETION_MUTATION_GUARDS_VERIFIED !== 'true' || MERCHANT_DELETION_ENROLLMENT_GUARDS_VERIFIED !== 'true' ||
      !/^https:\/\/[a-z0-9]{10}\.execute-api\.us-east-1\.amazonaws\.com$/.test(MERCHANT_CATALOG_ORIGIN || '') ||
      event?.operation !== 'MERCHANT_DELETION_SWEEP' || Object.keys(event).length !== 1) throw error('WORKER_NOT_ENABLED');

  const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
  const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
  const { CognitoIdentityProviderClient } = require('@aws-sdk/client-cognito-identity-provider');
  const { S3Client } = require('@aws-sdk/client-s3');
  const { createMerchantDeletionWorker } = require('./merchant-worker.cjs');
  const settlement = require('../../../backend/wallet-service/dist/merchantSettlementPreview');
  const db = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
  const worker = createMerchantDeletionWorker({
    db, settlement, s3: new S3Client({}), cognito: new CognitoIdentityProviderClient({}),
    mediaOrigin: MERCHANT_CATALOG_ORIGIN, verifiedMutationGuards: true, verifiedEnrollmentGuards: true,
  });
  return worker.sweep(() => context.getRemainingTimeInMillis());
}

module.exports = { handler };
