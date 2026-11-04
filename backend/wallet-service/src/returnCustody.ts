import {financialOfferSK} from './financialOfferKey';
import {DynamoDBDocumentClient,TransactWriteCommand} from '@aws-sdk/lib-dynamodb';
import {strongGet,exactCheck,equal} from './driverFinancialTransaction';
import {setFinancialFields as set} from './financialRelease';
import {verifyFullCashAssignment} from './fullCashOffer';
import {verifyDeliveryFundedAssignment} from './deliveryFundedOffer';
import {verifyFinancialAssignment} from './financialAssignment';
import {quoteHash,quoteEntityIdValid} from './deliveryQuoteRecord';
import {readOrderExceptionPolicy} from './orderExceptionPolicy';
import {casePhase} from './exceptionCasePolicy';
import {exceptionCaseIndexOperation} from './orderExceptionCaseIndex';
type Row=Record<string,any>;
const fail=():never=>{throw Error('RETURN_CUSTODY_CONFLICT');};
/** Physical receipt and condition are distinct. This plan NEVER changes collateral or pays anyone. */
export async function planReturnedTask(db:Pick<DynamoDBDocumentClient,'send'>,order:Row,offer:Row,at:string){
 const liveKey={driverId:order.driverId},jobKey={orderId:order.orderId,SK:'METADATA'},live=await strongGet(db,'WizzDriverLiveState_staging',liveKey),job=await strongGet(db,'WizzDispatchJobs_staging',jobKey);
 if(!live||live.currentOrderId!==order.orderId||live.activeOrdersCount!==1||!job||job.assignedDriverId!==order.driverId||job.status!=='assigned'||job.dispatchJobId!==offer.assignmentId)return fail();
 return {orderFields:{status:'returned',orderStatus:'returned',returnedAt:at,returnTaskCompletedAt:at,returnCustodyStatus:'RETURNED_TO_MERCHANT',updatedAt:at},operations:[
 set(exactCheck('WizzDriverLiveState_staging',liveKey,live),{currentOrderId:null,activeOrdersCount:0,isSearching:live.isActive===true,status:live.isActive===true?'available':'offline'}),
 set(exactCheck('WizzDispatchJobs_staging',jobKey,job),{status:'returned',completedAt:at})]};
}
/** Reconcile ONLY an immutable, authenticated owner attestation already stored by confirmReceipt.
 * Scheduled worker is SYSTEM, never an invented merchant/staff login. Existing disputed money stays untouched. */
export function createReturnCustodyReconciler(options:{db:Pick<DynamoDBDocumentClient,'send'>;now?:()=>number}){
 const {db}=options,now=options.now??Date.now;
 return async function reconcile(orderId:string,caseKey:string){
 if(!quoteEntityIdValid(orderId)||!/^RETURN#[1-9][0-9]{0,2}$/.test(caseKey))return fail();
 const key={PK:'ORDER#'+orderId,SK:'META'},ck={orderId,sk:caseKey},order=await strongGet(db,'WizzOrders',key),row=await strongGet(db,'staging-Holds',ck);
 if(!order||!row||row.kind!=='COD_RETURN_CASE'||row.status!=='REVIEW_REQUIRED'||row.allItemsReceived!==true||!['INTACT','DAMAGED'].includes(row.condition)||!row.confirmationDigest||!row.confirmedAt||!row.exceptionResolution||!readOrderExceptionPolicy(order))return {closed:false};
 if(row.taskCompletion){if(order.status!=='returned'||!order.returnTaskCompletedAt||row.taskCompletion.returnId!==row.returnId)return fail();return {closed:true,replayed:true};}
 if(order.status!=='return_arrived'||order.orderStatus!=='return_arrived'||order.returnStatus!=='REVIEW_REQUIRED'||order.returnCaseId!==row.returnId||order.financialOutcome!=null||(order.cashCollected!=null&&order.cashCollected!==false)||(order.cashCollectedAmount!=null&&order.cashCollectedAmount!==0)||row.cashCollected!==false||order.orderId!==orderId||row.offerId!==order.financialAcceptance?.offerId||row.attempt!==order.assignmentAttemptCounter||order.deletedAt!=null||order.deletionRequestId!=null||order.isDeleted===true||row.receipt?.status!=='REVIEW_REQUIRED'||row.receipt?.returnId!==row.returnId||row.receipt?.orderId!==orderId)return fail();
 const driverKey={driverId:order.driverId},driver=await strongGet(db,'WhizzDrivers_staging',driverKey),offerKey={orderId,SK:await financialOfferSK(db,orderId,order.driverId,order.assignmentWaveNumber)},saved=await strongGet(db,'WaveOffers_staging',offerKey),subject=driver?.cognitoSub??driver?.driverId;
 if(!driver||driver.deletedAt!=null||driver.deletionRequestId!=null||driver.isDeleted===true)return fail();
 let offer:Row;if(order.financialAcceptance.schemaVersion===3){const full=verifyFullCashAssignment(order,saved!,subject);offer={...full.baseOffer,digest:full.digest,allocation:full.settlement.allocation};}else if(order.financialAcceptance.schemaVersion===2){const funded=verifyDeliveryFundedAssignment(order,saved!,subject);offer={...funded.baseOffer,digest:funded.digest,allocation:funded.allocation};}else offer=verifyFinancialAssignment(order,saved,subject);
 const bk={businessId:offer.branchId},branch=await strongGet(db,'WhizzMerchants_Businesses',bk);
 if(!branch||branch.ownerId!==row.confirmedBy||branch.cognitoUserId!==branch.ownerId||branch.organizationId!==offer.source.order.merchantId||branch.deletedAt!=null||branch.deletionRequestId!=null||branch.isDeleted===true||row.branchId!==offer.branchId)return fail();
 const at=new Date(now()).toISOString(),task=await planReturnedTask(db,order,offer,at),eventId='RTC:'+quoteHash({returnId:row.returnId,confirmationDigest:row.confirmationDigest}).slice(0,48),active=casePhase(row.casePolicySnapshot,'FINANCIAL',at),completion={operationId:eventId,returnId:row.returnId,source:'VERIFIED_OWNER_RECEIPT',ownerReceiptAt:row.confirmedAt,closedAt:at,condition:row.condition,financialPosting:false},next={...row,version:row.version+1,taskCompletion:completion,activePhase:active,phaseHistory:[...(row.phaseHistory??[]),{...row.activePhase,respondedAt:at,responseSource:'VERIFIED_OWNER_RECEIPT'}],updatedAt:at,exceptionResolution:{...row.exceptionResolution,custody:{state:'RETURNED_TO_MERCHANT',verified:true,condition:row.condition,confirmedAt:row.confirmedAt},updatedAt:at}};
 const {Key:unused,...fence}=exactCheck('staging-Holds',ck,row).ConditionCheck;
 const index=await exceptionCaseIndexOperation(db,{caseId:row.exceptionResolution.caseId,orderId,caseKey,caseType:'COD_DELIVERY_EXCEPTION',state:'MANUAL_REVIEW',open:true,branchId:offer.branchId,at,dueAt:active.responseDueAt});
 const ops:Row[]=[exactCheck('WhizzDrivers_staging',driverKey,driver,[...Object.keys(driver),'deletionRequestId','deletedAt','isDeleted']),exactCheck('WaveOffers_staging',offerKey,saved!),exactCheck('WhizzMerchants_Businesses',bk,branch,[...Object.keys(branch),'deletionRequestId','deletedAt','isDeleted']),set(exactCheck('WizzOrders',key,order,[...Object.keys(order),'financialOutcome','returnTaskCompletedAt','deletionRequestId','deletedAt','isDeleted']),task.orderFields),...task.operations,index,{Put:{...fence,Item:next}},{Put:{TableName:'staging-Holds',Item:{orderId,sk:'CASE_EVENT#'+row.exceptionResolution.caseId+'#'+eventId,caseId:row.exceptionResolution.caseId,kind:'ORDER_EXCEPTION_CASE_EVENT',actorKind:'SYSTEM',actorId:'RETURN_RECEIPT_RECONCILER_241',action:'RETURN_TASK_COMPLETED',createdAt:at,reason:'Authenticated owner confirmed all units; condition review remains independent',financialPosting:false,proof:completion},ConditionExpression:'attribute_not_exists(orderId)'}},{Put:{TableName:'staging-AuditLog',Item:{datePartition:'date#'+at.slice(0,10).replace(/-/g,''),sk:at+'#'+eventId,logId:eventId,orderId,caseId:row.exceptionResolution.caseId,actorKind:'SYSTEM',actorId:'RETURN_RECEIPT_RECONCILER_241',action:'RETURN_TASK_COMPLETED',createdAt:at,financialPosting:false},ConditionExpression:'attribute_not_exists(sk)'}}];
 for(const pk of new Set(['ACCOUNT_LIFECYCLE#DRIVER#'+order.driverId,'ACCOUNT_LIFECYCLE#DRIVER#'+subject,'BUSINESS_LIFECYCLE#MERCHANT#'+offer.branchId,'ACCOUNT_LIFECYCLE#MERCHANT#'+branch.ownerId]))ops.push({ConditionCheck:{TableName:'staging-AccountDeletion',Key:{pk,sk:'META'},ConditionExpression:'attribute_not_exists(pk)'}});
 try{await db.send(new TransactWriteCommand({TransactItems:ops as any}));}catch(e){const newer=await strongGet(db,'staging-Holds',ck);if(equal(newer?.taskCompletion,completion))return {closed:true,replayed:true};throw e;}return {closed:true,replayed:false};
 };
}
