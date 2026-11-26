'use strict';

const { createHash, randomUUID } = require('node:crypto');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, QueryCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { getMessaging } = require('../../../backend/src/utils/firebase');
const { firebaseBinding } = require('../../../backend/src/utils/notification-provider-bindings');
const { outbox, pending, prefix, eventId } = require('./notice-record.cjs');

const account = '746727375268';
const region = 'us-east-1';
const name = 'wizz-production-merchant-ownership-notices';
const schedule = `arn:aws:events:${region}:${account}:rule/${name}`;
const streamPattern = /^arn:aws:dynamodb:us-east-1:746727375268:table\/wizz-production-WalletNotifications\/stream\/[\w.:-]+$/;
const tokensTable = 'wizz-production-PushDeviceTokens';
const platform = 'wizz-production-MerchantPlatform';
const deletion = 'wizz-production-AccountDeletion';
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const validToken = (token, subjectId, at) => typeof token?.token === 'string' && token.token.length > 0 &&
  !token.token.startsWith('BRANCH_DEVICE#') && token.subjectId === subjectId && token.app === 'merchant' &&
  !token.branchDeviceId && !token.disabled && !token.isDeleted && (!token.expiresAt || Number(token.expiresAt) > at);
const notification = {
  ownership_invitation: ['دعوة لنقل ملكية نشاط', 'لديك دعوة جديدة. افتح طلبات نقل الملكية في تطبيق وز للتاجر.'],
  ownership_accepted: ['قَبِل المالك الجديد دعوة النقل', 'طلب نقل ملكية نشاطك بانتظار مراجعة الإدارة.'],
  ownership_completed_previous: ['اكتمل نقل ملكية نشاطك', 'انتقلت إدارة النشاط إلى المالك الجديد. افتح وز للتاجر لمراجعة أنشطتك.'],
  ownership_completed_new: ['اكتمل نقل النشاط إليك', 'أصبح النشاط ضمن مطاعمك. افتح وز للتاجر لإدارته.'],
};

function createHandler({ db, messaging, stream, clock = Date.now }) {
  const seconds = () => Math.floor(clock() / 1000);
  const get = async (TableName, Key) => (await db.send(new GetCommand({ TableName, Key, ConsistentRead: true }))).Item;
  const update = async (Key, updateOptions) => db.send(new UpdateCommand({ TableName: outbox, Key, ...updateOptions }));

  async function currentRecipient(item) {
    const { organizationId, requestId, action } = item;
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(organizationId ?? '') || !uuid(requestId) ||
        !Object.hasOwn(notification, action) || item.eventId !== eventId(requestId, action) ||
        item.type !== action || !Number.isSafeInteger(item.expiresAt) || item.expiresAt <= clock()) return;
    const pk = 'ORGANIZATION#' + organizationId;
    let subjectId;
    if (action.startsWith('ownership_completed_')) {
      const audit = await get(platform, { pk, sk: 'OWNERSHIP_TRANSFER_AUDIT#' + requestId });
      if (audit?.kind !== 'OWNERSHIP_TRANSFER_COMPLETED' || audit.requestId !== requestId ||
          audit.organizationId !== organizationId || audit.previousOwnerId === audit.newOwnerId) return;
      subjectId = action.endsWith('_new') ? audit.newOwnerId : audit.previousOwnerId;
    } else {
      const request = await get(platform, { pk, sk: 'OWNERSHIP_TRANSFER' });
      const invited = action === 'ownership_invitation';
      if (request?.requestId !== requestId || request.organizationId !== organizationId ||
          request.expiresAt !== item.expiresAt || request.status !== (invited ? 'AWAITING_RECIPIENT' : 'AWAITING_REVIEW')) return;
      subjectId = invited ? request.recipientId : request.ownerId;
    }
    if (!uuid(subjectId)) return;
    if (await get(deletion, { pk: 'ACCOUNT_LIFECYCLE#MERCHANT#' + subjectId, sk: 'META' }) ||
        await get(deletion, { pk: 'SUBJECT#MERCHANT#' + subjectId, sk: 'ACTIVE#ACCOUNT#' + subjectId })) return;
    return subjectId;
  }

  async function deliver(id, context) {
    if (typeof id !== 'string' || !id.startsWith(prefix) || id.length > 120) return;
    const Key = { eventId: id };
    const lease = randomUUID(), at = seconds();
    let item;
    try {
      const result = await update(Key, {
        UpdateExpression: 'SET leaseOwner=:lease, leaseUntil=:until ADD attempts :one',
        ConditionExpression: 'deliveryStatus=:pending AND nextAttemptAt<=:now AND recipientApp=:app AND (attribute_not_exists(leaseUntil) OR leaseUntil<=:now)',
        ExpressionAttributeValues: { ':lease': lease, ':until': at + 120, ':one': 1, ':pending': pending, ':now': at, ':app': 'merchant' },
        ReturnValues: 'ALL_NEW',
      });
      item = result.Attributes;
    } catch (error) {
      if (error.name === 'ConditionalCheckFailedException') return;
      throw error;
    }
    let delivered = item.deliveredAny === true;
    let finalStatus;
    try {
      const subjectId = await currentRecipient(item);
      if (!subjectId) finalStatus = delivered ? 'SENT' : 'SUPPRESSED';
      else {
        const processed = new Set(item.processedTokenHashes ?? []);
        const [title, body] = notification[item.action];
        const collapseId = createHash('sha256').update(id).digest('hex').slice(0, 48);
        const tokens = new Set();
        let cursor;
        for (let page = 0; page < 20; page++) {
          const result = await db.send(new QueryCommand({ TableName: tokensTable, IndexName: 'SubjectIdIndex',
            KeyConditionExpression: 'subjectId=:subject', ExpressionAttributeValues: { ':subject': subjectId },
            ExclusiveStartKey: cursor, Limit: 100,
          }));
          for (const row of result.Items ?? []) {
            if (validToken(row, subjectId, at)) tokens.add(row.token);
          }
          cursor = result.LastEvaluatedKey;
          if (!cursor) break;
          if (page === 19) throw Error('OWNERSHIP_TOKEN_LIST_INCOMPLETE');
        }
        for (const token of tokens) {
          const hash = createHash('sha256').update(token).digest('hex');
          if (processed.has(hash)) continue;
          if (context.getRemainingTimeInMillis() < 13000) break;
          if (!validToken(await get(tokensTable, { token }), subjectId, seconds())) continue;
          if (await currentRecipient(item) !== subjectId) { finalStatus = delivered ? 'SENT' : 'SUPPRESSED'; break; }
          const provider = await messaging();
          try {
            await provider.send({
              token, notification: { title, body }, data: { type: item.type },
              android: { priority: 'high', collapseKey: collapseId, notification: { tag: collapseId } },
              apns: { headers: { 'apns-priority': '10', 'apns-push-type': 'alert', 'apns-collapse-id': collapseId },
                payload: { aps: { sound: 'default' } } },
            });
            delivered = true;
          } catch (error) {
            if (!['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'].includes(error.code)) continue;
          }
          await update(Key, {
            UpdateExpression: 'SET deliveredAny=:delivered ADD processedTokenHashes :hashes',
            ConditionExpression: 'leaseOwner=:lease',
            ExpressionAttributeValues: { ':lease': lease, ':delivered': delivered, ':hashes': new Set([hash]) },
          });
          processed.add(hash);
        }
        if (!finalStatus && delivered &&
            [...tokens].every(token => processed.has(createHash('sha256').update(token).digest('hex')))) finalStatus = 'SENT';
      }
    } catch (error) {
      console.warn('OWNERSHIP_NOTICE_RETRY', { name: error.name });
    }
    if (!finalStatus && (item.attempts >= 26 || item.expiresAt <= clock())) finalStatus = delivered ? 'PARTIALLY_SENT' : 'UNDELIVERABLE';
    await update(Key, {
      UpdateExpression: 'SET deliveryStatus=:status, nextAttemptAt=:next REMOVE leaseOwner, leaseUntil',
      ConditionExpression: 'leaseOwner=:lease',
      ExpressionAttributeValues: { ':lease': lease, ':status': finalStatus ?? pending,
        ':next': seconds() + Math.min(3600, 60 * 2 ** Math.min(item.attempts - 1, 6)) },
    });
  }

  return async (event, context) => {
    const scheduled = event?.source === 'aws.events' && event.account === account && event.region === region &&
      event['detail-type'] === 'Scheduled Event' && event.resources?.includes(schedule);
    const records = event?.Records;
    const fromStream = Array.isArray(records) && records.length > 0 && records.length <= 5 &&
      records.every(record => record.eventSource === 'aws:dynamodb' && record.eventSourceARN === stream &&
        typeof record.dynamodb?.SequenceNumber === 'string');
    if (!scheduled && !fromStream) throw Error('INVALID_OWNERSHIP_NOTICE_TRIGGER');
    if (scheduled) {
      const result = await db.send(new QueryCommand({ TableName: outbox, IndexName: 'PendingDelivery', Limit: 15,
        ProjectionExpression: 'eventId', KeyConditionExpression: 'deliveryStatus=:pending AND nextAttemptAt<=:now',
        ExpressionAttributeValues: { ':pending': pending, ':now': seconds() },
      }));
      for (const item of result.Items ?? []) {
        if (context.getRemainingTimeInMillis() < 15000) break;
        try { await deliver(item.eventId, context); }
        catch (error) { console.warn('OWNERSHIP_NOTICE_RECOVERY_RETRY', { name: error.name }); }
      }
      return { batchItemFailures: [] };
    }
    const failures = [];
    for (const record of records) {
      if (record.eventName !== 'INSERT') continue;
      try {
        if (context.getRemainingTimeInMillis() < 15000) throw Error('OWNERSHIP_NOTICE_NO_TIME');
        await deliver(record.dynamodb.Keys?.eventId?.S, context);
      } catch { failures.push({ itemIdentifier: record.dynamodb.SequenceNumber }); }
    }
    return { batchItemFailures: failures };
  };
}

const db = DynamoDBDocumentClient.from(new DynamoDBClient({ maxAttempts: 2 }));
exports.createHandler = createHandler;
exports.handler = (event, context) => {
  const stream = process.env.OWNERSHIP_NOTICE_STREAM_ARN;
  if (process.env.STAGE !== 'production' || process.env.AWS_REGION !== region || !streamPattern.test(stream ?? '')) {
    throw Error('PRODUCTION_OWNERSHIP_NOTICES_NOT_CONFIGURED');
  }
  firebaseBinding();
  return createHandler({ db, messaging: getMessaging, stream })(event, context);
};
