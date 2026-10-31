'use strict';
// Scheduled discovery and escalation only. Never writes orders, drivers, holds,
// offers or decisions, and never starts/cancels a dispatch cycle.
const {QueryCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const F=require('./dispatch-followup-core');
const T='staging-PlatformStaff',J='WizzDispatchJobs_staging',O='WizzOrders',B='WhizzMerchants_Businesses',D='staging-AccountDeletion';
const cursorKey={pk:'CONTROL#DISPATCH_FOLLOWUP_HOST',sk:'CURSOR'};
function createMonitor({db,now=Date.now,remainingMs=()=>60000,historicalContainsOrder}){
 async function load(orderId,includeClosed=false){
  const job=await F.get(db,J,{orderId,SK:'METADATA'});if(!job)return null;
  const order=await F.get(db,O,{PK:'ORDER#'+orderId,SK:'META'});
  if(!includeClosed&&order&&(!['pending','confirmed','preparing','ready_for_pickup'].includes(order.status)||order.driverId||order.assignedDriverId||order.pickedUpAt||order.deliveredAt||order.completedAt))return null;
  const branch=await F.get(db,B,{businessId:job.restaurantId});
  if(!order||!branch||![order.storeId,order.businessId].includes(job.restaurantId)||order.storeId&&order.businessId&&order.storeId!==order.businessId)return null;
  const orderLock={pk:'ORDER_LIFECYCLE#'+orderId,sk:'META'},branchLock={pk:'BUSINESS_LIFECYCLE#MERCHANT#'+job.restaurantId,sk:'META'},ownerLock={pk:'ACCOUNT_LIFECYCLE#MERCHANT#'+branch.ownerId,sk:'META'};
  const locks=await Promise.all([orderLock,branchLock,ownerLock].map(k=>F.get(db,D,k)));
  const deleted=locks.some(Boolean)||order.isDeleted===true||order.deletedAt!=null||order.deletionRequestId!=null||branch.isDeleted===true||branch.deletedAt!=null||branch.deletionRequestId!=null;
  const active=!deleted&&job.status==='no_driver_available'&&(job.dispatchReview?.reviewStatus==='REQUIRED'||job.financialDispatch===true&&job.financialSearchVersion===1)&&['pending','confirmed','preparing','ready_for_pickup'].includes(order.status)&&!order.driverId&&!order.assignedDriverId&&!order.pickedUpAt&&!order.deliveredAt&&!order.completedAt;
  const restart=await F.restartProgress(db,job,true);
  const cycle=job.dispatchCycle?.id??job.dispatchJobId;if(typeof cycle!=='string')return null;
  const pin=order.financeRollout;
  if(process.env.FINANCE_GENERAL_RELEASE_MODE==='REQUIRED'&&!historicalContainsOrder?.(orderId)&&(!pin||pin.schemaVersion!==2||pin.scopeId!=='GENERAL_STAGING_FULL_CASH_V1'||pin.version!==1||!/^([a-f0-9]{64})$/.test(pin.digest??'')))return null;
  const caseId=F.hash({orderId,source:'SEARCH',cycle});
  const guards=[F.exact(J,{orderId,SK:'METADATA'},job,['status','dispatchCycle','dispatchJobId','updatedAt','restaurantId','financialSearchVersion','financialDispatch','dispatchReview','dispatchRestart','dispatchReviewOutcome']),F.exact(O,{PK:'ORDER#'+orderId,SK:'META'},order,['status','driverId','assignedDriverId','pickedUpAt','deliveredAt','completedAt','storeId','businessId','financeRollout','isDeleted','deletedAt','deletionRequestId']),F.exact(B,{businessId:job.restaurantId},branch,['businessId','ownerId','regionId','isDeleted','deletedAt','deletionRequestId']),...[orderLock,branchLock,ownerLock].map((k,i)=>F.exact(D,k,locks[i],['pk']))];
  return {job,order,branch,active,deleted,caseId,guards,restart};
 }
 async function observe(orderId,expectedCase){
  const c=await load(orderId,!!expectedCase);if(!c)return {skipped:true};
  const caseId=expectedCase??c.caseId,old=await F.get(db,T,F.key(caseId));
  if(old&&(old.orderId!==orderId||old.branchId!==c.branch.businessId))throw Error('FOLLOWUP_SOURCE_BINDING_CHANGED');
  if(expectedCase&&(!old||old.status!=='OPEN'))return {skipped:true};
  if(!old&&!c.active)return {skipped:true};
  const time=now(),p=await F.policy(db,T);
  let next=old??F.initial({caseId,orderId,source:'SEARCH',branchId:c.branch.businessId,regionId:c.branch.regionId},c.job,p,time);
  const waitingRestart=!!c.restart?.waiting&&c.restart.caseId===caseId&&!c.deleted&&['pending','confirmed','preparing','ready_for_pickup'].includes(c.order.status)&&!c.order.driverId&&!c.order.assignedDriverId&&!c.order.pickedUpAt&&!c.order.deliveredAt&&!c.order.completedAt;
  if(c.restart&&c.restart.caseId===caseId)c.guards.push(c.restart.guard);
  if(waitingRestart){next={...next,restartState:c.restart.state,restartId:c.restart.restartId};}
  if(!waitingRestart&&(caseId!==c.caseId||!c.active)){
   next={...next,status:'RESOLVED',resolution:c.deleted?'SOURCE_CLOSED':c.order.status==='cancelled'?'ORDER_CANCELLED':c.order.driverId||c.order.assignedDriverId?'DRIVER_ASSIGNED':c.order.deliveredAt||c.order.completedAt||c.order.status==='delivered'?'ORDER_COMPLETED':caseId!==c.caseId||c.job.status==='searching'?'SEARCH_RESTARTED':'SOURCE_CHANGED',resolvedAt:new Date(time).toISOString()};
  }
  if(next.status==='OPEN'&&time>=Date.parse(next.escalationDueAt)&&!next.escalatedAt)next={...next,escalatedAt:new Date(time).toISOString()};
  const pointer=await F.get(db,T,F.inboxKey(caseId));
  if(old&&JSON.stringify(next)===JSON.stringify(old)&&(next.status!=='OPEN'||pointer))return {unchanged:true};
  next={...next,version:(old?.version??0)+1,updatedAt:new Date(time).toISOString()};
  const {TableName,Key,...condition}=F.exact(T,F.key(caseId),old).ConditionCheck;
  const actions=[...c.guards,F.exact(T,{pk:F.PK,sk:'CURRENT'},p.row),{Put:{TableName:T,Item:next,...condition}},next.status==='OPEN'?{Put:{TableName:T,Item:F.inboxRow(next)}}:{Delete:{TableName:T,Key:F.inboxKey(caseId)}}];
  // The persistent FOLLOWUP row is the in-platform notice. Readers revalidate
  // actual source state and regional authorization before showing it.
  try{await db.send(new TransactWriteCommand({TransactItems:actions}));return {saved:true,status:next.status};}catch(e){if(e.name==='TransactionCanceledException')return {conflict:true};throw e;}
 }
 return {observe,async tick(owner){
  if(typeof owner!=='string'||!/^[-\w:]{1,120}$/.test(owner))throw Error('INVALID_MONITOR_OWNER');
  const previous=await F.get(db,T,cursorKey),time=now();if(previous?.leaseUntil>time)return {busy:true};
  const lease={...cursorKey,kind:'DISPATCH_FOLLOWUP_CURSOR',version:(previous?.version??0)+1,jobsCursor:previous?.jobsCursor??null,followupCursor:previous?.followupCursor??null,leaseOwner:owner,leaseUntil:time+90000};
  const {TableName,Key,...condition}=F.exact(T,cursorKey,previous).ConditionCheck;
  try{await db.send(new TransactWriteCommand({TransactItems:[{Put:{TableName:T,Item:lease,...condition}}]}));}catch(e){if(e.name==='TransactionCanceledException')return {busy:true};throw e;}
  const result={observed:0,saved:0,conflicts:0,failed:0};
  for(const source of ['jobs','followup']){
   for(let pageNumber=0;pageNumber<5;pageNumber++){
   if(remainingMs()<20000)break;
   const field=source+'Cursor';
   const input=source==='jobs'?{TableName:J,IndexName:process.env.DISPATCH_FOLLOWUP_JOB_INDEX??'DispatchReviewStatus340',KeyConditionExpression:'#s=:s',FilterExpression:'SK=:sk',ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':sk':'METADATA',':s':'no_driver_available'}}:{TableName:T,ConsistentRead:true,KeyConditionExpression:'pk=:inbox',ExpressionAttributeValues:{':inbox':'DISPATCH_FOLLOWUP_INBOX#OPEN'}};
   const page=await db.send(new QueryCommand({...input,Limit:50,ExclusiveStartKey:lease[field]??undefined}));let complete=true;
   for(const row of page.Items??[]){
    if(remainingMs()<12000){complete=false;break;}
    try{const r=source==='followup'&&row.selector?.source==='ACCEPTANCE'?{skipped:true}:await observe(row.orderId,source==='followup'?row.caseId:undefined);result.observed++;if(r.saved)result.saved++;if(r.conflict)result.conflicts++;}catch(e){result.failed++;console.error('DISPATCH_FOLLOWUP_OBSERVE_FAILED',JSON.stringify({orderId:row.orderId,code:e.name}));}
    lease[field]=source==='jobs'?{orderId:row.orderId,SK:row.SK,status:row.status}:{pk:row.pk,sk:row.sk};
   }
   if(complete)lease[field]=page.LastEvaluatedKey??null;
   if(!complete||!lease[field])break;
   }
  }
  const current=await F.get(db,T,cursorKey);if(current?.leaseOwner!==owner||current.version!==lease.version)throw Error('FOLLOWUP_LEASE_CHANGED');
  const {TableName:t,Key:k,...guard}=F.exact(T,cursorKey,current).ConditionCheck;
  await db.send(new TransactWriteCommand({TransactItems:[{Put:{TableName:T,Item:{...lease,leaseUntil:0,lastTickAt:new Date(now()).toISOString(),...result},...guard}}]}));
  return {...result,hasContinuation:!!(lease.jobsCursor||lease.followupCursor)};
 }};
}
module.exports={createMonitor};
