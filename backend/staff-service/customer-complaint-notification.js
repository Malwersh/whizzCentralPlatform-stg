'use strict';
const {createHash}=require('crypto');
const titles={REQUEST_INFO:'نحتاج معلومات لإكمال مراجعة شكواك',DECIDE:'صدر قرار بشأن شكواك',RESOLVE_APPEAL:'صدر قرار مراجعة اعتراضك',CLOSE:'أُغلقت مراجعة شكواك'};
function complaintNotification({action,actor,order,row,requestId,at}){
 if(actor.kind!=='STAFF'||!titles[action])return null;
 const valid=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:#-]{0,149}$/.test(v);
 if(![order.userSub,order.orderId,row.caseId,row.supportSessionId,requestId].every(valid)||row.customerId!==order.userSub||row.orderId!==order.orderId||!Number.isSafeInteger(row.version)||row.version<1||!Number.isFinite(Date.parse(at)))throw Error('COMPLAINT_NOTIFICATION_INVALID');
 const eventId='CN:'+createHash('sha256').update(JSON.stringify(['complaint',order.userSub,row.caseId,requestId])).digest('hex');
 return {Put:{TableName:'staging-WalletNotifications',Item:{eventId,driverId:order.userSub,recipientApp:'user',type:'order_complaint_updated',target:'complaint',orderId:order.orderId,caseId:row.caseId,sessionId:row.supportSessionId,caseVersion:row.version,title:titles[action],body:'افتح تفاصيل الشكوى للاطلاع على التحديث.',createdAt:at,deliveryStatus:'PENDING',nextAttemptAt:0,attempts:0,ttl:Math.floor(Date.parse(at)/1000)+30*86400},ConditionExpression:'attribute_not_exists(eventId)'}};
}
module.exports={complaintNotification};
