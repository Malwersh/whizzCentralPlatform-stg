'use strict';

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { CognitoIdentityProviderClient } = require('@aws-sdk/client-cognito-identity-provider');
const { S3Client } = require('@aws-sdk/client-s3');
const { ApiGatewayManagementApiClient } = require('@aws-sdk/client-apigatewaymanagementapi');
const { runDeletionSweep } = require('../../../backend/account-deletion/scheduler');
const { retentionSettings } = require('../../../backend/account-deletion/settings');
const { financialDispatchTables } = require('../../../backend/wallet-service/dist/walletBindings');
const { error } = require('../../../backend/account-deletion/policy');
const { createCustomerDeletionWorker } = require('./customer-worker.cjs');
const { tables } = require('./evidence.cjs');
const settlement = require('../../../backend/wallet-service/dist/merchantSettlementPreview');

async function handler(event, context) {
  const { ENVIRONMENT, AWS_REGION, CUSTOMER_DELETION_ENABLED, SUPPORT_SOCKET_ENDPOINT } = process.env;
  const operation = event?.operation;
  if (ENVIRONMENT !== 'production' || AWS_REGION !== 'us-east-1' ||
      !/^https:\/\/[a-z0-9]{10}\.execute-api\.us-east-1\.amazonaws\.com\/production$/.test(SUPPORT_SOCKET_ENDPOINT) ||
      Object.keys(event ?? {}).length !== 1 ||
      (operation !== 'CUSTOMER_DELETION_READINESS' &&
       (operation !== 'CUSTOMER_DELETION_SWEEP' || CUSTOMER_DELETION_ENABLED !== 'true'))) {
    throw error('WORKER_NOT_ENABLED');
  }
  const db = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
  });
  if (operation === 'CUSTOMER_DELETION_READINESS') {
    financialDispatchTables();
    const loadPolicy = retentionSettings({ db, table: tables.staff, environment: 'production' });
    const policy = await loadPolicy('CUSTOMER');
    await loadPolicy('CUSTOMER', policy.retentionPolicyVersion);
    return { policyVersion: policy.retentionPolicyVersion, executionEnabled: CUSTOMER_DELETION_ENABLED === 'true' };
  }
  const processCustomer = createCustomerDeletionWorker({
    db, settlement, verifiedMutationGuards: true,
    deliveryFundingArchiveEnabled: process.env.DELIVERY_FUNDING_ARCHIVE_ENABLED === 'true',
    cognito: new CognitoIdentityProviderClient({}),
    s3: new S3Client({}),
    socket: new ApiGatewayManagementApiClient({ endpoint: SUPPORT_SOCKET_ENDPOINT }),
  });
  return runDeletionSweep({
    db, table: tables.deletion, environment: 'production', enabledTypes: ['CUSTOMER'],
    processRequest: request => processCustomer(request.subjectId, request.requestId),
    remainingTime: () => context.getRemainingTimeInMillis(),
    onError: ({ requestId, code }) => console.warn('CUSTOMER_DELETION_RETRY', { requestId, code }),
  });
}

module.exports = { handler };
