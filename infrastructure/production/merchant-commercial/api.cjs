'use strict';

const { GetCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const commercial = require('../../../backend/staff-service/commercial-management');
const fundingIndex = require('../../../backend/staff-service/commercial-funding-index');
const audit = require('../../../backend/staff-service/audit-trail');
const { allowed } = require('../driver-review/catalog');
const { identities } = require('../wallet-identity-bindings.json');

const tables = Object.freeze({
  platform: 'wizz-production-MerchantPlatform',
  staff: 'wizz-production-PlatformStaff',
  businesses: 'wizz-production-Merchants',
  deletion: 'wizz-production-AccountDeletion',
});
const discountTables = Object.freeze({
  MERCHANT:'wizz-production-MerchantDiscounts', PLATFORM:'wizz-production-PlatformDiscounts',
});
const staffPath = '/staff/merchants/agreements';
const ownerPath = '/auth/commercial-agreements';
const validId = v => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_:#.-]{0,149}$/.test(v);
const failure = (status, message) => Object.assign(new Error(message), { status });
const read = async (db, TableName, Key) => (await db.send(new GetCommand({ TableName, Key, ConsistentRead: true }))).Item;
const employee = (db, sub) => read(db, tables.staff, { pk: 'EMPLOYEE#' + sub, sk: 'PROFILE' });
const okStaff = (person, sub) => person?.employeeId === sub && person.status === 'ACTIVE' &&
  Number.isSafeInteger(person.version) && person.version > 0 && person.scope?.allRegions === true;
const guard = person => ({
  ConditionCheck: {
    TableName: tables.staff, Key: { pk: 'EMPLOYEE#' + person.employeeId, sk: 'PROFILE' },
    ConditionExpression: '#v=:v AND #s=:a',
    ExpressionAttributeNames: { '#v': 'version', '#s': 'status' },
    ExpressionAttributeValues: { ':v': person.version, ':a': 'ACTIVE' },
  },
});

function getHeader(event, name) {
  const selected = Object.entries(event.headers || {}).filter(([key]) => key.toLowerCase() === name);
  if (selected.length !== 1 || typeof selected[0][1] !== 'string' || selected[0][1].length > 8200) {
    throw failure(401, 'UNAUTHORIZED');
  }
  return selected[0][1];
}

async function verify(event, fn, audience, now, separateAccess = false) {
  const token = separateAccess ? getHeader(event, 'access-token')
    : /^Bearer\s+(\S+)$/i.exec(getHeader(event, 'authorization'))?.[1];
  if (!token) throw failure(401, 'UNAUTHORIZED');
  let claims;
  try { claims = await fn(token); } catch { throw failure(401, 'UNAUTHORIZED'); }
  const { poolId, clientId } = identities[audience];
  if (!validId(claims?.sub) || claims.iss !== 'https://cognito-idp.us-east-1.amazonaws.com/' + poolId ||
      claims.client_id !== clientId || claims.token_use !== 'access' || !Number.isFinite(claims.exp) ||
      claims.exp * 1000 <= now() || !Number.isSafeInteger(claims.auth_time) || claims.auth_time * 1000 > now()) {
    throw failure(401, 'UNAUTHORIZED');
  }
  return { claims, token };
}

function payload(event) {
  try {
    const input = event.httpMethod === 'GET' ? event.queryStringParameters
      : !event.isBase64Encoded && typeof event.body === 'string' && Buffer.byteLength(event.body) <= 18000 && JSON.parse(event.body);
    if (!input || typeof input !== 'object' || Array.isArray(input) || !validId(input.businessId) ||
        (event.httpMethod === 'GET' && (Object.keys(input).some(k => !['businessId','view'].includes(k)) ||
          Object.values(event.multiValueQueryStringParameters ?? {}).some(values=>values.length!==1)))) throw new Error();
    return input;
  } catch {
    throw failure(400, 'INVALID_COMMERCIAL_REQUEST');
  }
}

async function branchesFor(db, branch) {
  let cursor;
  const items = new Map();
  function add(row) {
    items.set(row.businessId, { id: row.businessId, name: row.businessName || row.name || 'فرع مسجّل' });
  }
  add(branch);
  do {
    const page = await db.send(new QueryCommand({
      TableName: tables.businesses, IndexName: 'ownerId-index',
      KeyConditionExpression: 'ownerId=:owner', ExpressionAttributeValues: { ':owner': branch.ownerId },
      ProjectionExpression: 'businessId', ExclusiveStartKey: cursor, Limit: 25,
    }));
    const options = await Promise.all((page.Items || []).map(item => read(db, tables.businesses, { businessId: item.businessId })));
    for (const row of options) {
      if (row?.ownerId === branch.ownerId && row.cognitoUserId === branch.ownerId &&
          row.organizationId === branch.organizationId && row.status === 'approved' &&
          !row.deletedAt && !row.isDeleted && !row.deletionRequestId) add(row);
    }
    cursor = page.LastEvaluatedKey;
    if (items.size > 200) throw failure(409, 'COMMERCIAL_LIST_TOO_LARGE');
  } while (cursor);
  return [...items.values()].sort((a, b) => a.name.localeCompare(b.name, 'ar'));
}

function createApi(deps, mode) {
  const { db, verifyAccess, liveIdentity, verifyMerchantId, now = Date.now } = deps;
  const owner = mode === 'owner';
  if (!owner && mode !== 'staff') throw Error('Invalid commercial identity');
  const expected = owner ? ownerPath : staffPath;
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  if (owner) Object.assign(headers, {
    'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization,Content-Type,Access-Token',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  });
  const reply = (statusCode, value) => ({ statusCode, headers, body: value === null ? '' : JSON.stringify(value) });
  return async event => {
    try {
      if (event.path !== expected || event.requestContext?.stage !== 'production') throw failure(404, 'NOT_FOUND');
      if (owner && event.httpMethod === 'OPTIONS') return reply(204, null);
      if (!['GET', 'POST'].includes(event.httpMethod)) throw failure(405, 'METHOD_NOT_ALLOWED');
      const { claims, token } = await verify(event, verifyAccess, owner ? 'merchant' : 'admin', now, owner);
      let actor;
      if (owner) {
        let idClaims, live;
        try {
          const idToken = /^Bearer\s+(\S+)$/i.exec(getHeader(event, 'authorization'))?.[1]
            || getHeader(event, 'authorization');
          [idClaims, live] = await Promise.all([verifyMerchantId(idToken), liveIdentity(token)]);
        } catch {
          throw failure(401, 'UNAUTHORIZED');
        }
        const attrs = Object.fromEntries((live.UserAttributes || []).map(x => [x.Name, x.Value]));
        if (idClaims?.sub !== claims.sub || attrs.sub !== claims.sub ||
            attrs.phone_number_verified !== 'true' || !attrs.phone_number ||
            attrs.phone_number !== idClaims.phone_number) throw failure(401, 'UNAUTHORIZED');
      } else {
        actor = await employee(db, claims.sub);
        if (!okStaff(actor, claims.sub) || (actor.minimumAuthTime || 0) > claims.auth_time ||
            !allowed(actor, 'commercial.read')) throw failure(403, 'PERMISSION_REQUIRED');
        const live = await liveIdentity(claims);
        if (!live?.Enabled || live.UserStatus !== 'CONFIRMED' ||
            live.UserAttributes?.find(x => x.Name === 'sub')?.Value !== claims.sub ||
            !live.UserMFASettingList?.includes('SOFTWARE_TOKEN_MFA')) throw failure(403, 'ADMIN_MFA_REQUIRED');
      }
      const principal = owner ? { kind: 'OWNER', sub: claims.sub } : { kind: 'STAFF', actor };
      const ctx = {
        db, enabled: true, agreementsOnly: true, goodsFundingEnabled: true, fundingQueueEnabled: true,
        fundingNoticesOutbox: 'wizz-production-WalletNotifications',
        allowAgreementSelfApproval: !owner, allowFundingSelfApproval: !owner, commercialTables: tables, discountTables,
        enrolled: true, recent: () => {}, claims, guard, employee: sub => employee(db, sub),
        now: () => new Date(now()).toISOString(),
        audit: (id, action, before, after, requestId) => audit.write(tables.staff,
          owner ? null : actor, owner ? id : actor.employeeId, action, before, after, requestId),
      };
      const query = event.queryStringParameters;
      if (event.httpMethod === 'GET' && ['funding-queue','funding-branches'].includes(query?.view)) {
        if (owner) throw failure(403,'PERMISSION_REQUIRED');
        if (Object.values(event.multiValueQueryStringParameters??{}).some(values=>values.length!==1))
          throw failure(400,'INVALID_COMMERCIAL_REQUEST');
        return reply(200,await (query.view==='funding-queue'?fundingIndex.list(ctx,actor,query):fundingIndex.branches(ctx,actor,query)));
      }
      const input = payload(event);
      const b = await read(db, tables.businesses, { businessId: input.businessId });
      if (b?.status !== 'approved' || b.isDeleted || b.deletedAt || b.deletionRequestId) throw failure(404, 'BUSINESS_UNAVAILABLE');
      const result = await commercial.service(ctx, principal, event.httpMethod, input);
      if (owner || event.httpMethod !== 'GET' || input.view!==undefined) return reply(200, result);
      return reply(200, { ...result, branches: await branchesFor(db, b) });
    } catch (error) {
      if (!error.status) console.warn(JSON.stringify({ event: 'MERCHANT_COMMERCIAL_FAILURE', name: error.name, requestId: event.requestContext?.requestId }));
      const status = error.status || 503;
      const code = error.status ? error.message : 'COMMERCIAL_UNAVAILABLE';
      return reply(status, owner ? { code, message: code } : { error: code });
    }
  };
}

module.exports = { createApi, tables, staffPath, ownerPath };
