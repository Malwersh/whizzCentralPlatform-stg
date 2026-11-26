'use strict';

const {DynamoDBClient} = require('@aws-sdk/client-dynamodb');
const {DynamoDBDocumentClient} = require('@aws-sdk/lib-dynamodb');
const {createWorker} = require('../../backend/wallet-service/notification-worker');
const {getMessaging} = require('../../backend/src/utils/firebase');
const {firebaseBinding} = require('../../backend/src/utils/notification-provider-bindings');

const account = '746727375268';
const region = 'us-east-1';
const schedule = `arn:aws:events:${region}:${account}:rule/wizz-production-support-reply-notices`;
const supportReplyTables = Object.freeze({
  outbox: 'wizz-production-WalletNotifications',
  pushTokens: 'wizz-production-PushDeviceTokens',
  sessions: 'wizz-production-SupportChatSessions',
  customers: 'wizz-production-Customers',
  deletion: 'wizz-production-AccountDeletion',
  cases: 'wizz-production-Holds',
});

function createHandler({client, messaging, stream, clock}) {
  return (event, context) => {
    const fromSchedule = event?.source === 'aws.events' && event.account === account &&
      event.region === region && event['detail-type'] === 'Scheduled Event' &&
      event.resources?.includes(schedule);
    const fromStream = Array.isArray(event?.Records) && event.Records.length > 0 && event.Records.length <= 5 &&
      event.Records.every(record => record.eventSource === 'aws:dynamodb' && record.eventSourceARN === stream);
    if (!fromSchedule && !fromStream) throw Error('INVALID_SUPPORT_REPLY_TRIGGER');
    return createWorker(client, messaging, clock, {
      supportReplyTables,
      canRetry: () => context.getRemainingTimeInMillis() > 8000,
    }).handler(fromSchedule ? {} : event);
  };
}

const client = DynamoDBDocumentClient.from(new DynamoDBClient({maxAttempts: 2}));

module.exports = {
  createHandler,
  handler(event, context) {
    const stream = process.env.SUPPORT_NOTICE_STREAM_ARN;
    if (process.env.STAGE !== 'production' || process.env.AWS_REGION !== region ||
        !/^arn:aws:dynamodb:us-east-1:746727375268:table\/wizz-production-WalletNotifications\/stream\/[\w.:-]+$/.test(stream ?? '')) {
      throw Error('PRODUCTION_SUPPORT_NOTICES_NOT_CONFIGURED');
    }
    firebaseBinding();
    return createHandler({client, messaging: getMessaging, stream})(event, context);
  },
};
