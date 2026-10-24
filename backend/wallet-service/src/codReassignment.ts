import {readOrderExceptionPolicy} from './orderExceptionPolicy';
import {readExceptionCasePolicy,casePhase} from './exceptionCasePolicy';
import {exceptionCaseIndexOperation} from './orderExceptionCaseIndex';
import { codIntegrationEvent } from './codIntegrationEvent';
import { DynamoDBDocumentClient, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { createCodFlowContext, ReturnActor } from './codFlowContext';
import { prepareCodRelease, setFinancialFields as set } from './financialRelease';
import { quoteHash, quoteEntityIdValid } from './deliveryQuoteRecord';
import { detach, equal, strongGet, exactCheck, FinancialRow as Row } from './driverFinancialTransaction';
const T={orders:'WizzOrders',holds:'staging-Holds',jobs:'WizzDispatchJobs_staging',live:'WizzDriverLiveState_staging',audit:'staging-AuditLog',lifecycle:'staging-WalletLifecycle'};
const fail=(code='COD_ASSIGNMENT_CONFLICT'):never=>{throw Object.assign(Error(code),{code});};
/** No automatic cancellation fee or return earning. Both remain subject to an explicit policy review.
 * Unassignment preserves order funds and frozen customer price, cancels only this driver assignment.
 */
export function createStagingCodReassignment(options:{db:Pick<DynamoDBDocumentClient,'send'>;authenticate:()=>Promise<ReturnActor>;reassignmentWindowSeconds:number;maximumWaves?:number;operatingCondition?:Row|null;operatingVersion?:number;now?:()=>number;enableDeliveryFunding?:boolean;enableFullCash?:boolean;cancelActorKind?:'MERCHANT_OWNER'|'STAFF';unassignActorKind?:'DRIVER'|'STAFF';assignmentDecision?:Row;authorizeStaff?:(actor:ReturnActor,order:Row,branch:Row)=>Promise<Row[]>;cancellationDecision?:Row;administrativeCancellation?:boolean;merchantCancellation?:Row}){
 const {db,authenticate,reassignmentWindowSeconds}=options,now=options.now??Date.now;
 if(!Number.isSafeInteger(reassignmentWindowSeconds)||reassignmentWindowSeconds<30||reassignmentWindowSeconds>900)return fail('COD_REASSIGNMENT_NOT_CONFIGURED');
 const maximumWaves=options.maximumWaves??4;if(!Number.isSafeInteger(maximumWaves)||maximumWaves<1||maximumWaves>10)return fail('COD_REASSIGNMENT_NOT_CONFIGURED');
 const context=createCodFlowContext({db,authenticate,now,enableDeliveryFunding:options.enableDeliveryFunding,enableFullCash:options.enableFullCash,authorizeStaff:options.authorizeStaff});
 async function run(value:unknown,cancel:boolean){
  const fields=cancel?['orderId','offerId','attempt','branchId',...(options.administrativeCancellation===true?[]:['goodsRetainedByBranch']),'cashCollected']:['orderId','offerId','attempt','cashCollected','reason'];
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==fields.sort().join(','))return fail('INVALID_COD_ASSIGNMENT');
  const v=detach(value as Row);
  if(![v.orderId,v.offerId].every(quoteEntityIdValid)||!Number.isSafeInteger(v.attempt)||v.attempt<1||v.attempt>=1000||v.cashCollected!==false||cancel&&(!quoteEntityIdValid(v.branchId)||options.administrativeCancellation!==true&&v.goodsRetainedByBranch!==true))return fail('INVALID_COD_ASSIGNMENT');
  if(!cancel&&!['VehicleIssue','Emergency','TooFar','TrafficJam','Other'].includes(v.reason))return fail('INVALID_COD_ASSIGNMENT');
  const actor=detach(await authenticate()),kind=cancel?(options.cancelActorKind??'MERCHANT_OWNER'):(options.unassignActorKind??'DRIVER');if(actor.kind!==kind||!quoteEntityIdValid(actor.subjectId))return fail('UNAUTHORIZED');
  if(!cancel&&kind==='STAFF'&&(!options.assignmentDecision||typeof options.assignmentDecision.reason!=='string'||options.assignmentDecision.reason.trim().length<5||options.assignmentDecision.reason.length>1000||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(options.assignmentDecision.idempotencyKey||'')))return fail('INVALID_COD_ASSIGNMENT');
  if(options.administrativeCancellation===true&&kind!=='STAFF')return fail('UNAUTHORIZED');
  const archiveKey={orderId:v.orderId,sk:'ASSIGNMENT_RELEASE#'+v.attempt},digest=quoteHash({...v,mode:cancel?'CANCEL':'UNASSIGN',...(kind==='STAFF'?{decision:cancel?options.cancellationDecision:options.assignmentDecision}:options.merchantCancellation?{merchantCancellation:options.merchantCancellation}:{})});
  function prior(row:Row|null){if(!row)return null;if(row.kind!=='COD_ASSIGNMENT_RELEASE'||row.requestDigest!==digest||row.actorId!==actor.subjectId||row.actorKind!==kind||row.offerId!==v.offerId||row.receipt?.orderId!==v.orderId)return fail();return {...row.receipt,replayed:true};}
  const replay=prior(await strongGet(db,T.holds,archiveKey));if(replay)return replay;
  try {
  const c=await context(v,kind),o=c.order;
  if(!equal(c.actor,actor)||o.merchantHandover?.state==='HANDED_TO_DRIVER'||!['assigned','accepted','heading_to_store','arrived_at_store'].includes(o.status)||o.pickedUpAt!=null||o.financialOutcome!=null||o.returnCaseId!=null||o.returnStatus!=null||c.record||o.cancellationRequestId!=null||o.cancellationStatus!=null||o.cashCollected!=null&&o.cashCollected!==false||o.cashCollectedAmount!=null&&o.cashCollectedAmount!==0)return fail();
  let decisionCase:Row|null=null,decisionOperation:Row|null=null,decisionJournal:Row|null=null,caseIndexOperation:Row|null=null,casePolicyCondition:Row|null=null;
  const decision=options.cancellationDecision;
  if(cancel&&kind==='STAFF'){
   if(!decision||typeof decision.reason!=='string'||decision.reason.trim().length<5||!quoteEntityIdValid(decision.requestId)||!quoteEntityIdValid(decision.decisionId)||!Number.isSafeInteger(decision.expectedVersion))return fail('INVALID_COD_ASSIGNMENT');
   const ck={orderId:v.orderId,sk:'CUSTOMER_CANCELLATION'},row=await strongGet(db,T.holds,ck);
   const proof=row?.merchantRetentionProof;
   if(!row||row.requestId!==decision.requestId||row.state!=='REQUESTED'||row.version!==decision.expectedVersion||options.administrativeCancellation!==true&&(!proof||proof.ownerId!==c.branch.ownerId||proof.branchId!==c.offer.branchId||proof.goodsRetainedByBranch!==true))return fail('CANCELLATION_RETAINED_PROOF_REQUIRED');
   const policy=row.casePolicySnapshot?null:await readExceptionCasePolicy(db),snapshot=row.casePolicySnapshot??policy!.snapshot;casePolicyCondition=policy?.condition??null;
   decisionCase={...row,casePolicySnapshot:snapshot,phaseHistory:[...(row.phaseHistory??[]),...(row.activePhase?[{...row.activePhase,respondedAt:c.timestamp,responseSource:'ADMIN_CANCELLATION'}]:[])],activePhase:casePhase(snapshot,'FINANCIAL',c.timestamp),state:'CANCELLED',version:row.version+1,settlementStatus:'REVIEW',decision:{administrativeOverride:options.administrativeCancellation===true,custodyBasis:options.administrativeCancellation===true?'NO_PICKUP_OR_HANDOVER_RECORDED':'OWNER_RETENTION_PROOF',decisionId:decision.decisionId,reason:decision.reason.trim(),actorId:actor.subjectId,at:c.timestamp},completedAt:c.timestamp,customerFee:0};
   const {Key:_key,...condition}=exactCheck(T.holds,ck,row).ConditionCheck;decisionOperation={Put:{...condition,Item:decisionCase}};
   caseIndexOperation=await exceptionCaseIndexOperation(db,{caseId:row.caseId,orderId:v.orderId,caseKey:row.sk,caseType:'CUSTOMER_CANCELLATION',state:'SETTLEMENT_PENDING',open:true,at:c.timestamp,branchId:c.offer.branchId,dueAt:decisionCase.activePhase.responseDueAt});
   decisionJournal={Put:{TableName:T.holds,Item:{orderId:v.orderId,sk:'CASE_DECISION#'+row.caseId+'#'+decision.decisionId,kind:'ORDER_EXCEPTION_DECISION',caseId:row.caseId,decisionId:decision.decisionId,action:'CANCEL_BEFORE_PICKUP',actorId:actor.subjectId,actorKind:'STAFF',reason:decision.reason.trim(),caseVersion:row.version,createdAt:c.timestamp,financialPosting:false},ConditionExpression:'attribute_not_exists(orderId)'}};
  }
  const extraCaseOperations:Row[]=[];
  if(cancel&&kind==='MERCHANT_OWNER'&&readOrderExceptionPolicy(o)){
   const command=options.merchantCancellation;
   if(!command||Object.keys(command).sort().join(',')!=='idempotencyKey,preparationState,reason'||typeof command.reason!=='string'||command.reason.trim().length<5||command.reason.length>1000||!['STARTED','READY'].includes(command.preparationState)||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(command.idempotencyKey||''))return fail('CANCELLATION_REASON_REQUIRED');
   const policy=await readExceptionCasePolicy(db),requestId='MCAN:'+quoteHash({orderId:v.orderId}).slice(0,48),caseId='OEX:'+quoteHash({requestId}).slice(0,48),ck={orderId:v.orderId,sk:'MERCHANT_CANCELLATION'};
   decisionCase={...ck,kind:'MERCHANT_CANCELLATION',schemaVersion:1,version:1,caseId,requestId,state:'CANCELLED',settlementStatus:'REVIEW',casePolicySnapshot:policy.snapshot,activePhase:casePhase(policy.snapshot,'FINANCIAL',c.timestamp),actorId:c.actor.subjectId,actorKind:c.actor.kind,requestDigest:digest,idempotencyKey:command.idempotencyKey,reason:command.reason.trim(),preparationState:command.preparationState,policyVersion:o.exceptionPolicy.version,policyDigest:o.exceptionPolicy.digest,createdAt:c.timestamp,completedAt:c.timestamp,updatedAt:c.timestamp,customerFee:0,responsibility:'UNDETERMINED',driverFare:{status:'REVIEW',basisAmount:c.offer.allocation.driverEarningEntitlement,approvedAmount:null,paymentStatus:'NOT_APPROVED'},merchantCompensation:{status:'REVIEW',amount:null},merchantRetentionProof:{ownerId:c.actor.subjectId,branchId:c.offer.branchId,goodsRetainedByBranch:true,preparationState:command.preparationState,note:command.reason.trim(),recordedAt:c.timestamp}};
   decisionOperation={Put:{TableName:T.holds,Item:decisionCase,ConditionExpression:'attribute_not_exists(orderId)'}};casePolicyCondition=policy.condition;
   caseIndexOperation=await exceptionCaseIndexOperation(db,{caseId,orderId:v.orderId,caseKey:ck.sk,caseType:decisionCase.kind,state:'SETTLEMENT_PENDING',open:true,at:c.timestamp,branchId:c.offer.branchId,dueAt:decisionCase.activePhase.responseDueAt});
   const customerKey={orderId:v.orderId,sk:'CUSTOMER_CANCELLATION'},customer=await strongGet(db,T.holds,customerKey);
   if(customer?.state==='REQUESTED'){const {Key:_key,...fence}=exactCheck(T.holds,customerKey,customer).ConditionCheck;extraCaseOperations.push({Put:{...fence,Item:{...customer,state:'SUPERSEDED',version:customer.version+1,linkedCaseId:caseId,updatedAt:c.timestamp,completedAt:c.timestamp}}},await exceptionCaseIndexOperation(db,{caseId:customer.caseId,orderId:v.orderId,caseKey:customer.sk,caseType:customer.kind,state:'SUPERSEDED',open:false,at:c.timestamp,branchId:c.offer.branchId}));}
   else extraCaseOperations.push(customer?exactCheck(T.holds,customerKey,customer):{ConditionCheck:{TableName:T.holds,Key:customerKey,ConditionExpression:'attribute_not_exists(orderId)'}});
  }
  const jobKey={orderId:v.orderId,SK:'METADATA'},job=await strongGet(db,T.jobs,jobKey),liveKey={driverId:o.driverId},live=await strongGet(db,T.live,liveKey);
  if(!job||job.status!=='assigned'||job.assignedDriverId!==o.driverId||job.dispatchJobId!==c.offer.assignmentId||!Number.isSafeInteger(job.currentWaveNumber)||job.currentWaveNumber<1||job.currentWaveNumber>=1000||!live||live.currentOrderId!==v.orderId||live.activeOrdersCount!==1)return fail();
  const operationId='CA:'+quoteHash({orderId:v.orderId,attempt:v.attempt,offerId:v.offerId,mode:cancel?'CANCEL':'UNASSIGN'}).slice(0,48);
  const release=await prepareCodRelease(db,o,c.offer,c.timestamp,operationId,cancel,options.enableDeliveryFunding===true,undefined,options.enableFullCash===true);
  const receipt={success:true,kind:cancel?'COD_CANCELLED':'COD_UNASSIGNED',orderId:v.orderId,offerId:v.offerId,attempt:v.attempt,operationId,holdReleased:release.H>0,replayed:false,...(decisionCase?{caseId:decisionCase.caseId,cancellationStatus:'CANCELLED',caseVersion:decisionCase.version}:{}),compensationStatus:'PENDING_POLICY_REVIEW'};
  const fieldsToFence=[...new Set([...Object.keys(o),'financialOutcome','returnStatus','returnCaseId','cancellationStatus','cancellationRequestId','pickedUpAt','cashCollected','cashCollectedAmount','financialRelease','merchantHandover'])];
  const ops:Row[]=[...c.guards,...release.operations,...extraCaseOperations,...(decisionOperation?[decisionOperation]:[]),...(decisionJournal?[decisionJournal]:[]),...(caseIndexOperation?[caseIndexOperation]:[]),...(casePolicyCondition?[casePolicyCondition]:[]),
   {Put:{TableName:T.holds,Item:{...archiveKey,kind:'COD_ASSIGNMENT_RELEASE',...(o.financialAcceptance.schemaVersion===3?{schemaVersion:3,settlementModel:'FULL_CASH_AT_DELIVERY_V1',deliveryFunding:o.financialAcceptance.deliveryFunding}:o.financialAcceptance.schemaVersion===2?{schemaVersion:2,deliveryFunding:o.financialAcceptance.deliveryFunding}:{}),outcome:cancel?'CANCELLED':'UNASSIGNED',operationId,requestDigest:digest,actorId:actor.subjectId,actorKind:kind,...(!cancel&&kind==='STAFF'?{staffDecision:options.assignmentDecision}:{}),
    orderId:v.orderId,offerId:v.offerId,attempt:v.attempt,branchId:c.offer.branchId,driverId:o.driverId,subjectId:c.subject,offerDigest:c.offer.digest,snapshotDigest:quoteHash(o.financialSnapshot),
    acceptedTerms:o.financialAcceptance,releasedHold:release.hold?{...release.hold,status:'RELEASED',statusCreatedAt:'RELEASED#'+c.timestamp,updatedAt:c.timestamp,releaseOperationId:operationId}:null,journalLines:release.journalLines,receipt,createdAt:c.timestamp},ConditionExpression:'attribute_not_exists(orderId)'}},
   set(exactCheck(T.live,liveKey,live),{currentOrderId:null,activeOrdersCount:0,isSearching:live.isActive===true,status:live.isActive===true?'available':'offline'}),
   {Put:{TableName:T.audit,Item:{datePartition:'date#'+c.timestamp.slice(0,10).replace(/-/g,''),sk:c.timestamp+'#'+operationId,logId:operationId,action:cancel?'COD_CANCELLED_BEFORE_PICKUP':kind==='STAFF'?'COD_STAFF_UNASSIGNED':'COD_DRIVER_UNASSIGNED',...(!cancel&&kind==='STAFF'?{reason:options.assignmentDecision!.reason,requestId:options.assignmentDecision!.idempotencyKey}:{}),actorId:actor.subjectId,orderId:v.orderId,driverId:o.driverId,branchId:c.offer.branchId,createdAt:c.timestamp,operationId},ConditionExpression:'attribute_not_exists(sk)'}},
   codIntegrationEvent({kind:cancel?'COD_CANCEL_OUTBOX':'COD_UNASSIGN_OUTBOX',financialOperationId:operationId,orderId:v.orderId,driverId:o.driverId,subjectId:c.subject,branchId:c.offer.branchId,offerId:v.offerId,attempt:v.attempt,waveNumber:o.assignmentWaveNumber,createdAt:c.timestamp})];
  if(cancel){
   ops.push(set(exactCheck(T.orders,c.key,o,fieldsToFence),{status:'cancelled',orderStatus:'cancelled',cancelledAt:c.timestamp,cancelledBy:actor.subjectId,...(decisionCase?{exceptionCancellation:{requestId:decisionCase.requestId,caseId:decisionCase.caseId,state:'CANCELLED',version:decisionCase.version}}:{}),holdStatus:release.H?'RELEASED':'NOT_REQUIRED',walletFinancialStatus:'CANCELLED',financialOutcome:operationId,updatedAt:c.timestamp}),
    set(exactCheck(T.jobs,jobKey,job),{status:'cancelled',completedAt:c.timestamp}),
    {Put:{TableName:T.holds,Item:{orderId:v.orderId,sk:'FINANCIAL_OUTCOME',kind:'COD_CANCEL_JOURNAL',...(o.financialAcceptance.schemaVersion===3?{schemaVersion:3,settlementModel:'FULL_CASH_AT_DELIVERY_V1',deliveryFunding:o.financialAcceptance.deliveryFunding}:o.financialAcceptance.schemaVersion===2?{schemaVersion:2,deliveryFunding:o.financialAcceptance.deliveryFunding}:{}),outcome:'CANCELLED',operationId,offerId:v.offerId,attempt:v.attempt,driverId:o.driverId,subjectId:c.subject,branchId:c.offer.branchId,journalLines:release.journalLines,receipt,createdAt:c.timestamp},ConditionExpression:'attribute_not_exists(orderId)'}});
  }else{
   const excluded=[...new Set([...(job.financialExcludedDriverIds??[]),o.driverId])];
   if(excluded.length>1000||!excluded.every(quoteEntityIdValid))return fail();
   ops.push(set(exactCheck(T.orders,c.key,o,fieldsToFence),{status:'ready_for_pickup',orderStatus:'ready_for_pickup',driverId:null,assignedDriverId:null,holdId:null,holdStatus:'NONE',holdAmount:0,financialAcceptance:null,driverName:null,driverPhone:null,vehicleType:null,vehiclePlate:null,assignedAt:null,driverAssignedAt:null,
     financialRelease:{attempt:v.attempt,offerId:v.offerId,operationId},updatedAt:c.timestamp}),
    set(exactCheck(T.jobs,jobKey,job),{status:'searching',assignedDriverId:null,driverId:null,expiresAt:new Date(now()+reassignmentWindowSeconds*1000).toISOString(),financialPreparingWave:null,financialWaveDeadline:null,financialSearchMaxWave:Math.min(job.currentWaveNumber+maximumWaves,1000),operatingLimitsVersion:options.operatingVersion??0,
     financialExcludedDriverIds:excluded,financialRedispatch:{waveNumber:job.currentWaveNumber+1,excludeDriverIds:excluded,operationId}}),
    {ConditionCheck:{TableName:T.holds,Key:{orderId:v.orderId,sk:'FINANCIAL_OUTCOME'},ConditionExpression:'attribute_not_exists(orderId)'}});
  }
  if(!cancel&&options.operatingCondition)ops.push(options.operatingCondition);
  if(ops.length>100||Buffer.byteLength(JSON.stringify(ops))>3500000)return fail('COD_ASSIGNMENT_UNAVAILABLE');
  if(!equal(actor,await authenticate()))return fail('UNAUTHORIZED');
  try{await db.send(new TransactWriteCommand({TransactItems:ops as any,ClientRequestToken:quoteHash(ops).slice(0,36)}));}
  catch{const old=prior(await strongGet(db,T.holds,archiveKey));if(old)return old;return fail('COD_ASSIGNMENT_UNAVAILABLE');}
  return receipt;
  }catch(error){const committed=prior(await strongGet(db,T.holds,archiveKey));if(committed&&equal(actor,await authenticate()))return committed;throw error;}
 }
 return Object.freeze({unassign:(v:unknown)=>run(v,false),cancelBeforePickup:(v:unknown)=>run(v,true)});
}
