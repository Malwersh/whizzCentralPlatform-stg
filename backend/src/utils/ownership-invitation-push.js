'use strict';
const {GetCommand,QueryCommand}=require('@aws-sdk/lib-dynamodb');
const {createHash}=require('node:crypto');

async function noticeFor(event,db,now){
 const {organizationId,requestId,audience}=event;
 if(event.action==='ownership_completed'){
  if(!['previous','new'].includes(audience))return null;
  const {Item:audit}=await db.send(new GetCommand({
   TableName:'staging-MerchantPlatform',Key:{pk:'ORGANIZATION#'+organizationId,sk:'OWNERSHIP_TRANSFER_AUDIT#'+requestId},
   ConsistentRead:true,ProjectionExpression:'requestId,organizationId,#kind,previousOwnerId,newOwnerId',
   ExpressionAttributeNames:{'#kind':'kind'},
  }));
  if(audit?.kind!=='OWNERSHIP_TRANSFER_COMPLETED'||audit.requestId!==requestId||
     audit.organizationId!==organizationId||audit.previousOwnerId===audit.newOwnerId)return null;
  return audience==='new'
   ?{subjectId:audit.newOwnerId,type:'ownership_completed_new',title:'اكتمل نقل النشاط إليك',
    body:'أصبح النشاط ضمن مطاعمك. افتح وز للتاجر لإدارته.'}
   :{subjectId:audit.previousOwnerId,type:'ownership_completed_previous',title:'اكتمل نقل ملكية نشاطك',
    body:'انتقلت إدارة النشاط إلى المالك الجديد. افتح وز للتاجر لمراجعة أنشطتك.'};
 }
 const accepted=event.action==='ownership_accepted';
 if(!accepted&&event.action!=='ownership_invitation')return null;
 const {Item:request}=await db.send(new GetCommand({
  TableName:'staging-MerchantPlatform',Key:{pk:'ORGANIZATION#'+organizationId,sk:'OWNERSHIP_TRANSFER'},
  ConsistentRead:true,ProjectionExpression:accepted
   ?'requestId,ownerId,#status,expiresAt':'requestId,recipientId,#status,expiresAt',
  ExpressionAttributeNames:{'#status':'status'},
 }));
 const expectedStatus=accepted?'AWAITING_REVIEW':'AWAITING_RECIPIENT';
 if(request?.requestId!==requestId||request.status!==expectedStatus||request.expiresAt<=now)return null;
 if(accepted)return {subjectId:request.ownerId,type:'ownership_accepted',title:'قَبِل المالك الجديد دعوة النقل',
  body:'طلب نقل ملكية نشاطك بانتظار مراجعة الإدارة.'};
 return {subjectId:request.recipientId,type:'ownership_invitation',title:'دعوة لنقل ملكية نشاط',
  body:'لديك دعوة جديدة. افتح طلبات نقل الملكية في تطبيق وز للتاجر.'};
}

async function send(event,{db,getMessaging,tokensTable,clock=Date.now}){
 const {organizationId,requestId}=event;
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(organizationId||'')||
    !/^[a-f0-9-]{36}$/i.test(requestId||''))return {skipped:true};
 const notice=await noticeFor(event,db,clock());
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(notice?.subjectId||''))return {skipped:true};
 const {subjectId,type,title,body}=notice;
 const {Item:deletion}=await db.send(new GetCommand({
  TableName:'staging-AccountDeletion',Key:{pk:'ACCOUNT_LIFECYCLE#MERCHANT#'+subjectId,sk:'META'},
  ConsistentRead:true,ProjectionExpression:'pk',
 }));
 if(deletion)return {skipped:true};
 const tokens=new Set();
 let cursor;
 do{
  const page=await db.send(new QueryCommand({
   TableName:tokensTable,IndexName:'SubjectIdIndex',
   KeyConditionExpression:'subjectId=:sub',ExpressionAttributeValues:{':sub':subjectId},
   ExclusiveStartKey:cursor,
  }));
  for(const row of page.Items||[]){
   if(typeof row.token!=='string'||!row.token||row.token.startsWith('BRANCH_DEVICE#'))continue;
   const {Item:device}=await db.send(new GetCommand({
    TableName:tokensTable,Key:{token:row.token},ConsistentRead:true,
   }));
   if(device?.subjectId===subjectId&&device.app==='merchant'&&!device.branchDeviceId&&
      !device.disabled&&!device.isDeleted&&(!device.expiresAt||Number(device.expiresAt)>clock()/1000))tokens.add(row.token);
  }
  cursor=page.LastEvaluatedKey;
 }while(cursor);
 if(!tokens.size)return {delivered:0};
 const messaging=await getMessaging();
 const collapseId=createHash('sha256').update(type+':'+requestId).digest('hex').slice(0,48);
 const devices=[...tokens];
 const failureCodes=new Set();
 let delivered=0,retryable=false;
 for(let i=0;i<devices.length;i+=500){
  const result=await messaging.sendEachForMulticast({
   tokens:devices.slice(i,i+500),
   notification:{title,body},
   data:{type},
   android:{priority:'high',collapseKey:collapseId,notification:{tag:collapseId}},
   apns:{headers:{'apns-priority':'10','apns-push-type':'alert','apns-collapse-id':collapseId},payload:{aps:{sound:'default'}}},
  });
  delivered+=result.successCount;
  for(const item of result.responses){
   if(item.success)continue;
   const code=/^messaging\/[a-z-]+$/.test(item.error?.code||'')?item.error.code:'PROVIDER_UNAVAILABLE';
   failureCodes.add(code);
   retryable||=!['messaging/registration-token-not-registered','messaging/invalid-registration-token'].includes(code);
  }
 }
 console.info('OWNERSHIP_PUSH_RESULT',{type,requestId,devices:devices.length,delivered,failureCodes:[...failureCodes]});
 if(retryable)throw Error('OWNERSHIP_PUSH_RETRY');
 return {delivered};
}
module.exports={send};
