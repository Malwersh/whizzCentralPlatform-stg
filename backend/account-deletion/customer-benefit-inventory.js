'use strict';
const {QueryCommand} = require('@aws-sdk/lib-dynamodb');
const {error} = require('./policy');
const TABLE = 'staging-WizzOfferJourney';
const terminal = new Set(['CAPTURED_USED', 'RELEASED', 'RELEASED_USED']);
const safeId = value => typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\x00-\x1f#]/.test(value);
const count = value => Number.isSafeInteger(value) && value >= 0;

// Read-only preflight. No grant, reservation, compensation link or money is erased.
// Completed evidence remains a retention review until an archive adapter is approved.
async function inventory({db, subjectIds, orderIds = [], maxPages = 100}) {
  if (!db || !Array.isArray(subjectIds) || !subjectIds.length || !subjectIds.every(safeId) ||
      !Array.isArray(orderIds) || !orderIds.every(safeId) || !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100)
    throw error('BENEFIT_INVENTORY_SCOPE_INVALID');
  const owners = new Set(subjectIds), blockers = [];
  let pages = 0, records = 0;
  async function read(pk) {
    let cursor;
    do {
      if (pages >= maxPages) throw error('BENEFIT_INVENTORY_INCOMPLETE');
      const result = await db.send(new QueryCommand({TableName: TABLE, ConsistentRead: true,
        KeyConditionExpression: '#pk=:pk', ExpressionAttributeNames: {'#pk':'pk'},
        ExpressionAttributeValues: {':pk':pk}, Limit:100, ...(cursor ? {ExclusiveStartKey:cursor} : {})}));
      pages++;
      for (const row of result.Items || []) {
        if (row.pk !== pk || typeof row.sk !== 'string') throw error('BENEFIT_INVENTORY_OWNERSHIP_MISMATCH');
        records++;
        let reason = 'BENEFIT_RETENTION_REVIEW';
        if (row.legalHold === true || row.retentionHold === true) reason = 'DOCUMENTED_RETENTION_HOLD';
        else if (pk.startsWith('USER#') && row.sk.startsWith('BENEFIT#')) {
          if (![row.version,row.grantedUses,row.usedUses,row.reservedUses].every(count) || row.version < 1 ||
              row.grantedUses < 1 || row.usedUses + row.reservedUses > row.grantedUses || typeof row.revoked !== 'boolean')
            throw error('BENEFIT_INVENTORY_RECORD_INVALID');
          if (row.reservedUses > 0) reason = 'BENEFIT_RESERVATION_PENDING';
        } else if (pk.startsWith('BENEFIT_ORDER#')) {
          if (!owners.has(row.sub) || row.orderId !== pk.slice('BENEFIT_ORDER#'.length))
            throw error('BENEFIT_INVENTORY_OWNERSHIP_MISMATCH');
          if (!['GOODS','DELIVERY'].includes(row.sk) || row.target !== row.sk || !safeId(row.campaignId) ||
              !Number.isSafeInteger(row.amountMinor) || row.amountMinor < 1 || !Number.isSafeInteger(row.version) || row.version < 1)
            throw error('BENEFIT_INVENTORY_RECORD_INVALID');
          if (row.status === 'RESERVED') reason = 'BENEFIT_RESERVATION_PENDING';
          else if (!terminal.has(row.status)) throw error('BENEFIT_INVENTORY_STATE_UNKNOWN');
        }
        // Unknown USER records also require review, never silently disappear.
        blockers.push({code:reason});
      }
      cursor = result.LastEvaluatedKey;
    } while (cursor);
  }
  for (const id of owners) await read('USER#' + id);
  for (const id of new Set(orderIds)) await read('BENEFIT_ORDER#' + id);
  return {complete:true, pages, records, blockers};
}
module.exports = {inventory, TABLE};
