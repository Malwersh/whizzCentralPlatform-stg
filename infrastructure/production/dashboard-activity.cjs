'use strict';

const {ScanCommand} = require('@aws-sdk/lib-dynamodb');
const {authenticateStaff} = require('./admin-session/live-admin.cjs');
const {allowed} = require('../../backend/staff-service/catalog');
const {additionalMetrics} = require('./dashboard-metric-sources.cjs');

const path = '/staff/dashboard/activity';
const metricPermissions = {support: 'support.metrics', offers: 'promotions.read', revenue: 'finance.read'};
const maxPages = 8;
const pageSize = 500;
const dayMs = 24 * 60 * 60 * 1000;
const baghdadCalendar = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Baghdad', year: 'numeric', month: '2-digit', day: '2-digit',
});
const closedRecords = '(attribute_not_exists(isDeleted) OR isDeleted <> :yes) AND ' +
  '(attribute_not_exists(deletedAt) OR deletedAt = :null) AND ' +
  '(attribute_not_exists(deletionRequestId) OR deletionRequestId = :null)';

function metricQueries(at) {
  const today = baghdadCalendar.format(at);
  const start = Date.parse(today + 'T00:00:00+03:00');
  const active = {':yes': true, ':null': null};
  return {
    orders: {
      TableName: 'wizz-production-Orders',
      FilterExpression: 'begins_with(PK, :order) AND SK = :meta AND createdAt >= :start AND createdAt < :end AND ' +
        closedRecords + ' AND (attribute_not_exists(deletionStatus) OR deletionStatus = :null)',
      ExpressionAttributeValues: {
        ...active, ':order': 'ORDER#', ':meta': 'META',
        ':start': new Date(start).toISOString(), ':end': new Date(start + dayMs).toISOString(),
      },
    },
    branches: {
      TableName: 'wizz-production-Merchants',
      FilterExpression: '#status = :approved AND isActive = :yes AND ' + closedRecords,
      ExpressionAttributeNames: {'#status': 'status'},
      ExpressionAttributeValues: {...active, ':approved': 'approved'},
    },
    drivers: {
      TableName: 'wizz-production-DriverLiveState',
      FilterExpression: '#status = :available AND isActive = :yes AND isSearching = :yes AND ' +
        '(attribute_not_exists(currentOrderId) OR currentOrderId = :null) AND ' +
        '(attribute_not_exists(activeOrdersCount) OR activeOrdersCount = :zero OR activeOrdersCount = :null) AND ' +
        'locationUpdatedAt > :cutoff AND locationUpdatedAt <= :now',
      ExpressionAttributeNames: {'#status': 'status'},
      ExpressionAttributeValues: {
        ...active, ':available': 'available', ':zero': 0,
        ':cutoff': new Date(at - 120_000).toISOString(), ':now': new Date(at).toISOString(),
      },
    },
    customers: {
      TableName: 'wizz-production-Customers',
      FilterExpression: closedRecords,
      ExpressionAttributeValues: active,
    },
  };
}

function metricSources(at) {
  const queries = metricQueries(at);
  const {':start': start, ':end': end} = queries.orders.ExpressionAttributeValues;
  return {
    ...Object.fromEntries(Object.entries(queries).map(([name, query]) => [name, [{query}]])),
    ...additionalMetrics(at, start, end),
  };
}

async function measureSource(db, {query, accumulate}, abortSignal) {
  let cursor;
  let value = 0n;
  for (let page = 0; page < maxPages; page++) {
    const result = await db.send(new ScanCommand({
      ...query, ...(accumulate ? {} : {Select: 'COUNT'}), Limit: pageSize, ExclusiveStartKey: cursor,
    }), {abortSignal});
    if (accumulate) {
      for (const row of result.Items ?? []) value += accumulate(row);
    } else {
      if (!Number.isSafeInteger(result.Count) || result.Count < 0) throw Error('Invalid count');
      value += BigInt(result.Count);
    }
    cursor = result.LastEvaluatedKey;
    if (!cursor || !Object.keys(cursor).length) return {value, complete: true};
  }
  return {value, complete: false};
}

async function measureMetric(db, sources, abortSignal) {
  const results = await Promise.all(sources.map(source => measureSource(db, source, abortSignal)));
  const value = Number(results.reduce((total, result) => total + result.value, 0n));
  if (!Number.isSafeInteger(value)) throw Error('Metric precision unavailable');
  return {value, complete: results.every(result => result.complete)};
}

const reply = (statusCode, body) => ({
  statusCode, headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}, body: JSON.stringify(body),
});

function createHandler({db, verifyStaff, getStaff, apiId, now = Date.now}) {
  const cache = new Map();
  return async event => {
    if (!apiId || event?.requestContext?.apiId !== apiId || event.requestContext.stage !== 'production' ||
        event.httpMethod !== 'GET' || event.resource !== path) return reply(404, {error: 'NOT_FOUND'});
    const headers = Object.entries(event.multiValueHeaders ?? {})
      .filter(([name]) => name.toLowerCase() === 'authorization');
    if (headers.length > 1 || (headers.length === 1 && headers[0][1]?.length !== 1)) {
      return reply(401, {error: 'UNAUTHORIZED'});
    }
    try {
      const {actor} = await authenticateStaff(
        event, {verifyStaff, getStaff}, db, now, 'dashboard.read', 'DASHBOARD_PERMISSION_REQUIRED',
      );
      const at = now();
      const today = baghdadCalendar.format(at);
      const abortSignal = AbortSignal.timeout(5_000);
      const permitted = Object.entries(metricSources(at)).filter(([name]) =>
        !Object.hasOwn(metricPermissions, name) || allowed(actor, metricPermissions[name]));
      const results = await Promise.all(permitted.map(async ([name, sources]) => {
        let entry = cache.get(name);
        if (entry?.today !== today || at - entry.at >= 20_000) {
          const data = measureMetric(db, sources, abortSignal).catch(error => {
            console.warn('Dashboard metric unavailable', name, error.name);
            return null;
          });
          entry = {today, at, data};
          cache.set(name, entry);
        }
        const value = await entry.data;
        if (value === null && cache.get(name) === entry) cache.delete(name);
        return {name, value, at: entry.at};
      }));
      const measuredAt = new Date(Math.min(...results.map(result => result.at))).toISOString();
      return reply(200, {metrics: Object.fromEntries(results.map(({name, value}) => [name, value])), measuredAt});
    } catch (error) {
      if (error.status) return reply(error.status, {error: error.message});
      console.error('Dashboard activity unavailable', error.name);
      return reply(503, {error: 'DASHBOARD_ACTIVITY_UNAVAILABLE'});
    }
  };
}

const {CognitoJwtVerifier} = require('aws-jwt-verify');
const {DynamoDBClient} = require('@aws-sdk/client-dynamodb');
const {DynamoDBDocumentClient} = require('@aws-sdk/lib-dynamodb');
const {CognitoIdentityProviderClient, AdminGetUserCommand} = require('@aws-sdk/client-cognito-identity-provider');
const {identities} = require('./wallet-identity-bindings.json');
const {poolId, clientId} = identities.admin;
const verifier = CognitoJwtVerifier.create({userPoolId: poolId, clientId, tokenUse: 'access'});
const config = {region: 'us-east-1', maxAttempts: 2};
const cognito = new CognitoIdentityProviderClient(config);
const handler = createHandler({
  db: DynamoDBDocumentClient.from(new DynamoDBClient(config)),
  apiId: process.env.DASHBOARD_API_ID,
  verifyStaff: token => verifier.verify(token),
  getStaff: username => cognito.send(new AdminGetUserCommand({UserPoolId: poolId, Username: username})),
});

module.exports = {createHandler, handler, metricSources, measureMetric};
