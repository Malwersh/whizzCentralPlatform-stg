'use strict';

const workflow = require('../../../backend/staff-service/merchant-staff-policy');
const audit = require('../../../backend/staff-service/audit-trail');
const {REGISTRY, rolePresets} = require('../../../backend/staff-service/staff-capabilities');
const {authenticateStaff} = require('../admin-session/live-admin.cjs');
const {capabilities} = require('../merchant-branch-finance/policy.cjs');

const table = 'wizz-production-PlatformStaff';
const policyCatalog = {
  requireBranchRead: true,
  registry: REGISTRY.filter(capability => capabilities.has(capability.id)),
  presets: rolePresets().map(preset => {
    const permissions = preset.permissions.filter(value => capabilities.has(value));
    const available = permissions.includes('wallet.settlements.read') || permissions.includes('orders.read');
    return {...preset, permissions, enabled: available, pendingPermissions: available ? []
      : preset.permissions.filter(value => !capabilities.has(value))};
  }),
};
const paths = new Map([[workflow.PATH, 'GET'], [workflow.PATH + '/history', 'GET'], [workflow.PATH + '/save', 'POST']]);
const reply = (statusCode, data) => ({statusCode, headers: {
  'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
}, body: JSON.stringify(data)});

function createApi(deps, env = process.env) {
  const {db, now = Date.now} = deps;
  return async event => {
    const path = event.resource;
    if (event.requestContext?.stage !== 'production' || !paths.has(path)) return reply(404, {error: 'NOT_FOUND'});
    if (paths.get(path) !== event.httpMethod) return reply(405, {error: 'METHOD_NOT_ALLOWED'});
    if (env.ENVIRONMENT !== 'production' || env.AWS_REGION !== 'us-east-1') {
      return reply(503, {error: 'STAFF_POLICY_UNAVAILABLE'});
    }
    try {
      const {actor, claims} = await authenticateStaff(event, deps, db, now, 'merchant_staff_policy.read', 'PERMISSION_REQUIRED');
      let input;
      if (event.httpMethod === 'POST') {
        try {
          if (event.isBase64Encoded || typeof event.body !== 'string' || Buffer.byteLength(event.body) > 65536) throw Error();
          input = JSON.parse(event.body);
        } catch { return reply(400, {error: 'INVALID_STAFF_POLICY_REQUEST'}); }
      }
      const guard = person => ({ConditionCheck: {TableName: table, Key: {pk: 'EMPLOYEE#' + person.employeeId, sk: 'PROFILE'},
        ConditionExpression: '#version=:version AND #status=:active',
        ExpressionAttributeNames: {'#version': 'version', '#status': 'status'},
        ExpressionAttributeValues: {':version': person.version, ':active': 'ACTIVE'},
      }});
      const result = await workflow.route({
        db, table, guard, enrolled: true, claims, policyCatalog, query: event.queryStringParameters,
        // The live verifier already confirms the current staff session and MFA.
        recent: () => {},
        audit: (id, action, before, after, requestId) => audit.write(table, actor, id, action, before, after, requestId),
      }, actor, event.httpMethod, path, input);
      return reply(200, result);
    } catch (error) {
      if (error.status) return reply(error.status, {error: error.message});
      console.warn('Merchant staff policy unavailable', error.name);
      return reply(503, {error: 'STAFF_POLICY_UNAVAILABLE'});
    }
  };
}

module.exports = {createApi, policyCatalog};
