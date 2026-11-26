const {dispatchOfferSK}=require('../../src/utils/dispatch-cycle-keys');
import {DynamoDBDocumentClient,QueryCommand,TransactWriteCommand} from '@aws-sdk/lib-dynamodb';
import {dispatchResponseQueue,DISPATCH_RESPONSE_QUEUE} from './dispatchResponseEvent';
import {strongGet,exactCheck,updateChecked,equal,FinancialRow as Row} from './driverFinancialTransaction';
import {quoteHash,quoteEntityIdValid} from './deliveryQuoteRecord';
import {validateDispatchCycle} from './dispatchCycle';
import {composeDispatchTransaction} from './dispatchTransaction';
const T={events:'staging-WalletLifecycle',jobs:'WizzDispatchJobs_staging',offers:'WaveOffers_staging',orders:'WizzOrders',drivers:'WhizzDrivers_staging',deletions:'staging-AccountDeletion',notices:'staging-WalletNotifications'};
const fail=():never=>{throw Error('DISPATCH_RESPONSE_PROOF_REQUIRED');};
const key=(r:Row)=>({orderId:r.orderId,SK:'DISPATCH_RESPONSE#'+r.eventId});
/** Internal consumer of existing queues. No wallet/hold/ledger or performance writes.
 * Each loser closure and its notice are atomic. Final acknowledgement is separate;
 * retry resumes prior closures without rewriting them or creating another notice.
 */
export function createStagingDispatchResponseIntegration(options:{db:Pick<DynamoDBDocumentClient,'send'>;now?:()=>number;notificationDelivery?:'HELD'|'PENDING'}){
 const {db}=options,now=options.now??Date.now,delivery=options.notificationDelivery??'HELD';
 if(!['HELD','PENDING'].includes(delivery))throw Error('INVALID_DISPATCH_NOTICE_DELIVERY');
 async function commit(ops:Row[],guards:Row[]=[]){const tx=composeDispatchTransaction(ops,guards);await db.send(new TransactWriteCommand({TransactItems:tx as any,ClientRequestToken:quoteHash(tx).slice(0,36)}));}
 function finish(q:Row,e:Row,status:string,extra:Row={}){
  const at=new Date(now()).toISOString(),names:Row={'#s':'status','#at':'integratedAt','#v':'integrationVersion','#q':'queuePartition','#n':'nextAttemptAt'},values:Row={':s':status,':at':at,':v':1};
  const fields=Object.entries(extra).map(([k,v],i)=>{names['#x'+i]=k;values[':x'+i]=v;return '#x'+i+'=:x'+i;});
  return [updateChecked(exactCheck(T.events,{operationId:q.operationId},q),'SET #s=:s,#at=:at,#v=:v'+(fields.length?','+fields.join(','):'')+' REMOVE #q,#n',names,values),updateChecked(exactCheck(T.jobs,key(e),e),'SET #s=:s,#at=:at',{'#s':'state','#at':'integratedAt'},{':s':status,':at':at})];
 }

 async function party(driverId:string,subjectId:string,branchId:string){
  const guards:Row[]=[];
  for(const pk of new Set(['ACCOUNT_LIFECYCLE#DRIVER#'+driverId,'ACCOUNT_LIFECYCLE#DRIVER#'+subjectId,'BUSINESS_LIFECYCLE#MERCHANT#'+branchId])){
   const k={pk,sk:'META'},r=await strongGet(db,T.deletions,k);if(r)return {suppressed:true,guards:[exactCheck(T.deletions,k,r)]};
   guards.push({ConditionCheck:{TableName:T.deletions,Key:k,ConditionExpression:'attribute_not_exists(pk)'}});
  }
  const profile=await strongGet(db,T.drivers,{driverId});
  if(!profile||(profile.cognitoSub??profile.driverId)!==subjectId)return fail();
  if(profile.isDeleted===true||profile.deletedAt!=null||profile.deletionRequestId!=null)return {suppressed:true,guards:[...guards,exactCheck(T.drivers,{driverId},profile)]};
  guards.push(exactCheck(T.drivers,{driverId},profile,[...new Set([...Object.keys(profile),'isDeleted','deletedAt','deletionRequestId'])]));return {suppressed:false,guards};
 }
 async function processEvent(operationId:string){
  if(typeof operationId!=='string'||!/^DR:[a-f0-9]{48}:EVENT$/.test(operationId))return fail();
  const q=await strongGet(db,T.events,{operationId});if(!q)return {missing:true};
  if(q.kind!=='DISPATCH_RESPONSE_INTEGRATION'||q.integrationSchemaVersion!==1||q.operationId!==q.eventId+':EVENT')return fail();
  if(['INTEGRATED','SUPPRESSED_DELETION','INTEGRATION_REVIEW_REQUIRED'].includes(q.status))return {status:q.status,replayed:true};
  if(q.status!=='PENDING_INTEGRATION'||q.queuePartition!==DISPATCH_RESPONSE_QUEUE||!Number.isSafeInteger(q.nextAttemptAt)||!Number.isSafeInteger(q.integrationAttempts)||q.integrationAttempts<0||q.integrationAttempts>=20)return fail();
  if(q.nextAttemptAt>Math.floor(now()/1000))return {deferred:true};
  const e=await strongGet(db,T.jobs,key(q));if(!e)return fail();
  const rebuilt:Row=dispatchResponseQueue(e).Put.Item;
  for(const k of Object.keys(rebuilt).filter(k=>!['status','queuePartition','nextAttemptAt','integrationAttempts'].includes(k)))if(!equal(q[k],rebuilt[k]))return fail();
  if(e.state!=='PENDING')return fail();
  try{
   const owner=await party(q.driverId,q.subjectId,q.branchId);
   if(owner.suppressed){await commit(finish(q,e,'SUPPRESSED_DELETION'),owner.guards);return {status:'SUPPRESSED_DELETION'};}
   const job=await strongGet(db,T.jobs,{orderId:q.orderId,SK:'METADATA'}),cycle=validateDispatchCycle(job?.dispatchCycle);
   const order=await strongGet(db,T.orders,{PK:'ORDER#'+q.orderId,SK:'META'});
   const sourceKey={orderId:q.orderId,SK:dispatchOfferSK(cycle,q.driverId,q.waveNumber)},offer=await strongGet(db,T.offers,sourceKey);
   if(cycle.engine!=='LEGACY'||cycle.id!==q.cycleId||cycle.assignmentId!==q.assignmentId||job?.restaurantId!==q.branchId||!order||order.orderId!==q.orderId||![order.storeId,order.businessId].some(v=>v===q.branchId)||[order.storeId,order.businessId].some(v=>v!==undefined&&v!==q.branchId)||!offer||offer.orderId!==q.orderId||offer.driverId!==q.driverId||offer.dispatchJobId!==q.assignmentId||offer.offerId!==q.offerId||offer.dispatchCycleId!==q.cycleId||offer.driverSubjectId!==q.subjectId||offer.waveNumber!==q.waveNumber)return fail();
   const accepted=q.eventType==='ACCEPTED',receipt=offer.dispatchReceipt;
   if(accepted?offer.responseStatus!=='accepted'||offer.isWinner!==true||receipt?.success!==true||receipt.kind!=='PINNED_LEGACY_ACCEPTANCE'||receipt.driverId!==q.driverId||receipt.subjectId!==q.subjectId||receipt.offerId!==q.offerId||receipt.orderId!==q.orderId||receipt.acceptedAt!==q.createdAt:offer.responseStatus!=='rejected'||offer.isWinner!==false||offer.responseAt!==q.createdAt)return fail();
   const guards=[...owner.guards,exactCheck(T.jobs,{orderId:q.orderId,SK:'METADATA'},job!),exactCheck(T.orders,{PK:order.PK,SK:order.SK},order,[...new Set([...Object.keys(order),'deletionRequestId','isDeleted','deletedAt','deletionStatus'])]),exactCheck(T.offers,sourceKey,offer),exactCheck(T.events,{operationId},q),exactCheck(T.jobs,key(e),e)];
   if(order.isDeleted===true||order.deletedAt!=null||order.deletionRequestId!=null||order.deletionStatus!=null)return fail();
   let closed=0;
   if(accepted){
    let cursor:Row|undefined;const rows:Row[]=[];
    for(let page=0;page<5;page++){
     const result=await db.send(new QueryCommand({TableName:T.offers,KeyConditionExpression:'#id=:id',ExpressionAttributeNames:{'#id':'orderId'},ExpressionAttributeValues:{':id':q.orderId},ConsistentRead:true,Limit:25,ExclusiveStartKey:cursor}));rows.push(...result.Items??[]);cursor=result.LastEvaluatedKey;if(!cursor)break;
    }
    if(cursor||rows.length>100)throw Error('DISPATCH_RESPONSE_READING_LIMIT');
    // Complete the inventory and validate all scope before the first write.
    const targets=rows.filter(r=>r.dispatchCycleId===q.cycleId&&r.offerId!==q.offerId);
    if(new Set(targets.map(r=>r.SK)).size!==targets.length||targets.some(r=>r.orderId!==q.orderId||!quoteEntityIdValid(r.driverId)||!quoteEntityIdValid(r.driverSubjectId)||!quoteEntityIdValid(r.offerId)||!Number.isSafeInteger(r.waveNumber)||r.SK!==dispatchOfferSK(cycle,r.driverId,r.waveNumber)||r.dispatchJobId!==q.assignmentId||!Number.isFinite(Date.parse(r.expiresAt))||new Date(r.expiresAt).toISOString()!==r.expiresAt||r.isWinner!==false||!['pending','rejected','expired','order_assigned_to_other'].includes(r.responseStatus)))return fail();
    for(const target of targets){
     if(target.responseStatus==='order_assigned_to_other'){const id='DISPATCH_NOTICE:'+quoteHash({operationId,offerId:target.offerId}).slice(0,48),notice=await strongGet(db,T.notices,{eventId:id});if(target.dispatchClosureEventId!==id||notice?.responseOperationId!==operationId||notice.offerId!==target.offerId||notice.driverId!==target.driverSubjectId)return fail();continue;}
     if(target.responseStatus!=='pending')continue;
     const recipient=await party(target.driverId,target.driverSubjectId,q.branchId),noticeId='DISPATCH_NOTICE:'+quoteHash({operationId,offerId:target.offerId}).slice(0,48),at=new Date(now()).toISOString();
     const notice={eventId:noticeId,type:'dispatch_offer_closed',recipientApp:'driver',driverId:target.driverSubjectId,dispatchDriverId:target.driverId,dispatchSubjectId:target.driverSubjectId,branchId:q.branchId,orderId:q.orderId,offerId:target.offerId,cycleId:q.cycleId,responseOperationId:operationId,dispatchNoticeExpiresAt:target.expiresAt,title:'انتهى عرض التوصيل',body:'أُسند الطلب إلى سائق آخر. حدّث قائمة العروض.',createdAt:at,deliveryStatus:recipient.suppressed||Date.parse(target.expiresAt)<=now()?'SUPPRESSED':delivery,attempts:0,nextAttemptAt:0};
     const close=updateChecked(exactCheck(T.offers,{orderId:q.orderId,SK:target.SK},target),'SET #s=:s,#at=:at,#event=:event',{'#s':'responseStatus','#at':'responseAt','#event':'dispatchClosureEventId'},{':s':'order_assigned_to_other',':at':at,':event':noticeId});
     try{await commit([close,{Put:{TableName:T.notices,Item:notice,ConditionExpression:'attribute_not_exists(eventId)'}}],[...guards,...recipient.guards]);closed++;}
     catch(error){const saved=await strongGet(db,T.offers,{orderId:q.orderId,SK:target.SK}),savedNotice=await strongGet(db,T.notices,{eventId:noticeId});if(saved?.responseStatus==='rejected'||saved?.responseStatus==='expired')continue;if(saved?.responseStatus!=='order_assigned_to_other'||saved.dispatchClosureEventId!==noticeId||savedNotice?.responseOperationId!==operationId||savedNotice.offerId!==target.offerId||savedNotice.driverId!==target.driverSubjectId)throw error;}
    }
   }
   await commit(finish(q,e,'INTEGRATED',{integrationResult:'RESPONSE_RECORDED_PERFORMANCE_PENDING'}),guards);
   return {status:'INTEGRATED',closed};
  }catch(error:any){
   const fresh=await strongGet(db,T.events,{operationId});if(fresh?.status==='INTEGRATED'||fresh?.status==='SUPPRESSED_DELETION')return {status:fresh.status,replayed:true};if(!equal(q,fresh))return {retry:true};
   const attempts=q.integrationAttempts+1,review=error?.message==='DISPATCH_RESPONSE_PROOF_REQUIRED'||attempts>=20;
   const status=review?'INTEGRATION_REVIEW_REQUIRED':'PENDING_INTEGRATION';
   try{if(review)await commit(finish(q,e,status,{integrationAttempts:attempts,integrationError:'DISPATCH_RESPONSE_REVIEW_REQUIRED'}));else await commit([updateChecked(exactCheck(T.events,{operationId},q),'SET #a=:a,#n=:n',{'#a':'integrationAttempts','#n':'nextAttemptAt'},{':a':attempts,':n':Math.floor(now()/1000)+Math.min(900,15*2**Math.min(attempts,6))})]);}catch(retryError:any){if(retryError?.name!=='TransactionCanceledException')throw retryError;}
   return {status};
  }
 }
 async function run(){let cursor:Row|undefined,processed=0,failed=0;for(let page=0;page<2;page++){const r=await db.send(new QueryCommand({TableName:T.events,IndexName:'ByDue',KeyConditionExpression:'#q=:q AND #n<=:now',ExpressionAttributeNames:{'#q':'queuePartition','#n':'nextAttemptAt'},ExpressionAttributeValues:{':q':DISPATCH_RESPONSE_QUEUE,':now':Math.floor(now()/1000)},Limit:25,ExclusiveStartKey:cursor}));for(const row of r.Items??[]){try{await processEvent(row.operationId);}catch{failed++;}processed++;}cursor=r.LastEvaluatedKey;if(!cursor)break;}return {processed,failed};}
 return {processEvent,run};
}
