'use strict';
const {ScanCommand,GetCommand,PutCommand}=require('@aws-sdk/lib-dynamodb');
const {createHash}=require('node:crypto');
const {target}=require('./policy');
const PENDING=new Set(['READY','PENDING_SETTLEMENT','PENDING_EXTERNAL_ASSET','PENDING_POLICY','RETRY_REQUIRED','PROCESSING']);
function eligible(r,enabled){
 if(!enabled.has(r.actorType)||!PENDING.has(r.status)||typeof r.subjectId!=='string'||!/^[a-f0-9-]{36}$/.test(r.requestId||''))return false;
 if(r.pk!==`SUBJECT#${r.actorType}#${r.subjectId}`||r.sk!==`REQUEST#${r.requestId}`)return false;
 let scope;try{scope=target({type:r.actorType,sub:r.subjectId},r.scope);if(Object.keys(r.scope).length!==3||scope.kind!==r.scope.kind||scope.id!==r.scope.id||scope.type!==r.scope.type)return false;}catch(_){return false;}
 const fp=createHash('sha256').update(JSON.stringify([r.actorType,r.subjectId,scope,r.requestId])).digest('hex');
 // This attestation is written only inside the transaction consuming the OTP.
 if(r.fingerprint!==fp||r.verification?.method!=='PHONE_OTP'||!/^[a-f0-9-]{36}$/.test(r.verification.challengeId||'')||!Number.isSafeInteger(r.verification.verifiedAt))return false;
 return true;
}
async function runDeletionSweep({db,table,enabledTypes,processRequest,remainingTime=()=>300000,maxRequests=5,maxPages=20,onError=()=>{}}){
 if(table!=='staging-AccountDeletion')throw Error('INVALID_STAGING_TABLE');
 const enabled=new Set(enabledTypes);const key={pk:'SCHEDULER#ALL',sk:'META'};
 const {Item:saved}=await db.send(new GetCommand({TableName:table,Key:key,ConsistentRead:true}));
 let cursor=saved?.cursor,processed=0,failed=0,skipped=0,pages=0,stop=false;
 do{
  if(remainingTime()<60000)break;
  const p=await db.send(new ScanCommand({TableName:table,ExclusiveStartKey:cursor,Limit:50,ConsistentRead:true,FilterExpression:'begins_with(sk,:prefix)',ExpressionAttributeValues:{':prefix':'REQUEST#'}}));pages++;
  for(const r of p.Items||[]){
   cursor={pk:r.pk,sk:r.sk};
   if(eligible(r,enabled)){
    if(r.leaseUntil>Date.now()/1000){skipped++;continue;}
    try{await processRequest(r);processed++;}catch(e){failed++;onError({requestId:r.requestId,code:e.code||e.name||'SERVICE_ERROR'});}
   }else skipped++;
   if(processed+failed>=maxRequests||remainingTime()<60000){stop=true;break;}
  }
  if(!stop)cursor=p.LastEvaluatedKey;
 }while(!stop&&cursor&&pages<maxPages);
 await db.send(new PutCommand({TableName:table,Item:{...key,...(cursor?{cursor}:{}),updatedAt:new Date().toISOString()}}));
 return {processed,failed,skipped,pages};
}
module.exports={eligible,runDeletionSweep};
