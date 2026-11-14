'use strict';
const {randomUUID,randomInt,createHmac,createHash,timingSafeEqual}=require('node:crypto');
const {GetCommand,UpdateCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {target,error}=require('./policy');
function fingerprint(actor,input){
 if(!/^[a-f0-9-]{36}$/.test(input.requestId||''))throw error('INVALID_REQUEST_ID');
 return createHash('sha256').update(JSON.stringify([actor.type,actor.sub,target(actor,input.scope),input.requestId])).digest('hex');
}
const signature=(secret,id,fp,code)=>createHmac('sha256',secret).update(JSON.stringify(['account-deletion',id,fp,code])).digest('hex');
function deletionVerification({db,table,secret,deliver,clock=()=>Math.floor(Date.now()/1000)}){
 if(!table?.startsWith('staging-')||!db||!secret||!deliver)throw error('VERIFICATION_NOT_CONFIGURED');
 const read=async(pk)=>(await db.send(new GetCommand({TableName:table,Key:{pk,sk:'META'},ConsistentRead:true}))).Item;
 const activeKey=a=>`VERIFY_ACTIVE#${a.type}#${a.sub}`;
 async function send(actor,input){
  const fp=fingerprint(actor,input),phone=actor.attrs?.phone_number;
  if(actor.attrs?.phone_number_verified!=='true'||!/^\+9647\d{9}$/.test(phone||''))throw error('PHONE_VERIFICATION_REQUIRED');
  const time=clock(),day=Math.floor(time/86400),id=randomUUID(),key=await secret(),code=String(randomInt(0,1000000)).padStart(6,'0');
  if(!key.hmacKey||!key.apiKey)throw error('VERIFICATION_UNAVAILABLE');
  const limits=[{pk:`DELETE_COOLDOWN#${actor.type}#${actor.sub}`,cooldown:true},{pk:`DELETE_DAILY#${day}#${actor.type}#${actor.sub}`,limit:10},{pk:`DELETE_GLOBAL#${day}`,limit:200}];
  await db.send(new TransactWriteCommand({TransactItems:[...limits.map(q=>({Update:{TableName:table,Key:{pk:q.pk,sk:'META'},UpdateExpression:q.cooldown?'SET nextAllowedAt = :next, expiresAt = :ttl':'SET expiresAt = :ttl ADD sends :one',ConditionExpression:q.cooldown?'attribute_not_exists(nextAllowedAt) OR nextAllowedAt <= :now':'attribute_not_exists(sends) OR sends < :limit',ExpressionAttributeValues:q.cooldown?{':next':time+60,':now':time,':ttl':time+86400}:{':ttl':time+172800,':one':1,':limit':q.limit}}})),{Put:{TableName:table,Item:{pk:'CHALLENGE#'+id,sk:'META',purpose:'account-deletion',subjectId:actor.sub,actorType:actor.type,fingerprint:fp,expiresAt:time+300,used:false,attempts:0,digest:signature(key.hmacKey,id,fp,code)},ConditionExpression:'attribute_not_exists(pk)'}},{Put:{TableName:table,Item:{pk:activeKey(actor),sk:'META',challengeId:id,expiresAt:time+300}}}]}));
  await deliver(key,phone,code); // Provider adapter must reject non-2xx, never log code/phone/key.
  return {challengeId:id,phoneHint:'••••'+phone.slice(-4),expiresIn:300,resendAfter:60};
 }
 async function verify(actor,input){
  const fp=fingerprint(actor,input),time=clock();
  if(!/^[a-f0-9-]{36}$/.test(input.challengeId||'')||!/^\d{6}$/.test(input.code||''))throw error('INVALID_CODE');
  const [record,active]=await Promise.all([read('CHALLENGE#'+input.challengeId),read(activeKey(actor))]);
  if(!record||record.purpose!=='account-deletion'||record.subjectId!==actor.sub||record.actorType!==actor.type||record.fingerprint!==fp||active?.challengeId!==input.challengeId||record.used||record.expiresAt<=time||record.attempts>=5)throw error('INVALID_CODE');
  const key=await secret(),expected=Buffer.from(record.digest,'hex'),actual=Buffer.from(signature(key.hmacKey,input.challengeId,fp,input.code),'hex');
  const correct=expected.length===actual.length&&timingSafeEqual(expected,actual);
  const update={TableName:table,Key:{pk:record.pk,sk:'META'},UpdateExpression:correct?'SET verifiedAt = :at ADD attempts :one':'ADD attempts :one',ConditionExpression:'used = :no AND attempts < :max AND expiresAt > :now'+(correct?' AND attribute_not_exists(verifiedAt)':''),ExpressionAttributeValues:{':no':false,':max':5,':now':time,':one':1,...(correct?{':at':time}:{})}};
  if(record.verifiedAt&&correct)return {challengeId:input.challengeId,fingerprint:fp};
  await db.send(new TransactWriteCommand({TransactItems:[{ConditionCheck:{TableName:table,Key:{pk:activeKey(actor),sk:'META'},ConditionExpression:'challengeId = :id',ExpressionAttributeValues:{':id':input.challengeId}}},{Update:update}]}));
  if(!correct)throw error('INVALID_CODE');
  return {challengeId:input.challengeId,fingerprint:fp};
 }
 return {send,verify};
}
module.exports={deletionVerification,fingerprint,signature};
