import {DynamoDBDocumentClient,ScanCommand,TransactWriteCommand} from '@aws-sdk/lib-dynamodb';
import {strongGet,exactCheck,FinancialRow as Row} from './driverFinancialTransaction';
import {setFinancialFields as set} from './financialRelease';
import {composeDispatchTransaction} from './dispatchTransaction';
import {validateDispatchCycle} from './dispatchCycle';
import {createStagingDispatchCoordinator} from './dispatchCoordinator';
import {quoteHash,quoteEntityIdValid} from './deliveryQuoteRecord';
const {dispatchWaveSK}=require('../../src/utils/dispatch-cycle-keys');
const JOBS='WizzDispatchJobs_staging',ORDERS='WizzOrders';
const fail=():never=>{throw Error('DISPATCH_RESTART_START_CONFLICT');};
/** Trusted durable start consumer. No public handler, own scheduling or financial
 * writer. Callback must use the existing fenced Legacy runner. A callback's return
 * value is never an ACK: inspect durable coordinator/wave/delivery evidence.
 */
export function createStagingDispatchRestartStart(options:{db:Pick<DynamoDBDocumentClient,'send'>;now?:()=>number;mode?:string;start:(input:{orderId:string;assignmentId:string;cycleId:string})=>Promise<unknown>}){
 const {db}=options,now=options.now??Date.now;
 function enabled(){if((options.mode??process.env.DISPATCH_RESTART_START_MODE)!=='REQUIRED')throw Error('DISPATCH_RESTART_START_DISABLED');}
 async function processRestart(orderId:string,restartId:string,owner:string){
  enabled();if(!quoteEntityIdValid(orderId)||!/^DRS:[a-f0-9]{48}$/.test(restartId)||!quoteEntityIdValid(owner))return fail();
  const key={orderId,SK:'DISPATCH_RESTART#'+restartId};let row=await strongGet(db,JOBS,key);if(!row)return {missing:true};
  if(row.kind!=='DISPATCH_RESTART_START'||row.schemaVersion!==1||row.orderId!==orderId||row.restartId!==restartId||!/^DISPATCH_REVIEW#[a-f0-9]{64}$/.test('DISPATCH_REVIEW#'+row.caseId)||!Number.isSafeInteger(row.version)||row.version<1||!Number.isSafeInteger(row.attempts)||row.attempts<0||!Number.isSafeInteger(row.nextAttemptAt)||!Number.isSafeInteger(now()))return fail();
  const token=quoteHash({caseId:row.caseId,requestId:row.requestId});if(row.restartId!=='DRS:'+token.slice(0,48)||row.cycleId!=='DC:'+token||row.assignmentId!=='DISPATCH:'+token)return fail();
  if(['STARTED','NEEDS_REVIEW','SUPPRESSED_DELETION','STALE'].includes(row.state))return {state:row.state,replayed:true};
  if(row.legalHold===true||row.retentionHold===true||row.financialArchiveConfirmed)return fail();
  if(!['PENDING','STARTING'].includes(row.state))return fail();
  if(row.state==='STARTING'&&(!Number.isSafeInteger(row.leaseUntil)||row.leaseUntil>now()))return {busy:true};
  if(row.nextAttemptAt>now())return {deferred:true};
  async function commit(fields:Row,guards:Row[]=[]){const tx=composeDispatchTransaction([set(exactCheck(JOBS,key,row!,[...new Set([...Object.keys(row!),'legalHold','retentionHold','financialArchiveConfirmed'])]),{...fields,version:row!.version+1,updatedAt:new Date(now()).toISOString()})],guards);await db.send(new TransactWriteCommand({TransactItems:tx as any,ClientRequestToken:quoteHash(tx).slice(0,36)}));row=await strongGet(db,JOBS,key);}
  async function context(){
   const jobKey={orderId,SK:'METADATA'},orderKey={PK:'ORDER#'+orderId,SK:'META'},job=await strongGet(db,JOBS,jobKey),order=await strongGet(db,ORDERS,orderKey);
   if(!job||!order)return {stale:true,guards:[] as Row[]};
   const guards:Row[]=[exactCheck(JOBS,jobKey,job),exactCheck(ORDERS,orderKey,order,[...new Set([...Object.keys(order),'deletedAt','deletionStatus','isDeleted','deletionRequestId'])])];
   if(job.dispatchJobId!==row!.assignmentId||job.dispatchRestart?.restartId!==restartId||order.deliveryJobId!==row!.assignmentId)return {stale:true,guards};
   const cycle=validateDispatchCycle(job.dispatchCycle);
   if(cycle.engine!=='LEGACY'||cycle.keyVersion!==2||cycle.id!==row!.cycleId||cycle.digest!==row!.cycleDigest||cycle.assignmentId!==row!.assignmentId||cycle.orderId!==orderId||job.restaurantId!==row!.branchId)return fail();
   const decisionKey={pk:'DISPATCH_REVIEW#'+row!.caseId,sk:'DECISION'},decision=await strongGet(db,'staging-PlatformStaff',decisionKey);
   if(!decision||decision.status!=='EXECUTED'||decision.resultCode!=='SEARCH_RESTART_QUEUED'||decision.requestId!==row!.requestId||decision.receipt?.restartId!==restartId||decision.receipt?.cycleId!==cycle.id||decision.receipt?.assignmentId!==cycle.assignmentId)return fail();
   guards.push(exactCheck('staging-PlatformStaff',decisionKey,decision));
   const branchKey={businessId:row!.branchId},branch=await strongGet(db,'WhizzMerchants_Businesses',branchKey);
   if(!branch)return fail();guards.push(exactCheck('WhizzMerchants_Businesses',branchKey,branch,[...new Set([...Object.keys(branch),'deletedAt','isDeleted','deletionRequestId'])]));
   let suppressed=order.isDeleted===true||order.deletionRequestId!=null||order.deletionStatus!=null||order.deletedAt!=null||branch.isDeleted===true||branch.deletionRequestId!=null||branch.deletedAt!=null;
   for(const pk of ['BUSINESS_LIFECYCLE#MERCHANT#'+row!.branchId,'ACCOUNT_LIFECYCLE#MERCHANT#'+branch.ownerId]){const k={pk,sk:'META'},r=await strongGet(db,'staging-AccountDeletion',k);guards.push(r?exactCheck('staging-AccountDeletion',k,r):{ConditionCheck:{TableName:'staging-AccountDeletion',Key:k,ConditionExpression:'attribute_not_exists(pk)'}});if(r)suppressed=true;}
   const review=branch.status!=='approved'||branch.isActive!==true||branch.ordersBlocked===true||branch.platformSuspended===true||['cancelled','canceled','delivered','completed','returned','rejected','refunded'].includes(order.status);
   return {job,order,cycle,guards,suppressed,review};
  }
  let c=await context();if(c.stale){await commit({state:'STALE'},c.guards);return {state:'STALE'};}if(c.suppressed){await commit({state:'SUPPRESSED_DELETION'},c.guards);return {state:'SUPPRESSED_DELETION'};}if(c.review){await commit({state:'NEEDS_REVIEW'},c.guards);return {state:'NEEDS_REVIEW'};}
  if(now()>=Date.parse(c.cycle!.searchDeadline)){
   await createStagingDispatchCoordinator({db,now}).plan({orderId,assignmentId:row.assignmentId,source:'TIMEOUT'});c=await context();await commit({state:'NEEDS_REVIEW'},c.guards);return {state:'NEEDS_REVIEW'};
  }
  await commit({state:'STARTING',leaseOwner:owner,leaseUntil:Math.min(now()+30000,Date.parse(c.cycle!.searchDeadline))},c.guards);
  enabled();
  try{await options.start({orderId,assignmentId:row!.assignmentId,cycleId:row!.cycleId});}catch{/* lost ACK or failure: only recorded evidence can confirm progress */}
  c=await context();if(c.stale){await commit({state:'STALE'},c.guards);return {state:'STALE'};}if(c.suppressed){await commit({state:'SUPPRESSED_DELETION'},c.guards);return {state:'SUPPRESSED_DELETION'};}if(c.review){await commit({state:'NEEDS_REVIEW'},c.guards);return {state:'NEEDS_REVIEW'};}
  const job=c.job!,cycle=c.cycle!;let started=job.status==='assigned'&&c.order!.driverId===job.assignedDriverId&&c.order!.driverId!=null;
  if(!started&&job.currentWaveNumber>0&&job.dispatchTransition?.cycleId===cycle.id){
   const waveKey={orderId,SK:dispatchWaveSK(cycle,job.currentWaveNumber)},wave=await strongGet(db,JOBS,waveKey),intentKey={orderId,SK:'DISPATCH_TRANSITION#'+job.dispatchTransition.id},intent=await strongGet(db,JOBS,intentKey);
   if(wave&&intent){c.guards.push(exactCheck(JOBS,waveKey,wave),exactCheck(JOBS,intentKey,intent));started=wave.kind==='DISPATCH_WAVE'&&wave.state==='READY'&&wave.cycleDigest===cycle.digest&&wave.assignmentId===cycle.assignmentId&&wave.transitionId===intent.intentId&&intent.cycleId===cycle.id&&intent.state==='APPLIED'&&Array.isArray(wave.driverIds)&&Array.isArray(wave.delivered)&&wave.driverIds.every((id:string)=>wave.delivered.includes(id));}
  }
  const attempts=row!.attempts+1,state=started?'STARTED':job.status==='no_driver_available'||attempts>=20?'NEEDS_REVIEW':'PENDING';
  await commit({state,attempts,leaseUntil:0,nextAttemptAt:now()+Math.min(900000,15000*2**Math.min(attempts,6)),...(started?{startedAt:new Date(now()).toISOString()}:{})},c.guards);
  return {state};
 }
 async function run(owner:string,cursor?:Row){enabled();const q=await db.send(new ScanCommand({TableName:JOBS,ConsistentRead:true,Select:'SPECIFIC_ATTRIBUTES',Limit:25,ExclusiveStartKey:cursor,FilterExpression:'#kind=:kind AND (#state=:pending OR #state=:starting)',ExpressionAttributeNames:{'#kind':'kind','#state':'state'},ExpressionAttributeValues:{':kind':'DISPATCH_RESTART_START',':pending':'PENDING',':starting':'STARTING'},ProjectionExpression:'orderId,SK'}));let processed=0,failed=0;for(const r of q.Items??[]){try{if(r.SK?.startsWith('DISPATCH_RESTART#')){await processRestart(r.orderId,r.SK.slice('DISPATCH_RESTART#'.length),owner);processed++;}}catch{failed++;}}return {processed,failed,nextCursor:q.LastEvaluatedKey??null};}
 return {process:processRestart,run};
}
