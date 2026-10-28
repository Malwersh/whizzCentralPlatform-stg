'use strict';
const {randomUUID,createHash}=require('node:crypto');
const {POLICY,TABLE,validId}=require('./contract');
const {offerReference,ratingReference,buildProjection}=require('./model');
const SOURCES={offers:'WaveOffers_staging',orders:'WizzOrders',holds:'staging-Holds',drivers:'WhizzDrivers_staging',ratings:'whizz-order-ratings-staging'};
const conditional=e=>e?.name==='ConditionalCheckFailedException'||e?.name==='TransactionCanceledException';
function createWorker({db,sdk,readPerformance,readIncidents,now=()=>Date.now(),streams={},sourceHealth=async()=>false,enqueue=async()=>{}}){
 const {GetCommand,QueryCommand,PutCommand,UpdateCommand,TransactWriteCommand}=sdk;
 const get=async(table,key)=>(await db.send(new GetCommand({TableName:table,Key:key,ConsistentRead:true}))).Item;
 async function invalidate(driverId,eventId,refs=[]){
  if(!validId(driverId)||typeof eventId!=='string'||!eventId)throw Error('INVALID_PROJECTION_EVENT');
  const pk='DRIVER#'+driverId,token=createHash('sha256').update(eventId+'|'+driverId).digest('hex'),at=now();
  const receipt={pk:'EVENT#'+token,sk:'META',kind:'PERFORMANCE_EVENT',expiresAt:Math.floor(at/1000)+7*86400};
  const ops=[{Put:{TableName:TABLE,Item:receipt,ConditionExpression:'attribute_not_exists(pk)'}},{Update:{TableName:TABLE,Key:{pk,sk:'STATE'},UpdateExpression:'SET driverId=:driver, schemaVersion=:schema, policyVersion=:policy, queuePartition=:queue, nextAttemptAt=:now, invalidatedAt=:at ADD generation :one',ExpressionAttributeValues:{':driver':driverId,':schema':1,':policy':POLICY,':queue':'PERFORMANCE',':now':at,':at':new Date(at).toISOString(),':one':1}}}];
  for(const ref of refs){if(ref.driverId!==driverId)throw Error('REFERENCE_OWNER_MISMATCH');ops.push({Put:{TableName:TABLE,Item:{pk,sk:ref.sk,kind:'SOURCE_REFERENCE',source:ref.source,indexRow:ref.indexRow}}});}
  for(let attempt=0;;attempt++){
   try{await db.send(new TransactWriteCommand({TransactItems:ops}));return true;}catch(e){
    if(conditional(e)&&(await get(TABLE,{pk:receipt.pk,sk:receipt.sk}))?.kind==='PERFORMANCE_EVENT')return false;
    const conflict=e.name==='TransactionConflictException'||(e.CancellationReasons||[]).some(r=>r.Code==='TransactionConflict');
    if(!conflict||attempt>=6)throw e;
    await new Promise(resolve=>setTimeout(resolve,Math.min(1000,40*2**attempt)+Math.floor(Math.random()*30)));
   }
  }
 }
 async function orderDrivers(orderId){
  const ids=new Set();let key,pages=0;
  do{const q=await db.send(new QueryCommand({TableName:SOURCES.offers,KeyConditionExpression:'orderId=:order',ExpressionAttributeValues:{':order':orderId},ConsistentRead:true,Limit:100,...(key?{ExclusiveStartKey:key}:{})}));for(const row of q.Items||[]){const ref=offerReference(row);if(ref)ids.add(ref.driverId);}key=q.LastEvaluatedKey;if(++pages>20)throw Error('SOURCE_ORDER_HISTORY_INCOMPLETE');}while(key);
  return ids;
 }
 async function streamRecord(record){
  if(record.eventSource!=='aws:dynamodb'||!['INSERT','MODIFY','REMOVE'].includes(record.eventName)||!record.eventID)throw Error('INVALID_PROJECTION_SOURCE');
  const table=Object.keys(streams).find(t=>streams[t]===record.eventSourceARN);if(!table||!Object.values(SOURCES).includes(table))throw Error('INVALID_PROJECTION_SOURCE');
  const {unmarshall}=sdk,old=record.dynamodb?.OldImage?unmarshall(record.dynamodb.OldImage):null,next=record.dynamodb?.NewImage?unmarshall(record.dynamodb.NewImage):null,keys=unmarshall(record.dynamodb.Keys||{});
  const ids=new Set();if(table===SOURCES.drivers&&validId(keys.driverId))ids.add(keys.driverId);for(const row of [old,next]){if(validId(row?.driverId))ids.add(row.driverId);if(validId(row?.financialAcceptance?.driverId))ids.add(row.financialAcceptance.driverId);for(const a of row?.driverPerformanceDecisions||[])if(validId(a.driverId))ids.add(a.driverId);if(table===SOURCES.ratings&&row?.pk?.startsWith('DRIVER#')&&validId(row.pk.slice(7)))ids.add(row.pk.slice(7));}
  if([SOURCES.orders,SOURCES.holds].includes(table)){
   const orderId=keys.orderId||keys.PK?.replace(/^ORDER#/,'');if(validId(orderId))for(const driver of await orderDrivers(orderId))ids.add(driver);
  }
  // Always hydrate the current source: replaying an old stream image never overwrites a newer reference.
  const current=[SOURCES.offers,SOURCES.ratings].includes(table)?await get(table,keys):null,ref=table===SOURCES.offers?offerReference(current):table===SOURCES.ratings?ratingReference(current):null;
  if(ref)ids.add(ref.driverId);
  for(const driver of ids)await invalidate(driver,record.eventSourceARN+'|'+record.eventID,ref?.driverId===driver?[ref]:[]);
  return [...ids];
 }
 async function bootstrap(driverId){
  if(!validId(driverId))throw Error('INVALID_DRIVER');
  await invalidate(driverId,'BOOTSTRAP_START#'+POLICY+'#'+driverId);
  const pk='DRIVER#'+driverId,token=randomUUID(),at=now();
  try{await db.send(new UpdateCommand({TableName:TABLE,Key:{pk,sk:'STATE'},UpdateExpression:'SET bootstrapLeaseToken=:token, bootstrapLeaseUntil=:until',ConditionExpression:'attribute_not_exists(bootstrapLeaseUntil) OR bootstrapLeaseUntil<:now',ExpressionAttributeValues:{':token':token,':until':at+90000,':now':at}}));}catch(e){if(conditional(e))return false;throw e;}
  try{
   const state=await get(TABLE,{pk,sk:'STATE'});
   for(const kind of ['offers','ratings']){
    if(state[kind+'BackfillComplete'])continue;
    const cursor=state[kind+'BackfillCursor'];
    const q=kind==='offers'?{TableName:SOURCES.offers,IndexName:'driverId-sentAt-index',KeyConditionExpression:'driverId=:driver',ExpressionAttributeValues:{':driver':driverId}}:{TableName:SOURCES.ratings,IndexName:'DriverRatingChronology281',KeyConditionExpression:'#driver=:driver',ExpressionAttributeNames:{'#driver':'driverRatingKey'},ExpressionAttributeValues:{':driver':'DRIVER#'+driverId}};
    const result=await db.send(new QueryCommand({...q,ScanIndexForward:false,Limit:100,...(cursor?{ExclusiveStartKey:cursor}:{})}));
    for(let i=0;i<(result.Items||[]).length;i+=5){
     const refs=(await Promise.all(result.Items.slice(i,i+5).map(async row=>{
      const current=await get(q.TableName,kind==='offers'?{orderId:row.orderId,SK:row.SK}:{pk:row.pk});return kind==='offers'?offerReference(current):ratingReference(current);
     }))).filter(Boolean);
     if(refs.length)await invalidate(driverId,'BACKFILL#'+kind+'#'+refs.map(r=>r.sk).join('|'),refs);
    }
    const names={'#cursor':kind+'BackfillCursor',...(!result.LastEvaluatedKey?{'#done':kind+'BackfillComplete'}:{})};
    await db.send(new UpdateCommand({TableName:TABLE,Key:{pk,sk:'STATE'},UpdateExpression:result.LastEvaluatedKey?'SET #cursor=:cursor, nextAttemptAt=:due':'SET #done=:yes, nextAttemptAt=:due REMOVE #cursor',ConditionExpression:'bootstrapLeaseToken=:token',ExpressionAttributeNames:names,ExpressionAttributeValues:{':token':token,':due':now()+1000,...(result.LastEvaluatedKey?{':cursor':result.LastEvaluatedKey}:{':yes':true})}}));
    if(result.LastEvaluatedKey)return false;
   }
   await db.send(new UpdateCommand({TableName:TABLE,Key:{pk,sk:'STATE'},UpdateExpression:'SET bootstrapComplete=:yes',ConditionExpression:'bootstrapLeaseToken=:token',ExpressionAttributeValues:{':yes':true,':token':token}}));return true;
  }finally{await db.send(new UpdateCommand({TableName:TABLE,Key:{pk,sk:'STATE'},UpdateExpression:'REMOVE bootstrapLeaseToken, bootstrapLeaseUntil',ConditionExpression:'bootstrapLeaseToken=:token',ExpressionAttributeValues:{':token':token}})).catch(()=>{});}
 }
 function calculatorDB(driverId){return {send:async command=>{
  const q=command.input;
  const offers=q.TableName===SOURCES.offers&&q.IndexName==='driverId-sentAt-index',ratings=q.TableName===SOURCES.ratings&&q.IndexName==='DriverRatingChronology281';
  if(!offers&&!ratings)return db.send(command);
  const prefix=offers?'OFFER#':'RATING#',asOf=q.ExpressionAttributeValues[':asOf']||'~';
  const result=await db.send(new QueryCommand({TableName:TABLE,ConsistentRead:true,KeyConditionExpression:'pk=:pk AND sk BETWEEN :start AND :end',ExpressionAttributeValues:{':pk':'DRIVER#'+driverId,':start':prefix,':end':prefix+asOf+'#~'},ScanIndexForward:false,Limit:q.Limit,...(q.ExclusiveStartKey?{ExclusiveStartKey:q.ExclusiveStartKey}:{})}));
  return {...result,Items:(result.Items||[]).map(r=>r.indexRow)};
 }};}
 async function purge(driverId){
  const pk='DRIVER#'+driverId;
  await db.send(new UpdateCommand({TableName:TABLE,Key:{pk,sk:'STATE'},UpdateExpression:'SET inactive=:yes, queuePartition=:queue, nextAttemptAt=:due REMOVE #snapshot, detailsKey',ExpressionAttributeNames:{'#snapshot':'snapshot'},ExpressionAttributeValues:{':yes':true,':queue':'PERFORMANCE',':due':now()+1000}}));
  const result=await db.send(new QueryCommand({TableName:TABLE,KeyConditionExpression:'pk=:pk',ExpressionAttributeValues:{':pk':pk},ConsistentRead:true,Limit:100}));
  const rows=(result.Items||[]).filter(r=>r.sk!=='STATE');
  for(let i=0;i<rows.length;i+=25)await db.send(new TransactWriteCommand({TransactItems:rows.slice(i,i+25).map(r=>({Delete:{TableName:TABLE,Key:{pk,sk:r.sk}}}))}));
  if(!result.LastEvaluatedKey)await db.send(new TransactWriteCommand({TransactItems:[{Delete:{TableName:TABLE,Key:{pk,sk:'STATE'}}}]}));
  return {inactive:true,purgePending:!!result.LastEvaluatedKey};
 }
 async function refresh(driverId){
  const pk='DRIVER#'+driverId,state=await get(TABLE,{pk,sk:'STATE'});if(!state)return {skipped:true};
  const profile=await get(SOURCES.drivers,{driverId});
  if(!profile||profile.isDeleted===true||profile.deletedAt)return purge(driverId);
  if(!state.bootstrapComplete){await bootstrap(driverId);await enqueue([driverId]);return {bootstrapped:true};}
  if(state.generation===state.builtGeneration&&Date.parse(state.validUntil)>now())return {unchanged:true};
  const at=now(),token=randomUUID(),generation=state.generation;
  try{await db.send(new UpdateCommand({TableName:TABLE,Key:{pk,sk:'STATE'},UpdateExpression:'SET leaseToken=:token, leaseUntil=:until',ConditionExpression:'generation=:generation AND (attribute_not_exists(leaseUntil) OR leaseUntil<:now)',ExpressionAttributeValues:{':token':token,':until':at+90000,':generation':generation,':now':at}}));}catch(e){if(conditional(e))return {busy:true};throw e;}
  try{
   if(profile.deletionRequestId){await db.send(new UpdateCommand({TableName:TABLE,Key:{pk,sk:'STATE'},UpdateExpression:'SET inactive=:yes REMOVE #snapshot, detailsKey, queuePartition, nextAttemptAt, leaseToken, leaseUntil',ConditionExpression:'leaseToken=:token',ExpressionAttributeNames:{'#snapshot':'snapshot'},ExpressionAttributeValues:{':yes':true,':token':token}}));return {inactive:true};}
   const adapter=calculatorDB(driverId),tables={...SOURCES,ratingIndex:'DriverRatingChronology281'};
   const performance=await readPerformance({db:adapter,GetCommand,QueryCommand,driverId,tables,now:()=>at,rulesVersion:4}),quality=await readIncidents({db:adapter,GetCommand,QueryCommand,driverId,now:()=>at});
   const built=buildProjection(performance,quality,at),detailKey='DETAILS#'+generation+'#'+token;
   const detail={pk,sk:detailKey,policyVersion:POLICY,version:generation,details:built.details,expiresAt:Math.floor(now()/1000)+7*86400};
   // A pointer and its details are published atomically. No partially published version can be read.
   const ops=[{Put:{TableName:TABLE,Item:detail,ConditionExpression:'attribute_not_exists(pk)'}},{Update:{TableName:TABLE,Key:{pk,sk:'STATE'},UpdateExpression:'SET #snapshot=:snapshot, detailsKey=:details, builtGeneration=:generation, computedAt=:at, validUntil=:valid, queuePartition=:queue, nextAttemptAt=:due REMOVE leaseToken, leaseUntil, lastError, inactive',ConditionExpression:'generation=:generation AND leaseToken=:token',ExpressionAttributeNames:{'#snapshot':'snapshot'},ExpressionAttributeValues:{':snapshot':built.snapshot,':details':detailKey,':generation':generation,':token':token,':at':new Date(at).toISOString(),':valid':built.validUntil,':queue':'PERFORMANCE',':due':Date.parse(built.validUntil)}}}];
   if(Buffer.byteLength(JSON.stringify(detail))>340000||Buffer.byteLength(JSON.stringify(built.snapshot))>340000)throw Error('PROJECTION_SIZE_LIMIT');
   await db.send(new TransactWriteCommand({TransactItems:ops}));return {published:true,version:generation};
  }catch(e){await db.send(new UpdateCommand({TableName:TABLE,Key:{pk,sk:'STATE'},UpdateExpression:'SET nextAttemptAt=:retry, lastError=:error REMOVE leaseToken, leaseUntil',ConditionExpression:'leaseToken=:token',ExpressionAttributeValues:{':token':token,':retry':now()+5000,':error':'REFRESH_PENDING'}})).catch(()=>{});if(conditional(e))return {superseded:true};throw e;}
 }
 async function scheduled(){
  const at=now();await db.send(new PutCommand({TableName:TABLE,Item:{pk:'CONTROL',sk:'HEALTH',policyVersion:POLICY,healthy:await sourceHealth(),updatedAt:new Date(at).toISOString()}}));
  const due=await db.send(new QueryCommand({TableName:TABLE,IndexName:'ByDue',KeyConditionExpression:'queuePartition=:queue AND nextAttemptAt<=:now',ExpressionAttributeValues:{':queue':'PERFORMANCE',':now':at},Limit:8}));
  const result=[];for(let i=0;i<(due.Items||[]).length;i+=4)result.push(...await Promise.all(due.Items.slice(i,i+4).map(r=>refresh(r.driverId))));return {processed:result.length};
 }
 async function handle(event){
  if(Array.isArray(event?.Records)&&event.Records.some(r=>r.eventSource==='aws:sqs')){
   const failures=[],byDriver=new Map();
   for(const r of event.Records){try{if(r.eventSource!=='aws:sqs'||r.eventSourceARN!=='arn:aws:sqs:us-east-1:699561669180:staging-driver-performance-refresh')throw Error();const body=JSON.parse(r.body);if(Object.keys(body).join(',')!=='driverId'||!validId(body.driverId))throw Error();if(!byDriver.has(body.driverId))byDriver.set(body.driverId,[]);byDriver.get(body.driverId).push(r.messageId);}catch{failures.push({itemIdentifier:r.messageId});}}
   await Promise.all([...byDriver].map(async([driverId,ids])=>{try{await refresh(driverId);}catch{failures.push(...ids.map(id=>({itemIdentifier:id})));}}));return {batchItemFailures:failures};
  }
  if(Array.isArray(event?.Records)){const failures=[],drivers=new Set();for(const r of event.Records){try{for(const id of await streamRecord(r))drivers.add(id);}catch{failures.push({itemIdentifier:r.dynamodb?.SequenceNumber||r.eventID});}}
   await enqueue([...drivers]);if(event.kind==='ORDER_FORWARD'&&failures.length)throw Error('FORWARDED_ORDER_REFRESH_PENDING');return {batchItemFailures:failures};}
  if(event?.kind==='SCHEDULE')return scheduled();
  if(event?.kind==='BACKFILL'&&Array.isArray(event.driverIds)&&event.driverIds.length<=20&&event.driverIds.every(validId)){if(event.requestId!==undefined&&!/^[a-f0-9-]{36}$/i.test(event.requestId))throw Error('INVALID_REBUILD_REQUEST');for(const id of event.driverIds){if(event.requestId)await invalidate(id,'REBUILD#'+event.requestId);await bootstrap(id);await refresh(id);}return {requested:event.driverIds.length};}
  throw Error('INVALID_PROJECTION_EVENT');
 }
 return {invalidate,streamRecord,bootstrap,refresh,scheduled,handle,calculatorDB};
}
module.exports={createWorker,SOURCES};
