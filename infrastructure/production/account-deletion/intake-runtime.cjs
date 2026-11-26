'use strict';

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { CognitoIdentityProviderClient } = require('@aws-sdk/client-cognito-identity-provider');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const { error } = require('../../../backend/account-deletion/policy');
const { createDriverDeletionEvidence } = require('./driver-linked-data.cjs');
const { createEvidence } = require('./evidence.cjs');
const { createApi } = require('./api.cjs');

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const otpSecretArn = /^arn:aws:secretsmanager:us-east-1:746727375268:secret:[A-Za-z0-9/_+=.@-]+$/;

async function handler(event) {
  const { ENVIRONMENT, AWS_REGION, ACCOUNT_DELETION_ACTOR_TYPE = 'CUSTOMER',
    CUSTOMER_DELETION_CANARY_SUBJECT, DELETION_OTP_SECRET_ARN } = process.env;
  const type=ACCOUNT_DELETION_ACTOR_TYPE;
  if (ENVIRONMENT !== 'production' || AWS_REGION !== 'us-east-1' || !['CUSTOMER','DRIVER','MERCHANT'].includes(type) ||
      !otpSecretArn.test(DELETION_OTP_SECRET_ARN) ||
      !DELETION_OTP_SECRET_ARN.includes('/'+type.toLowerCase()+'/otp-')) throw error('INTAKE_NOT_CONFIGURED');
  const db = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
  });
  const secrets = new SecretsManagerClient({});
  const enabled = process.env[type+'_DELETION_INTAKE_ENABLED'] === 'true';
  const api = createApi({
    db, cognito: new CognitoIdentityProviderClient({}), allowedTypes: [type],
    executionTypes: new Set(enabled || type==='CUSTOMER'&&uuid.test(CUSTOMER_DELETION_CANARY_SUBJECT) ? [type] : []),
    allowIntake: actor => actor.type===type && (enabled || type==='CUSTOMER'&&actor.sub===CUSTOMER_DELETION_CANARY_SUBJECT),
    inspect: type==='DRIVER' ? createDriverDeletionEvidence({db}) :
      createEvidence({ db, deliveryFundingArchiveEnabled: process.env.DELIVERY_FUNDING_ARCHIVE_ENABLED === 'true' }),
    async secret() {
      const { SecretString } = await secrets.send(new GetSecretValueCommand({ SecretId: DELETION_OTP_SECRET_ARN }));
      const value = JSON.parse(SecretString);
      if (typeof value?.apiKey !== 'string' || !value.apiKey ||
          typeof value.hmacKey !== 'string' || value.hmacKey.length < 32) throw error('VERIFICATION_UNAVAILABLE');
      return value;
    },
    async deliver(key, phone, code) {
      const response = await fetch('https://api.otpiq.com/api/sms', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + key.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phoneNumber: phone.slice(1), smsType: 'verification', provider: 'whatsapp-sms', verificationCode: code,
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw error('VERIFICATION_UNAVAILABLE');
    },
  });
  return api(event);
}

module.exports = { handler };
