const {randomUUID,createHash}=require('crypto');
const {DynamoDBClient}=require('@aws-sdk/client-dynamodb');
const {DynamoDBDocumentClient,GetCommand,QueryCommand,UpdateCommand,DeleteCommand}=require('@aws-sdk/lib-dynamodb');
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
async function codNoticeAllowed(client,item,at){
 if(item.type==='wallet_cash_payout'){
  if(typeof item.driverId!=='string'||!/^[A-Za-z0-9_-]{1,150}$/.test(item.driverId)||!/^DPO:[a-f0-9]{48}$/.test(item.payoutId||''))return false;
  const {Item:driver}=await client.send(new GetCommand({TableName:'WhizzDrivers_staging',Key:{driverId:item.driverId},ConsistentRead:true,ProjectionExpression:'driverId,cognitoSub,isDeleted,deletedAt,deletionRequestId'}));
  if(!driver||(driver.cognitoSub??driver.driverId)!==item.driverId||driver.isDeleted===true||driver.deletedAt!=null||driver.deletionRequestId!=null)return false;
  return !(await client.send(new GetCommand({TableName:'staging-AccountDeletion',Key:{pk:'ACCOUNT_LIFECYCLE#DRIVER#'+item.driverId,sk:'META'},ConsistentRead:true,ProjectionExpression:'pk,sk'}))).Item;
 }
 const dispatch=item.type==='dispatch_offer_closed';
 if(item.type!=='wallet_cod_lifecycle'&&!dispatch)return true;
 const mode=dispatch?process.env.DISPATCH_RESPONSE_NOTIFICATIONS_MODE:process.env.FINANCIAL_COD_NOTIFICATIONS_MODE;
 if(mode!=='REQUIRED'||process.env.STAGE!=='staging'||process.env.AWS_REGION!=='us-east-1'||process.env.FINANCIAL_COD_ACCOUNT_ID!=='699561669180')throw Error(dispatch?'DISPATCH_NOTICE_DISABLED':'COD_NOTICE_DISABLED');
 const driverId=dispatch?item.dispatchDriverId:item.financialDriverId,subjectId=dispatch?item.dispatchSubjectId:item.financialSubjectId;
 const rollout=require('./finance-rollout').createFinanceRollout({db:client,now:()=>at});await rollout.order(item.orderId,'NOTIFY');rollout.driver(item.orderId,driverId,subjectId);
 const valid=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_:#.-]{0,149}$/.test(v);
 if(![driverId,subjectId,item.branchId].every(valid)||item.driverId!==subjectId||item.recipientApp!=='driver')return false;
 if(dispatch&&(!Number.isFinite(Date.parse(item.dispatchNoticeExpiresAt))||Date.parse(item.dispatchNoticeExpiresAt)<=at))return false;
 if(dispatch&&(![item.offerId,item.orderId,item.cycleId].every(valid)||!/^DR:[a-f0-9]{48}:EVENT$/.test(item.responseOperationId||'')))return false;
 const {Item:driver}=await client.send(new GetCommand({TableName:'WhizzDrivers_staging',Key:{driverId},ConsistentRead:true,
  ProjectionExpression:'driverId,cognitoSub,isDeleted,deletedAt,deletionRequestId'}));
 if(!driver||(driver.cognitoSub??driver.driverId)!==subjectId||driver.isDeleted===true||driver.deletedAt!=null||driver.deletionRequestId!=null)return false;
 for(const pk of new Set(['ACCOUNT_LIFECYCLE#DRIVER#'+driverId,'ACCOUNT_LIFECYCLE#DRIVER#'+subjectId,'BUSINESS_LIFECYCLE#MERCHANT#'+item.branchId])){
  if((await client.send(new GetCommand({TableName:'staging-AccountDeletion',Key:{pk,sk:'META'},ConsistentRead:true,ProjectionExpression:'pk,sk'}))).Item)return false;
 }
 return true;
}

function createWorker(client,messaging,clock=()=>Date.now()){
 async function processEvent(eventId){
  const now=Math.floor(clock()/1000),owner=randomUUID(),table=process.env.WALLET_NOTIFICATIONS_TABLE;
  let item;
  // Scope discovery precedes taking a lease on a new financial/dispatch notice.
  if(process.env.FINANCIAL_COD_NOTIFICATIONS_MODE==='REQUIRED'||process.env.DISPATCH_RESPONSE_NOTIFICATIONS_MODE==='REQUIRED'){
   const selected=(await client.send(new GetCommand({TableName:table,Key:{eventId},ConsistentRead:true}))).Item;
   if(selected&&['wallet_cod_lifecycle','dispatch_offer_closed'].includes(selected.type)){
    const rollout=require('./finance-rollout').createFinanceRollout({db:client,now:clock});
    if(!rollout.containsOrder(selected.orderId))return;
    await rollout.order(selected.orderId,'NOTIFY');rollout.driver(selected.orderId,selected.dispatchDriverId??selected.financialDriverId,selected.dispatchSubjectId??selected.financialSubjectId);
   }
  }
  try{
   const result=await client.send(new UpdateCommand({TableName:table,Key:{eventId},UpdateExpression:'SET leaseOwner = :owner, leaseUntil = :lease ADD attempts :one',ConditionExpression:'deliveryStatus = :pending AND nextAttemptAt <= :now AND (attribute_not_exists(leaseUntil) OR leaseUntil < :now)',ExpressionAttributeValues:{':owner':owner,':lease':now+120,':one':1,':pending':'PENDING',':now':now},ReturnValues:'ALL_NEW'}));
   item=result.Attributes;
  }catch(error){if(error.name==='ConditionalCheckFailedException')return;throw error;}
  const delivered=new Set(item.deliveredTokenHashes || []);
  let retry=false,hadToken=false,suppressed=false;
  try{
   if(!await codNoticeAllowed(client,item,clock()))suppressed=true;
   let cursor;
   do{
    if(suppressed)break;
    const result=await client.send(new QueryCommand({TableName:process.env.PUSH_TOKENS_TABLE,IndexName:'SubjectIdIndex',KeyConditionExpression:'subjectId = :driver',ExpressionAttributeValues:{':driver':item.driverId},ExclusiveStartKey:cursor}));
    for(const record of result.Items || []){
     if(record.app!==(item.recipientApp || 'driver') || !record.token)continue;
     hadToken=true;
     const hash=digest(record.token);
     if(delivered.has(hash))continue;
     try{
      if(!await codNoticeAllowed(client,item,clock())){suppressed=true;break;}
      const sender=await messaging();
      await sender.send({token:record.token,notification:{title:item.title,body:item.body},data:item.type==='dispatch_offer_closed'?{type:'offer_taken',action:'remove_offer',eventId:item.eventId,driverId:item.driverId,offerId:item.offerId,orderId:item.orderId,cycleId:item.cycleId}:{type:item.type,eventId:item.eventId,driverId:item.driverId,topupId:item.topupId || '',amount:item.type==='wallet_cod_lifecycle'?'':String(item.amount || 0),reviewStatus:item.reviewStatus || '',action:item.type==='driver_review_changed'?'refresh_profile':'open_wallet'},android:{priority:'high',notification:{tag:item.eventId}},apns:{headers:{'apns-priority':'10','apns-push-type':'alert','apns-collapse-id':digest(item.eventId).slice(0,48)},payload:{aps:{sound:'default','content-available':1}}}});
      await client.send(new UpdateCommand({TableName:table,Key:{eventId},UpdateExpression:'ADD deliveredTokenHashes :hash',ConditionExpression:'leaseOwner = :owner',ExpressionAttributeValues:{':hash':new Set([hash]),':owner':owner}}));
      delivered.add(hash);
     }catch(error){
      if(['messaging/registration-token-not-registered','messaging/invalid-registration-token'].includes(error.code)){
       await client.send(new DeleteCommand({TableName:process.env.PUSH_TOKENS_TABLE,Key:{token:record.token}}));
      }else{retry=true;console.warn('Wallet push attempt failed',{eventId,code:error.code || error.name});}
     }
    }
    cursor=result.LastEvaluatedKey;
   }while(cursor&&!suppressed);
  }catch(error){retry=true;console.warn('Wallet push registry unavailable',{eventId,code:error.code || error.name});}
  if(!hadToken)retry=true;
  const expired=now-Math.floor(Date.parse(item.createdAt)/1000)>=86400 || item.attempts>=24;
  const status=suppressed?'SUPPRESSED':retry?(expired?'UNDELIVERABLE':'PENDING'):(delivered.size?'SENT':'UNDELIVERABLE');
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
