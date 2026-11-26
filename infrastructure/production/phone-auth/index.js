'use strict';
const crypto = require('node:crypto');
const {DynamoDBClient} = require('@aws-sdk/client-dynamodb');
const {DynamoDBDocumentClient, GetCommand, TransactWriteCommand, UpdateCommand} = require('@aws-sdk/lib-dynamodb');
const {SecretsManagerClient, GetSecretValueCommand} = require('@aws-sdk/client-secrets-manager');
const {createHandler, MAX_ATTEMPTS} = require('./merchant-challenge');
const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const secrets = new SecretsManagerClient({});
const table = process.env.OTP_TABLE;
const {createProofStore}=require('./merchant-login-proof.cjs');
const proofs=createProofStore({db,GetCommand,TransactWriteCommand});
const scopeCondition = 'poolId = :pool AND subject = :subject';
const handler = createHandler({
  poolId: process.env.USER_POOL_ID,
  clientId: process.env.USER_POOL_CLIENT_ID,
  proofs,
  now: () => Math.floor(Date.now() / 1000),
  id: () => crypto.randomUUID(),
  code: () => String(crypto.randomInt(0, 1000000)).padStart(6, '0'),
  async config() {
    if (process.env.ENVIRONMENT !== 'production' || process.env.OTP_ENABLED !== 'true' || !table || !process.env.OTP_SECRET_ARN) {
      throw Error('OTP configuration unavailable');
    }
    const result = await secrets.send(new GetSecretValueCommand({SecretId: process.env.OTP_SECRET_ARN}));
    return JSON.parse(result.SecretString);
  },
  async get(id) {
    return (await db.send(new GetCommand({TableName: table, Key: {id}, ConsistentRead: true}))).Item;
  },
  async reserve(row, now) {
    await db.send(new TransactWriteCommand({TransactItems: [
      {Update: {TableName: table, Key: {id: `COOLDOWN#${row.poolId}#${row.phone}`},
        UpdateExpression: 'SET nextAllowedAt = :next, expiresAt = :ttl',
        ConditionExpression: 'attribute_not_exists(nextAllowedAt) OR nextAllowedAt <= :now',
        ExpressionAttributeValues: {':next': now + 60, ':ttl': now + 86400, ':now': now}}},
      {Update: {TableName: table, Key: {id: `DAILY#${row.poolId}#${Math.floor(now / 86400)}#${row.phone}`},
        UpdateExpression: 'SET expiresAt = :ttl ADD sends :one',
        ConditionExpression: 'attribute_not_exists(sends) OR sends < :limit',
        ExpressionAttributeValues: {':ttl': now + 172800, ':one': 1, ':limit': 10}}},
      {Put: {TableName: table, Item: row, ConditionExpression: 'attribute_not_exists(id)'}},
    ]}));
  },
  async send(phone, code, apiKey) {
    const result = await fetch('https://api.otpiq.com/api/sms', {
      method: 'POST', headers: {Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'User-Agent':'WizzProductionVerification/1.0'},
      body: JSON.stringify({phoneNumber: phone.slice(1), smsType: 'verification',
        provider: 'whatsapp-telegram-sms', verificationCode: code}), signal: AbortSignal.timeout(3500),
    });
    if (!result.ok) throw Error('OTP delivery failed');
  },
  async invalidate(id, scope) {
    await db.send(new UpdateCommand({TableName: table, Key: {id}, UpdateExpression: 'SET invalid = :yes',
      ConditionExpression: scopeCondition,
      ExpressionAttributeValues: {':pool': scope.poolId, ':subject': scope.subject, ':yes': true}}));
  },
  async attempt(row, scope, now, correct) {
    try {
      await db.send(new UpdateCommand({TableName: table, Key: {id: row.id},
        UpdateExpression: correct ? 'SET used = :yes ADD attempts :one' : 'ADD attempts :one',
        ConditionExpression: scopeCondition + ' AND used = :no AND attribute_not_exists(invalid) AND expiresAt > :now AND attempts = :seen AND attempts < :max AND digest = :digest',
        ExpressionAttributeValues: {':pool': scope.poolId, ':subject': scope.subject, ':no': false,
          ':now': now, ':seen': row.attempts, ':max': MAX_ATTEMPTS, ':one': 1, ':digest': row.digest,
          ...(correct ? {':yes': true} : {})}}));
      return true;
    } catch (error) {
      if (error.name === 'ConditionalCheckFailedException') return false;
      throw error;
    }
  },
});
exports.handler = async event => {
  if (process.env.ENVIRONMENT !== 'production' || process.env.OTP_ENABLED !== 'true' ||
      process.env.USER_POOL_ID !== 'us-east-1_2sKZ4fGbZ' ||
      process.env.USER_POOL_CLIENT_ID !== '5l8ng11uudg146crop63926svq' ||
      table !== 'wizz-production-MerchantOtpSessions' ||
      !/^arn:aws:secretsmanager:us-east-1:746727375268:secret:wizz\/production\/merchant\/otp-[A-Za-z0-9]{6}$/.test(process.env.OTP_SECRET_ARN||'')) {
    throw Error('OTP configuration unavailable');
  }
  return handler(event);
};
