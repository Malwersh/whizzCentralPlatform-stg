'use strict';
const {GetCommand,QueryCommand}=require('@aws-sdk/lib-dynamodb');
const {createHash}=require('node:crypto');

async function send(event,{db,getMessaging,tokensTable,clock=Date.now}){
 const {organizationId,requestId}=event;
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(organizationId||'')||
    !/^[a-f0-9-]{36}$/i.test(requestId||''))return {skipped:true};
 const {Item:request}=await db.send(new GetCommand({
  TableName:'staging-MerchantPlatform',Key:{pk:'ORGANIZATION#'+organizationId,sk:'OWNERSHIP_TRANSFER'},
  ConsistentRead:true,ProjectionExpression:'requestId,recipientId,#status,expiresAt',
  ExpressionAttributeNames:{'#status':'status'},
 }));
 if(request?.requestId!==requestId||request.status!=='AWAITING_RECIPIENT'||
    request.expiresAt<=clock()||!request.recipientId)return {skipped:true};
 const {Item:deletion}=await db.send(new GetCommand({
  TableName:'staging-AccountDeletion',Key:{pk:'ACCOUNT_LIFECYCLE#MERCHANT#'+request.recipientId,sk:'META'},
  ConsistentRead:true,ProjectionExpression:'pk',
 }));
 if(deletion)return {skipped:true};
 const tokens=new Set();
 let cursor;
 do{
  const page=await db.send(new QueryCommand({
   TableName:tokensTable,IndexName:'SubjectIdIndex',
   KeyConditionExpression:'subjectId=:sub',ExpressionAttributeValues:{':sub':request.recipientId},
   ExclusiveStartKey:cursor,
  }));
  for(const row of page.Items||[]){
   if(typeof row.token!=='string'||!row.token||row.token.startsWith('BRANCH_DEVICE#'))continue;
   const {Item:device}=await db.send(new GetCommand({
    TableName:tokensTable,Key:{token:row.token},ConsistentRead:true,
   }));
   if(device?.subjectId===request.recipientId&&device.app==='merchant'&&!device.branchDeviceId&&
      !device.disabled&&!device.isDeleted&&(!device.expiresAt||Number(device.expiresAt)>clock()/1000))tokens.add(row.token);
  }
  cursor=page.LastEvaluatedKey;
 }while(cursor);
 if(!tokens.size)return {delivered:0};
 const messaging=await getMessaging();
 const collapseId=createHash('sha256').update(requestId).digest('hex');
 const devices=[...tokens];
 let delivered=0,retryable=false;
 for(let i=0;i<devices.length;i+=500){
  const result=await messaging.sendEachForMulticast({
   tokens:devices.slice(i,i+500),
   notification:{title:'دعوة لنقل ملكية نشاط',body:'لديك دعوة جديدة. افتح طلبات نقل الملكية في تطبيق وز للتاجر.'},
   data:{type:'ownership_invitation'},
   android:{priority:'high',collapseKey:collapseId,notification:{tag:collapseId}},
   apns:{headers:{'apns-collapse-id':collapseId},payload:{aps:{sound:'default'}}},
  });
  delivered+=result.successCount;
  retryable||=result.responses.some(item=>!item.success&&
   !['messaging/registration-token-not-registered','messaging/invalid-registration-token'].includes(item.error?.code));
 }
 if(retryable)throw Error('OWNERSHIP_INVITE_PUSH_RETRY');
 return {delivered};
}
module.exports={send};
