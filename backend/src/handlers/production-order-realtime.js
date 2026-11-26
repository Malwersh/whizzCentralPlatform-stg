'use strict';
const { forwardOrderEvents } = require('../../driver-performance-projection/order-forwarder');

const { CognitoJwtVerifier } = require('aws-jwt-verify');
const { AdminGetUserCommand, CognitoIdentityProviderClient } = require('@aws-sdk/client-cognito-identity-provider');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand, DeleteCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
const { unmarshall } = require('@aws-sdk/util-dynamodb');
const identityConfig = require('../../../infrastructure/production/wallet-identity-bindings.json').identities;

const tables = {
  connections: 'wizz-production-OrderConnections', orders: 'wizz-production-Orders',
  customers: 'wizz-production-Customers', branches: 'wizz-production-Merchants',
  drivers: 'wizz-production-Drivers', driverLive: 'wizz-production-DriverLiveState', lifecycle: 'wizz-production-AccountDeletion',
};
const accounts = { customer: 'CUSTOMER', merchant: 'MERCHANT', driver: 'DRIVER' };
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,150}$/.test(value);
const connectionKey = value => typeof value === 'string' && /^[A-Za-z0-9_=/+-]{1,150}$/.test(value);
const get = async (db, TableName, Key) => (await db.send(new GetCommand({
  TableName, Key, ConsistentRead: true,
}))).Item;
const response = (statusCode, code) => ({ statusCode, body: JSON.stringify({ code }) });

function createVerifier(cognito) {
  const pools = Object.keys(accounts).map(role => ({
    role, userPoolId: identityConfig[role].poolId, clientId: identityConfig[role].clientId,
  }));
  const verifier = CognitoJwtVerifier.create(pools.map(({ userPoolId, clientId }) => ({
    userPoolId, clientId, tokenUse: null,
  })));
  return async token => {
    const claims = await verifier.verify(token);
    const pool = pools.find(item => claims.iss === 'https://cognito-idp.us-east-1.amazonaws.com/' + item.userPoolId);
    const username = claims['cognito:username'] || claims.username;
    if (!pool || !identifier(claims.sub) || typeof username !== 'string' || !username || username.length > 128) {
      throw Error('INVALID_REALTIME_IDENTITY');
    }
    const person = await cognito.send(new AdminGetUserCommand({ UserPoolId: pool.userPoolId, Username: username }));
    const identities = (person.UserAttributes || []).filter(attribute => attribute.Name === 'sub');
    if (person.Enabled !== true || person.UserStatus !== 'CONFIRMED' || identities.length !== 1 || identities[0].Value !== claims.sub) {
      throw Error('INVALID_REALTIME_IDENTITY');
    }
    return { role: pool.role, subjectId: claims.sub, expiresAt: claims.exp };
  };
}

function tokenFrom(event) {
  const auth = Object.entries(event.headers || {}).filter(([key]) => key.toLowerCase() === 'authorization');
  const legacy = event.queryStringParameters?.token;
  if (auth.length > 1 || (auth.length && legacy !== undefined)) return null;
  const token = auth.length ? /^Bearer ([\w.-]+)$/.exec(auth[0][1])?.[1] : legacy;
  return typeof token === 'string' && token.length <= 8192 && /^[\w-]+\.[\w-]+\.[\w-]+$/.test(token) ? token : null;
}

function unavailable(row) {
  return !row || row.isActive === false || row.isDeleted === true || !!row.deletedAt || !!row.deletionRequestId;
}
const activeDriver = row => !unavailable(row) && row.isActive === true &&
  row.isBanned !== true && row.isSuspended !== true && row.isVerified === true &&
  ['APPROVED', 'VERIFIED'].includes(String(row.status || row.registrationStatus).toUpperCase());

async function validScope(db, scope, now) {
  if (!scope || !identifier(scope.subjectId) || !Number.isSafeInteger(scope.expiresAt) || scope.expiresAt <= now ||
      !Object.hasOwn(accounts, scope.role)) return false;
  const deletion = await get(db, tables.lifecycle, { pk: 'ACCOUNT_LIFECYCLE#' + accounts[scope.role] + '#' + scope.subjectId, sk: 'META' });
  if (deletion) return false;
  if (scope.role === 'customer') {
    const person = await get(db, tables.customers, { userId: scope.subjectId });
    return !unavailable(person) && person.userId === scope.subjectId &&
      (person.cognitoSub === undefined || person.cognitoSub === scope.subjectId);
  }
  if (scope.role === 'driver') {
    const person = await get(db, tables.drivers, { driverId: scope.subjectId });
    return activeDriver(person) && person.driverId === scope.subjectId &&
      (person.cognitoSub === undefined || person.cognitoSub === scope.subjectId);
  }
  if (!identifier(scope.businessId)) return false;
  const [branch, lifecycle] = await Promise.all([
    get(db, tables.branches, { businessId: scope.businessId }),
    get(db, tables.lifecycle, { pk: 'BUSINESS_LIFECYCLE#MERCHANT#' + scope.businessId, sk: 'META' }),
  ]);
  return !unavailable(branch) && !lifecycle && branch.businessId === scope.businessId &&
    branch.ownerId === scope.subjectId && branch.cognitoUserId === scope.subjectId &&
    ['approved', 'active'].includes(branch.status);
}

function audience(scope) {
  if (scope.role === 'customer') return 'CUSTOMER#' + scope.subjectId;
  if (scope.role === 'driver') return 'DRIVER#' + scope.subjectId;
  return 'MERCHANT#' + scope.businessId;
}

function matches(scope, order) {
  if (!order || order.isDeleted === true || order.deletedAt || order.deletionRequestId) return false;
  if (scope.role === 'customer') {
    return order.userSub === scope.subjectId && order.userId === scope.subjectId && order.isGuestOrder !== true &&
      (scope.orderId === undefined || scope.orderId === order.orderId);
  }
  if (scope.role === 'merchant') {
    return (order.storeId ?? order.businessId) === scope.businessId;
  }
  return (order.driverId ?? order.assignedDriverId) === scope.subjectId &&
    (order.driverId == null || order.assignedDriverId == null || order.driverId === order.assignedDriverId);
}

const orderById = (db, orderId) => get(db, tables.orders, { PK: 'ORDER#' + orderId, SK: 'META' });

function updateMessage(order, isNewForMerchant = false) {
  return {
    type: isNewForMerchant ? 'NEW_ORDER' : 'order_update',
    orderId: order.orderId, status: order.status, updatedAt: order.updatedAt || order.createdAt,
    ...(typeof order.estimatedDeliveryTime === 'string' ? { estimatedDeliveryTime: order.estimatedDeliveryTime } : {}),
  };
}

async function registerDriverConnection(db, connectionId, scope, time) {
  const driverId = scope.subjectId;
  const activeCondition = {
    TableName: tables.drivers, Key: { driverId },
    ConditionExpression: 'isActive=:yes AND isVerified=:yes AND (#status IN (:approved,:verified) OR (attribute_not_exists(#status) AND registrationStatus IN (:approved,:verified))) AND (attribute_not_exists(cognitoSub) OR cognitoSub=:driver) AND attribute_not_exists(deletionRequestId) AND attribute_not_exists(deletedAt) AND (attribute_not_exists(isDeleted) OR isDeleted=:no) AND (attribute_not_exists(isBanned) OR isBanned=:no) AND (attribute_not_exists(isSuspended) OR isSuspended=:no)',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: { ':driver': driverId, ':yes': true, ':no': false, ':approved': 'APPROVED', ':verified': 'VERIFIED' },
  };
  await db.send(new TransactWriteCommand({ TransactItems: [
    { ConditionCheck: activeCondition },
    { ConditionCheck: {
      TableName: tables.lifecycle, Key: { pk: 'ACCOUNT_LIFECYCLE#DRIVER#' + driverId, sk: 'META' },
      ConditionExpression: 'attribute_not_exists(pk)',
    } },
    { ConditionCheck: {
      TableName: tables.connections, Key: { connectionId },
      ConditionExpression: 'isActive=:yes AND #scope=:scope',
      ExpressionAttributeNames: { '#scope': 'scope' },
      ExpressionAttributeValues: { ':yes': true, ':scope': scope },
    } },
    { Update: {
      TableName: tables.driverLive, Key: { driverId },
      UpdateExpression: 'SET connectionId=:connection, connectionStatus=:connected, lastConnected=:at',
      ExpressionAttributeValues: { ':connection': connectionId, ':connected': 'connected', ':at': new Date(time * 1000).toISOString() },
    } },
  ] }));
}

async function removeDriverConnection(db, driverId, connectionId) {
  try {
    await db.send(new UpdateCommand({
      TableName: tables.driverLive, Key: { driverId },
      ConditionExpression: 'connectionId=:connection',
      UpdateExpression: 'SET connectionStatus=:disconnected REMOVE connectionId',
      ExpressionAttributeValues: { ':connection': connectionId, ':disconnected': 'disconnected' },
    }));
  } catch (error) {
    if (error.name !== 'ConditionalCheckFailedException') throw error;
  }
}

function createGateway({ db, verify, send, now = () => Math.floor(Date.now() / 1000) }) {
  return async event => {
    const { connectionId, routeKey, stage } = event?.requestContext || {};
    if (stage !== 'production' || !connectionKey(connectionId)) return response(400, 'INVALID_REALTIME_REQUEST');
    if (routeKey === '$disconnect') {
      const old = await get(db, tables.connections, { connectionId });
      await db.send(new DeleteCommand({ TableName: tables.connections, Key: { connectionId } }));
      if (old?.scope?.role === 'driver' && identifier(old.scope.subjectId)) {
        await removeDriverConnection(db, old.scope.subjectId, connectionId);
      }
      return response(200, 'DISCONNECTED');
    }
    if (routeKey === '$connect') {
      const token = tokenFrom(event);
      if (!token) return response(401, 'AUTH_REQUIRED');
      let identity;
      try { identity = await verify(token); }
      catch { return response(401, 'AUTH_REQUIRED'); }
      const query = event.queryStringParameters || {};
      const scope = { ...identity, expiresAt: Math.min(identity.expiresAt, now() + 7200) };
      if (scope.role === 'merchant') scope.businessId = query.businessId;
      if (scope.role === 'customer' && query.orderId !== undefined) {
        if (!identifier(query.orderId)) return response(403, 'FORBIDDEN');
        scope.orderId = query.orderId;
      }
      if ((scope.role === 'driver' && query.driverId !== undefined && query.driverId !== scope.subjectId) ||
          !await validScope(db, scope, now())) return response(403, 'FORBIDDEN');
      if (scope.orderId && !matches(scope, await orderById(db, scope.orderId))) return response(403, 'FORBIDDEN');
      const identityScope346 = { version: 1, role: accounts[scope.role], subjectId: scope.subjectId,
        expiresAt: scope.expiresAt, ...(scope.role === 'driver' ? { driverId: scope.subjectId } : {}) };
      const registration = { TableName: tables.connections, Item: {
        connectionId, audience: audience(scope), scope, identityScope346, isActive: true, ttl: scope.expiresAt,
      }, ConditionExpression: 'attribute_not_exists(connectionId)' };
      if (scope.role === 'driver') {
        try {
          await db.send(new TransactWriteCommand({ TransactItems: [
            { ConditionCheck: {
              TableName: tables.lifecycle, Key: { pk: 'ACCOUNT_LIFECYCLE#DRIVER#' + scope.subjectId, sk: 'META' },
              ConditionExpression: 'attribute_not_exists(pk)',
            } },
            { Put: registration },
          ] }));
        } catch (error) {
          if (error.name !== 'TransactionCanceledException') throw error;
          return response(403, 'FORBIDDEN');
        }
      } else await db.send(new PutCommand(registration));
      return response(200, 'CONNECTED');
    }
    if (routeKey !== '$default' || event.isBase64Encoded || typeof event.body !== 'string' ||
        Buffer.byteLength(event.body) > 16384) return response(400, 'INVALID_REALTIME_REQUEST');
    let input;
    try { input = JSON.parse(event.body); } catch { return response(400, 'INVALID_REALTIME_REQUEST'); }
    const row = await get(db, tables.connections, { connectionId });
    const scope = row?.scope;
    if (!row?.isActive || !await validScope(db, scope, now())) return response(403, 'FORBIDDEN');
    const action = input?.action || input?.type;
    if (scope.role === 'driver' &&
        [input?.driverId, input?.userId].some(id => id != null && id !== scope.subjectId)) {
      return response(403, 'FORBIDDEN');
    }
    if (action === 'authenticate') {
      if (scope.role === 'driver') {
        try { await registerDriverConnection(db, connectionId, scope, now()); }
        catch (error) {
          if (error.name !== 'TransactionCanceledException') throw error;
          return response(403, 'FORBIDDEN');
        }
      }
      await send(connectionId, { type: 'auth_success', userType: scope.role });
      return response(200, 'OK');
    }
    if (scope.role === 'driver' && ['driver_status','subscribe_driver_offers'].includes(action)) {
      await send(connectionId, { type: 'driver_status_response' });
      return response(200, 'OK');
    }
    if (['ping', 'heartbeat'].includes(action)) {
      await send(connectionId, { type: action === 'ping' ? 'pong' : 'heartbeat_response' });
      return response(200, 'OK');
    }
    if (['subscribe_order','unsubscribe_order','get_order_status'].includes(action)) {
      const orderId = input.orderId ?? input.order_id;
      if (!identifier(orderId) || (input.orderId != null && input.order_id != null && input.orderId !== input.order_id)) {
        return response(400, 'INVALID_REALTIME_REQUEST');
      }
      if (row.unsubscribed && action === 'get_order_status') return response(403, 'FORBIDDEN');
      const order = await orderById(db, orderId);
      if (!matches(scope, order)) return response(403, 'FORBIDDEN');
      if (action !== 'get_order_status' && scope.orderId !== undefined) {
        await db.send(new UpdateCommand({ TableName: tables.connections, Key: { connectionId },
          ConditionExpression: 'attribute_exists(connectionId) AND #scope=:scope',
          UpdateExpression: 'SET unsubscribed=:unsubscribed', ExpressionAttributeNames: { '#scope': 'scope' },
          ExpressionAttributeValues: { ':scope': scope, ':unsubscribed': action === 'unsubscribe_order' } }));
      }
      if (action !== 'unsubscribe_order') await send(connectionId, updateMessage(order));
      return response(200, 'OK');
    }
    return response(400, 'UNSUPPORTED_REALTIME_ACTION');
  };
}

function createBroadcast({ db, send, streamArn, dispatchReady, forwardPerformance, forwardKitchen, now = () => Math.floor(Date.now() / 1000) }) {
  return async ({ Records = [] }) => {
    const jobs = new Map();
    const performanceEvents = [];
    const kitchenEvents = [];
    for (const record of Records) {
      if (record.eventSource !== 'aws:dynamodb' || record.eventSourceARN !== streamArn ||
          !['INSERT','MODIFY'].includes(record.eventName)) continue;
      const next = record.dynamodb?.NewImage && unmarshall(record.dynamodb.NewImage);
      const previous = record.dynamodb?.OldImage && unmarshall(record.dynamodb.OldImage);
      if (!identifier(next?.orderId) || next.PK !== 'ORDER#' + next.orderId || next.SK !== 'META' ||
          typeof next.status !== 'string') continue;
      if (forwardPerformance) performanceEvents.push(record);
      if (forwardKitchen) {
        const fields = ['PK', 'SK', 'businessId', 'storeId', 'merchantId'];
        const project = image => Object.fromEntries(fields.filter(key => image?.[key] !== undefined).map(key => [key, image[key]]));
        kitchenEvents.push({ eventSource: record.eventSource, eventSourceARN: record.eventSourceARN,
          eventName: record.eventName, dynamodb: { NewImage: project(record.dynamodb.NewImage),
            OldImage: project(record.dynamodb.OldImage), SequenceNumber: record.dynamodb.SequenceNumber } });
      }
      if (dispatchReady && record.eventName === 'MODIFY' && previous &&
          next.status === 'ready_for_pickup' && previous.status !== 'ready_for_pickup' &&
          previous.orderStatus !== 'ready_for_pickup' && next.deliveryJobId == null) {
        const fields = ['PK','SK','orderId','status','orderStatus','storeId','businessId',
          'financialSearch','deliveryJobId','financialRelease','excludedDrivers'];
        const NewImage = Object.fromEntries(fields.filter(key => record.dynamodb.NewImage[key] !== undefined)
          .map(key => [key, record.dynamodb.NewImage[key]]));
        for (const field of ['financialSnapshot','commercialPricing']) {
          if (next[field] != null) NewImage[field] = { BOOL: true };
        }
        const OldImage = Object.fromEntries(['status','orderStatus'].filter(key => record.dynamodb.OldImage[key] !== undefined)
          .map(key => [key, record.dynamodb.OldImage[key]]));
        await dispatchReady({ eventSource: record.eventSource, eventSourceARN: record.eventSourceARN,
          eventName: record.eventName, eventID: record.eventID,
          dynamodb: { Keys: record.dynamodb.Keys, SequenceNumber: record.dynamodb.SequenceNumber, NewImage, OldImage },
        });
      }
      if (previous && ['status','driverId','assignedDriverId','estimatedDeliveryTime'].every(field => previous[field] === next[field])) continue;
      const job = jobs.get(next.orderId) || {};
      jobs.set(next.orderId, { isNew: job.isNew || record.eventName === 'INSERT' });
    }
    if (performanceEvents.length) await forwardPerformance(performanceEvents);
    let sent = 0;
    for (const [orderId, { isNew }] of jobs) {
      const order = await orderById(db, orderId);
      if (!order || order.orderId !== orderId) continue;
      const groups = [
        ['CUSTOMER', order.userSub], ['MERCHANT', order.storeId ?? order.businessId],
        ['DRIVER', order.driverId ?? order.assignedDriverId],
      ];
      for (const [kind, target] of groups) {
        if (!identifier(target)) continue;
        let cursor;
        do {
          const page = await db.send(new QueryCommand({ TableName: tables.connections, IndexName: 'Audience',
            KeyConditionExpression: 'audience=:audience', ExpressionAttributeValues: { ':audience': kind + '#' + target },
            ExclusiveStartKey: cursor }));
          const candidates = page.Items || [];
          for (let index = 0; index < candidates.length; index += 16) {
            await Promise.all(candidates.slice(index, index + 16).map(async item => {
              const row = await get(db, tables.connections, { connectionId: item.connectionId });
              if (!row?.isActive || row.unsubscribed || !matches(row.scope, order) ||
                  !await validScope(db, row.scope, now())) return;
              try {
                await send(row.connectionId, updateMessage(order, isNew && kind === 'MERCHANT'));
                sent++;
              } catch (error) {
                if (error.name !== 'GoneException' && error.$metadata?.httpStatusCode !== 410) throw error;
                await db.send(new DeleteCommand({ TableName: tables.connections, Key: { connectionId: row.connectionId } }));
              }
            }));
          }
          cursor = page.LastEvaluatedKey;
        } while (cursor);
      }
    }
    if (kitchenEvents.length) await forwardKitchen(kitchenEvents);
    return { orders: jobs.size, sent };
  };
}

function dependencies() {
  const url = process.env.REALTIME_MANAGEMENT_URL;
  if (process.env.ENVIRONMENT !== 'production' || process.env.AWS_REGION !== 'us-east-1' ||
      !/^https:\/\/[a-z0-9]+\.execute-api\.us-east-1\.amazonaws\.com\/production$/.test(url || '')) {
    throw Error('REALTIME_NOT_CONFIGURED');
  }
  const client = new ApiGatewayManagementApiClient({ endpoint: url, maxAttempts: 2 });
  return {
    db: DynamoDBDocumentClient.from(new DynamoDBClient({ maxAttempts: 2 }), { marshallOptions: { removeUndefinedValues: true } }),
    send: (ConnectionId, message) => client.send(new PostToConnectionCommand({ ConnectionId, Data: Buffer.from(JSON.stringify(message)) })),
  };
}

let gateway, broadcast;
exports.gateway = event => {
  gateway ??= createGateway({ ...dependencies(), verify: createVerifier(new CognitoIdentityProviderClient({ maxAttempts: 2 })) });
  return gateway(event);
};
exports.broadcast = event => {
  const streamArn = process.env.ORDER_STREAM_ARN;
  if (!/^arn:aws:dynamodb:us-east-1:746727375268:table\/wizz-production-Orders\/stream\/[\w.:-]+$/.test(streamArn || '')) {
    throw Error('REALTIME_STREAM_NOT_CONFIGURED');
  }
  const workerArn=process.env.PRODUCTION_DISPATCH_WORKER_ARN;
  if (workerArn && workerArn !== 'arn:aws:lambda:us-east-1:746727375268:function:wizz-production-dispatch-cycle') {
    throw Error('DISPATCH_WORKER_NOT_CONFIGURED');
  }
  const collectorArn=process.env.PRODUCTION_PERFORMANCE_COLLECTOR_ARN;
  if (collectorArn && collectorArn !== 'arn:aws:lambda:us-east-1:746727375268:function:wizz-production-driver-performance-collector') {
    throw Error('PERFORMANCE_COLLECTOR_NOT_CONFIGURED');
  }
  const kitchenArn=process.env.PRODUCTION_KITCHEN_PROJECTION_ARN;
  if (kitchenArn && kitchenArn !== 'arn:aws:lambda:us-east-1:746727375268:function:wizz-production-hosted-kitchen-projection') {
    throw Error('KITCHEN_PROJECTION_NOT_CONFIGURED');
  }
  if (!broadcast) {
    const lambda=(workerArn || collectorArn || kitchenArn) ? new LambdaClient({ maxAttempts: 2 }) : null;
    const dispatchReady=workerArn ? async record => {
      const invocation=await lambda.send(new InvokeCommand({ FunctionName: workerArn, InvocationType: 'Event',
        Payload: Buffer.from(JSON.stringify({ Records: [record] })) }));
      if (invocation.StatusCode!==202 || invocation.FunctionError) throw Error('DISPATCH_WORKER_INVOCATION_FAILED');
    } : undefined;
    const forwardPerformance=collectorArn ? Records => forwardOrderEvents({ Records },
      input => lambda.send(new InvokeCommand(input)), { streamArn, target: collectorArn }) : undefined;
    const forwardKitchen=kitchenArn ? async Records => {
      const result=await lambda.send(new InvokeCommand({ FunctionName: kitchenArn, InvocationType: 'Event',
        Payload: Buffer.from(JSON.stringify({ Records })) }));
      if(result.StatusCode!==202||result.FunctionError)throw Error('KITCHEN_PROJECTION_INVOCATION_FAILED');
    } : undefined;
    broadcast=createBroadcast({ ...dependencies(), streamArn, dispatchReady, forwardPerformance, forwardKitchen });
  }
  return broadcast(event);
};
exports.createGateway = createGateway;
exports.createBroadcast = createBroadcast;
