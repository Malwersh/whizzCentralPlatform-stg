'use strict';

const branchStaff = require('staging-branch-staff');
const branchDevices = require('staging-branch-devices');
const branchPairing = require('staging-branch-pairing');
const delegatedPayouts = require('../../../backend/staff-service/merchant-device-payouts');
const { productionDb } = require('../merchant-settlements/api.cjs');
const { authenticateOwner, header } = require('../merchant-financial-session/api.cjs');
const { capabilities } = require('./policy.cjs');
const { GetCommand } = require('@aws-sdk/lib-dynamodb');

const paths = Object.freeze({
  staff: '/auth/branch-staff',
  devices: '/auth/branch-devices',
  session: '/branch-device',
  finance: '/branch-device/settlements',
});
const sessionActions = new Set([
  'reception', 'unlock', 'profile', 'touch', 'lock', 'disconnect',
  'discounts_list', 'discounts_create', 'discounts_update', 'discounts_status', 'discounts_delete',
]);
const fail = (status, code) => { throw Object.assign(Error(code), {status}); };
const allowedError = /^(?:INVALID_|PERMISSION_|MEMBERSHIP_|DEVICE_|SESSION_|RECENT_|STAFF_|ACCOUNT_|BUSINESS_|BRANCH_|OWNER_|OWNERSHIP_|SELF_|PAIRING_|PHONE_|PIN_|PERSON_|EXPLICIT_|LEGACY_|PAYOUT_|SETTLEMENT_|POLICY_|ROLE_|INVITATION_|REQUEST_|VERSION_|DISCOUNT_|SHARED_DISCOUNT_|CAMPAIGN_RETENTION_HOLD$|UNKNOWN_ACTION$|UNAUTHORIZED$)/;

function productionPhone(value) {
  const normalized = String(value ?? '')
    .replace(/[٠-٩]/g, char => char.charCodeAt(0) - 1632)
    .replace(/[۰-۹]/g, char => char.charCodeAt(0) - 1776)
    .replace(/[\s()-]/g, '');
  if (/^07\d{9}$/.test(normalized)) return '+964' + normalized.slice(1);
  if (/^\+?9647\d{9}$/.test(normalized)) return '+' + normalized.replace(/^\+/, '');
  fail(400, 'INVALID_PHONE');
}

function inputFrom(event) {
  if (event.httpMethod === 'GET') {
    if (Object.values(event.multiValueQueryStringParameters ?? {}).some(values => values.length !== 1)) fail(400, 'INVALID_STAFF_REQUEST');
    return event.queryStringParameters ?? {};
  }
  try {
    if (event.isBase64Encoded || typeof event.body !== 'string' || Buffer.byteLength(event.body) > 25000) throw Error();
    const input = JSON.parse(event.body);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error();
    return input;
  } catch { fail(400, 'INVALID_STAFF_REQUEST'); }
}

function deviceEvent(event) {
  const authorization = header(event, 'authorization');
  const token = /^Bearer ([\w-]{1,150}:[a-f0-9-]{36}:[\w-]{43})$/.exec(authorization ?? '')?.[1];
  if (!token) fail(401, 'DEVICE_REVOKED');
  const session = header(event, 'x-staff-session');
  return {token, session, normalized: {...event, headers: {Authorization: 'Bearer ' + token, 'X-Staff-Session': session}}};
}

function createHandler(deps, audience, env = process.env) {
  const now = deps.now ?? Date.now;
  const db = productionDb(deps.db, deps.deduplicate, {merchantDiscounts:audience === 'access'});
  const headers = {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'};
  const reply = (statusCode, result) => ({statusCode, headers, body: JSON.stringify(result)});

  return async event => {
    const resource = event.resource;
    if (event.requestContext?.stage !== 'production' ||
        !(audience === 'finance' ? resource === paths.finance : [paths.staff, paths.devices, paths.session].includes(resource))) {
      return reply(404, {code: 'NOT_FOUND'});
    }
    if (env.ENVIRONMENT !== 'production' || env.AWS_REGION !== 'us-east-1' || env.MERCHANT_STAFF_PERMISSION_MODE !== 'CENTRAL') {
      return reply(503, {code: 'STAFF_SERVICE_UNAVAILABLE'});
    }
    try {
      const method = event.httpMethod;
      if (resource === paths.finance || resource === paths.session) {
        if (method !== 'POST') fail(405, 'METHOD_NOT_ALLOWED');
        const {token, session, normalized} = deviceEvent(event);
        const input = inputFrom(event);
        if (resource === paths.finance) {
          if (Object.keys(input).sort().join(',') !== 'action,httpMethod,input' || input.action !== 'settlements' ||
              !['GET', 'POST'].includes(input.httpMethod)) fail(400, 'PAYOUT_INVALID_REQUEST');
          if (!/^[-a-f0-9]{36}:[\w-]{43}$/.test(session ?? '')) fail(401, 'SESSION_REVOKED');
          const response = await delegatedPayouts.handle({db, enabled: true}, {
            action: 'merchant_device_payout', deviceToken: token, staffSession: session,
            httpMethod: input.httpMethod, input: input.input,
          });
          return reply(response.statusCode, response.statusCode === 200 ? response.result : {
            code: allowedError.test(response.code) ? response.code : 'PAYOUT_UNAVAILABLE',
          });
        }
        if (!sessionActions.has(input.action)) fail(400, 'UNKNOWN_ACTION');
        const result = await branchDevices.runtime(db, normalized, input);
        if (input.action === 'reception') return reply(200, {...result, ordersEnabled: true});
        if (input.action === 'profile') {
          // Return only the tasks served by the production device routes.
          return reply(200, {...result, capabilities: {
            read: result.capabilities.read, readOrders: result.capabilities.readOrders,
            readMenu: result.capabilities.readMenu, createProduct: result.capabilities.createProduct,
            deleteProduct: result.capabilities.deleteProduct, editProductInfo: result.capabilities.editProductInfo,
            editProductPrice: result.capabilities.editProductPrice,
            editProductAvailability: result.capabilities.editProductAvailability,
            editMenu: result.capabilities.editMenu,
            readHours: result.capabilities.readHours, editHours: result.capabilities.editHours,
            readDiscounts: result.capabilities.readDiscounts, createDiscounts: result.capabilities.createDiscounts,
            editDiscounts: result.capabilities.editDiscounts, activateDiscounts: result.capabilities.activateDiscounts,
            deleteDiscounts: result.capabilities.deleteDiscounts,
            readSettlements: result.capabilities.readSettlements,
            requestPayout: result.capabilities.requestPayout, receivePayout: result.capabilities.receivePayout,
          }, staff: {...result.staff, permissions: result.staff.permissions.filter(permission => capabilities.has(permission))}});
        }
        return reply(200, result);
      }
      if (!['GET', 'POST'].includes(method)) fail(405, 'METHOD_NOT_ALLOWED');
      let principal, attrs, cognitoUser;
      try {
        principal = await authenticateOwner(event, {...deps, now, async getUser(token) {
          cognitoUser = await deps.getUser(token);
          return cognitoUser;
        }});
        attrs = await principal.revalidate();
        if (attrs.phone_number_verified !== 'true' || !Number.isSafeInteger(principal.authTime) ||
            principal.authTime * 1000 > now()) throw Error();
      } catch { fail(401, 'UNAUTHORIZED'); }
      const deleting = await db.send(new GetCommand({
        TableName: 'wizz-production-AccountDeletion',
        Key: {pk: 'ACCOUNT_LIFECYCLE#MERCHANT#' + principal.subjectId, sk: 'META'},
        ConsistentRead: true, ProjectionExpression: 'pk',
      }));
      if (deleting.Item) fail(403, 'ACCOUNT_CLOSING');
      const input = inputFrom(event);
      const normalized = {...event, queryStringParameters: method === 'GET' ? input : undefined};
      const context = {
        db, sub: principal.subjectId, phone: productionPhone, cognito: deps.cognito,
        identity: {claims: {auth_time: principal.authTime}, user: {
          Username: cognitoUser.Username,
          UserAttributes: Object.entries(attrs).map(([Name, Value]) => ({Name, Value})),
        }},
      };
      return reply(200, await (resource === paths.staff ? branchStaff.route : branchPairing.route)(context, normalized, input));
    } catch (error) {
      const code = error.code || error.message;
      if (Number.isSafeInteger(error.status) && (allowedError.test(code) || code === 'METHOD_NOT_ALLOWED')) {
        return reply(error.status, {code});
      }
      console.warn('Merchant branch finance unavailable', error.name);
      return reply(503, {code: 'STAFF_SERVICE_UNAVAILABLE'});
    }
  };
}

module.exports = {createHandler, paths, capabilities};
