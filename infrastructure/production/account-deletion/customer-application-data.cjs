'use strict';

const { ScanCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { purge: purgeQuotes } = require('../../../backend/account-deletion/customer-delivery-quotes');
const { error } = require('../../../backend/account-deletion/policy');
const { tables } = require('./evidence.cjs');
const { customerExecutionChecks } = require('./customer-execution-scope.cjs');

const personalSources = [
  { table: 'wizz-production-Addresses', key: 'addressId', owner: 'userId' },
  { table: 'wizz-production-Favorites', key: 'favoriteId', owner: 'userId' },
  { table: 'wizz-production-PushDeviceTokens', key: 'token', owner: 'subjectId', role: { field: 'app', value: 'user' } },
];

async function purgeCustomerApplicationData({ db, request, job, clock = Date.now, maxPages = 100 }) {
  customerExecutionChecks(request, job, clock());
  const { subjectId } = request;
  const discovered = [];
  for (const source of personalSources) {
    const { table, key, owner, role } = source;
    const names = { '#owner': owner, ...(role ? { '#role': role.field } : {}) };
    const values = { ':owner': subjectId, ...(role ? { ':role': role.value } : {}) };
    const matches = '#owner=:owner' + (role ? ' AND #role=:role' : '');
    let cursor;
    let pages = 0;
    do {
      const { Items = [], LastEvaluatedKey } = await db.send(new ScanCommand({
        TableName: table, ConsistentRead: true, ExclusiveStartKey: cursor, Limit: 250,
        FilterExpression: matches, ExpressionAttributeNames: { ...names, '#key': key },
        ProjectionExpression: ['#key', ...Object.keys(names), 'legalHold', 'retentionHold'].join(', '),
        ExpressionAttributeValues: values,
      }));
      for (const row of Items) {
        if (typeof row[key] !== 'string' || !row[key] || row[owner] !== subjectId ||
            (role && row[role.field] !== role.value)) throw error('INVALID_CLEANUP_SCOPE');
        if (row.legalHold || row.retentionHold) throw error('DOCUMENTED_RETENTION_HOLD');
      }
      if (Items.length) discovered.push({ source, matches, names, values, items: Items });
      cursor = LastEvaluatedKey;
      if (++pages >= maxPages && cursor) throw error('INVENTORY_INCOMPLETE');
    } while (cursor);
  }

  await purgeQuotes({
    db, r: request, job, requestTable: tables.deletion, environment: 'production',
    clock: () => new Date(clock()).toISOString(), maxPages,
  });
  for (const { source, matches, names, values, items } of discovered) {
    for (let offset = 0; offset < items.length; offset += 25) {
      const deletions = items.slice(offset, offset + 25).map(row => ({ Delete: {
        TableName: source.table, Key: { [source.key]: row[source.key] },
        ConditionExpression: matches +
          ' AND (attribute_not_exists(legalHold) OR legalHold=:no) AND (attribute_not_exists(retentionHold) OR retentionHold=:no)',
        ExpressionAttributeNames: names, ExpressionAttributeValues: { ...values, ':no': false },
      } }));
      await db.send(new TransactWriteCommand({ TransactItems: [
        ...customerExecutionChecks(request, job, clock()),
        ...deletions,
      ] }));
    }
  }
}

module.exports = { purgeCustomerApplicationData };
