'use strict';

const {GetCommand} = require('@aws-sdk/lib-dynamodb');
const {allowed} = require('../../../backend/staff-service/catalog');
const {identities} = require('../wallet-identity-bindings.json');
const fail = (status, code) => { throw Object.assign(Error(code), {status}); };
const validId = value => typeof value === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);

async function authenticateStaff(event, deps, db, now, permission, permissionError = 'SETTLEMENT_PERMISSION_REQUIRED',
  {allowRegional = false} = {}) {
  const values = Object.entries(event.headers ?? {}).filter(([name]) => name.toLowerCase() === 'authorization');
  const value = values.length === 1 ? values[0][1] : undefined;
  const token = typeof value === 'string' && value.length <= 8200 ? /^Bearer (\S+)$/i.exec(value)?.[1] : null;
  if (!token) fail(401, 'UNAUTHORIZED');
  let claims, live;
  try {
    claims = await deps.verifyStaff(token);
    const {poolId, clientId} = identities.admin;
    if (!validId(claims?.sub) || typeof claims.username !== 'string' ||
        claims.iss !== 'https://cognito-idp.us-east-1.amazonaws.com/' + poolId ||
        claims.client_id !== clientId || claims.token_use !== 'access' ||
        !Number.isSafeInteger(claims.exp) || claims.exp * 1000 <= now() ||
        !Number.isSafeInteger(claims.auth_time) || claims.auth_time * 1000 > now()) {
      fail(401, 'UNAUTHORIZED');
    }
    live = await deps.getStaff(claims.username);
  } catch (error) {
    if (error.status === 401 || ['JwtInvalidSignatureError', 'NotAuthorizedException', 'UserNotFoundException'].includes(error.name)) {
      fail(401, 'UNAUTHORIZED');
    }
    if (!claims) fail(401, 'UNAUTHORIZED');
    throw error;
  }
  if (live?.Enabled !== true || live.UserStatus !== 'CONFIRMED' || live.Username !== claims.username ||
      live.UserAttributes?.filter(x => x.Name === 'sub').map(x => x.Value).join(',') !== claims.sub) {
    fail(401, 'UNAUTHORIZED');
  }
  if (!live.UserMFASettingList?.includes('SOFTWARE_TOKEN_MFA')) fail(403, 'ADMIN_MFA_REQUIRED');
  const {Item: actor} = await db.send(new GetCommand({
    TableName: 'wizz-production-PlatformStaff', Key: {pk: 'EMPLOYEE#' + claims.sub, sk: 'PROFILE'}, ConsistentRead: true,
  }));
  const regional = allowRegional && actor?.scope?.allRegions === false && Array.isArray(actor.scope.regionIds) &&
    actor.scope.regionIds.length > 0;
  if (!actor || actor.employeeId !== claims.sub || actor.status !== 'ACTIVE' || (!regional && actor.scope?.allRegions !== true) ||
      !Number.isSafeInteger(actor.version) || actor.version < 1 || actor.deletedAt != null ||
      actor.deletionRequestId != null || actor.isDeleted === true ||
      !Number.isSafeInteger(actor.minimumAuthTime ?? 0) || (actor.minimumAuthTime ?? 0) < 0 ||
      (actor.minimumAuthTime ?? 0) > claims.auth_time ||
      !(Array.isArray(permission) ? permission.some(key => allowed(actor, key)) : allowed(actor, permission))) fail(403, permissionError);
  return {actor, claims};
}

module.exports = {authenticateStaff};
