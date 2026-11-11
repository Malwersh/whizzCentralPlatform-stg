'use strict';
const {GetCommand}=require('@aws-sdk/lib-dynamodb');
const {promotionConsent}=require('./customer-promotion-consent-449');
function allowed(profile,kind){
 if(!profile||profile.isActive===false||profile.deletionRequestId)return false;
 return kind==='promotion'?promotionConsent(profile):profile.notification_settings?.order_notifications!==false;
}
async function read(db,userId){
 if(typeof userId!=='string'||!userId)return null;
 return (await db.send(new GetCommand({TableName:'WizzUser_users_staging',Key:{userId},ConsistentRead:true,
  ProjectionExpression:'userId,notification_settings,isActive,deletionRequestId,marketing_consent'}))).Item;
}
function withoutAlert(message){
 const result=structuredClone(message);delete result.notification;
 if(result.android)delete result.android.notification;
 result.apns={headers:{...(result.apns?.headers||{}),'apns-priority':'5','apns-push-type':'background'},payload:{aps:{'content-available':1}}};
 return result;
}
module.exports={allowed,read,withoutAlert};
