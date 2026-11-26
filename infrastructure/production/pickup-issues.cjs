'use strict';

const { CognitoIdentityProviderClient } = require('@aws-sdk/client-cognito-identity-provider');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, QueryCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { authenticateFinancialIdentity } = require('../../backend/wallet-service/src/financialIdentity');
const { createExceptionStaffAuthority } = require('../../backend/wallet-service/src/exceptionStaffAuthority');
const { financialOrderTables } = require('../../backend/wallet-service/src/walletBindings');
const { allowed } = require('../../backend/staff-service/catalog');
const audit = require('../../backend/staff-service/audit-trail');
const { route, view } = require('../../backend/staff-service/pickup-issue-workflow');
const { recordPickupIssue } = require('../../../whizzDrivers-stg/backend/driver-pickup-issues');

const driverPath = '/driver/orders/{orderId}/issue';
const staffPath = '/staff/pickup-issues';
const partition = 'PICKUP_ISSUE_OPEN';
const orderIdPattern = /^[A-Za-z0-9][A-Za-z0-9_.:#-]{0,149}$/;
const reportIdPattern = /^[-A-Za-z0-9]{8,80}$/;
const headers = {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'};
const reply = (statusCode, value) => ({statusCode, headers, body: JSON.stringify(value)});
const unavailable = () => reply(503, {error: 'PICKUP_ISSUE_SERVICE_UNAVAILABLE'});
const reject = (message, status) => { throw Object.assign(Error(message), {status}); };

function queueKey(orderId, report) {
  return {pk: partition, sk: report.reportedAt + '#' + orderId + '#' + report.id};
}

async function listOpenReports(db, tables, cursor, options) {
  const {now, ...access} = options;
  let start;
  if (cursor !== undefined) {
    try {
      if (typeof cursor !== 'string' || cursor.length > 1000) throw Error();
      const {employee, key} = JSON.parse(Buffer.from(cursor, 'base64url'));
      if (employee !== access.currentEmployeeId || key?.pk !== partition ||
          typeof key.sk !== 'string' || key.sk.length > 280) throw Error();
      start = {pk: partition, sk: key.sk};
    } catch {
      reject('PICKUP_WORKFLOW_CURSOR_INVALID', 400);
    }
  }
  const page = await db.send(new QueryCommand({
    TableName: tables.staff, ConsistentRead: true, ScanIndexForward: false, Limit: 20,
    KeyConditionExpression: 'pk = :pk', ExpressionAttributeValues: {':pk': partition},
    ExclusiveStartKey: start,
  }));
  const rows = await Promise.all((page.Items ?? []).map(async entry => {
    if (!orderIdPattern.test(entry.orderId ?? '') || !reportIdPattern.test(entry.reportId ?? '')) return null;
    const [order, workflow] = await Promise.all([
      db.send(new GetCommand({
        TableName: tables.orders, ConsistentRead: true, Key: {PK: 'ORDER#' + entry.orderId, SK: 'META'},
      })),
      db.send(new GetCommand({
        TableName: tables.staff, ConsistentRead: true,
        Key: {pk: 'PICKUP_ISSUE#' + entry.orderId, sk: 'REPORT#' + entry.reportId},
      })),
    ]);
    if (order.Item?.orderId !== entry.orderId || order.Item.deletedAt != null ||
        order.Item.deletionRequestId != null || order.Item.isDeleted === true ||
        workflow.Item?.status === 'CLOSED') return null;
    const report = order.Item.pickupIssueReports?.find(item => item.id === entry.reportId);
    return report ? view(order.Item, report, workflow.Item, now) : null;
  }));
  const nextCursor = page.LastEvaluatedKey
    ? Buffer.from(JSON.stringify({employee: access.currentEmployeeId, key: page.LastEvaluatedKey})).toString('base64url')
    : null;
  return {items: rows.filter(Boolean), nextCursor, ...access};
}

function createHandler({db, cognito}) {
  return async event => {
    if (process.env.ENVIRONMENT !== 'production' || event?.requestContext?.stage !== 'production') {
      return reply(404, {error: 'NOT_FOUND'});
    }
    const api = event.requestContext.apiId;
    const driver = event.resource === driverPath && api === process.env.PICKUP_DRIVER_API_ID;
    if (!(driver && event.httpMethod === 'POST') &&
        !(event.resource === staffPath && api === process.env.PICKUP_STAFF_API_ID && ['POST', 'GET'].includes(event.httpMethod))) {
      return reply(404, {error: 'NOT_FOUND'});
    }
    const authorization = Object.entries(event.headers ?? {}).filter(([name]) => name.toLowerCase() === 'authorization');
    const multiple = Object.entries(event.multiValueHeaders ?? {}).filter(([name]) => name.toLowerCase() === 'authorization');
    const value = authorization[0]?.[1];
    const token = authorization.length === 1 && multiple.length <= 1 &&
      (!multiple.length || (Array.isArray(multiple[0][1]) && multiple[0][1].length === 1 && multiple[0][1][0] === value)) &&
      typeof value === 'string' && value.length <= 16000
      ? /^Bearer ([\w-]+\.[\w-]+\.[\w-]+)$/i.exec(value)?.[1] : null;
    if (!token) return reply(401, {error: 'UNAUTHORIZED'});
    try {
      const tables = financialOrderTables();
      let input = event.queryStringParameters ?? {};
      if (event.httpMethod === 'POST') {
        if (event.isBase64Encoded || typeof event.body !== 'string' || Buffer.byteLength(event.body) > 8000) {
          reject('PICKUP_WORKFLOW_INVALID', 400);
        }
        try { input = JSON.parse(event.body); }
        catch { reject('PICKUP_WORKFLOW_INVALID', 400); }
        if (!input || typeof input !== 'object' || Array.isArray(input)) reject('PICKUP_WORKFLOW_INVALID', 400);
      } else if (Object.values(event.multiValueQueryStringParameters ?? {}).some(values => values.length !== 1)) {
        reject('PICKUP_WORKFLOW_INVALID', 400);
      }

      if (driver) {
        const {subjectId} = await authenticateFinancialIdentity(cognito, token, 'DRIVER');
        const orderId = event.pathParameters?.orderId;
        if (typeof orderId !== 'string' || !orderIdPattern.test(orderId)) reject('PICKUP_WORKFLOW_INVALID', 400);
        const recorded = await recordPickupIssue({
          db, GetCommand, table: tables.orders, driverId: subjectId, orderId, body: input,
          writeReport: (update, report) => db.send(new TransactWriteCommand({TransactItems: [
            {ConditionCheck: {
              TableName: process.env.ACCOUNT_DELETION_TABLE,
              Key: {pk: 'ACCOUNT_LIFECYCLE#DRIVER#' + subjectId, sk: 'META'},
              ConditionExpression: 'attribute_not_exists(pk)',
            }},
            {Update: update},
            {Put: {
              TableName: tables.staff, ConditionExpression: 'attribute_not_exists(pk)',
              Item: {...queueKey(orderId, report), orderId, reportId: report.id},
            }},
          ]})),
        });
        return reply(recorded.statusCode, recorded.result);
      }

      const authority = createExceptionStaffAuthority({db, cognito, accessToken: token});
      const actor = await authority.authenticate();
      const {employee, guard} = await authority.read(actor);
      const result = await route({
        db, tables, allowed, enrolled: true, recent: () => {}, guard: () => guard,
        audit: (id, action, before, after, requestId) => audit.write(tables.staff, employee, id, action, before, after, requestId),
        listOpenReports: (cursor, options) => listOpenReports(db, tables, cursor, options),
        closeReport: (orderId, report) => ({Delete: {TableName: tables.staff, Key: queueKey(orderId, report)}}),
      }, employee, event.httpMethod, input);
      return reply(200, result);
    } catch (error) {
      if (['UNAUTHORIZED', 'NotAuthorizedException', 'UserNotFoundException'].includes(error?.code ?? error?.name) ||
          error?.message === 'UNAUTHORIZED') return reply(401, {error: 'UNAUTHORIZED'});
      if (['EXCEPTION_EMPLOYEE_UNAVAILABLE', 'EXCEPTION_PERMISSION_REQUIRED'].includes(error?.code)) {
        return reply(403, {error: 'PERMISSION_REQUIRED'});
      }
      if (Number.isInteger(error?.status)) return reply(error.status, {error: error.message});
      console.error('Pickup issue service failed', error?.name);
      return unavailable();
    }
  };
}

const aws = {region: 'us-east-1', maxAttempts: 2};
const db = DynamoDBDocumentClient.from(new DynamoDBClient(aws), {marshallOptions: {removeUndefinedValues: true}});
module.exports = {handler: createHandler({db, cognito: new CognitoIdentityProviderClient(aws)}), createHandler};
