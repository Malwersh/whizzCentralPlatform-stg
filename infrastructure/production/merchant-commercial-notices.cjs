'use strict';

const {randomUUID} = require('node:crypto');
const {DynamoDBClient} = require('@aws-sdk/client-dynamodb');
const {DynamoDBDocumentClient, QueryCommand, UpdateCommand} = require('@aws-sdk/lib-dynamodb');
const {send} = require('../../backend/src/utils/commercial-sharing-push');
const {getMessaging} = require('../../backend/src/utils/firebase');
const {firebaseBinding} = require('../../backend/src/utils/notification-provider-bindings');
const {outboxId, pendingStatus} = require('../../backend/staff-service/commercial-notices');
const {identities} = require('./wallet-identity-bindings.json');

const account = '746727375268';
const region = 'us-east-1';
const name = 'wizz-production-merchant-commercial-notices';
const schedule = `arn:aws:events:${region}:${account}:rule/${name}`;
const outbox = 'wizz-production-WalletNotifications';
const tokensTable = 'wizz-production-PushDeviceTokens';
const production = Object.freeze({
  staff: 'wizz-production-PlatformStaff',
  merchants: 'wizz-production-Merchants',
  platform: 'wizz-production-MerchantPlatform',
  deletion: 'wizz-production-AccountDeletion',
  pool: identities.merchant.poolId,
});
const eventPattern = /^COMMERCIAL_SHARING_NOTICE#[a-f0-9]{64}$/;
const streamPattern = /^arn:aws:dynamodb:us-east-1:746727375268:table\/wizz-production-WalletNotifications\/stream\/[\w.:-]+$/;
const type = 'commercial_sharing_requested';

function createHandler({db, messaging, stream, clock = Date.now, cognito}) {
  const seconds = () => Math.floor(clock() / 1000);

  async function deliver(eventId, context) {
    if (typeof eventId !== 'string' || !eventPattern.test(eventId)) return;
    const Key = {eventId};
    const owner = randomUUID();
    const at = seconds();
    let item;
    try {
      const claimed = await db.send(new UpdateCommand({
        TableName: outbox, Key,
        UpdateExpression: 'SET leaseOwner=:owner, leaseUntil=:until ADD attempts :one',
        ConditionExpression: 'deliveryStatus=:pending AND nextAttemptAt<=:now AND (attribute_not_exists(leaseUntil) OR leaseUntil<=:now) AND #type=:type AND recipientApp=:merchant',
        ExpressionAttributeNames: {'#type': 'type'},
        ExpressionAttributeValues: {':owner':owner, ':until':at+120, ':one':1, ':pending':pendingStatus,
          ':now':at, ':type':type, ':merchant':'merchant'},
        ReturnValues: 'ALL_NEW',
      }));
      item = claimed.Attributes;
    } catch (error) {
      if (error.name === 'ConditionalCheckFailedException') return;
      throw error;
    }

    const valid = /^DISCOUNT_FUNDING#[A-Za-z0-9_:#.-]{1,150}$/.test(item?.noticePk ?? '') &&
      /^NOTICE#[1-9]\d*$/.test(item?.noticeSk ?? '') && eventId === outboxId(item.noticePk,item.noticeSk) &&
      Number.isFinite(Date.parse(item.createdAt)) && Number.isFinite(Date.parse(item.expiresAt));
    let delivered = item.deliveredAny === true;
    let result;
    if (valid && clock() < Date.parse(item.expiresAt)) {
      try {
        result = await send({action:'commercial_notice',pk:item.noticePk,sk:item.noticeSk},{
          db, getMessaging:messaging, tokensTable, production, now:clock, cognito,
          canSend:()=>context.getRemainingTimeInMillis()>12000,
          processedTokenHashes:[...(item.processedTokenHashes ?? [])],
          async saveProgress(hashes, success) {
            delivered ||= success;
            await db.send(new UpdateCommand({
              TableName:outbox, Key,
              UpdateExpression:'SET deliveredAny=:delivered ADD processedTokenHashes :hashes',
              ConditionExpression:'leaseOwner=:owner',
              ExpressionAttributeValues:{':owner':owner, ':delivered':delivered, ':hashes':new Set(hashes)},
            }));
          },
        });
      } catch (error) {
        console.warn(JSON.stringify({event:'COMMERCIAL_NOTICE_RETRY',name:error.name}));
      }
    } else {
      result = {cancelled:true};
    }

    const stop = item.attempts >= 24 || clock()-Date.parse(item.createdAt) >= 86400000;
    const status = result?.cancelled ? (delivered ? 'SENT' : 'SUPPRESSED')
      : result?.complete || (result?.noDevices && delivered) ? 'SENT'
      : stop ? (delivered ? 'PARTIALLY_SENT' : 'UNDELIVERABLE') : pendingStatus;
    const next = seconds()+Math.min(3600, 60*2**Math.min(item.attempts-1,6));
    const values = {':owner':owner, ':status':status, ':next':next, ':updated':new Date(clock()).toISOString()};
    const finished = status !== pendingStatus;
    if (finished) values[':ttl'] = seconds()+30*86400;
    await db.send(new UpdateCommand({
      TableName:outbox, Key, ConditionExpression:'leaseOwner=:owner',
      UpdateExpression:'SET deliveryStatus=:status, nextAttemptAt=:next, updatedAt=:updated'+
        (finished ? ', #ttl=:ttl' : '')+' REMOVE leaseOwner, leaseUntil',
      ExpressionAttributeValues:values, ...(finished ? {ExpressionAttributeNames:{'#ttl':'ttl'}} : {}),
    }));
  }

  return async (event, context) => {
    const scheduled = event?.source === 'aws.events' && event.account === account && event.region === region &&
      event['detail-type'] === 'Scheduled Event' && Array.isArray(event.resources) && event.resources.includes(schedule);
    const fromStream = Array.isArray(event?.Records) && event.Records.length > 0 && event.Records.length <= 5 &&
      event.Records.every(record => record.eventSource === 'aws:dynamodb' && record.eventSourceARN === stream &&
        typeof record.dynamodb?.SequenceNumber === 'string');
    if (!scheduled && !fromStream) throw Error('INVALID_COMMERCIAL_NOTICE_TRIGGER');
    if (scheduled) {
      const {Items=[]} = await db.send(new QueryCommand({
        TableName:outbox,IndexName:'PendingDelivery',Limit:15,ProjectionExpression:'eventId',
        KeyConditionExpression:'deliveryStatus=:pending AND nextAttemptAt<=:now',
        ExpressionAttributeValues:{':pending':pendingStatus,':now':seconds()},
      }));
      for (const item of Items) {
        if (context.getRemainingTimeInMillis() < 15000) break;
        try { await deliver(item.eventId, context); }
        catch (error) { console.warn(JSON.stringify({event:'COMMERCIAL_NOTICE_RECOVERY_RETRY',name:error.name})); }
      }
      return {batchItemFailures:[]};
    }
    const failures=[];
    for (const record of event.Records) {
      if (record.eventName !== 'INSERT') continue;
      const sequence=record.dynamodb.SequenceNumber;
      if (context.getRemainingTimeInMillis() < 15000) {
        failures.push({itemIdentifier:sequence});
        continue;
      }
      try { await deliver(record.dynamodb.Keys?.eventId?.S, context); }
      catch { failures.push({itemIdentifier:sequence}); }
    }
    return {batchItemFailures:failures};
  };
}

const db = DynamoDBDocumentClient.from(new DynamoDBClient({maxAttempts:2}));
module.exports = {createHandler,handler(event, context) {
  const stream = process.env.COMMERCIAL_NOTICE_STREAM_ARN;
  if (process.env.STAGE !== 'production' || process.env.AWS_REGION !== region || !streamPattern.test(stream ?? '')) {
    throw Error('PRODUCTION_COMMERCIAL_NOTICES_NOT_CONFIGURED');
  }
  firebaseBinding();
  return createHandler({db,messaging:getMessaging,stream})(event, context);
}};
