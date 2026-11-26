'use strict';

const {CognitoJwtVerifier} = require('aws-jwt-verify');
const {CognitoIdentityProviderClient, AdminGetUserCommand} = require('@aws-sdk/client-cognito-identity-provider');
const {DynamoDBClient} = require('@aws-sdk/client-dynamodb');
const sdk = require('@aws-sdk/lib-dynamodb');
const {createAuthenticator} = require('./merchant-profile/authenticate.cjs');
const {authenticateStaff} = require('./admin-session/live-admin.cjs');
const {createRegionResolver} = require('../../backend/region-management/covered-region-entry');
const {createRegions, TABLES} = require('./merchant-branches/regions.cjs');
const {createBusinessChanges} = require('./merchant-business-changes.cjs');
const {identities} = require('./wallet-identity-bindings.json');

const ownerPath = '/auth/business-changes';
const staffPath = '/staff/merchants/changes';
const headers = {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'};
const reply = (statusCode, body) => ({statusCode, headers, body: JSON.stringify(body)});
const conflicts = new Set(['CHANGE_BASE_CONFLICT', 'REQUEST_NOT_PENDING', 'OWNERSHIP_CHANGED', 'BRANCH_NOT_EDITABLE']);
const messages = {
  CHANGE_BASE_CONFLICT: 'تغيّرت بيانات الفرع. حدّث الصفحة قبل إرسال الطلب.',
  BUSINESS_UNAVAILABLE: 'هذه الخدمة متاحة للمالك الحالي للفرع.',
  BUSINESS_CLOSING: 'هذا الفرع لديه إجراء إغلاق قيد التنفيذ.',
  LOCATION_OUTSIDE_REGION: 'اختر نقطة داخل حدود المنطقة المحددة.',
  REGION_DELIVERY_UNAVAILABLE: 'التوصيل غير متاح في المنطقة المحددة.',
  REGION_UNAVAILABLE: 'المنطقة المحددة لم تعد متاحة.',
};

function createHandler({db, regions, verifyStaff, getStaff, authenticateOwner, apiId, now = Date.now}) {
  const service = createBusinessChanges({db, regions, now});
  return async event => {
    const path = event?.resource;
    const method = event?.httpMethod;
    if (!apiId || event?.requestContext?.apiId !== apiId || event.requestContext.stage !== 'production' ||
        ![ownerPath, staffPath].includes(path) || !['GET', 'POST'].includes(method)) {
      return reply(404, {error: 'NOT_FOUND'});
    }
    const owner = path === ownerPath;
    try {
      const identity = owner ? await authenticateOwner(event) :
        (await authenticateStaff(event, {verifyStaff, getStaff}, db, now,
          'merchants.read', 'PERMISSION_REQUIRED', {allowRegional: true})).actor;
      const query = event.queryStringParameters ?? {};
      if (Object.values(event.multiValueQueryStringParameters ?? {}).some(value => value.length !== 1)) {
        return reply(400, {error: 'INVALID_QUERY'});
      }
      let input;
      if (method === 'POST') {
        if (event.isBase64Encoded || typeof event.body !== 'string' || Buffer.byteLength(event.body) > 8000) {
          return reply(400, {error: 'INVALID_BODY'});
        }
        try { input = JSON.parse(event.body); }
        catch { return reply(400, {error: 'INVALID_BODY'}); }
        if (!input || typeof input !== 'object' || Array.isArray(input)) return reply(400, {error: 'INVALID_BODY'});
      }
      return reply(200, owner
        ? await service.owner(identity.sub, method, query, input)
        : await service.staff(identity, method, query, input));
    } catch (error) {
      const status = error.status ?? (conflicts.has(error.code) ? 409 : error.code ? 400 : 503);
      const code = status < 500 ? error.code ?? error.message : 'MERCHANT_CHANGE_UNAVAILABLE';
      if (status === 503) console.warn('Merchant business changes unavailable', error.name);
      return reply(status, owner
        ? {code, message: messages[code] ?? (status === 401 ? 'يرجى تسجيل الدخول.' : 'تعذّر إكمال الطلب. حاول مجددًا.')}
        : {error: code});
    }
  };
}

const options = {region: 'us-east-1', maxAttempts: 2};
const db = sdk.DynamoDBDocumentClient.from(new DynamoDBClient(options), {marshallOptions: {removeUndefinedValues: true}});
const cognito = new CognitoIdentityProviderClient(options);
const admin = identities.admin;
const verifier = CognitoJwtVerifier.create({userPoolId: admin.poolId, clientId: admin.clientId, tokenUse: 'access'});
const regions = createRegions({db, sdk, resolveCoverage: createRegionResolver({db, sdk, tables: TABLES})});
const handler = createHandler({
  db, regions, apiId: process.env.MERCHANT_CHANGES_API_ID,
  verifyStaff: token => verifier.verify(token),
  getStaff: username => cognito.send(new AdminGetUserCommand({UserPoolId: admin.poolId, Username: username})),
  authenticateOwner: createAuthenticator({cognito, AdminGetUserCommand}),
});

module.exports = {createHandler, handler};
