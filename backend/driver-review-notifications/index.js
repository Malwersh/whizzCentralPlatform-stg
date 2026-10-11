'use strict';
const {DynamoDBClient}=require('@aws-sdk/client-dynamodb');
const {DynamoDBDocumentClient,PutCommand}=require('@aws-sdk/lib-dynamodb');
const {unmarshall}=require('@aws-sdk/util-dynamodb');
const db=DynamoDBDocumentClient.from(new DynamoDBClient({}));
function reviewState(row){
 const status=String(row.status || row.registrationStatus || '').toUpperCase();
 if(['SUSPENDED','BANNED','REJECTED'].includes(status))return status;
 if(row.isVerified===true || ['ACTIVE','APPROVED','VERIFIED'].includes(status))return 'APPROVED';
 return 'PENDING';
}
function createHandler(client){return async event=>{
 const failures=[];
 for(const record of event.Records || []){
  if(record.eventName!=='MODIFY')continue;
  try{
   if(!record.dynamodb.OldImage || !record.dynamodb.NewImage)continue;
   const old=unmarshall(record.dynamodb.OldImage),row=unmarshall(record.dynamodb.NewImage);
   const status=reviewState(row);
   if(status===reviewState(old) || status==='PENDING' || !row.driverId)continue;
   const eventId=`DRIVER_REVIEW#${record.eventID}`;
   await client.send(new PutCommand({TableName:process.env.NOTIFICATIONS_TABLE,Item:{eventId,driverId:row.driverId,type:'driver_review_changed',topupId:'',amount:0,
    reviewStatus:status,title:status==='APPROVED'?'تمت الموافقة على حسابك':'تم تحديث حالة حسابك',
    body:status==='APPROVED'?'أصبح حسابك معتمدًا. افتح التطبيق للاطلاع على الحالة الجديدة.':'افتح التطبيق للاطلاع على قرار مراجعة حسابك.',
    createdAt:new Date().toISOString(),deliveryStatus:'PENDING',nextAttemptAt:0,attempts:0},ConditionExpression:'attribute_not_exists(eventId)'}));
  }catch(error){if(error.name!=='ConditionalCheckFailedException'){console.warn('Driver review event failed',{code:error.name});failures.push({itemIdentifier:record.dynamodb.SequenceNumber});}}
 }
 return {batchItemFailures:failures};
};}
exports.createHandler=createHandler;exports.reviewState=reviewState;exports.handler=createHandler(db);
