'use strict';

const {authenticateStaff} = require('../admin-session/live-admin.cjs');
const schedules = require('../../../backend/staff-service/settlement-schedules');
const {actions} = require('../../../backend/staff-service/merchant-financial-access');
const {authenticateOwner, createOtp, header, sessionTable, validOtpSecret} =
  require('../merchant-financial-session/api.cjs');

const paths = Object.freeze({
  owner: '/auth/settlement-schedules',
  staff: '/staff/settlement-schedules',
  branches: '/staff/settlement-schedules/branches',
});
const tableAliases = new Map(Object.entries({
  'WhizzMerchants_Businesses': 'Merchants',
  'staging-AccountDeletion': 'AccountDeletion',
  'staging-MerchantPlatform': 'MerchantPlatform',
  'staging-PlatformStaff': 'PlatformStaff',
  'staging-Holds': 'Holds',
  'staging-Wallets': 'Wallets',
  'staging-LedgerEntries': 'LedgerEntries',
  'staging-AuditLog': 'AuditLog',
  'staging-WalletLifecycle': 'WalletLifecycle',
  'WizzOrders': 'Orders',
  'WaveOffers_staging': 'WaveOffers',
  'WizzDispatchJobs_staging': 'DispatchJobs',
}));
const tables = new Set([
  ...[...tableAliases.values()].map(name => 'wizz-production-' + name),
  sessionTable, 'wizz-production-PushDeviceTokens', 'wizz-production-WalletNotifications',
]);
const fail = (status, code) => { throw Object.assign(Error(code), {status}); };

function productionDb(db, deduplicate, {merchantDiscounts = false} = {}) {
  const discountTable = 'wizz-production-MerchantDiscounts';
  function tableName(name) {
    if (merchantDiscounts && ['WhizzMerchants_Discounts',discountTable].includes(name)) return discountTable;
    const target = tableAliases.has(name) ? 'wizz-production-' + tableAliases.get(name) : name;
    if (!tables.has(target)) throw Error('SETTLEMENT_TABLE_NOT_CONFIGURED');
    return target;
  }
  const bind = item => ({...item, TableName: tableName(item.TableName)});
  return {send(command) {
    const input = command.input;
    switch (command.constructor.name) {
      case 'GetCommand':
      case 'QueryCommand':
      case 'ScanCommand':
        return db.send(new command.constructor(bind(input)));
      case 'BatchGetCommand': {
        const requests = Object.entries(input.RequestItems).map(([name, value]) => [tableName(name), value]);
        if (requests.length !== new Set(requests.map(([name]) => name)).size) throw Error('SETTLEMENT_TABLE_ALIAS_CONFLICT');
        return db.send(new command.constructor({...input, RequestItems: Object.fromEntries(requests)}));
      }
      case 'TransactWriteCommand': {
        const operations = input.TransactItems.map(operation => {
          const [[kind, item]] = Object.entries(operation);
          return {[kind]: bind(item)};
        });
        // Two workflow guards can reference the same branch through different
        // binding names. Normalize those names before combining the conditions.
        const checks = deduplicate(operations.filter(item => item.ConditionCheck));
        const writes = operations.filter(item => !item.ConditionCheck);
        return db.send(new command.constructor({...input, TransactItems: [...checks, ...writes]}));
      }
      default:
        throw Error('SETTLEMENT_OPERATION_NOT_CONFIGURED');
    }
  }};
}

function readInput(event) {
  if (event.httpMethod === 'GET') {
    if (Object.values(event.multiValueQueryStringParameters || {}).some(values => values.length !== 1)) {
      fail(400, 'INVALID_SCHEDULE_REQUEST');
    }
    return event.queryStringParameters || {};
  }
  try {
    if (event.isBase64Encoded || typeof event.body !== 'string' || Buffer.byteLength(event.body) > 25000) throw Error();
    const input = JSON.parse(event.body);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error();
    return input;
  } catch { fail(400, 'INVALID_SCHEDULE_REQUEST'); }
}

function ownerInput(event, input) {
  if (Object.hasOwn(input, 'financialAccess') || actions.has(input.action)) fail(400, 'PAYOUT_FINANCIAL_INVALID_REQUEST');
  const value = header(event, 'x-financial-session');
  if (!value) fail(403, 'PAYOUT_FINANCIAL_UNLOCK_REQUIRED');
  try {
    const financialAccess = JSON.parse(value);
    if (!financialAccess || Object.keys(financialAccess).sort().join(',') !== 'deviceId,token' ||
        typeof financialAccess.deviceId !== 'string' || typeof financialAccess.token !== 'string') throw Error();
    return {...input, financialAccess};
  } catch { fail(400, 'PAYOUT_FINANCIAL_INVALID_REQUEST'); }
}

function createHandler(deps, audience, env = process.env) {
  if (!['owner', 'staff'].includes(audience)) throw Error('SETTLEMENT_AUDIENCE_NOT_CONFIGURED');
  const owner = audience === 'owner';
  const now = deps.now ?? Date.now;
  const db = productionDb(deps.db, deps.deduplicate);
  const headers = {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'};
  if (owner) Object.assign(headers, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization,Access-Token,Content-Type,X-Financial-Session',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  });
  const reply = (statusCode, result) => ({statusCode, headers, body: result === null ? '' : JSON.stringify(result)});
  const reject = (status, code) => reply(status, owner ? {code} : {error: code});

  return async event => {
    const branches = !owner && event.resource === paths.branches;
    if (event.requestContext?.stage !== 'production' || (!branches && event.resource !== paths[audience])) {
      return reject(404, 'NOT_FOUND');
    }
    const method = event.httpMethod;
    if (owner && method === 'OPTIONS') return reply(204, null);
    if (method !== 'GET' && (method !== 'POST' || branches)) return reject(405, 'METHOD_NOT_ALLOWED');
    if (env.ENVIRONMENT !== 'production' || env.PLATFORM_ENVIRONMENT !== 'production' ||
        env.AWS_REGION !== 'us-east-1' || env.FINANCIAL_SESSION_TABLE !== sessionTable ||
        !validOtpSecret(env.OTP_SECRET_ARN)) return reject(503, 'SETTLEMENT_SCHEDULE_UNAVAILABLE');
    try {
      const ctx = {db, enabled: true, now};
      if (owner) {
        let principal;
        try { principal = await authenticateOwner(event, {...deps, now}); } catch { fail(401, 'UNAUTHORIZED'); }
        const input = ownerInput(event, readInput(event));
        return reply(200, await schedules.owner({
          ...ctx, financialLockEnabled: true, financialSessionTable: sessionTable,
          payoutOtp: createOtp({...deps, secretArn: env.OTP_SECRET_ARN}),
          deduplicateGuards: deps.deduplicate, pushTokensTable: 'wizz-production-PushDeviceTokens',
        }, principal.subjectId, method, input, principal));
      }
      const {actor, claims} = await authenticateStaff(event, deps, db, now, 'finance.read');
      const route = branches ? schedules.branches : schedules.staff;
      return reply(200, await route({...ctx, claims, enrolled: true}, actor, method, readInput(event)));
    } catch (error) {
      const code = error.code || error.message;
      if (error.status && /^(?:INVALID_|ADMIN_|PAYOUT_|CORRECTION_|SCHEDULE_|SETTLEMENT_|MERCHANT_|UNAUTHORIZED$)/.test(code)) {
        return reject(error.status, code);
      }
      console.warn('Merchant settlement unavailable', error.name);
      return reject(503, 'SETTLEMENT_SCHEDULE_UNAVAILABLE');
    }
  };
}

module.exports = {createHandler, paths, productionDb};
