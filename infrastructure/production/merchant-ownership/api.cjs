'use strict';

const sdk = require('@aws-sdk/lib-dynamodb');
const { authenticateOwner, createOtp, validOtpSecret } = require('../merchant-financial-session/api.cjs');
const { createRoute } = require('../../../../whizzMerchants-stg/backend/functions/auth/ownership-transfer-service');
const { createTransferStore } = require('../../../../whizzMerchants-stg/backend/functions/auth/ownership-transfer-store');
const { createDestination } = require('../../../../whizzMerchants-stg/backend/functions/auth/ownership-transfer-destination');
const { enqueue } = require('./notice-record.cjs');

const path = '/auth/ownership-transfer';
const platform = 'wizz-production-MerchantPlatform';
const staff = 'wizz-production-PlatformStaff';
const deletion = 'wizz-production-AccountDeletion';
const policyKey = { pk: 'OPERATIONAL_SETTINGS#MERCHANT_ONBOARDING', sk: 'CURRENT' };
const subject = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const phonePattern = /^\+9647\d{9}$/;
const fail = (status, code) => { throw Object.assign(Error(code), { status }); };
const headers = {
  'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization,Access-Token,Content-Type',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
};
const reply = (statusCode, data) => ({ statusCode, headers, body: data === undefined ? '' : JSON.stringify(data) });
const accountKeys = sub => [
  { pk: 'ACCOUNT_LIFECYCLE#MERCHANT#' + sub, sk: 'META' },
  { pk: 'SUBJECT#MERCHANT#' + sub, sk: 'ACTIVE#ACCOUNT#' + sub },
];
const exactKey = (Key, TableName) => ({
  ConditionCheck: { TableName, Key, ConditionExpression: 'attribute_not_exists(pk)' },
});

function createHandler({
  db, verifyAccess, verifyId, getUser, getIdentity, getSecret, sendCode,
  env = process.env, now = Date.now, commands = sdk,
}) {
  const read = async (TableName, Key) => (await db.send(new commands.GetCommand({ TableName, Key, ConsistentRead: true }))).Item;
  async function open(sub) {
    const locks = await Promise.all(accountKeys(sub).map(Key => read(deletion, Key)));
    if (locks.some(Boolean)) fail(403, 'ACCOUNT_CLOSING');
  }

  return async event => {
    if (event.resource !== path || event.requestContext?.stage !== 'production') return reply(404, { code: 'NOT_FOUND' });
    if (event.httpMethod === 'OPTIONS') return reply(204);
    if (!['GET', 'POST'].includes(event.httpMethod)) return reply(405, { code: 'METHOD_NOT_ALLOWED' });
    if (env.ENVIRONMENT !== 'production' || env.AWS_REGION !== 'us-east-1' || !validOtpSecret(env.OTP_SECRET_ARN)) {
      return reply(503, { code: 'OWNERSHIP_TRANSFER_UNAVAILABLE' });
    }
    let principal, live;
    try {
      principal = await authenticateOwner(event, { verifyAccess, verifyId, getUser, getIdentity, now });
      live = await principal.revalidate();
    } catch { return reply(401, { code: 'UNAUTHORIZED' }); }
    const sub = principal.subjectId;
    try {
      if (!subject(sub) || !phonePattern.test(live.phone_number) || live.phone_number_verified !== 'true') {
        fail(401, 'UNAUTHORIZED');
      }
      await open(sub);
      let input = {};
      if (event.httpMethod === 'POST') {
        try {
          if (event.isBase64Encoded || typeof event.body !== 'string' || Buffer.byteLength(event.body) > 4096 ||
              Object.keys(event.queryStringParameters ?? {}).length) throw Error();
          input = JSON.parse(event.body);
          if (!input || Array.isArray(input) || typeof input !== 'object') throw Error();
        } catch { fail(400, 'INVALID_TRANSFER_REQUEST'); }
        if (input.action === 'START' &&
            (!phonePattern.test(input.recipientPhone ?? '') || !subject(input.expectedRecipientId))) {
          fail(400, 'INVALID_TRANSFER_RECIPIENT');
        }
      }
      let policy;
      const terms = async () => {
        policy = await read(staff, policyKey);
        const { partnershipReady, termsVersion, termsTextAr } = policy?.values ?? {};
        if (!Number.isSafeInteger(policy?.version) || typeof policy?.policyVersion !== 'string' ||
            typeof termsVersion !== 'string' || typeof termsTextAr !== 'string') {
          fail(503, 'OWNERSHIP_TRANSFER_UNAVAILABLE');
        }
        return { partnershipReady, termsVersion, termsTextAr };
      };
      let recipientProfile;
      const resolveRecipient = async phone => {
        if (typeof phone !== 'string' || !phonePattern.test(phone)) return null;
        let user;
        try { user = await getIdentity(phone); }
        catch (error) { if (error.name === 'UserNotFoundException') return null; throw error; }
        const attributes = Object.fromEntries((user?.UserAttributes || []).map(({ Name, Value }) => [Name, Value]));
        if (user?.Enabled !== true || user.UserStatus !== 'CONFIRMED' || !subject(attributes.sub) ||
            attributes.phone_number !== phone || attributes.phone_number_verified !== 'true') return null;
        const profile = await read(platform, { pk: 'PERSON#' + attributes.sub, sk: 'PROFILE' });
        if (profile?.subjectId !== attributes.sub || profile.phoneNumber !== phone ||
            profile.isDeleted || profile.deletedAt || typeof profile.name !== 'string' || !profile.name.trim() ||
            !Number.isSafeInteger(profile.version)) return null;
        try { await open(attributes.sub); }
        catch (error) { if (error.status === 403) return null; throw error; }
        recipientProfile = profile;
        return { id: attributes.sub, name: profile.name, phone };
      };
      const store = createTransferStore({
        ...commands, db, environment: 'production', clock: now,
        transitionWrites(next, previous) {
          if (next.status === 'AWAITING_RECIPIENT' && next.requestId !== previous?.requestId) {
            if (!recipientProfile || recipientProfile.subjectId !== next.recipientId) fail(409, 'TRANSFER_RECIPIENT_CHANGED');
            return [
              { ConditionCheck: { TableName: platform, Key: { pk: 'PERSON#' + next.recipientId, sk: 'PROFILE' },
                ConditionExpression: 'subjectId=:sub AND phoneNumber=:phone AND #v=:version',
                ExpressionAttributeNames: { '#v': 'version' },
                ExpressionAttributeValues: { ':sub': next.recipientId, ':phone': recipientProfile.phoneNumber,
                  ':version': recipientProfile.version },
              } },
              enqueue(next, 'ownership_invitation', now()),
            ];
          }
          if (next.status === 'AWAITING_REVIEW') {
            return [
              { ConditionCheck: { TableName: staff, Key: policyKey,
                ConditionExpression: '#v=:version AND policyVersion=:policy AND #values.termsVersion=:terms AND #values.partnershipReady=:ready',
                ExpressionAttributeNames: { '#v': 'version', '#values': 'values' },
                ExpressionAttributeValues: { ':version': policy.version, ':policy': policy.policyVersion,
                  ':terms': next.agreementVersion, ':ready': true },
              } },
              enqueue(next, 'ownership_accepted', now()),
            ];
          }
          return [];
        },
      });
      const destination = createDestination({
        db, table: platform, clock: now, Get: commands.GetCommand, Write: commands.TransactWriteCommand,
        provider: createOtp({ getSecret, sendCode, secretArn: env.OTP_SECRET_ARN,
          domain: 'wizz-production/merchant/ownership-settlement/v1' }),
        guards: subjectId => accountKeys(subjectId).map(Key => exactKey(Key, deletion)),
      });
      const output = await createRoute({ store, terms, destination, resolveRecipient, clock: now, allowValidSession: true })({
        event, input, identity: {
          claims: { sub, token_use: 'access', auth_time: principal.authTime },
          user: { UserAttributes: Object.entries(live).map(([Name, Value]) => ({ Name, Value })) },
        },
      });
      if (event.httpMethod === 'POST' && output.request) {
        const { requestId, organizationId, status } = output.request;
        return reply(200, { request: { requestId, organizationId, status } });
      }
      return reply(200, output);
    } catch (error) {
      if (Number.isInteger(error.status) && /^[A-Z_]+$/.test(error.message)) return reply(error.status, { code: error.message });
      if (error.name === 'TransactionCanceledException' || error.name === 'ConditionalCheckFailedException') {
        return reply(409, { code: 'TRANSFER_STATE_CHANGED' });
      }
      console.warn('OWNERSHIP_TRANSFER_UNAVAILABLE', { name: error.name });
      return reply(503, { code: 'OWNERSHIP_TRANSFER_UNAVAILABLE' });
    }
  };
}

module.exports = { createHandler, path };
