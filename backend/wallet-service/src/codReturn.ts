import {createReturnItemManifest,verifyReturnItemReceipt} from './returnItems';
import {verifyMerchantPayoutJournal} from './merchantPayout';
import {planReturnedTask} from './returnCustody';
import {planAutomaticReturn,acceptanceKey} from './returnOperations';
import {readExceptionSettings} from './orderExceptionSettings';
import {assertPosition} from './deliveryAttempt';
import {readExceptionCasePolicy,casePhase} from './exceptionCasePolicy';
import {exceptionCaseIndexOperation} from './orderExceptionCaseIndex';
import {requireNoResponseAttempt} from './deliveryAttempt';
import {readOrderExceptionPolicy} from './orderExceptionPolicy';
import {returnResolution,merchantReturnResolution} from './orderExceptionPolicy';
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
export function createStagingCodReturn(options:{db:Pick<DynamoDBDocumentClient,'send'>;authenticate:()=>Promise<ReturnActor>;now?:()=>number;enableDeliveryFunding?:boolean;enableFullCash?:boolean;returnRouter?:any}){
 const {db,authenticate}=options,now=options.now??Date.now;
 const context=createCodFlowContext({db,authenticate,now,enableDeliveryFunding:options.enableDeliveryFunding,enableFullCash:options.enableFullCash});
 const orderFence=(c:Awaited<ReturnType<typeof context>>)=>exactCheck(T.orders,c.key,c.order,[...new Set([...Object.keys(c.order),'cashReviewVerifiedCollection','openPaymentClaimId','financialOutcome','returnStatus','returnCaseId','cancellationStatus','cancellationRequestId','deletionRequestId','deletedAt','deletionStatus','isDeleted','cashCollected','cashCollectedAmount'])]);
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
 function noCash(order:Row){if(order.cashReviewVerifiedCollection!=null||order.openPaymentClaimId!=null||(order.cashCollected!=null&&order.cashCollected!==false)||(order.cashCollectedAmount!=null&&order.cashCollectedAmount!==0))return fail('COD_CASH_REVIEW_REQUIRED');}
 async function holdGuard(c:Awaited<ReturnType<typeof context>>){
  const H=whole(c.offer.allocation.driverWalletHold),key={orderId:c.order.orderId,sk:'HOLD'},hold=await strongGet(db,T.holds,key);
  if(c.order.holdAmount!==H||c.order.holdStatus!==(H?'ACTIVE':'NOT_REQUIRED'))return fail();
  if(H){if(!hold||hold.financialSchemaVersion!==(c.order.financialAcceptance.schemaVersion===3?4:2)||hold.amount!==H||hold.status!=='ACTIVE'||hold.holdId!==c.order.holdId||
   hold.walletId!=='WALLET#DRIVER#'+c.order.driverId||hold.metadata?.assignmentAttempt!==c.order.assignmentAttemptCounter||hold.metadata?.offerDigest!==c.offer.digest||hold.metadata?.offerId!==c.offer.offerId)return fail();}
  else if(c.order.holdId!==null||hold&&(hold.status!=='NOT_REQUIRED'||hold.amount!==0||hold.financialSchemaVersion!==(c.order.financialAcceptance.schemaVersion===3?4:2)||hold.metadata?.assignmentAttempt!==c.order.assignmentAttemptCounter||hold.metadata?.offerDigest!==c.offer.digest))return fail();
  return {H,key,hold,guard:hold?exactCheck(T.holds,key,hold):{ConditionCheck:{TableName:T.holds,Key:key,ConditionExpression:'attribute_not_exists(orderId)'}}};
 }
 return Object.freeze({
 async requestReturn(value:unknown){
  const v=input(value,['orderId','offerId','attempt','reason','cashCollected',...(value&&typeof value==='object'&&Object.prototype.hasOwnProperty.call(value,'position')?['position']:[])]);
  if(v.cashCollected!==false)return fail('COD_CASH_REVIEW_REQUIRED');
  if(!['CUSTOMER_UNREACHABLE','CUSTOMER_REFUSED','DELIVERY_BLOCKED','OTHER'].includes(v.reason))return fail('INVALID_COD_RETURN');
  const c=await context(v,'DRIVER');noCash(c.order);
  if(c.record){if(c.record.reason!==v.reason||c.record.cashCollected!==false)return fail();return {...receipt(v,c,c.record.status),replayed:true};}
  if(!['picked_up','heading_to_customer','arrived_at_customer'].includes(c.order.status)||c.order.financialOutcome!=null||c.order.returnCaseId!=null||c.order.returnStatus!=null||c.order.cancellationStatus!=null||c.order.cancellationRequestId!=null)return fail();
  const attemptEvidence=readOrderExceptionPolicy(c.order)&&v.reason==='CUSTOMER_UNREACHABLE'?await requireNoResponseAttempt(db,c):null;
  const requested=readOrderExceptionPolicy(c.order)!==null;let initialStatus=requested?'REQUESTED':'RETURNING';
  const h=await holdGuard(c),result=receipt(v,c,initialStatus);
  const record={...c.returnKey,kind:'COD_RETURN_CASE',schemaVersion:1,returnId:c.returnId,driverId:c.order.driverId,driverSubjectId:c.subject,branchId:c.offer.branchId,
   offerId:v.offerId,offerDigest:c.offer.digest,attempt:v.attempt,reason:v.reason,cashCollected:false,status:initialStatus,version:1,createdAt:c.timestamp,updatedAt:c.timestamp};
   const itemManifest=requested?createReturnItemManifest(c.order,c.offer.digest):null;if(itemManifest)Object.assign(record,{itemManifest});
   if(attemptEvidence)Object.assign(record,{deliveryAttemptId:attemptEvidence.row!.attemptId});
   let resolution=returnResolution(c.order,c.offer,record,initialStatus,c.timestamp);
   const casePolicy=resolution?await readExceptionCasePolicy(db):null;
   if(resolution&&casePolicy)Object.assign(record,{exceptionResolution:resolution,casePolicySnapshot:casePolicy.snapshot,activePhase:casePhase(casePolicy.snapshot,'CUSTODY',c.timestamp)});
   const automatic=requested?await planAutomaticReturn(db,c,record,v.position,options.returnRouter):null;
   if(automatic&&'manualReason' in automatic)Object.assign(record,{automaticReturnAssessment:{state:'MANUAL_REVIEW_REQUIRED',reason:automatic.manualReason,assessedAt:automatic.assessedAt}});
   if(automatic&&'disposition' in automatic){initialStatus='RETURNING';resolution=returnResolution(c.order,c.offer,record,initialStatus,c.timestamp);Object.assign(record,{status:initialStatus,disposition:automatic.disposition,exceptionResolution:resolution,activePhase:{...(record as Row).activePhase,respondedAt:c.timestamp,responseSource:'AUTOMATIC_DISPOSITION'}});result.status=initialStatus;}
   const caseIndex=resolution?await exceptionCaseIndexOperation(db,{caseId:resolution.caseId,orderId:v.orderId,caseKey:c.returnKey.sk,caseType:'COD_DELIVERY_EXCEPTION',state:resolution.status,open:true,at:c.timestamp,branchId:c.offer.branchId,dueAt:casePhase(casePolicy!.snapshot,'CUSTODY',c.timestamp).responseDueAt}):null;
  const recovered=await commit(c,[...c.guards,h.guard,...(automatic&&'disposition' in automatic?[...automatic.guards,automatic.decision]:[]),...(casePolicy?[casePolicy.condition]:[]),...(caseIndex?[caseIndex]:[]),...(attemptEvidence?[attemptEvidence.operation]:[]),
   {ConditionCheck:{TableName:T.holds,Key:{orderId:v.orderId,sk:'FINANCIAL_OUTCOME'},ConditionExpression:'attribute_not_exists(orderId)'}},
   set(orderFence(c),{status:'returning',orderStatus:'returning',returnStatus:initialStatus,returnCaseId:c.returnId,updatedAt:c.timestamp}),
   {Put:{TableName:T.holds,Item:record,ConditionExpression:'attribute_not_exists(orderId)'}},audit(c,'COD_RETURN_REQUESTED',c.returnId)],async()=>{
    const row=await strongGet(db,T.holds,c.returnKey);return row?.returnId===c.returnId&&row.reason===v.reason?{...result,status:row.status,replayed:true}:null;
   });return recovered??result;
 },
 async arriveReturn(value:unknown){
  const v=input(value,['orderId','offerId','attempt','returnId',...(value&&typeof value==='object'&&Object.prototype.hasOwnProperty.call(value,'position')?['position']:[])]),c=await context(v,'DRIVER');
  if(v.returnId!==c.returnId||!c.record)return fail();
  if(c.record.status==='ARRIVED_AT_BRANCH'||c.record.status==='CONFIRMED'||c.record.status==='REVIEW_REQUIRED')return {...receipt(v,c,c.record.status),replayed:true};
  if(c.record.status!=='RETURNING'||c.order.status!=='returning'||c.order.returnStatus!=='RETURNING'||c.order.returnCaseId!==c.returnId||c.order.financialOutcome!=null)return fail();
  noCash(c.order);const returnOpsPolicy=readOrderExceptionPolicy(c.order)?await strongGet(db,'staging-PlatformStaff',{pk:'OPERATIONAL_SETTINGS#RETURN_OPERATIONS',sk:'CURRENT'}):null;const arrivalSettings=returnOpsPolicy?await readExceptionSettings(db):null;const arrivalProof=arrivalSettings?assertPosition(v.position,c.offer.source.order.branchPoint,arrivalSettings.snapshot.values,now()):null;const h=await holdGuard(c),result=receipt(v,c,'ARRIVED_AT_BRANCH');
  const recovered=await commit(c,[...c.guards,h.guard,...(arrivalSettings?[arrivalSettings.condition]:[]),set(orderFence(c),{status:'return_arrived',orderStatus:'return_arrived',returnStatus:'ARRIVED_AT_BRANCH',updatedAt:c.timestamp}),
   set(exactCheck(T.holds,c.returnKey,c.record),{status:'ARRIVED_AT_BRANCH',version:c.record.version+1,arrivedAt:c.timestamp,updatedAt:c.timestamp,...(arrivalProof?{arrivalProof}:{}),...(c.record.exceptionResolution?{exceptionResolution:returnResolution(c.order,c.offer,c.record,'ARRIVED_AT_BRANCH',c.timestamp)}:{})}),
   audit(c,'COD_RETURN_ARRIVED',c.returnId+':ARRIVED')],async()=>{
    const row=await strongGet(db,T.holds,c.returnKey);return row?.returnId===c.returnId&&['ARRIVED_AT_BRANCH','CONFIRMED','REVIEW_REQUIRED'].includes(row.status)?{...result,status:row.status,replayed:true}:null;
   });return recovered??result;
 },
 async readReturn(value:unknown){
  const v=input(value,['branchId','orderId','offerId','attempt']),c=await context(v,'MERCHANT_OWNER');
  if(!quoteEntityIdValid(v.branchId)||!c.record)return fail();
  await db.send(new TransactWriteCommand({TransactItems:[...c.guards,orderFence(c),exactCheck(T.holds,c.returnKey,c.record),audit(c,'COD_RETURN_READ',randomUUID())] as any}));
  let r=c.record;const acceptance=await strongGet(db,'staging-MerchantPlatform',acceptanceKey(c.offer.branchId));
  if(r.entitlementsPosted?.merchantCompensationIqd){const p=await strongGet(db,T.holds,{orderId:v.orderId,sk:'MERCHANT_PAYABLE'});if(p?.status==='PAID'){const journal=await strongGet(db,'staging-MerchantPlatform',{pk:'MERCHANT_PAYOUT_PAID#'+p.paidPayoutId,sk:'META'});verifyMerchantPayoutJournal(journal!,c.offer.branchId,p);r={...r,exceptionResolution:{...r.exceptionResolution,merchantCompensation:{...r.exceptionResolution.merchantCompensation,paymentStatus:'PAID',paidAt:p.paidAt}}};}}
  return {success:true,kind:'COD_RETURN_CASE',orderId:v.orderId,offerId:v.offerId,attempt:v.attempt,branchId:c.offer.branchId,returnId:c.returnId,
   itemManifest:r.itemManifest??null,itemReceipt:r.itemReceipt??null,status:r.status,version:r.version,taskCompleted:c.order.status==='returned',holdStatus:c.order.holdStatus,automaticReturnAcceptance:{enabled:acceptance?.enabled===true&&acceptance?.ownerId===c.branch.ownerId&&acceptance?.termsVersion==='RETURN_ACCEPTANCE_V1'},handoverIssue:r.handoverIssue??null,branchReadiness:r.branchReadiness??null,disposition:r.disposition??null,reason:r.reason,cashCollected:r.cashCollected,createdAt:r.createdAt,arrivedAt:r.arrivedAt??null,
   ...(r.exceptionResolution?{resolution:merchantReturnResolution(r)}:{}),
   confirmation:r.confirmedAt?{allItemsReceived:r.allItemsReceived,condition:r.condition,driverResponsibility:r.driverResponsibility,confirmedAt:r.confirmedAt}:null};
 },
 async confirmReceipt(value:unknown){
  const v=input(value,['branchId','orderId','offerId','attempt','returnId','expectedVersion','allItemsReceived','condition','driverResponsibility','cashCollected',...(value&&typeof value==='object'&&Object.prototype.hasOwnProperty.call(value,'itemReceipts')?['itemReceipts']:[])]);
  if(v.cashCollected!==false)return fail('COD_CASH_REVIEW_REQUIRED');
  if(!quoteEntityIdValid(v.branchId))return fail('INVALID_COD_RETURN');
  if(typeof v.allItemsReceived!=='boolean'||!['INTACT','DAMAGED','MISSING'].includes(v.condition)||!['NONE','REVIEW'].includes(v.driverResponsibility)||!Number.isSafeInteger(v.expectedVersion)||v.expectedVersion<1)return fail('INVALID_COD_RETURN');
  const c=await context(v,'MERCHANT_OWNER');noCash(c.order);
  if(v.returnId!==c.returnId||!c.record)return fail();
  if(c.record?.itemCustodyOrigin)return fail('RETURN_ITEM_PLAN_LOCKED');
  const fingerprint=quoteHash(v);
  if(c.record.confirmationDigest){if(c.record.confirmationDigest!==fingerprint||c.record.confirmedBy!==c.actor.subjectId)return fail();return {...c.record.receipt,replayed:true};}
  const savedCase=c.record;
  const itemResult=savedCase.itemManifest?verifyReturnItemReceipt(savedCase.itemManifest,v.itemReceipts,c.actor.subjectId,c.timestamp):null;
  if(!savedCase.itemManifest&&v.itemReceipts!==undefined)return fail('RETURN_ITEMS_INVALID');
  if(itemResult&&(itemResult.allItemsReceived!==v.allItemsReceived||itemResult.condition!==v.condition||savedCase.itemManifest.orderId!==v.orderId||savedCase.itemManifest.attempt!==v.attempt||savedCase.itemManifest.offerDigest!==c.offer.digest))return fail('RETURN_ITEMS_INVALID');
  const perform=async()=>{
  if(savedCase.status!=='ARRIVED_AT_BRANCH'||savedCase.version!==v.expectedVersion||c.order.status!=='return_arrived'||c.order.returnStatus!=='ARRIVED_AT_BRANCH'||c.order.returnCaseId!==c.returnId||c.order.financialOutcome!=null)return fail();
  const h=await holdGuard(c),clean=v.allItemsReceived&&v.condition==='INTACT'&&v.driverResponsibility==='NONE';
  const result={...receipt(v,c,clean?'CONFIRMED':'REVIEW_REQUIRED'),holdReleased:clean&&h.H>0,holdStatus:clean?(h.H?'RELEASED':'NOT_REQUIRED'):c.order.holdStatus,financialReviewRequired:!clean,driverCompensationStatus:'PENDING_POLICY_REVIEW'};
  const ops:Row[]=[...c.guards];
  const physicalReceipt=v.allItemsReceived&&v.condition!=='MISSING'&&!!savedCase.exceptionResolution;
  let taskCompletion:Row|undefined;
  if(!clean){
   if(physicalReceipt){const task=await planReturnedTask(db,c.order,c.offer,c.timestamp);taskCompletion={returnId:c.returnId,source:'VERIFIED_OWNER_RECEIPT',ownerReceiptAt:c.timestamp,closedAt:c.timestamp,condition:v.condition,financialPosting:false};ops.push(...task.operations,h.guard,set(orderFence(c),{...task.orderFields,returnStatus:'REVIEW_REQUIRED'}));}
   else ops.push(h.guard,set(orderFence(c),{returnStatus:'REVIEW_REQUIRED',updatedAt:c.timestamp}));
  }else{
   const operationId='CR:'+quoteHash({returnId:c.returnId,attempt:v.attempt,offerDigest:c.offer.digest}).slice(0,48);
   Object.assign(result,{operationId});
   const release=await prepareCodRelease(db,c.order,c.offer,c.timestamp,operationId,true,options.enableDeliveryFunding===true,undefined,options.enableFullCash===true);
   const journal=release.journalLines;
   ops.push(...release.operations);
   const liveKey={driverId:c.order.driverId},live=await strongGet(db,T.live,liveKey),jobKey={orderId:v.orderId,SK:'METADATA'},job=await strongGet(db,T.jobs,jobKey);
   if(!live||live.currentOrderId!==v.orderId||live.activeOrdersCount!==1||!job||job.assignedDriverId!==c.order.driverId||job.status!=='assigned'||job.dispatchJobId!==c.offer.assignmentId)return fail();
   if(journal.reduce((s,r)=>s+BigInt(r.delta),0n)!==0n)return fail();
   ops.push(set(orderFence(c),{status:'returned',orderStatus:'returned',returnStatus:'CONFIRMED',returnedAt:c.timestamp,...(c.order.returnHandover?{returnHandover:{...c.order.returnHandover,state:'RESOLVED_BY_OWNER_RECEIPT'}}:{}),holdStatus:h.H?'RELEASED':'NOT_REQUIRED',walletFinancialStatus:'RETURNED',financialOutcome:operationId,updatedAt:c.timestamp}),
    set(exactCheck(T.live,liveKey,live),{currentOrderId:null,activeOrdersCount:0,isSearching:live.isActive===true,status:live.isActive===true?'available':'offline'}),
    set(exactCheck(T.jobs,jobKey,job),{status:'returned',completedAt:c.timestamp}),
    {Put:{TableName:T.holds,Item:{orderId:v.orderId,sk:'FINANCIAL_OUTCOME',kind:'COD_RETURN_JOURNAL',...(c.order.financialAcceptance.schemaVersion===3?{schemaVersion:3,settlementModel:'FULL_CASH_AT_DELIVERY_V1',deliveryFunding:c.order.financialAcceptance.deliveryFunding}:c.order.financialAcceptance.schemaVersion===2?{schemaVersion:2,deliveryFunding:c.order.financialAcceptance.deliveryFunding}:{}),operationId,outcome:'RETURNED',returnId:c.returnId,driverId:c.order.driverId,subjectId:c.subject,branchId:c.offer.branchId,
     offerId:v.offerId,attempt:v.attempt,journalLines:journal,receipt:result,createdAt:c.timestamp},ConditionExpression:'attribute_not_exists(orderId)'}},
    codIntegrationEvent({kind:'COD_RETURN_OUTBOX',financialOperationId:operationId,orderId:v.orderId,driverId:c.order.driverId,subjectId:c.subject,branchId:c.offer.branchId,offerId:v.offerId,attempt:v.attempt,waveNumber:c.order.assignmentWaveNumber,createdAt:c.timestamp}));
  }
  if(savedCase.exceptionResolution){const active=(result.status==='CONFIRMED'||physicalReceipt)&&savedCase.casePolicySnapshot?casePhase(savedCase.casePolicySnapshot,'FINANCIAL',c.timestamp):savedCase.activePhase;ops.push(await exceptionCaseIndexOperation(db,{caseId:savedCase.exceptionResolution.caseId,orderId:v.orderId,caseKey:c.returnKey.sk,caseType:'COD_DELIVERY_EXCEPTION',state:result.status==='CONFIRMED'?'SETTLEMENT_PENDING':'MANUAL_REVIEW',open:true,at:c.timestamp,branchId:c.offer.branchId,dueAt:active?.responseDueAt??c.timestamp}));}
  ops.push(set(exactCheck(T.holds,c.returnKey,savedCase),{status:result.status,version:savedCase.version+1,...(taskCompletion?{taskCompletion}:{}),...(itemResult?{itemReceipt:itemResult.receipt}:{}),confirmationDigest:fingerprint,confirmedBy:c.actor.subjectId,confirmedAt:c.timestamp,
   ...(clean&&savedCase.handoverIssue?{handoverIssue:{...savedCase.handoverIssue,state:'RESOLVED_BY_OWNER_RECEIPT',resolvedAt:c.timestamp}}:{}),allItemsReceived:v.allItemsReceived,condition:v.condition,driverResponsibility:v.driverResponsibility,receipt:result,updatedAt:c.timestamp,...((result.status==='CONFIRMED'||physicalReceipt)&&savedCase.casePolicySnapshot?{phaseHistory:[...(savedCase.phaseHistory??[]),{...savedCase.activePhase,respondedAt:c.timestamp,responseSource:'MERCHANT_RECEIPT'}],activePhase:casePhase(savedCase.casePolicySnapshot,'FINANCIAL',c.timestamp)}:{}),...(savedCase.exceptionResolution?{exceptionResolution:returnResolution(c.order,c.offer,{...savedCase,...(itemResult?{itemReceipt:itemResult.receipt}:{}),allItemsReceived:v.allItemsReceived,condition:v.condition,confirmedAt:c.timestamp},result.status,c.timestamp)}:{})}),
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
