'use strict';
// Shared contract: explicit refusal wins on legacy contradictory rows. No bulk migration.
function promotionConsent(profile){
 const raw=[profile?.marketing_consent,profile?.notification_settings?.promotion_notifications];
 if(raw.some(v=>v!=null&&typeof v!=='boolean'))return false;
 const values=raw.filter(v=>typeof v==='boolean');
 return !values.includes(false)&&values.includes(true);
}
function notificationView(profile){
 const settings=profile?.notification_settings;
 return {...(settings&&typeof settings==='object'&&!Array.isArray(settings)?settings:{}),promotion_notifications:promotionConsent(profile)};
}
// Whole-map writes preserve siblings. Abort if another request changed that map after the read.
function fenceNotificationSnapshot(params,profile){
 params.ExpressionAttributeNames={...params.ExpressionAttributeNames,'#notificationSnapshot':'notification_settings'};
 let condition;
 if(Object.prototype.hasOwnProperty.call(profile,'notification_settings')){
  params.ExpressionAttributeValues[':notificationSnapshot']=profile.notification_settings;
  condition='#notificationSnapshot = :notificationSnapshot';
 }else condition='attribute_not_exists(#notificationSnapshot)';
 params.ConditionExpression=`(${params.ConditionExpression}) AND (${condition})`;
}
module.exports={promotionConsent,notificationView,fenceNotificationSnapshot};
