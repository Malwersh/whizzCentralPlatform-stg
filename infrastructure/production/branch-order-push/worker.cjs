'use strict';

const {GetCommand,QueryCommand,UpdateCommand,DeleteCommand} = require('@aws-sdk/lib-dynamodb');
const {unmarshall} = require('@aws-sdk/util-dynamodb');
const {randomUUID} = require('node:crypto');
const {allowed} = require('../../../backend/src/utils/branch-device-push');
const {readPolicy,soundFile} = require('../../../backend/src/handlers/notification-sound-policy');
const {applySound} = require('../../../backend/src/utils/notification-sound-message');
const {tables,read,digest,bindingKey,tokenKey,reverseKey,id} = require('./bindings.cjs');
const streamPattern=/^arn:aws:dynamodb:us-east-1:746727375268:table\/wizz-production-Orders\/stream\/[\w.:-]+$/;
const noticeAge=15*60;
const deliveredExpiry=24*3600;
const isConflict=error=>error.name==='ConditionalCheckFailedException';

function change(record) {
  const shape=record.dynamodb?.NewImage;
  if (!shape) return;
  const order=unmarshall(shape);
  if (!id(order.orderId) || !id(order.businessId) || order.PK!=='ORDER#'+order.orderId ||
      order.SK!=='META' || order.storeId!==order.businessId) return;
  const result={orderId:order.orderId,businessId:order.businessId,source:order};
  const previous=record.dynamodb.OldImage ? unmarshall(record.dynamodb.OldImage) : undefined;
  if (record.eventName==='INSERT' && order.status==='pending') return {...result,action:'new_order',title:'طلب جديد',collapse:'new'};
  if (record.eventName!=='MODIFY' || !previous) return;
  const state=order.exceptionCancellation?.state, oldState=previous.exceptionCancellation?.state;
  if (state==='REQUESTED' && oldState!==state && id(order.exceptionCancellation.requestId)) {
    return {...result,action:'customer_cancellation_requested',title:'طلب إلغاء بانتظار المراجعة',collapse:order.exceptionCancellation.requestId};
  }
  if (order.status==='cancelled' && previous.status!=='cancelled' &&
      (order.canceledBy==='customer' || state==='CANCELLED')) {
    return {...result,action:'order_cancellation_confirmed',title:'أُلغي الطلب',collapse:'cancelled'};
  }
}

function currentNotice(order,notice,now) {
  if (!order || order.businessId!==notice.businessId || order.storeId!==notice.businessId || order.orderId!==notice.orderId ||
      order.isDeleted || order.deletedAt || order.deletionRequestId) return false;
  if (notice.action==='new_order') {
    return order.status==='confirmed' || order.status==='pending' && Date.parse(order.merchantAcceptanceDeadlineAt)>now;
  }
  if (notice.action==='customer_cancellation_requested') {
    return order.exceptionCancellation?.state==='REQUESTED' && order.exceptionCancellation.requestId===notice.collapse;
  }
  return order.status==='cancelled' && (order.canceledBy==='customer' || order.exceptionCancellation?.state==='CANCELLED');
}

function createWorker({db,messaging,stream,now=Date.now,policy=()=>readPolicy(db,tables.staff),canRun=()=>true}) {
  if (!streamPattern.test(stream??'')) throw Error('PRODUCTION_ORDER_NOTICE_STREAM_REQUIRED');
  const checkOrder = async notice => currentNotice(await read(db,tables.orders,{PK:'ORDER#'+notice.orderId,SK:'META'}),notice,now());

  async function send(notice,record,sound) {
    const row=await read(db,tables.registry,tokenKey(record.branchDeviceId));
    if (row?.env!=='production' || row.businessId!==notice.businessId || row.disabled ||
        !id(row.branchDeviceId) || typeof row.fcmToken!=='string' || row.ttl<=Math.floor(now()/1000) ||
        !await allowed(db,row,Math.floor(now()/1000),tables)) return;
    const hash=digest(row.fcmToken);
    const pointer=await read(db,tables.registry,reverseKey(hash));
    if (pointer?.boundDeviceId!==row.branchDeviceId || pointer.boundBranchId!==notice.businessId ||
        pointer.deviceVersion!==row.branchDeviceVersion || pointer.ttl<=Math.floor(now()/1000)) return;
    if (!await checkOrder(notice)) return;
    const eventId='MERCHANT_BRANCH_ORDER_PUSH#'+digest([notice.orderId,notice.collapse,row.branchDeviceId].join('\0'));
    const lease=randomUUID(), at=Math.floor(now()/1000), marker={eventId};
    try {
      await db.send(new UpdateCommand({TableName:tables.delivery,Key:marker,
        UpdateExpression:'SET leaseOwner=:owner, leaseUntil=:lease, #ttl=:ttl',
        ConditionExpression:'attribute_not_exists(deliveredAt) AND (attribute_not_exists(leaseUntil) OR leaseUntil <= :at)',
        ExpressionAttributeNames:{'#ttl':'ttl'},
        ExpressionAttributeValues:{':owner':lease,':lease':at+40,':ttl':at+deliveredExpiry,':at':at}}));
    } catch (error) {
      if (!isConflict(error)) throw error;
      const existing=await read(db,tables.delivery,marker);
      if (existing?.deliveredAt) return;
      throw Error('ORDER_NOTICE_RETRY_PENDING');
    }
    const base={
      token:row.fcmToken,notification:{title:notice.title,body:'افتح جهاز الفرع لمتابعة الطلب.'},
      data:{type:'merchant_order',action:notice.action,businessId:notice.businessId,orderId:notice.orderId,eventId},
      android:{priority:'high',ttl:noticeAge*1000,notification:{tag:eventId}},
      apns:{headers:{'apns-priority':'10','apns-push-type':'alert','apns-collapse-id':eventId.slice(-48),
        'apns-expiration':String(at+noticeAge)},payload:{aps:{'content-available':1}}},
    };
    let retry;
    try {
      const sender=await messaging();
      await sender.send(applySound(base,soundFile(sound,'merchantNewOrder',row.soundEnabled!==false,row.soundReady??[]),'merchant_orders'));
    } catch (error) {
      if (['messaging/registration-token-not-registered','messaging/invalid-registration-token'].includes(error.code)) {
        try {
          await db.send(new DeleteCommand({TableName:tables.platform,Key:bindingKey(notice.businessId,row.branchDeviceId),
            ConditionExpression:'tokenHash=:token AND deviceVersion=:version',
            ExpressionAttributeValues:{':token':hash,':version':row.branchDeviceVersion}}));
        } catch (removeError) { if (!isConflict(removeError)) retry=removeError; }
      } else retry=error;
    }
    const ledger = {TableName:tables.delivery,Key:marker,ConditionExpression:'leaseOwner=:owner',
      ExpressionAttributeValues:{':owner':lease}};
    if (retry) {
      await db.send(new UpdateCommand({...ledger,UpdateExpression:'REMOVE leaseOwner, leaseUntil'}));
      throw retry;
    }
    await db.send(new UpdateCommand({...ledger,
      UpdateExpression:'SET deliveredAt=:at REMOVE leaseOwner, leaseUntil',
      ExpressionAttributeValues:{...ledger.ExpressionAttributeValues,':at':at}}));
  }

  return async event => {
    if (!Array.isArray(event?.Records) || event.Records.length>5 ||
        event.Records.some(row=>row.eventSource!=='aws:dynamodb'||row.eventSourceARN!==stream)) throw Error('INVALID_ORDER_NOTICE_EVENT');
    const batchItemFailures=[];
    for (const record of event.Records) {
      try {
        if (!canRun()) throw Error('ORDER_NOTICE_RETRY_PENDING');
        const at=record.dynamodb?.ApproximateCreationDateTime;
        if (!Number.isFinite(at) || Math.floor(now()/1000)-at>=noticeAge) continue;
        const notice=change(record);
        if (!notice || !await checkOrder(notice)) continue;
        let cursor,sound;
        do {
          const page=await db.send(new QueryCommand({TableName:tables.registry,IndexName:'BusinessIdIndex',
            KeyConditionExpression:'businessId=:branch',ExpressionAttributeValues:{':branch':notice.businessId},
            ExclusiveStartKey:cursor,Limit:25}));
          for (const row of page.Items??[]) {
            if (row.app!=='merchant' || !id(row.branchDeviceId) || row.token!==tokenKey(row.branchDeviceId).token) continue;
            if (!canRun()) throw Error('ORDER_NOTICE_RETRY_PENDING');
            sound??=await policy();
            await send(notice,row,sound);
          }
          cursor=page.LastEvaluatedKey;
        } while (cursor);
      } catch (error) {
        console.warn('Merchant branch order notice deferred',{code:error.code??error.name});
        batchItemFailures.push({itemIdentifier:record.dynamodb.SequenceNumber});
      }
    }
    return {batchItemFailures};
  };
}
module.exports={change,createWorker};
