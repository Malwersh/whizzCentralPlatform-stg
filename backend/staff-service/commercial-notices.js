'use strict';
// Durable delivery intent is committed with the sharing draft. No credentials or financial values in push payloads.
const {GetCommand,ScanCommand,UpdateCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {LambdaClient,InvokeCommand}=require('@aws-sdk/client-lambda');
const S='staging-PlatformStaff',TARGET='wizzcentral-notifications-staging-pushSendMerchantOrder';
function notice(draft){return {pk:draft.pk,sk:'NOTICE#'+draft.version,ownerId:draft.ownerId,businessId:draft.businessIds[0],draftVersion:draft.version,draftHash:draft.hash,eventId:(draft.kind==='DELIVERY'?'delivery:':'sharing:')+draft.id+':'+draft.version,status:'PENDING',createdAt:draft.createdAt,expiresAt:draft.values.effectiveTo,attempts:0,nextAttemptAt:0,leaseUntil:0,sentTokenHashes:[]};}
async function tick({db,invoke,now=Date.now}){
 const clock=()=>Math.floor(now()/1000),lambda=invoke?null:new LambdaClient({});
 const send=invoke|| (async payload=>{const r=await lambda.send(new InvokeCommand({FunctionName:TARGET,InvocationType:'RequestResponse',Payload:Buffer.from(JSON.stringify(payload))}),{abortSignal:AbortSignal.timeout(5000)});if(r.FunctionError)throw Error('NOTICE_PROVIDER_UNAVAILABLE');return JSON.parse(Buffer.from(r.Payload).toString());});
 const cursorKey={pk:'SYSTEM_COMMERCIAL_NOTICES',sk:'CURSOR'};let cursor=(await db.send(new GetCommand({TableName:S,Key:cursorKey,ConsistentRead:true}))).Item?.cursor,scanned=0,sent=0,handled=0,providerCodes=[];
 outer:for(let page=0;page<10;page++){
  const result=await db.send(new ScanCommand({TableName:S,Limit:100,ConsistentRead:true,...(cursor?{ExclusiveStartKey:cursor}:{}),FilterExpression:'(begins_with(pk,:pk) OR begins_with(pk,:delivery)) AND begins_with(sk,:sk)',ExpressionAttributeValues:{':pk':'DISCOUNT_FUNDING#',':delivery':'DELIVERY_FUNDING#',':sk':'NOTICE#'}}));
  for(const row of result.Items||[]){scanned++;if(!['PENDING','RETRY'].includes(row.status)||row.nextAttemptAt>clock()||row.leaseUntil>clock())continue;
   let claimed;try{claimed=(await db.send(new UpdateCommand({TableName:S,Key:{pk:row.pk,sk:row.sk},UpdateExpression:'SET leaseUntil=:lease ADD attempts :one',ConditionExpression:'#s=:s AND leaseUntil=:old AND attempts=:a',ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':lease':clock()+90,':one':1,':s':row.status,':old':row.leaseUntil,':a':row.attempts},ReturnValues:'ALL_NEW'}))).Attributes;}catch(e){if(e.name==='ConditionalCheckFailedException')continue;throw e;}
   let outcome;try{outcome=await send({action:'commercial_notice',pk:row.pk,sk:row.sk});}catch{outcome={retry:true,failureCodes:['NOTICE_PROVIDER_UNAVAILABLE']};}
   providerCodes.push(...(outcome.failureCodes||[]));
   const completed=outcome.cancelled||outcome.complete,status=outcome.cancelled?'CANCELLED':outcome.complete?'SENT':'RETRY';if(outcome.complete)sent++;
   await db.send(new UpdateCommand({TableName:S,Key:{pk:row.pk,sk:row.sk},UpdateExpression:'SET #s=:s, leaseUntil=:zero, nextAttemptAt=:next, sentTokenHashes=:hashes',ConditionExpression:'leaseUntil=:lease AND attempts=:a',ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':s':status,':zero':0,':next':completed?0:clock()+(outcome.noDevices?300:Math.min(900,60*claimed.attempts)),':hashes':[...new Set([...(claimed.sentTokenHashes||[]),...(outcome.sentTokenHashes||[])])],':lease':claimed.leaseUntil,':a':claimed.attempts}}));
   if(++handled>=3)break outer;
  }
  cursor=result.LastEvaluatedKey;if(!cursor)break;
 }
 await db.send(new UpdateCommand({TableName:S,Key:cursorKey,UpdateExpression:'SET #c=:c',ExpressionAttributeNames:{'#c':'cursor'},ExpressionAttributeValues:{':c':cursor||null}}));return {scanned,sent,more:!!cursor,providerCodes:[...new Set(providerCodes)]};
}
module.exports={notice,tick};
