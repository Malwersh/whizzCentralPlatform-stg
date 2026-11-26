'use strict';

const { CognitoJwtVerifier } = require('aws-jwt-verify');
const { CognitoIdentityProviderClient, GetUserCommand, AdminGetUserCommand } = require('@aws-sdk/client-cognito-identity-provider');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const { identities } = require('../wallet-identity-bindings.json');
const { createHandler } = require('./api.cjs');

const options = { region: 'us-east-1', maxAttempts: 2 };
const { poolId, clientId } = identities.merchant;
const access = CognitoJwtVerifier.create({ userPoolId: poolId, clientId, tokenUse: 'access' });
const id = CognitoJwtVerifier.create({ userPoolId: poolId, clientId, tokenUse: 'id' });
const db = DynamoDBDocumentClient.from(new DynamoDBClient(options), { marshallOptions: { removeUndefinedValues: true } });
const cognito = new CognitoIdentityProviderClient(options);
const secrets = new SecretsManagerClient(options);

exports.handler = createHandler({
  db, verifyAccess: token => access.verify(token), verifyId: token => id.verify(token),
  getUser: token => cognito.send(new GetUserCommand({ AccessToken: token })),
  getIdentity: username => cognito.send(new AdminGetUserCommand({ UserPoolId: poolId, Username: username })),
  async getSecret(arn) {
    const result = await secrets.send(new GetSecretValueCommand({ SecretId: arn, VersionStage: 'AWSCURRENT' }));
    return JSON.parse(result.SecretString);
  },
  async sendCode(phone, code, apiKey) {
    const response = await fetch('https://api.otpiq.com/api/sms', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json',
        'User-Agent': 'WizzProductionVerification/1.0' },
      body: JSON.stringify({ phoneNumber: phone.slice(1), smsType: 'verification',
        provider: 'whatsapp-telegram-sms', verificationCode: code }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw Error('TRANSFER_DESTINATION_DELIVERY_FAILED');
  },
});
