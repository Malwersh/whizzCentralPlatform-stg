'use strict';
const {createHash,createHmac}=require('node:crypto');
const {GetCommand,PutCommand}=require('@aws-sdk/lib-dynamodb');
const {error,target}=require('./policy');
const receiptToken=(key,fingerprint)=>createHmac('sha256',key).update('deletion-receipt#'+fingerprint).digest('base64url');
const tokenHash=token=>createHash('sha256').update(token).digest('hex');
function receiptAccess({db,table,store,secret,clock=()=>Math.floor(Date.now()/1000)}){
 const issue=async(actor,record)=>{
   if(record.subjectId!==actor.sub||record.actorType!==actor.type)throw error('UNAUTHORIZED');
   const key=await secret(),token=receiptToken(key.hmacKey,record.fingerprint);
   await db.send(new PutCommand({TableName:table,Item:{pk:'RECEIPT#'+tokenHash(token),sk:'META',subjectId:actor.sub,actorType:actor.type,requestId:record.requestId,expiresAt:clock()+90*86400}}));
   return token;
  };
 return {
  issue,
  async prepare(actor,input){
   if(!/^[a-f0-9-]{36}$/.test(input.requestId||''))throw error('INVALID_REQUEST_ID');
   const fingerprint=createHash('sha256').update(JSON.stringify([actor.type,actor.sub,target(actor,input.scope),input.requestId])).digest('hex');
   return issue(actor,{actorType:actor.type,subjectId:actor.sub,requestId:input.requestId,fingerprint});
  },
  async read(token){
   if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))throw error('UNAUTHORIZED');
   const {Item}=await db.send(new GetCommand({TableName:table,Key:{pk:'RECEIPT#'+tokenHash(token),sk:'META'},ConsistentRead:true}));
   if(!Item||Item.expiresAt<=clock())throw error('UNAUTHORIZED');
   const record=await store.get({type:Item.actorType,sub:Item.subjectId},Item.requestId);
   if(!record)return {request:null};
   if(record.subjectId!==Item.subjectId||record.actorType!==Item.actorType)throw error('UNAUTHORIZED');
   return {request:{requestId:record.requestId,status:record.status,blockers:record.blockers||[],updatedAt:record.updatedAt}};
  }
 };
}
module.exports={receiptAccess,receiptToken,tokenHash};
