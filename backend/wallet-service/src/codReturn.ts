import { codIntegrationEvent } from './codIntegrationEvent';
import { randomUUID } from 'crypto';
import { DynamoDBDocumentClient, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { createCodFlowContext, ReturnActor } from './codFlowContext';
import { prepareCodRelease } from './financialRelease';
import { quoteHash, quoteEntityIdValid } from './deliveryQuoteRecord';
import { readMoney, toWholeIqdExact } from './money';
import { detach, equal, strongGet, exactCheck, updateChecked, FinancialRow as Row } from './driverFinancialTransaction';
const T={orders:'WizzOrders',offers:'WaveOffers_staging',holds:'staging-Holds',wallets:'staging-Wallets',ledger:'staging-LedgerEntries',
 audit:'staging-AuditLog',lifecycle:'staging-WalletLifecycle',driver:'WhizzDrivers_staging',branch:'WhizzMerchants_Businesses',
 deletion:'staging-AccountDeletion',jobs:'WizzDispatchJobs_staging',live:'WizzDriverLiveState_staging'};
export type { ReturnActor } from './codFlowContext';
const fail=(code='COD_RETURN_CONFLICT'):never=>{throw Object.assign(Error(code),{code});};
const whole=(v:unknown)=>toWholeIqdExact(readMoney(v));
function set(check:Row,values:Row){const names:Row={},args:Row={};const parts=Object.entries(values).map(([k,v],i)=>{names['#u'+i]=k;args[':u'+i]=v;return '#u'+i+'=:u'+i;});return updateChecked(check,'SET '+parts.join(', '),names,args);}
function input(value:unknown,fields:string[]){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==fields.sort().join(','))return fail('INVALID_COD_RETURN');
 const v=detach(value as Row);
 if(!quoteEntityIdValid(v.orderId)||!quoteEntityIdValid(v.offerId)||!Number.isSafeInteger(v.attempt)||v.attempt<1||v.attempt>1000)return fail('INVALID_COD_RETURN');
 return v;
}
/** COD return only. Driver arrival is an assertion, not proof of receipt. Owner receipt is independent.
 * No refunds, driver earnings, automatic responsibility allocation, or implicit timers.
 * The injected authenticator MUST validate original credentials, never a caller's role/subject fields.
 */
export function createStagingCodReturn(options:{db:Pick<DynamoDBDocumentClient,'send'>;authenticate:()=>Promise<ReturnActor>;now?:()=>number}){
 const {db,authenticate}=options,now=options.now??Date.now;
 const context=createCodFlowContext({db,authenticate,now});
 const orderFence=(c:Awaited<ReturnType<typeof context>>)=>exactCheck(T.orders,c.key,c.order,[...new Set([...Object.keys(c.order),'financialOutcome','returnStatus','returnCaseId','cancellationStatus','cancellationRequestId','deletionRequestId','deletedAt','deletionStatus','isDeleted','cashCollected','cashCollectedAmount'])]);
 function audit(c:Awaited<ReturnType<typeof context>>,action:string,eventId:string){return {Put:{TableName:T.audit,Item:{datePartition:'date#'+c.timestamp.slice(0,10).replace(/-/g,''),sk:c.timestamp+'#'+eventId,
  logId:eventId,action,orderId:c.order.orderId,branchId:c.offer.branchId,returnId:c.returnId,actorId:c.actor.subjectId,actorKind:c.actor.kind,createdAt:c.timestamp},ConditionExpression:'attribute_not_exists(sk)'}};}
 async function commit(c:Awaited<ReturnType<typeof context>>,ops:Row[],recover:()=>Promise<Row|null>){
  if(ops.length>100||Buffer.byteLength(JSON.stringify(ops))>3500000)return fail('COD_RETURN_UNAVAILABLE');
  if(!equal(c.actor,await authenticate()))return fail('UNAUTHORIZED');
  try{await db.send(new TransactWriteCommand({TransactItems:ops as any,ClientRequestToken:quoteHash(ops).slice(0,36)}));}
  catch{const receipt=await recover();if(receipt)return receipt;return fail('COD_RETURN_UNAVAILABLE');}
  return null;
 }
 function receipt(v:Row,c:Awaited<ReturnType<typeof context>>,status:string){return {success:true,kind:'COD_RETURN',orderId:v.orderId,offerId:v.offerId,attempt:v.attempt,returnId:c.returnId,status,replayed:false};}
 function noCash(order:Row){if((order.cashCollected!=null&&order.cashCollected!==false)||(order.cashCollectedAmount!=null&&order.cashCollectedAmount!==0))return fail('COD_CASH_REVIEW_REQUIRED');}
 async function holdGuard(c:Awaited<ReturnType<typeof context>>){
  const H=whole(c.offer.allocation.driverWalletHold),key={orderId:c.order.orderId,sk:'HOLD'},hold=await strongGet(db,T.holds,key);
  if(c.order.holdAmount!==H||c.order.holdStatus!==(H?'ACTIVE':'NOT_REQUIRED'))return fail();
  if(H){if(!hold||hold.financialSchemaVersion!==2||hold.amount!==H||hold.status!=='ACTIVE'||hold.holdId!==c.order.holdId||
   hold.walletId!=='WALLET#DRIVER#'+c.order.driverId||hold.metadata?.assignmentAttempt!==c.order.assignmentAttemptCounter||hold.metadata?.offerDigest!==c.offer.digest||hold.metadata?.offerId!==c.offer.offerId)return fail();}
  else if(c.order.holdId!==null||hold&&(hold.status!=='NOT_REQUIRED'||hold.amount!==0||hold.financialSchemaVersion!==2||hold.metadata?.assignmentAttempt!==c.order.assignmentAttemptCounter||hold.metadata?.offerDigest!==c.offer.digest))return fail();
  return {H,key,hold,guard:hold?exactCheck(T.holds,key,hold):{ConditionCheck:{TableName:T.holds,Key:key,ConditionExpression:'attribute_not_exists(orderId)'}}};
 }
 return Object.freeze({
 async requestReturn(value:unknown){
  const v=input(value,['orderId','offerId','attempt','reason','cashCollected']);
  if(v.cashCollected!==false)return fail('COD_CASH_REVIEW_REQUIRED');
  if(!['CUSTOMER_UNREACHABLE','CUSTOMER_REFUSED','DELIVERY_BLOCKED','OTHER'].includes(v.reason))return fail('INVALID_COD_RETURN');
  const c=await context(v,'DRIVER');noCash(c.order);
  if(c.record){if(c.record.reason!==v.reason||c.record.cashCollected!==false)return fail();return {...receipt(v,c,c.record.status),replayed:true};}
  if(!['picked_up','heading_to_customer','arrived_at_customer'].includes(c.order.status)||c.order.financialOutcome!=null||c.order.returnCaseId!=null||c.order.returnStatus!=null||c.order.cancellationStatus!=null||c.order.cancellationRequestId!=null)return fail();
  const h=await holdGuard(c),result=receipt(v,c,'RETURNING');
  const record={...c.returnKey,kind:'COD_RETURN_CASE',schemaVersion:1,returnId:c.returnId,driverId:c.order.driverId,driverSubjectId:c.subject,branchId:c.offer.branchId,
   offerId:v.offerId,offerDigest:c.offer.digest,attempt:v.attempt,reason:v.reason,cashCollected:false,status:'RETURNING',version:1,createdAt:c.timestamp,updatedAt:c.timestamp};
  const recovered=await commit(c,[...c.guards,h.guard,
   {ConditionCheck:{TableName:T.holds,Key:{orderId:v.orderId,sk:'FINANCIAL_OUTCOME'},ConditionExpression:'attribute_not_exists(orderId)'}},
   set(orderFence(c),{status:'returning',orderStatus:'returning',returnStatus:'RETURNING',returnCaseId:c.returnId,updatedAt:c.timestamp}),
   {Put:{TableName:T.holds,Item:record,ConditionExpression:'attribute_not_exists(orderId)'}},audit(c,'COD_RETURN_REQUESTED',c.returnId)],async()=>{
    const row=await strongGet(db,T.holds,c.returnKey);return row?.returnId===c.returnId&&row.reason===v.reason?{...result,status:row.status,replayed:true}:null;
   });return recovered??result;
 },
 async arriveReturn(value:unknown){
  const v=input(value,['orderId','offerId','attempt','returnId']),c=await context(v,'DRIVER');
  if(v.returnId!==c.returnId||!c.record)return fail();
  if(c.record.status==='ARRIVED_AT_BRANCH'||c.record.status==='CONFIRMED'||c.record.status==='REVIEW_REQUIRED')return {...receipt(v,c,c.record.status),replayed:true};
  if(c.record.status!=='RETURNING'||c.order.status!=='returning'||c.order.returnStatus!=='RETURNING'||c.order.returnCaseId!==c.returnId||c.order.financialOutcome!=null)return fail();
  noCash(c.order);const h=await holdGuard(c),result=receipt(v,c,'ARRIVED_AT_BRANCH');
  const recovered=await commit(c,[...c.guards,h.guard,set(orderFence(c),{status:'return_arrived',orderStatus:'return_arrived',returnStatus:'ARRIVED_AT_BRANCH',updatedAt:c.timestamp}),
   set(exactCheck(T.holds,c.returnKey,c.record),{status:'ARRIVED_AT_BRANCH',version:c.record.version+1,arrivedAt:c.timestamp,updatedAt:c.timestamp}),
   audit(c,'COD_RETURN_ARRIVED',c.returnId+':ARRIVED')],async()=>{
    const row=await strongGet(db,T.holds,c.returnKey);return row?.returnId===c.returnId&&['ARRIVED_AT_BRANCH','CONFIRMED','REVIEW_REQUIRED'].includes(row.status)?{...result,status:row.status,replayed:true}:null;
   });return recovered??result;
 },
 async readReturn(value:unknown){
  const v=input(value,['branchId','orderId','offerId','attempt']),c=await context(v,'MERCHANT_OWNER');
  if(!quoteEntityIdValid(v.branchId)||!c.record)return fail();
  await db.send(new TransactWriteCommand({TransactItems:[...c.guards,orderFence(c),exactCheck(T.holds,c.returnKey,c.record),audit(c,'COD_RETURN_READ',randomUUID())] as any}));
  const r=c.record;
  return {success:true,kind:'COD_RETURN_CASE',orderId:v.orderId,offerId:v.offerId,attempt:v.attempt,branchId:c.offer.branchId,returnId:c.returnId,
   status:r.status,version:r.version,reason:r.reason,cashCollected:r.cashCollected,createdAt:r.createdAt,arrivedAt:r.arrivedAt??null,
   confirmation:r.confirmedAt?{allItemsReceived:r.allItemsReceived,condition:r.condition,driverResponsibility:r.driverResponsibility,confirmedAt:r.confirmedAt}:null};
 },
 async confirmReceipt(value:unknown){
  const v=input(value,['branchId','orderId','offerId','attempt','returnId','expectedVersion','allItemsReceived','condition','driverResponsibility','cashCollected']);
  if(v.cashCollected!==false)return fail('COD_CASH_REVIEW_REQUIRED');
  if(!quoteEntityIdValid(v.branchId))return fail('INVALID_COD_RETURN');
  if(typeof v.allItemsReceived!=='boolean'||!['INTACT','DAMAGED','MISSING'].includes(v.condition)||!['NONE','REVIEW'].includes(v.driverResponsibility)||!Number.isSafeInteger(v.expectedVersion)||v.expectedVersion<1)return fail('INVALID_COD_RETURN');
  const c=await context(v,'MERCHANT_OWNER');noCash(c.order);
  if(v.returnId!==c.returnId||!c.record)return fail();
  const fingerprint=quoteHash(v);
  if(c.record.confirmationDigest){if(c.record.confirmationDigest!==fingerprint||c.record.confirmedBy!==c.actor.subjectId)return fail();return {...c.record.receipt,replayed:true};}
  const savedCase=c.record;
  const perform=async()=>{
  if(savedCase.status!=='ARRIVED_AT_BRANCH'||savedCase.version!==v.expectedVersion||c.order.status!=='return_arrived'||c.order.returnStatus!=='ARRIVED_AT_BRANCH'||c.order.returnCaseId!==c.returnId||c.order.financialOutcome!=null)return fail();
  const h=await holdGuard(c),clean=v.allItemsReceived&&v.condition==='INTACT'&&v.driverResponsibility==='NONE';
  const result={...receipt(v,c,clean?'CONFIRMED':'REVIEW_REQUIRED'),holdReleased:clean&&h.H>0,holdStatus:clean?(h.H?'RELEASED':'NOT_REQUIRED'):c.order.holdStatus,financialReviewRequired:!clean,driverCompensationStatus:'PENDING_POLICY_REVIEW'};
  const ops:Row[]=[...c.guards];
  if(!clean){
   ops.push(h.guard,set(orderFence(c),{returnStatus:'REVIEW_REQUIRED',updatedAt:c.timestamp}));
  }else{
   const operationId='CR:'+quoteHash({returnId:c.returnId,attempt:v.attempt,offerDigest:c.offer.digest}).slice(0,48);
   Object.assign(result,{operationId});
   const release=await prepareCodRelease(db,c.order,c.offer,c.timestamp,operationId,true);
   const journal=release.journalLines;
   ops.push(...release.operations);
   const liveKey={driverId:c.order.driverId},live=await strongGet(db,T.live,liveKey),jobKey={orderId:v.orderId,SK:'METADATA'},job=await strongGet(db,T.jobs,jobKey);
   if(!live||live.currentOrderId!==v.orderId||live.activeOrdersCount!==1||!job||job.assignedDriverId!==c.order.driverId||job.status!=='assigned'||job.dispatchJobId!==c.offer.assignmentId)return fail();
   if(journal.reduce((s,r)=>s+BigInt(r.delta),0n)!==0n)return fail();
   ops.push(set(orderFence(c),{status:'returned',orderStatus:'returned',returnStatus:'CONFIRMED',returnedAt:c.timestamp,holdStatus:h.H?'RELEASED':'NOT_REQUIRED',walletFinancialStatus:'RETURNED',financialOutcome:operationId,updatedAt:c.timestamp}),
    set(exactCheck(T.live,liveKey,live),{currentOrderId:null,activeOrdersCount:0,isSearching:false,status:live.isActive===true?'available':'offline'}),
    set(exactCheck(T.jobs,jobKey,job),{status:'returned',completedAt:c.timestamp}),
    {Put:{TableName:T.holds,Item:{orderId:v.orderId,sk:'FINANCIAL_OUTCOME',kind:'COD_RETURN_JOURNAL',operationId,outcome:'RETURNED',returnId:c.returnId,driverId:c.order.driverId,subjectId:c.subject,branchId:c.offer.branchId,
     offerId:v.offerId,attempt:v.attempt,journalLines:journal,receipt:result,createdAt:c.timestamp},ConditionExpression:'attribute_not_exists(orderId)'}},
    codIntegrationEvent({kind:'COD_RETURN_OUTBOX',financialOperationId:operationId,orderId:v.orderId,driverId:c.order.driverId,subjectId:c.subject,branchId:c.offer.branchId,offerId:v.offerId,attempt:v.attempt,waveNumber:c.order.assignmentWaveNumber,createdAt:c.timestamp}));
  }
  ops.push(set(exactCheck(T.holds,c.returnKey,savedCase),{status:result.status,version:savedCase.version+1,confirmationDigest:fingerprint,confirmedBy:c.actor.subjectId,confirmedAt:c.timestamp,
   allItemsReceived:v.allItemsReceived,condition:v.condition,driverResponsibility:v.driverResponsibility,receipt:result,updatedAt:c.timestamp}),
   audit(c,clean?'COD_RETURN_CONFIRMED':'COD_RETURN_REVIEW_REQUIRED',c.returnId+':RECEIPT'));
  const recovered=await commit(c,ops,async()=>{const r=await strongGet(db,T.holds,c.returnKey);return r?.confirmationDigest===fingerprint&&r.confirmedBy===c.actor.subjectId?{...r.receipt,replayed:true}:null;});return recovered??result;
  };
  try{return await perform();}catch(error){
   const r=await strongGet(db,T.holds,c.returnKey);
   if(r?.confirmationDigest===fingerprint&&r.confirmedBy===c.actor.subjectId&&equal(c.actor,await authenticate()))return {...r.receipt,replayed:true};
   throw error;
  }
 }
 });
}
