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
export function createStagingCodReassignment(options:{db:Pick<DynamoDBDocumentClient,'send'>;authenticate:()=>Promise<ReturnActor>;reassignmentWindowSeconds:number;maximumWaves?:number;operatingCondition?:Row|null;operatingVersion?:number;now?:()=>number}){
 const {db,authenticate,reassignmentWindowSeconds}=options,now=options.now??Date.now;
 if(!Number.isSafeInteger(reassignmentWindowSeconds)||reassignmentWindowSeconds<30||reassignmentWindowSeconds>900)return fail('COD_REASSIGNMENT_NOT_CONFIGURED');
 const maximumWaves=options.maximumWaves??4;if(!Number.isSafeInteger(maximumWaves)||maximumWaves<1||maximumWaves>10)return fail('COD_REASSIGNMENT_NOT_CONFIGURED');
 const context=createCodFlowContext({db,authenticate,now});
 async function run(value:unknown,cancel:boolean){
  const fields=cancel?['orderId','offerId','attempt','branchId','goodsRetainedByBranch','cashCollected']:['orderId','offerId','attempt','cashCollected','reason'];
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==fields.sort().join(','))return fail('INVALID_COD_ASSIGNMENT');
  const v=detach(value as Row);
  if(![v.orderId,v.offerId].every(quoteEntityIdValid)||!Number.isSafeInteger(v.attempt)||v.attempt<1||v.attempt>=1000||v.cashCollected!==false||cancel&&(!quoteEntityIdValid(v.branchId)||v.goodsRetainedByBranch!==true))return fail('INVALID_COD_ASSIGNMENT');
  if(!cancel&&!['VehicleIssue','Emergency','TooFar','TrafficJam','Other'].includes(v.reason))return fail('INVALID_COD_ASSIGNMENT');
  const actor=detach(await authenticate()),kind=cancel?'MERCHANT_OWNER':'DRIVER';if(actor.kind!==kind||!quoteEntityIdValid(actor.subjectId))return fail('UNAUTHORIZED');
  const archiveKey={orderId:v.orderId,sk:'ASSIGNMENT_RELEASE#'+v.attempt},digest=quoteHash({...v,mode:cancel?'CANCEL':'UNASSIGN'});
  function prior(row:Row|null){if(!row)return null;if(row.kind!=='COD_ASSIGNMENT_RELEASE'||row.requestDigest!==digest||row.actorId!==actor.subjectId||row.actorKind!==kind||row.offerId!==v.offerId||row.receipt?.orderId!==v.orderId)return fail();return {...row.receipt,replayed:true};}
  const replay=prior(await strongGet(db,T.holds,archiveKey));if(replay)return replay;
  try {
  const c=await context(v,kind),o=c.order;
  if(!equal(c.actor,actor)||!['assigned','accepted','heading_to_store','arrived_at_store'].includes(o.status)||o.pickedUpAt!=null||o.financialOutcome!=null||o.returnCaseId!=null||o.returnStatus!=null||c.record||o.cancellationRequestId!=null||o.cancellationStatus!=null||o.cashCollected!=null&&o.cashCollected!==false||o.cashCollectedAmount!=null&&o.cashCollectedAmount!==0)return fail();
  const jobKey={orderId:v.orderId,SK:'METADATA'},job=await strongGet(db,T.jobs,jobKey),liveKey={driverId:o.driverId},live=await strongGet(db,T.live,liveKey);
  if(!job||job.status!=='assigned'||job.assignedDriverId!==o.driverId||job.dispatchJobId!==c.offer.assignmentId||!Number.isSafeInteger(job.currentWaveNumber)||job.currentWaveNumber<1||job.currentWaveNumber>=1000||!live||live.currentOrderId!==v.orderId||live.activeOrdersCount!==1)return fail();
  const operationId='CA:'+quoteHash({orderId:v.orderId,attempt:v.attempt,offerId:v.offerId,mode:cancel?'CANCEL':'UNASSIGN'}).slice(0,48);
  const release=await prepareCodRelease(db,o,c.offer,c.timestamp,operationId,cancel);
  const receipt={success:true,kind:cancel?'COD_CANCELLED':'COD_UNASSIGNED',orderId:v.orderId,offerId:v.offerId,attempt:v.attempt,operationId,holdReleased:release.H>0,replayed:false,compensationStatus:'PENDING_POLICY_REVIEW'};
  const fieldsToFence=[...new Set([...Object.keys(o),'financialOutcome','returnStatus','returnCaseId','cancellationStatus','cancellationRequestId','pickedUpAt','cashCollected','cashCollectedAmount','financialRelease'])];
  const ops:Row[]=[...c.guards,...release.operations,
   {Put:{TableName:T.holds,Item:{...archiveKey,kind:'COD_ASSIGNMENT_RELEASE',outcome:cancel?'CANCELLED':'UNASSIGNED',operationId,requestDigest:digest,actorId:actor.subjectId,actorKind:kind,
    orderId:v.orderId,offerId:v.offerId,attempt:v.attempt,branchId:c.offer.branchId,driverId:o.driverId,subjectId:c.subject,offerDigest:c.offer.digest,snapshotDigest:quoteHash(o.financialSnapshot),
    acceptedTerms:o.financialAcceptance,releasedHold:release.hold?{...release.hold,status:'RELEASED',statusCreatedAt:'RELEASED#'+c.timestamp,updatedAt:c.timestamp,releaseOperationId:operationId}:null,journalLines:release.journalLines,receipt,createdAt:c.timestamp},ConditionExpression:'attribute_not_exists(orderId)'}},
   set(exactCheck(T.live,liveKey,live),{currentOrderId:null,activeOrdersCount:0,isSearching:false,status:live.isActive===true?'available':'offline'}),
   {Put:{TableName:T.audit,Item:{datePartition:'date#'+c.timestamp.slice(0,10).replace(/-/g,''),sk:c.timestamp+'#'+operationId,logId:operationId,action:cancel?'COD_CANCELLED_BEFORE_PICKUP':'COD_DRIVER_UNASSIGNED',actorId:actor.subjectId,orderId:v.orderId,driverId:o.driverId,branchId:c.offer.branchId,createdAt:c.timestamp,operationId},ConditionExpression:'attribute_not_exists(sk)'}},
   codIntegrationEvent({kind:cancel?'COD_CANCEL_OUTBOX':'COD_UNASSIGN_OUTBOX',financialOperationId:operationId,orderId:v.orderId,driverId:o.driverId,subjectId:c.subject,branchId:c.offer.branchId,offerId:v.offerId,attempt:v.attempt,waveNumber:o.assignmentWaveNumber,createdAt:c.timestamp})];
  if(cancel){
   ops.push(set(exactCheck(T.orders,c.key,o,fieldsToFence),{status:'cancelled',orderStatus:'cancelled',cancelledAt:c.timestamp,cancelledBy:actor.subjectId,holdStatus:release.H?'RELEASED':'NOT_REQUIRED',walletFinancialStatus:'CANCELLED',financialOutcome:operationId,updatedAt:c.timestamp}),
    set(exactCheck(T.jobs,jobKey,job),{status:'cancelled',completedAt:c.timestamp}),
    {Put:{TableName:T.holds,Item:{orderId:v.orderId,sk:'FINANCIAL_OUTCOME',kind:'COD_CANCEL_JOURNAL',outcome:'CANCELLED',operationId,offerId:v.offerId,attempt:v.attempt,driverId:o.driverId,subjectId:c.subject,branchId:c.offer.branchId,journalLines:release.journalLines,receipt,createdAt:c.timestamp},ConditionExpression:'attribute_not_exists(orderId)'}});
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
