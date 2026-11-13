'use strict';
const {ScanCommand} = require('@aws-sdk/lib-dynamodb');
const {error} = require('./policy');
const TABLE = 'staging-PlatformStaff';
const safeId = v => typeof v === 'string' && v.length > 0 && v.length <= 200 && !/[\x00-\x1f#]/.test(v);
const count = v => Number.isSafeInteger(v) && v >= 0;
// Read-only. Terminal funding evidence still needs retention review; never erase it
// or rewrite its customer key/digest as part of personal-data cleanup.
async function inventory({db, subjectIds, maxPages = 100}) {
  if (!db || !Array.isArray(subjectIds) || !subjectIds.length || subjectIds.length > 40 ||
      !subjectIds.every(safeId) || !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100)
    throw error('DELIVERY_FUNDING_SCOPE_INVALID');
  const owners = new Set(subjectIds), values = {':reservation':'DELIVERY_RESERVATION#', ':usage':'DELIVERY_USAGE#'};
  const customerMarkers = [], keyMarkers = [];
  [...owners].forEach((id,i) => { values[':id'+i] = id; values[':key'+i] = 'CUSTOMER#'+id; customerMarkers.push(':id'+i); keyMarkers.push(':key'+i); });
  let cursor, pages = 0, records = 0;
  const blockers = new Set(), keys = [];
  do {
    if (pages >= maxPages) throw error('DELIVERY_FUNDING_INVENTORY_INCOMPLETE');
    const response = await db.send(new ScanCommand({TableName:TABLE, ConsistentRead:true, Select:'SPECIFIC_ATTRIBUTES', Limit:100,
      FilterExpression:'(begins_with(#pk,:reservation) AND #customer IN ('+customerMarkers.join(',')+')) OR (begins_with(#pk,:usage) AND #sk IN ('+keyMarkers.join(',')+'))',
      ProjectionExpression:'#pk,#sk,#customer,#order,#state,#schema,#version,#reserved,#completed,#legal,#retention',
      ExpressionAttributeNames:{'#pk':'pk','#sk':'sk','#customer':'customerId','#order':'orderId','#state':'status',
        '#schema':'schemaVersion','#version':'version','#reserved':'reservedUses','#completed':'completedUses',
        '#legal':'legalHold','#retention':'retentionHold'}, ExpressionAttributeValues:values,
      ...(cursor ? {ExclusiveStartKey:cursor} : {})}));
    pages++;
    for (const row of response.Items || []) {
      if (typeof row.pk !== 'string' || typeof row.sk !== 'string') throw error('DELIVERY_FUNDING_RECORD_INVALID');
      let pending = false;
      if (row.pk.startsWith('DELIVERY_RESERVATION#')) {
        if (!owners.has(row.customerId)) throw error('DELIVERY_FUNDING_OWNERSHIP_MISMATCH');
        if (!safeId(row.orderId) || !['DELIVERY_RESERVATION#'+row.orderId,'DELIVERY_RESERVATION#'+row.orderId+'#PROMOTION'].includes(row.pk) ||
            row.sk !== 'META' || ![1,2].includes(row.schemaVersion) || !count(row.version) || row.version < 1)
          throw error('DELIVERY_FUNDING_RECORD_INVALID');
        if (!['RESERVED','CAPTURED','RELEASED'].includes(row.status)) throw error('DELIVERY_FUNDING_STATE_UNKNOWN');
        pending = row.status === 'RESERVED';
      } else if (row.pk.startsWith('DELIVERY_USAGE#')) {
        if (!row.sk.startsWith('CUSTOMER#') || !owners.has(row.sk.slice(9)) ||
            (row.customerId !== undefined && row.customerId !== row.sk.slice(9))) throw error('DELIVERY_FUNDING_OWNERSHIP_MISMATCH');
        if (!safeId(row.pk.slice('DELIVERY_USAGE#'.length)) || row.schemaVersion !== 1 ||
            !count(row.version) || row.version < 1 || !count(row.reservedUses) || !count(row.completedUses))
          throw error('DELIVERY_FUNDING_RECORD_INVALID');
        pending = row.reservedUses > 0;
      } else throw error('DELIVERY_FUNDING_OWNERSHIP_MISMATCH');
      records++;
      keys.push({pk:row.pk,sk:row.sk});
      blockers.add(row.legalHold === true || row.retentionHold === true ? 'DOCUMENTED_RETENTION_HOLD' :
        pending ? 'DELIVERY_FUNDING_RESERVATION_PENDING' : 'DELIVERY_FUNDING_RETENTION_REVIEW');
    }
    cursor = response.LastEvaluatedKey;
  } while (cursor);
  return {complete:true, pages, records, keys, blockers:[...blockers].map(code=>({code}))};
}
module.exports = {inventory, TABLE};
