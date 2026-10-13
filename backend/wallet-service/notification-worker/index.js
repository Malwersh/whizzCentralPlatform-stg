const {randomUUID,createHash}=require('crypto');
const {DynamoDBClient}=require('@aws-sdk/client-dynamodb');
const {DynamoDBDocumentClient,QueryCommand,UpdateCommand,DeleteCommand}=require('@aws-sdk/lib-dynamodb');
const {SecretsManagerClient,GetSecretValueCommand}=require('@aws-sdk/client-secrets-manager');
const {unmarshall}=require('@aws-sdk/util-dynamodb');
const admin=require('firebase-admin');
const db=DynamoDBDocumentClient.from(new DynamoDBClient({}));
let messagingPromise;
async function getMessaging(){
 if(!messagingPromise) messagingPromise=(async()=>{
  const secret=await new SecretsManagerClient({}).send(new GetSecretValueCommand({SecretId:process.env.FIREBASE_ADMIN_SA_SECRET_ID}));
  if(!admin.apps.length)admin.initializeApp({credential:admin.credential.cert(JSON.parse(secret.SecretString))});
  return admin.messaging();
 })().catch(error=>{messagingPromise=null;throw error;});
 return messagingPromise;
}
const digest=token=>createHash('sha256').update(token).digest('hex');
function createWorker(client,messaging,clock=()=>Date.now()){
 async function processEvent(eventId){
  const now=Math.floor(clock()/1000),owner=randomUUID(),table=process.env.WALLET_NOTIFICATIONS_TABLE;
  let item;
  try{
   const result=await client.send(new UpdateCommand({TableName:table,Key:{eventId},UpdateExpression:'SET leaseOwner = :owner, leaseUntil = :lease ADD attempts :one',ConditionExpression:'deliveryStatus = :pending AND nextAttemptAt <= :now AND (attribute_not_exists(leaseUntil) OR leaseUntil < :now)',ExpressionAttributeValues:{':owner':owner,':lease':now+120,':one':1,':pending':'PENDING',':now':now},ReturnValues:'ALL_NEW'}));
   item=result.Attributes;
  }catch(error){if(error.name==='ConditionalCheckFailedException')return;throw error;}
  const delivered=new Set(item.deliveredTokenHashes || []);
  let retry=false,hadToken=false;
  try{
   let cursor;
   do{
    const result=await client.send(new QueryCommand({TableName:process.env.PUSH_TOKENS_TABLE,IndexName:'SubjectIdIndex',KeyConditionExpression:'subjectId = :driver',ExpressionAttributeValues:{':driver':item.driverId},ExclusiveStartKey:cursor}));
    for(const record of result.Items || []){
     if(record.app!==(item.recipientApp || 'driver') || !record.token)continue;
     hadToken=true;
     const hash=digest(record.token);
     if(delivered.has(hash))continue;
     try{
      const sender=await messaging();
      await sender.send({token:record.token,notification:{title:item.title,body:item.body},data:{type:item.type,eventId:item.eventId,driverId:item.driverId,topupId:item.topupId || '',amount:String(item.amount || 0),reviewStatus:item.reviewStatus || '',action:item.type==='driver_review_changed'?'refresh_profile':'open_wallet'},android:{priority:'high',notification:{tag:item.eventId}},apns:{headers:{'apns-priority':'10','apns-push-type':'alert','apns-collapse-id':digest(item.eventId).slice(0,48)},payload:{aps:{sound:'default','content-available':1}}}});
      await client.send(new UpdateCommand({TableName:table,Key:{eventId},UpdateExpression:'ADD deliveredTokenHashes :hash',ConditionExpression:'leaseOwner = :owner',ExpressionAttributeValues:{':hash':new Set([hash]),':owner':owner}}));
      delivered.add(hash);
     }catch(error){
      if(['messaging/registration-token-not-registered','messaging/invalid-registration-token'].includes(error.code)){
       await client.send(new DeleteCommand({TableName:process.env.PUSH_TOKENS_TABLE,Key:{token:record.token}}));
      }else{retry=true;console.warn('Wallet push attempt failed',{eventId,code:error.code || error.name});}
     }
    }
    cursor=result.LastEvaluatedKey;
   }while(cursor);
  }catch(error){retry=true;console.warn('Wallet push registry unavailable',{eventId,code:error.code || error.name});}
  if(!hadToken)retry=true;
  const expired=now-Math.floor(Date.parse(item.createdAt)/1000)>=86400 || item.attempts>=24;
  const status=retry?(expired?'UNDELIVERABLE':'PENDING'):(delivered.size?'SENT':'UNDELIVERABLE');
  const values={':owner':owner,':status':status,':next':now+Math.min(3600,60*Math.pow(2,Math.min(item.attempts-1,6))),':updated':new Date(clock()).toISOString()};
  let expression='SET deliveryStatus = :status, nextAttemptAt = :next, updatedAt = :updated';
  if(status!=='PENDING'){expression+=', #ttl = :ttl';values[':ttl']=now+30*86400;}
  await client.send(new UpdateCommand({TableName:table,Key:{eventId},UpdateExpression:expression+' REMOVE leaseOwner, leaseUntil',ConditionExpression:'leaseOwner = :owner',ExpressionAttributeValues:values,...(status!=='PENDING'?{ExpressionAttributeNames:{'#ttl':'ttl'}}:{})}));
 }
 async function handler(event){
  const failures=[];
  if(event.Records){
   for(const record of event.Records){
    if(record.eventName!=='INSERT')continue;
    try{await processEvent(unmarshall(record.dynamodb.Keys).eventId);}catch(error){console.warn('Wallet outbox processing failed',{code:error.name});failures.push({itemIdentifier:record.dynamodb.SequenceNumber});}
   }
  }else{
   const result=await client.send(new QueryCommand({TableName:process.env.WALLET_NOTIFICATIONS_TABLE,IndexName:'PendingDelivery',KeyConditionExpression:'deliveryStatus = :pending AND nextAttemptAt <= :now',ExpressionAttributeValues:{':pending':'PENDING',':now':Math.floor(clock()/1000)},Limit:25}));
   for(const item of result.Items || [])try{await processEvent(item.eventId);}catch(error){console.warn('Wallet retry failed',{eventId:item.eventId,code:error.name});}
  }
  return {batchItemFailures:failures};
 }
 return {handler,processEvent};
}
exports.createWorker=createWorker;
exports.handler=(event)=>createWorker(db,getMessaging).handler(event);
