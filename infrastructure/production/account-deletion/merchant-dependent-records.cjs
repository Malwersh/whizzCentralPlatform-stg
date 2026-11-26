'use strict';

const { QueryCommand, ScanCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { exact } = require('../../../backend/account-deletion/cod-retention');
const { error } = require('../../../backend/account-deletion/policy');
const { tables } = require('./evidence.cjs');

async function readRows(db, Command, input) {
  let cursor;
  const rows = [];
  for (let page = 0; page < 100; page++) {
    const response = await db.send(new Command({ ...input, ConsistentRead: true, Limit: 200, ExclusiveStartKey: cursor }));
    rows.push(...response.Items || []);
    cursor = response.LastEvaluatedKey;
    if (!cursor) return rows;
  }
  throw error('INVENTORY_INCOMPLETE');
}

async function purgeMerchantDependentRecords({ db, request, clock = Date.now }) {
  const { pk, sk, requestId, subjectId, scope, status, leaseOwner, job } = request;
  const branch = scope?.kind === 'BUSINESS';
  if (request.actorType !== 'MERCHANT' || !['BUSINESS', 'ACCOUNT'].includes(scope?.kind) ||
      !scope.id || (branch ? job?.businessId !== scope.id : scope.id !== subjectId) ||
      job?.subjectId !== subjectId || job.requestId !== requestId || !leaseOwner || status !== 'PROCESSING' ||
      pk !== 'SUBJECT#MERCHANT#' + subjectId || sk !== 'REQUEST#' + requestId) throw error('INVALID_CLEANUP_SCOPE');

  const deletes = [];
  async function collect(TableName, keys, Command, input, belongs) {
    for (const row of await readRows(db, Command, { TableName, ...input })) {
      if (!belongs(row) || keys.some(key => typeof row[key] !== 'string' || !row[key])) {
        throw error('INVALID_CLEANUP_SCOPE');
      }
      if (row.legalHold || row.retentionHold) throw error('DOCUMENTED_RETENTION_HOLD');
      deletes.push({ Delete: { TableName, Key: Object.fromEntries(keys.map(key => [key, row[key]])), ...exact(row) } });
    }
  }

  if (branch) {
    for (const [name, keys] of [
      ['Products', ['productId']], ['WorkingHours', ['businessId', 'weekday']],
      ['BusinessSubcategories', ['subcategoryId']], ['MenuCategories', ['categoryId']],
    ]) {
      await collect('wizz-production-' + name, keys, ScanCommand, {
        FilterExpression: 'businessId=:branch', ExpressionAttributeValues: { ':branch': scope.id },
      }, row => row.businessId === scope.id && (row.ownerId == null || row.ownerId === subjectId));
    }
    const posPartition = 'MERCHANT_POS#' + scope.id;
    await collect(tables.platform, ['pk', 'sk'], QueryCommand, {
      KeyConditionExpression: 'pk=:pos AND sk=:settings',
      ExpressionAttributeValues: { ':pos': posPartition, ':settings': 'SETTINGS' },
    }, row => row.pk === posPartition && row.sk === 'SETTINGS' && row.businessId === scope.id);
  } else {
    const person = 'PERSON#' + subjectId;
    await collect(tables.platform, ['pk', 'sk'], QueryCommand, {
      KeyConditionExpression: 'pk=:person AND begins_with(sk,:draft)',
      ExpressionAttributeValues: { ':person': person, ':draft': 'DRAFT#' },
    }, row => row.pk === person && row.sk.startsWith('DRAFT#') && row.subjectId === subjectId && !row.businessId);
    await collect(tables.platform, ['pk', 'sk'], QueryCommand, {
      KeyConditionExpression: 'pk=:person AND begins_with(sk,:submission)',
      ExpressionAttributeValues: { ':person': person, ':submission': 'SUBMISSION#' },
    }, row => row.pk === person && row.sk.startsWith('SUBMISSION#') && row.subjectId === subjectId);
    await collect('wizz-production-MerchantFinancialSessions', ['pk', 'sk'], ScanCommand, {
      FilterExpression: 'subjectId=:subject AND begins_with(pk,:prefix) AND (#kind=:session OR #kind=:challenge)',
      ExpressionAttributeNames: { '#kind': 'kind' },
      ExpressionAttributeValues: { ':subject': subjectId, ':prefix': 'MERCHANT_FINANCIAL_SESSION#',
        ':session': 'MERCHANT_FINANCIAL_SESSION', ':challenge': 'MERCHANT_FINANCIAL_CHALLENGE' },
    }, row => row.subjectId === subjectId && /^MERCHANT_FINANCIAL_SESSION#[a-f0-9]{64}$/.test(row.pk) &&
      (row.sk === 'SESSION' && row.kind === 'MERCHANT_FINANCIAL_SESSION' ||
       row.sk === 'CHALLENGE' && row.kind === 'MERCHANT_FINANCIAL_CHALLENGE'));
    await collect('wizz-production-MerchantOtpSessions', ['id'], ScanCommand, {
      FilterExpression: '#subject=:username AND poolId=:pool', ExpressionAttributeNames: { '#subject': 'subject' },
      ExpressionAttributeValues: { ':username': job.username, ':pool': job.pool },
    }, row => row.subject === job.username && row.poolId === job.pool);
  }

  const grantPrefix = branch ? 'MERCHANT_FINANCE#' + scope.id + '#' : 'MERCHANT_FINANCE#';
  await collect(tables.transfers, ['idempotencyKey', 'sk'], ScanCommand, {
    FilterExpression: 'begins_with(idempotencyKey,:prefix) AND #owner=:subject',
    ExpressionAttributeNames: { '#owner': branch ? 'ownerId' : 'memberId' },
    ExpressionAttributeValues: { ':prefix': grantPrefix, ':subject': subjectId },
  }, row => row.sk === 'META' && typeof row.memberId === 'string' &&
    row.idempotencyKey.startsWith(grantPrefix) && row.idempotencyKey.endsWith('#' + row.memberId) &&
    (branch ? row.ownerId === subjectId : row.memberId === subjectId));

  const marker = (branch ? 'BUSINESS' : 'ACCOUNT') + '_LIFECYCLE#MERCHANT#' + scope.id;
  for (let offset = 0; offset < deletes.length; offset += 20) {
    await db.send(new TransactWriteCommand({ TransactItems: [
      { ConditionCheck: { TableName: tables.deletion, Key: { pk, sk },
        ConditionExpression: 'leaseOwner=:lease AND leaseUntil>:now AND #version=:version AND #status=:processing',
        ExpressionAttributeNames: { '#version': 'version', '#status': 'status' },
        ExpressionAttributeValues: { ':lease': leaseOwner, ':now': Math.floor(clock() / 1000),
          ':version': request.version, ':processing': 'PROCESSING' } } },
      { ConditionCheck: { TableName: tables.deletion, Key: { pk: marker, sk: 'META' },
        ConditionExpression: 'subjectId=:subject AND requestId=:request AND #state=:closing',
        ExpressionAttributeNames: { '#state': 'state' },
        ExpressionAttributeValues: { ':subject': subjectId, ':request': requestId, ':closing': 'CLOSING' } } },
      ...deletes.slice(offset, offset + 20),
    ] }));
  }
}

module.exports = { purgeMerchantDependentRecords };
