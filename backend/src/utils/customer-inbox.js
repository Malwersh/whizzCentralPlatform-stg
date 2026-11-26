'use strict';
const {createHash}=require('node:crypto');
const {GetCommand,PutCommand}=require('@aws-sdk/lib-dynamodb');
const valid=value=>typeof value==='string'&&/^[A-Za-z0-9_:#.-]{1,200}$/.test(value);
// Existing inbox storage, no ledger or wallet balance mutations.
function build({subjectId,eventKey,type,title,body,orderId,orderNumber,campaignId,sessionId,at=new Date().toISOString(),pending=false}){
 if(!valid(subjectId)||typeof eventKey!=='string'||!eventKey||!['order_update','campaign_offer','support_reply'].includes(type)||!Number.isFinite(Date.parse(at)))throw Error('INVALID_CUSTOMER_NOTICE');
 const eventId='CN:'+createHash('sha256').update(JSON.stringify([subjectId,type,eventKey])).digest('hex');
 const item={eventId,driverId:subjectId,recipientApp:'user',type,title,body,createdAt:at,deliveryStatus:pending?'PENDING':'STORED',nextAttemptAt:Math.floor(Date.now()/1000),attempts:0,ttl:Math.floor(Date.parse(at)/1000)+30*86400};
 for(const [key,value] of Object.entries({orderId,orderNumber,campaignId,sessionId}))if(value!=null){if(!valid(value))throw Error('INVALID_CUSTOMER_NOTICE_TARGET');item[key]=value;}
 return item;
}
async function record(db,input){
 const item=build(input),eventId=item.eventId;
 try{await db.send(new PutCommand({TableName:process.env.WALLET_NOTIFICATIONS_TABLE||'staging-WalletNotifications',Item:item,ConditionExpression:'attribute_not_exists(eventId)'}));}
 catch(e){if(e.name!=='ConditionalCheckFailedException')throw e;}
 return eventId;
}
async function subject(db,userId,expectedSubject){
 if(!valid(userId))throw Error('INVALID_CUSTOMER_ID');
 const profile=(await db.send(new GetCommand({TableName:'WizzUser_users_staging',Key:{userId},ConsistentRead:true,ProjectionExpression:'userId,cognitoSub,isActive,deletedAt,deletionRequestId'}))).Item;
 if(!profile||profile.isActive===false||profile.deletedAt||profile.deletionRequestId)return null;
 if(expectedSubject && profile.cognitoSub && expectedSubject!==profile.cognitoSub)return null;
 return profile.cognitoSub||expectedSubject||profile.userId;
}
function supportReply(session,message){
 if(message.senderType!=='agent'||session.userType!=='customer')return null;
 return build({subjectId:session.customerId,eventKey:message.messageId,type:'support_reply',title:'رد جديد من الدعم',body:'وصل رد على محادثتك. افتح التطبيق للاطلاع عليه.',sessionId:session.sessionId,...(session.orderId?{orderId:session.orderId}:{}),at:message.createdAt,pending:true});
}
module.exports={build,record,subject,supportReply};
