'use strict';

const {DynamoDBClient} = require('@aws-sdk/client-dynamodb');
const {DynamoDBDocumentClient} = require('@aws-sdk/lib-dynamodb');
const {createWorker} = require('../../backend/wallet-service/notification-worker');
const {getMessaging} = require('../../backend/src/utils/firebase');
const {firebaseBinding} = require('../../backend/src/utils/notification-provider-bindings');

const account='746727375268';
const region='us-east-1';
const name='wizz-production-order-return-notices';
const schedule=`arn:aws:events:${region}:${account}:rule/${name}`;
const returnNoticeTables=Object.freeze({
  outbox:'wizz-production-WalletNotifications',
  pushTokens:'wizz-production-PushDeviceTokens',
  drivers:'wizz-production-Drivers',
  merchants:'wizz-production-Merchants',
  platform:'wizz-production-MerchantPlatform',
  deletion:'wizz-production-AccountDeletion',
});

function createHandler({db,messaging,stream,clock}) {
  return (event,context)=>{
    const fromSchedule=event?.source==='aws.events' && event.account===account && event.region===region &&
      event['detail-type']==='Scheduled Event' && event.resources?.includes(schedule);
    const fromStream=Array.isArray(event?.Records) && event.Records.length>0 && event.Records.length<=5 &&
      event.Records.every(record=>record.eventSource==='aws:dynamodb' && record.eventSourceARN===stream);
    if (!fromSchedule && !fromStream) throw Error('INVALID_RETURN_NOTICE_TRIGGER');
    return createWorker(db,messaging,clock,{returnNoticeTables,
      canRetry:()=>context.getRemainingTimeInMillis()>8000,
    }).handler(fromSchedule?{}:event);
  };
}

const db=DynamoDBDocumentClient.from(new DynamoDBClient({maxAttempts:2}));
exports.createHandler=createHandler;
exports.handler=(event,context)=>{
  const stream=process.env.RETURN_NOTICE_STREAM_ARN;
  if (process.env.STAGE!=='production' || process.env.AWS_REGION!==region ||
    !/^arn:aws:dynamodb:us-east-1:746727375268:table\/wizz-production-WalletNotifications\/stream\/[\w.:-]+$/.test(stream??'')) {
    throw Error('PRODUCTION_RETURN_NOTICES_NOT_CONFIGURED');
  }
  firebaseBinding();
  return createHandler({db,messaging:getMessaging,stream})(event,context);
};
