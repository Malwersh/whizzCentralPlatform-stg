'use strict';

const {DynamoDBClient}=require('@aws-sdk/client-dynamodb');
const {DynamoDBDocumentClient,GetCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {CognitoJwtVerifier}=require('aws-jwt-verify');
const {identities:{customer}}=require('./wallet-identity-bindings.json');
const {createCustomerNotificationStore}=require('../../backend/wallet-service/src/customerNotificationStore.ts');
const {WalletError}=require('../../backend/wallet-service/src/types.ts');
const {promotionConsent, notificationView, fenceNotificationSnapshot}=
  require('../../backend/src/handlers/customer-promotion-consent-449');

const route='/wallet/transfers/notifications';
const tables={
  notices:'wizz-production-WalletNotifications',
  readState:'wizz-production-IdempotencyKeys',
  profiles:'wizz-production-Customers',
  lifecycle:'wizz-production-AccountDeletion',
};
const responseHeaders={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const respond=(statusCode,value)=>({statusCode,headers:responseHeaders,body:JSON.stringify(value)});
const error=(status,code,message)=>new WalletError(message,code,status);
const unavailable=()=>error(403,'ACCOUNT_UNAVAILABLE','الحساب غير متاح.');
const lifeKey=subject=>({pk:'ACCOUNT_LIFECYCLE#CUSTOMER#'+subject,sk:'META'});

function writeChecks(subject) {
  return [
    {ConditionCheck:{TableName:tables.lifecycle,Key:lifeKey(subject),ConditionExpression:'attribute_not_exists(pk)'}},
    {ConditionCheck:{TableName:tables.profiles,Key:{userId:subject},
      ConditionExpression:'cognitoSub = :subject AND (attribute_not_exists(isActive) OR isActive <> :false) AND (attribute_not_exists(isDeleted) OR isDeleted <> :true) AND (attribute_not_exists(deletedAt) OR attribute_type(deletedAt,:nullType)) AND (attribute_not_exists(deletionRequestId) OR attribute_type(deletionRequestId,:nullType))',
      ExpressionAttributeValues:{':subject':subject,':true':true,':false':false,':nullType':'NULL'}}},
  ];
}

function createHandler({db,verify,apiId,now}) {
  const inbox=createCustomerNotificationStore({db,notificationsTable:()=>tables.notices,readStateTable:tables.readState,writeChecks,now});
  const get=async (TableName,Key,ProjectionExpression)=>(await db.send(new GetCommand({
    TableName,Key,ProjectionExpression,ConsistentRead:true,
  }))).Item;
  return async event=>{
    try {
      if(event?.requestContext?.stage!=='production'||event.requestContext.apiId!==apiId||event.resource!==route)
        throw error(404,'NOT_FOUND','الخدمة غير موجودة.');
      if(!['GET','POST'].includes(event.httpMethod))throw error(405,'METHOD_NOT_ALLOWED','الإجراء غير متاح.');
      const header=Object.entries(event.headers??{}).filter(([name])=>name.toLowerCase()==='authorization');
      const token=header.length===1 && typeof header[0][1]==='string' ? /^Bearer (\S+)$/i.exec(header[0][1])?.[1] : undefined;
      let subject;
      try {
        if(!token || token.length>8200)throw Error();
        ({sub:subject}=await verify(token));
        if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(subject??''))throw Error();
      } catch {
        throw error(401,'UNAUTHORIZED','سجّل الدخول للاطلاع على الإشعارات.');
      }
      const preferences=event.queryStringParameters?.view==='preferences';
      if(preferences && (Object.keys(event.queryStringParameters).length!==1 ||
         Object.values(event.multiValueQueryStringParameters??{}).some(values=>values.length!==1)))
        throw error(400,'INVALID_NOTIFICATION_SETTINGS','راجع إعدادات الإشعارات.');
      const [profile,lock]=await Promise.all([
        get(tables.profiles,{userId:subject},'userId,cognitoSub,isActive,isDeleted,deletedAt,deletionRequestId'+
          (preferences?',notification_settings,marketing_consent':'')),
        get(tables.lifecycle,lifeKey(subject),'pk'),
      ]);
      if(lock || profile?.userId!==subject || profile.cognitoSub!==subject || profile.isActive===false ||
        profile.isDeleted===true || profile.deletedAt!=null || profile.deletionRequestId!=null)throw unavailable();

      const preferenceReply=settings=>respond(200,{
        success:true,data:{id:subject,notification_settings:settings},
      });
      if(event.httpMethod==='GET') {
        if(preferences) return preferenceReply(notificationView(profile));
        const cursor=event.queryStringParameters?.cursor;
        if(cursor!=null && typeof cursor!=='string') throw error(400,'INVALID_CURSOR','مؤشر الصفحة غير صالح.');
        return respond(200,await inbox.list(subject,cursor));
      }
      let input;
      try {
        if(event.isBase64Encoded || typeof event.body!=='string' || Buffer.byteLength(event.body)>16000) throw Error();
        input=JSON.parse(event.body);
        if(!input || typeof input!=='object' || Array.isArray(input)) throw Error();
      } catch {
        throw error(400,'INVALID_NOTIFICATION','اختر إشعارات صالحة.');
      }
      if(!preferences) return respond(200,await inbox.markRead(subject,input));
      const values=input.notification_settings;
      if(Object.keys(input).join(',')!=='notification_settings' || !values || typeof values!=='object' ||
          Array.isArray(values) || !Object.keys(values).length || Object.entries(values).some(([key,value])=>
            !['order_notifications','promotion_notifications'].includes(key)||typeof value!=='boolean'))
        throw error(400,'INVALID_NOTIFICATION_SETTINGS','راجع إعدادات الإشعارات.');
      const [accountGuard,{ConditionCheck:profileGuard}]=writeChecks(subject);
      const settings={...notificationView(profile),...values};
      const update={...profileGuard,UpdateExpression:'SET #settings=:settings',
        ExpressionAttributeNames:{'#settings':'notification_settings','#consent':'marketing_consent'},
        ExpressionAttributeValues:{...profileGuard.ExpressionAttributeValues,':settings':settings}};
      if(Object.hasOwn(profile,'marketing_consent')){
        update.ConditionExpression+=' AND #consent=:previousConsent';
        update.ExpressionAttributeValues[':previousConsent']=profile.marketing_consent;
      }else update.ConditionExpression+=' AND attribute_not_exists(#consent)';
      if(Object.hasOwn(values,'promotion_notifications')){
        update.UpdateExpression+=', #consent=:consent';
        update.ExpressionAttributeValues[':consent']=values.promotion_notifications;
      }
      fenceNotificationSnapshot(update,profile);
      try {
        await db.send(new TransactWriteCommand({TransactItems:[accountGuard,{Update:update}]}));
      }catch(cause){
        if(cause.name==='TransactionCanceledException')
          throw error(409,'NOTIFICATION_SETTINGS_CHANGED','تغيّرت إعدادات الإشعارات. حدّثها وأعد المحاولة.');
        throw cause;
      }
      return preferenceReply({...settings,promotion_notifications:promotionConsent({
        notification_settings:settings,marketing_consent:values.promotion_notifications??profile.marketing_consent,
      })});
    } catch (cause) {
      const known=cause instanceof WalletError;
      if(!known) console.error('Customer inbox request failed',{name:cause?.name??'Error',method:event?.httpMethod});
      return respond(known?cause.statusCode:503,{error:{
        code:known?cause.code:'INBOX_UNAVAILABLE',
        message:known?cause.message:'تعذر تحديث الإشعارات. أعد المحاولة.',
      }});
    }
  };
}

const db=DynamoDBDocumentClient.from(new DynamoDBClient({region:'us-east-1',maxAttempts:2}));
const verifier=CognitoJwtVerifier.create({userPoolId:customer.poolId,clientId:customer.clientId,tokenUse:null});
const apiId=process.env.CUSTOMER_INBOX_API_ID;
const production=createHandler({db,verify:token=>verifier.verify(token),apiId});
module.exports={createHandler,handler(event) {
  if(process.env.STAGE!=='production'||process.env.AWS_REGION!=='us-east-1'||!(/^[a-z0-9]{10}$/.test(apiId??'')))
    return respond(503,{error:{code:'INBOX_UNAVAILABLE',message:'خدمة الإشعارات غير متاحة.'}});
  return production(event);
}};
