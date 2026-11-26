'use strict';

const { createHmac } = require('node:crypto');
const { createAccess, actions } = require('../../../backend/staff-service/merchant-financial-access');
const { identities } = require('../wallet-identity-bindings.json');

const path = '/auth/merchant-financial-session';
const sessionTable = 'wizz-production-MerchantFinancialSessions';
const approvedSecret = /^arn:aws:secretsmanager:us-east-1:746727375268:secret:wizz\/production\/merchant\/otp-[A-Za-z0-9]{6}$/;
const headers = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization,Access-Token,Content-Type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
};
const codes = new Map([
  ['PAYOUT_FINANCIAL_INVALID_REQUEST', 400],
  ['PAYOUT_FINANCIAL_INVALID_CODE', 400],
  ['PAYOUT_FINANCIAL_CHALLENGE_EXPIRED', 409],
  ['PAYOUT_FINANCIAL_RATE_LIMIT', 429],
  ['PAYOUT_FINANCIAL_OWNER_REQUIRED', 403],
  ['PAYOUT_FINANCIAL_IDENTITY_CHANGED', 403],
  ['PAYOUT_FINANCIAL_UNLOCK_REQUIRED', 403],
]);
const reply = (statusCode, data) => ({statusCode, headers, body: data == null ? '' : JSON.stringify(data)});
const failure = (statusCode, code) => reply(statusCode, {code});

function header(event, name) {
  const values = Object.entries(event.headers ?? {}).filter(([key]) => key.toLowerCase() === name);
  const value = values.length === 1 ? values[0][1] : undefined;
  return typeof value === 'string' && value.length <= 8200 ? value : null;
}

function attributes(user) {
  const wanted = ['sub', 'phone_number', 'phone_number_verified'];
  const attrs = {};
  for (const {Name, Value} of user.UserAttributes ?? []) {
    if (!wanted.includes(Name)) continue;
    if (Object.hasOwn(attrs, Name) || typeof Value !== 'string') throw Error('UNAUTHORIZED');
    attrs[Name] = Value;
  }
  return attrs;
}

function createOtp({ getSecret, sendCode, secretArn, domain = 'wizz-production/merchant/financial-verification/v1' }) {
  let config;
  const load = () => config ??= Promise.resolve().then(async () => {
    const value = await getSecret(secretArn);
    if (typeof value?.apiKey !== 'string' || !value.apiKey.trim() ||
        typeof value.hmacKey !== 'string' || value.hmacKey.length < 32) {
      throw Error('PAYOUT_FINANCIAL_VERIFICATION_UNAVAILABLE');
    }
    return value;
  });
  return {
    async secret() {
      const {hmacKey} = await load();
      return createHmac('sha256', hmacKey).update(domain).digest('hex');
    },
    async send(phone, code) {
      const {apiKey} = await load();
      await sendCode(phone, code, apiKey);
    },
  };
}

function validOtpSecret(arn) {
  return approvedSecret.test(arn ?? '');
}

async function authenticateOwner(event, {verifyAccess, verifyId, getUser, getIdentity, now}) {
  const {poolId, clientId} = identities.merchant;
  const accessToken = header(event, 'access-token');
  const idToken = /^Bearer (\S+)$/i.exec(header(event, 'authorization') ?? '')?.[1];
  if (!accessToken || !idToken || /\s/.test(accessToken)) throw Error('UNAUTHORIZED');
  const [claims, idClaims] = await Promise.all([verifyAccess(accessToken), verifyId(idToken)]);
  const issuer = 'https://cognito-idp.us-east-1.amazonaws.com/' + poolId;
  if (!/^[a-f0-9-]{36}$/i.test(claims?.sub) || idClaims?.sub !== claims.sub ||
      claims.iss !== issuer || idClaims.iss !== issuer || claims.client_id !== clientId || idClaims.aud !== clientId ||
      claims.token_use !== 'access' || idClaims.token_use !== 'id' ||
      !Number.isInteger(claims.exp) || !Number.isInteger(idClaims.exp) ||
      Math.min(claims.exp, idClaims.exp) * 1000 <= now()) throw Error('UNAUTHORIZED');
  const unauthorized = () => Object.assign(Error('UNAUTHORIZED'), {status: 401});
  return {
    subjectId: claims.sub,
    authTime: claims.auth_time,
    async revalidate() {
      let user, current;
      try {
        user = await getUser(accessToken);
        if (!user?.Username || attributes(user).sub !== claims.sub) throw unauthorized();
        current = await getIdentity(user.Username);
      } catch (error) {
        if (['NotAuthorizedException', 'UserNotFoundException'].includes(error.name)) throw unauthorized();
        throw error;
      }
      const live = attributes(current ?? {});
      if (current?.Enabled !== true || current.UserStatus !== 'CONFIRMED' || current.Username !== user.Username ||
          live.sub !== claims.sub || live.phone_number !== attributes(user).phone_number) throw unauthorized();
      return live;
    },
  };
}

function createHandler({
  db, verifyAccess, verifyId, getUser, getIdentity, getSecret, sendCode, deduplicateGuards,
  env = process.env, now = Date.now,
}) {
  return async event => {
    if (event.resource !== path || event.requestContext?.stage !== 'production') return failure(404, 'NOT_FOUND');
    if (event.httpMethod === 'OPTIONS') return reply(204, null);
    if (event.httpMethod !== 'POST') return failure(405, 'METHOD_NOT_ALLOWED');
    if (env.ENVIRONMENT !== 'production' || env.AWS_REGION !== 'us-east-1' ||
        env.FINANCIAL_SESSION_TABLE !== sessionTable || !validOtpSecret(env.OTP_SECRET_ARN)) {
      return failure(503, 'PAYOUT_FINANCIAL_VERIFICATION_UNAVAILABLE');
    }
    const accessToken = header(event, 'access-token');
    const idToken = /^Bearer (\S+)$/i.exec(header(event, 'authorization') ?? '')?.[1];
    if (!accessToken || !idToken || /\s/.test(accessToken)) return failure(401, 'UNAUTHORIZED');
    let input;
    try {
      if (event.isBase64Encoded || typeof event.body !== 'string' || Buffer.byteLength(event.body) > 4096) throw Error();
      input = JSON.parse(event.body);
      if (!input || Array.isArray(input) || !actions.has(input.action)) throw Error();
    } catch { return failure(400, 'PAYOUT_FINANCIAL_INVALID_REQUEST'); }
    let owner;
    try {
      owner = await authenticateOwner(event, {verifyAccess, verifyId, getUser, getIdentity, now});
    } catch { return failure(401, 'UNAUTHORIZED'); }

    try {
      const service = createAccess({
        db, now, deduplicateGuards, financialSessionTable: sessionTable,
        payoutOtp: createOtp({getSecret, sendCode, secretArn: env.OTP_SECRET_ARN}),
      }, owner);
      return reply(200, await service.act(input));
    } catch (error) {
      if (error.message === 'UNAUTHORIZED' || error.name === 'NotAuthorizedException') return failure(401, 'UNAUTHORIZED');
      if (codes.has(error.code)) return failure(codes.get(error.code), error.code);
      if (['TransactionCanceledException', 'ConditionalCheckFailedException'].includes(error.name)) {
        return failure(409, 'PAYOUT_FINANCIAL_CHALLENGE_EXPIRED');
      }
      console.warn('Merchant verification unavailable', error.name);
      return failure(503, 'PAYOUT_FINANCIAL_VERIFICATION_UNAVAILABLE');
    }
  };
}

module.exports = {createHandler, path, sessionTable, authenticateOwner, header, createOtp, validOtpSecret};
