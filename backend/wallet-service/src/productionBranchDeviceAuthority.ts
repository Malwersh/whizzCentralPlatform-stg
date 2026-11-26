import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import type { DeviceOrderAccess } from './productionMerchantOrderResponses';
import { checkoutTables } from './checkoutTables';
import type { FinancialRow as Row } from './driverFinancialTransaction';
import { quoteHash } from './deliveryQuoteRecord';

const devices = require('../merchant-runtime/functions/auth/branch_devices');
type Database = Pick<DynamoDBDocumentClient, 'send'>;
const fail = (status: number, code: string): never => { throw Object.assign(Error(code), {status}); };

function header(event: Row, name: string): string | undefined {
  const matched = Object.entries(event.headers ?? {}).filter(([key]) => key.toLowerCase() === name);
  if (!matched.length) return undefined;
  const value = matched[0][1];
  if (matched.length !== 1 || typeof value !== 'string' || value.length > 512) return fail(401, 'DEVICE_REVOKED');
  return value;
}

export function createDeviceAuthority(db: Database, env = process.env, now = Date.now) {
  return async (event: Row, branchId: string, required: readonly string[], allowReception = false): Promise<DeviceOrderAccess> => {
    if (env.MERCHANT_STAFF_PERMISSION_MODE !== 'CENTRAL' || process.env.MERCHANT_STAFF_PERMISSION_MODE !== 'CENTRAL') {
      fail(503, 'STAFF_POLICY_UNAVAILABLE');
    }
    const tables = checkoutTables(env);
    const aliases: Record<string, string> = {
      'WhizzMerchants_Businesses': tables.branches, 'staging-MerchantPlatform': tables.platform,
      'staging-PlatformStaff': tables.policy, 'staging-AccountDeletion': tables.deletion,
    };
    const tableFor = (name: string) => {
      if (!Object.prototype.hasOwnProperty.call(aliases, name)) throw Error('DEVICE_TABLE_SCOPE_INVALID');
      return aliases[name];
    };
    const read = {send(command: Row) {
      if (command.constructor.name !== 'GetCommand' || !command.input.ConsistentRead) throw Error('DEVICE_READ_SCOPE_INVALID');
      return db.send(new GetCommand({...command.input, TableName: tableFor(command.input.TableName)} as any));
    }};
    const tag = /^Bearer ([\w-]{1,150}:[a-f0-9-]{36}:[\w-]{43})$/.exec(header(event,'authorization') ?? '')?.[1];
    if (!tag) fail(401,'DEVICE_REVOKED');
    const session = header(event,'x-staff-session');
    if (!session && !allowReception) fail(401,'SESSION_REVOKED');
    if (tag!.split(':')[0] !== branchId) fail(403,'BRANCH_SCOPE_REQUIRED');
    const {b,d} = await devices.reception(read, tag);
    if (b.businessId !== branchId || b.deletedAt != null || b.isDeleted === true) fail(403,'BUSINESS_UNAVAILABLE');
    const at = Math.floor(now()/1000);
    const device = devices.check(d, ' AND #deviceStatus=:deviceActive AND expiresAt>:deviceNow', {
      ':deviceNow': at, ':deviceActive': 'ACTIVE',
    });
    device.ConditionCheck.ExpressionAttributeNames['#deviceStatus'] = 'status';
    const guards = [...devices.guards(b), device];
    const actor = {kind: 'MERCHANT' as const, subjectId: b.ownerId, businessId: branchId, ownerId: b.ownerId, guards};
    const scope = [b.ownerId, branchId, d.deviceId, d.version];
    const mapGuards = () => {
      actor.guards = guards.map(({ConditionCheck: op}) => ({ConditionCheck: {...op, TableName: tableFor(op.TableName)}}));
    };
    if (session === undefined) {
      mapGuards();
      return {actor, deviceId: d.deviceId, deviceVersion: d.version, deviceExpiresAt: d.expiresAt,
        receptionOnly: true, scopeHash: quoteHash(scope)};
    }
    const {s, m, authorization, common} = await devices.employeeAccess(read, {headers:{'X-Staff-Session':session}}, {b,d});
    if (s.ownerId !== b.ownerId || !Number.isSafeInteger(s.maxExpiresAt) || s.maxExpiresAt <= at) fail(401,'SESSION_REVOKED');
    if (!authorization?.permissions.includes('branch.read') || !required.every(permission => authorization.permissions.includes(permission))) {
      fail(403,'PERMISSION_REQUIRED');
    }
    actor.subjectId = s.subjectId;
    guards.push(...common);
    mapGuards();
    return {
      actor, deviceId: d.deviceId, receptionOnly: false, sessionId: s.sessionId,
      scopeHash: quoteHash([...scope, s.sessionId, s.subjectId, m.version, s.pinVersion, authorization.policy.version]),
      actorName: m.displayName ?? '', roleName: m.grant.roleNameAr,
      permissions: authorization.permissions,
      membershipVersion: m.version, policyVersion: authorization.policy.version,
    };
  };
}
