'use strict';

const { createHash } = require('node:crypto');
const { DeleteConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');
const { DeleteObjectCommand, GetBucketVersioningCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { GetCommand, QueryCommand, ScanCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { exact } = require('../../../backend/account-deletion/cod-retention');
const { error } = require('../../../backend/account-deletion/policy');
const { retentionSettings } = require('../../../backend/account-deletion/settings');
const { customerExecutionChecks } = require('./customer-execution-scope.cjs');
const { tables } = require('./evidence.cjs');

const bucket = 'wizz-production-support-attachments-746727375268-us-east-1';
const objectScope = { Bucket: bucket, ExpectedBucketOwner: '746727375268' };
const support = {
  sessions: 'wizz-production-SupportChatSessions', messages: 'wizz-production-SupportChatMessages',
  attachments: 'wizz-production-SupportAttachments', receipts: 'wizz-production-SupportMessageReceipts',
  connections: 'wizz-production-SupportConnections', notices: 'wizz-production-WalletNotifications',
};
const attachmentId = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const held = row => row.legalHold || row.retentionHold || row.evidenceRetention || row.complaintCaseId;
const sourceKey = (row, keys) => Object.fromEntries(keys.map(key => {
  if (typeof row[key] !== 'string' || !row[key]) throw error('SUPPORT_INVENTORY_INVALID');
  return [key, row[key]];
}));
const scope = (row, fields) => exact(Object.fromEntries([...fields, 'legalHold', 'retentionHold'].map(field => [field, row[field]])));

async function purgeCustomerSupport({ db, s3, socket, request, job, clock = Date.now, maxPages = 100 }) {
  customerExecutionChecks(request, job, clock());
  const { subjectId, requestId } = request;
  if (!request.policyVersion || request.policyVersion !== job.policyVersion) throw error('RETENTION_POLICY_INVALID');
  const policy = await retentionSettings({ db, table: tables.staff, environment: 'production' })('CUSTOMER', request.policyVersion);
  if (policy.supportRetentionDays !== 0) throw error('RETENTION_POLICY_INVALID');

  const lockKey = { pk: 'ACCOUNT_LIFECYCLE#CUSTOMER#' + subjectId, sk: 'META' };
  const { Item: lock } = await db.send(new GetCommand({ TableName: tables.deletion, Key: lockKey, ConsistentRead: true }));
  if (lock?.requestId !== requestId || lock.state !== 'CLOSING' || !Number.isSafeInteger(lock.lockedAt)) {
    throw error('INVALID_CLEANUP_SCOPE');
  }
  // Production attachment invocations have a 30-second timeout. A reservation
  // made before the lock may still be finishing its S3 write.
  if (Math.floor(clock() / 1000) < lock.lockedAt + 60) throw error('SUPPORT_WRITES_DRAINING');

  async function readPages(Command, input) {
    let cursor;
    const rows = [];
    for (let i = 0; i < maxPages; i++) {
      const result = await db.send(new Command({ ...input, ConsistentRead: true, Limit: 250, ExclusiveStartKey: cursor }));
      rows.push(...(result.Items || []));
      cursor = result.LastEvaluatedKey;
      if (!cursor) return rows;
    }
    throw error('SUPPORT_INVENTORY_INCOMPLETE');
  }

  const scan = (TableName, FilterExpression, ExpressionAttributeValues, ExpressionAttributeNames) =>
    readPages(ScanCommand, { TableName, FilterExpression, ExpressionAttributeValues, ExpressionAttributeNames });
  const scanSession = (table, sid) => scan(table, 'sessionId=:sid', { ':sid': sid });
  const apply = (actions, session) => db.send(new TransactWriteCommand({ TransactItems: [
    ...customerExecutionChecks(request, job, clock()),
    ...(session ? [{ ConditionCheck: {
      TableName: support.sessions, Key: { sessionId: session.sessionId },
      ...scope(session, ['customerId', 'userId', 'userType', 'complaintCaseId', 'orderId']),
    } }] : []),
    ...actions,
  ] }));
  const remove = (table, keys, row, fields) => ({
    Delete: { TableName: table, Key: sourceKey(row, keys), ...scope(row, [...keys, ...fields]) },
  });

  const sessions = await scan(support.sessions, 'customerId=:customer OR (userType=:role AND userId=:customer)',
    { ':customer': subjectId, ':role': 'customer' });
  const ownConnections = await scan(support.connections, 'userType=:role AND (authSubject=:customer OR userId=:customer)',
    { ':customer': subjectId, ':role': 'customer' });
  const inventory = [];
  for (const session of sessions) {
    const sid = session.sessionId;
    if (session.userType !== 'customer' || session.customerId !== subjectId || session.userId !== subjectId ||
        typeof sid !== 'string' || !/^[A-Za-z0-9_:#.-]{1,200}$/.test(sid)) throw error('SUPPORT_INVENTORY_INVALID');
    if (held(session)) throw error('DOCUMENTED_RETENTION_HOLD');
    const [messages, attachments, receipts, links, notices] = await Promise.all([
      readPages(QueryCommand, { TableName: support.messages, KeyConditionExpression: 'sessionId=:sid',
        ExpressionAttributeValues: { ':sid': sid } }),
      scanSession(support.attachments, sid),
      scanSession(support.receipts, sid),
      scan(support.connections, 'sessionId=:sid AND userType=:role', { ':sid': sid, ':role': 'agent' }),
      scan(support.notices, 'sessionId=:sid AND recipientApp=:app AND driverId=:subject AND #type=:type',
        { ':sid': sid, ':app': 'user', ':subject': subjectId, ':type': 'support_reply' }, { '#type': 'type' }),
    ]);
    if ([...messages, ...attachments, ...receipts, ...notices, ...links].some(held)) throw error('DOCUMENTED_RETENTION_HOLD');
    const prefix = 'support-images/' + createHash('sha256').update(sid).digest('hex') + '/';
    if (attachments.some(row => !attachmentId.test(row.attachmentId ?? '') || row.key !== prefix + row.attachmentId ||
        row.userType !== 'agent' && (row.userType !== 'customer' || row.subjectId !== subjectId))) {
      throw error('SUPPORT_INVENTORY_INVALID');
    }
    if (notices.some(row => row.leaseUntil >= Math.floor(clock() / 1000))) throw error('SUPPORT_WRITES_DRAINING');
    inventory.push({ session, prefix, attachments: new Map(attachments.map(row => [row.attachmentId, row])), operations: [
      ...messages.map(row => remove(support.messages, ['sessionId','messageKey'], row, ['messageId'])),
      ...receipts.map(row => remove(support.receipts, ['receiptId'], row, ['sessionId','messageId','contentHash'])),
      ...attachments.map(row => remove(support.attachments, ['attachmentId'], row, ['sessionId','key','status','evidenceRetention','checksum'])),
      ...notices.map(row => remove(support.notices, ['eventId'], row, ['sessionId','driverId','recipientApp','type','leaseOwner','leaseUntil'])),
      ...links.map(row => ({ Update: {
        TableName: support.connections, Key: sourceKey(row, ['connectionId']), UpdateExpression: 'REMOVE sessionId',
        ...scope(row, ['connectionId','userType','sessionId','authSubject']),
      } })),
    ] });
  }

  if (inventory.length) {
    const versioning = await s3.send(new GetBucketVersioningCommand(objectScope));
    if (versioning.Status) throw error('SUPPORT_OBJECT_VERSIONING_REVIEW_REQUIRED');
  }
  for (const { session, prefix, attachments, operations } of inventory) {
    let token;
    let pages = 0;
    do {
      const page = await s3.send(new ListObjectsV2Command({ ...objectScope, Prefix: prefix, MaxKeys: 100, ContinuationToken: token }));
      for (const object of page.Contents || []) {
        const id = object.Key?.slice(prefix.length);
        if (!object.Key?.startsWith(prefix) || !attachmentId.test(id ?? '') ||
            typeof object.ETag !== 'string' || !object.ETag) throw error('SUPPORT_INVENTORY_INVALID');
        const row = attachments.get(id);
        await apply([{ ConditionCheck: {
          TableName: support.attachments, Key: { attachmentId: id },
          ...(row ? scope(row, ['attachmentId','sessionId','key','status','evidenceRetention','checksum'])
            : { ConditionExpression: 'attribute_not_exists(attachmentId)' }),
        } }], session);
        await s3.send(new DeleteObjectCommand({ ...objectScope, Key: object.Key, IfMatch: object.ETag }));
      }
      token = page.NextContinuationToken;
      if (++pages >= maxPages && token) throw error('SUPPORT_INVENTORY_INCOMPLETE');
      if (page.IsTruncated && !token) throw error('SUPPORT_INVENTORY_INCOMPLETE');
    } while (token);
    for (let offset = 0; offset < operations.length; offset += 20) {
      await apply(operations.slice(offset, offset + 20), session);
    }
    await apply([remove(support.sessions, ['sessionId'], session, ['customerId','userId','userType','complaintCaseId','orderId'])]);
  }
  for (const row of ownConnections) {
    if (row.userId !== subjectId || row.authSubject !== subjectId || row.userType !== 'customer' ||
        !/^[A-Za-z0-9_=+-]{1,128}$/.test(row.connectionId || '')) throw error('SUPPORT_INVENTORY_INVALID');
    await apply([{ ConditionCheck: {
      TableName: support.connections, Key: { connectionId: row.connectionId },
      ...scope(row, ['connectionId','userId','authSubject','userType']),
    } }]);
    try {
      await socket.send(new DeleteConnectionCommand({ ConnectionId: row.connectionId }));
    } catch (failure) {
      if (failure.name !== 'GoneException' && failure.$metadata?.httpStatusCode !== 410) throw failure;
    }
    // API Gateway's disconnect handler may have removed the row already.
    await apply([{ Delete: {
      TableName: support.connections, Key: { connectionId: row.connectionId },
      ConditionExpression: 'attribute_not_exists(connectionId) OR (authSubject=:subject AND userType=:role)',
      ExpressionAttributeValues: { ':subject': subjectId, ':role': 'customer' },
    } }]);
  }
}

module.exports = { purgeCustomerSupport };
