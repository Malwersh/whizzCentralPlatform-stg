'use strict';

const {CognitoJwtVerifier} = require('aws-jwt-verify');
const {CognitoIdentityProviderClient, GetUserCommand, AdminGetUserCommand} = require('@aws-sdk/client-cognito-identity-provider');
const {DynamoDBClient} = require('@aws-sdk/client-dynamodb');
const {DynamoDBDocumentClient} = require('@aws-sdk/lib-dynamodb');
const {SecretsManagerClient, GetSecretValueCommand} = require('@aws-sdk/client-secrets-manager');
const {cashAccountingDeduplicate} = require('../../../backend/wallet-service/src/cashboxAccounting');
const {identities} = require('../wallet-identity-bindings.json');
const {createHandler} = require('./api.cjs');

const options = {region: 'us-east-1', maxAttempts: 2};
const db = DynamoDBDocumentClient.from(new DynamoDBClient(options), {marshallOptions: {removeUndefinedValues: true}});
const cognito = new CognitoIdentityProviderClient(options);
const secrets = new SecretsManagerClient(options);
const verify = ({poolId, clientId}, tokenUse) => {
  const verifier = CognitoJwtVerifier.create({userPoolId: poolId, clientId, tokenUse});
  return token => verifier.verify(token);
};
const identity = (poolId, username) => cognito.send(new AdminGetUserCommand({UserPoolId: poolId, Username: username}));
const deps = {
  db, deduplicate: cashAccountingDeduplicate,
  verifyAccess: verify(identities.merchant, 'access'),
  verifyId: verify(identities.merchant, 'id'),
  verifyStaff: verify(identities.admin, 'access'),
  getUser: token => cognito.send(new GetUserCommand({AccessToken: token})),
  getIdentity: username => identity(identities.merchant.poolId, username),
  getStaff: username => identity(identities.admin.poolId, username),
  async getSecret(arn) {
    const result = await secrets.send(new GetSecretValueCommand({SecretId: arn, VersionStage: 'AWSCURRENT'}));
    return JSON.parse(result.SecretString);
  },
  async sendCode(phone, code, apiKey) {
    const response = await fetch('https://api.otpiq.com/api/sms', {
      method: 'POST',
      headers: {Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json'},
      body: JSON.stringify({phoneNumber: phone.slice(1), smsType: 'verification',
        provider: 'whatsapp-telegram-sms', verificationCode: code}),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw Error('PAYOUT_CODE_SEND_UNCONFIRMED');
  },
};

exports.owner = createHandler(deps, 'owner');
exports.staff = createHandler(deps, 'staff');
