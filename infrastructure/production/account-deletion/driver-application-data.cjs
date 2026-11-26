'use strict';

const { GetCommand, ScanCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { DeleteConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');
const { exact } = require('../../../backend/account-deletion/cod-retention');
const { error } = require('../../../backend/account-deletion/policy');
const { driverExecutionChecks } = require('./customer-execution-scope.cjs');

const connectionsTable = 'wizz-production-OrderConnections';
const liveTable = 'wizz-production-DriverLiveState';
const driverSources = [
  { table:'wizz-production-PushDeviceTokens', key:'token', owner:'subjectId', role:'app' },
  { table:'wizz-production-WalletNotifications', key:'eventId', owner:'driverId', role:'recipientApp' },
];

function validateLiveState(row, subjectId) {
  if (!row) return;
  if (row.driverId !== subjectId) throw error('INVALID_CLEANUP_SCOPE');
  if (row.legalHold || row.retentionHold) throw error('DOCUMENTED_RETENTION_HOLD');
  if (row.currentOrderId != null || (row.activeOrdersCount != null && row.activeOrdersCount !== 0)) {
    throw error('ACTIVE_ORDER_AFTER_LOCK');
  }
}

async function driverConnections(db, subjectId, maxPages) {
  const audience = 'DRIVER#' + subjectId;
  const rows = [];
  let cursor;
  for (let page = 0; page < maxPages; page++) {
    const result = await db.send(new ScanCommand({
      TableName: connectionsTable, ConsistentRead: true, Limit: 250, ExclusiveStartKey: cursor,
      FilterExpression: 'audience=:audience OR (#scope.#role=:driver AND #scope.subjectId=:subject)',
      ExpressionAttributeNames: { '#scope':'scope', '#role':'role' },
      ExpressionAttributeValues: { ':audience':audience, ':driver':'driver', ':subject':subjectId },
    }));
    for (const row of result.Items ?? []) {
      if (row.audience !== audience || row.scope?.role !== 'driver' || row.scope.subjectId !== subjectId ||
          (row.identityScope346 && (row.identityScope346.role !== 'DRIVER' ||
           row.identityScope346.subjectId !== subjectId || row.identityScope346.driverId !== subjectId)) ||
          typeof row.connectionId !== 'string' || !/^[A-Za-z0-9_=/+-]{1,150}$/.test(row.connectionId)) {
        throw error('INVALID_CLEANUP_SCOPE');
      }
      if (row.legalHold || row.retentionHold) throw error('DOCUMENTED_RETENTION_HOLD');
      rows.push(row);
    }
    cursor = result.LastEvaluatedKey;
    if (!cursor) return rows;
  }
  throw error('INVENTORY_INCOMPLETE');
}

async function disconnectDriver({ db, orderSocket, request, job, clock, connections }) {
  for (const row of connections) {
    const Key = { connectionId: row.connectionId };
    const snapshot = exact(row);
    await db.send(new TransactWriteCommand({ TransactItems:[
      ...driverExecutionChecks(request, job, clock()),
      { ConditionCheck:{ TableName:connectionsTable, Key, ...snapshot } },
    ] }));
    try {
      await orderSocket.send(new DeleteConnectionCommand({ ConnectionId:row.connectionId }));
    } catch (cause) {
      if (cause.name !== 'GoneException' && cause.$metadata?.httpStatusCode !== 410) throw cause;
    }
    await db.send(new TransactWriteCommand({ TransactItems:[
      ...driverExecutionChecks(request, job, clock()),
      { Delete:{ TableName:connectionsTable, Key, ...snapshot,
        ConditionExpression:'attribute_not_exists(#connection) OR ('+snapshot.ConditionExpression+')',
        ExpressionAttributeNames:{ ...snapshot.ExpressionAttributeNames, '#connection':'connectionId' },
      } },
    ] }));
  }
}

async function purgeDriverApplicationData({ db, orderSocket, request, job, clock = Date.now, maxPages = 100 }) {
  driverExecutionChecks(request, job, clock());
  const { subjectId } = request;
  const liveKey = { driverId:subjectId };
  const { Item: live } = await db.send(new GetCommand({
    TableName:liveTable, Key:liveKey, ConsistentRead:true,
  }));
  validateLiveState(live, subjectId);
  const connections = await driverConnections(db, subjectId, maxPages);
  if (connections.length && !orderSocket) throw error('DRIVER_SOCKET_NOT_CONFIGURED');
  const deletes = [];
  for (const { table, key, owner, role } of driverSources) {
    let cursor, pages=0;
    do {
      const { Items = [], LastEvaluatedKey } = await db.send(new ScanCommand({
        TableName:table, ConsistentRead:true, Limit:250, ExclusiveStartKey:cursor,
        FilterExpression:'#owner=:subject AND #role=:driver',
        ProjectionExpression:'#key,#owner,#role,legalHold,retentionHold',
        ExpressionAttributeNames:{ '#key':key, '#owner':owner, '#role':role },
        ExpressionAttributeValues:{ ':subject':subjectId, ':driver':'driver' },
      }));
      for (const row of Items) {
        if (typeof row[key] !== 'string' || !row[key] || row[owner] !== subjectId || row[role] !== 'driver') {
          throw error('INVALID_CLEANUP_SCOPE');
        }
        if (row.legalHold || row.retentionHold) throw error('DOCUMENTED_RETENTION_HOLD');
        deletes.push({ Delete:{ TableName:table, Key:{ [key]:row[key] }, ...exact(row) } });
      }
      cursor = LastEvaluatedKey;
      if (++pages >= maxPages && cursor) throw error('INVENTORY_INCOMPLETE');
    } while (cursor);
  }
  if (live) {
    const fields = ['driverId','currentOrderId','activeOrdersCount','updatedAt','connectionId','version'];
    const snapshot = Object.fromEntries(fields.map(field=>[field,live[field]]));
    deletes.push({ Delete:{ TableName:liveTable, Key:liveKey, ...exact(snapshot) } });
  }
  for (let offset = 0; offset < deletes.length; offset += 25) {
    await db.send(new TransactWriteCommand({ TransactItems:[
      ...driverExecutionChecks(request, job, clock()), ...deletes.slice(offset,offset+25),
    ] }));
  }
  await disconnectDriver({ db, orderSocket, request, job, clock, connections });
}

module.exports = { purgeDriverApplicationData };
