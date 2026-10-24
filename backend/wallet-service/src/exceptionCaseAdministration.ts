import {createReturnContinuation,RETURN_CONTINUATION_ACTIONS} from './returnContinuation';
import {guardReturnCaseFinancialDb,guardReturnDispositionDb} from './returnContinuationRuntime264';
import {createReturnItemCustodyPlan} from './returnItemCustodyPlan';
import {createExceptionFinancialClosure} from './exceptionFinancialClosure';
import {createExceptionFinancials} from './exceptionFinancials';
import {createReturnGuaranteeReview} from './returnGuaranteeReview';
import {createExceptionCaseFindings} from './exceptionCaseFindings';
import {createReturnDisposition} from './returnDisposition';
import {setFinancialFields as set} from './financialRelease';
import {DynamoDBDocumentClient,TransactWriteCommand} from '@aws-sdk/lib-dynamodb';
import {strongGet,exactCheck,equal} from './driverFinancialTransaction';
import {quoteHash,quoteEntityIdValid} from './deliveryQuoteRecord';
import {readOrderExceptionPolicy} from './orderExceptionPolicy';
import {createCustomerCancellation} from './customerCancellation';
import {createStagingCodReassignment} from './codReassignment';
import {createExceptionStaffAuthority} from './exceptionStaffAuthority';
import {exceptionCaseIndexOperation} from './orderExceptionCaseIndex';
type Row=Record<string,any>;
const fail=(code='EXCEPTION_CASE_CONFLICT'):never=>{throw Object.assign(Error(code),{code});};
export function createExceptionCaseAdministration(options:{db:Pick<DynamoDBDocumentClient,'send'>;authority:ReturnType<typeof createExceptionStaffAuthority>;now?:()=>number;enableFullCash?:boolean;enableDeliveryFunding?:boolean}){
 const {db,authority}=options,now=options.now??Date.now;
 return async function execute(v:Row){
  if(RETURN_CONTINUATION_ACTIONS.includes(v?.action))return createReturnContinuation({...options,authenticate:authority.authenticate}).execute(v,'STAFF');
  const financialOptions={...options,db:guardReturnCaseFinancialDb(db)};
  if(v?.action==='AUTHORIZE_RETURN_ITEM_PLAN')return createReturnItemCustodyPlan({db,authority,now})(v);
  if(v?.action==='CLOSE_EXCEPTION_FINANCIALS')return createExceptionFinancialClosure(financialOptions)(v);
  if(['APPROVE_EXCEPTION_ENTITLEMENTS','EXECUTE_EXCEPTION_ENTITLEMENTS','APPROVE_EXCEPTION_GUARANTEE','EXECUTE_EXCEPTION_GUARANTEE'].includes(v?.action))return createExceptionFinancials(financialOptions)(v);
  if(v?.action==='RELEASE_RETURN_GUARANTEE')return createReturnGuaranteeReview(financialOptions)(v);
  if(['ADD_CASE_EVIDENCE','SET_RESPONSIBILITY'].includes(v?.action))return createExceptionCaseFindings({db,authority,now})(v);
  const fields=['orderId','caseKey','caseId','expectedVersion','action','reason','idempotencyKey',...(v?.action==='AUTHORIZE_RETURN'?['returnFeasibleConfirmed']:[])];
  if(!v||typeof v!=='object'||Object.keys(v).sort().join(',')!==fields.sort().join(',')||![v.orderId,v.caseId].every(quoteEntityIdValid)||!['CUSTOMER_CANCELLATION','MERCHANT_CANCELLATION'].includes(v.caseKey)&&!/^RETURN#[1-9][0-9]{0,2}$/.test(v.caseKey)||!Number.isSafeInteger(v.expectedVersion)||v.expectedVersion<1||!['AUTHORIZE_RETURN','CANCEL_BEFORE_PICKUP','DECLINE_CANCELLATION','REQUEST_EVIDENCE','ADD_NOTE','ISSUE_RETURN_INSTRUCTIONS'].includes(v.action)||typeof v.reason!=='string'||v.reason.trim().length<5||v.reason.length>2000||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v.idempotencyKey||''))return fail('INVALID_EXCEPTION_CASE_ACTION');
  const actor=await authority.authenticate();if(actor.kind!=='STAFF')return fail('UNAUTHORIZED');const access=await authority.operate(actor);
  const ok={PK:'ORDER#'+v.orderId,SK:'META'},ck={orderId:v.orderId,sk:v.caseKey},order=await strongGet(db,'WizzOrders',ok),row=await strongGet(db,'staging-Holds',ck);
  if(!order||!row||row.orderId!==v.orderId||order.orderId!==v.orderId||!readOrderExceptionPolicy(order))return fail('EXCEPTION_CASE_UNAVAILABLE');
  const caseId=row.caseId??row.exceptionResolution?.caseId;if(caseId!==v.caseId)return fail('EXCEPTION_CASE_UNAVAILABLE');
  const eventKey={orderId:v.orderId,sk:'CASE_EVENT#'+caseId+'#'+v.idempotencyKey},digest=quoteHash({...v,actorId:actor.subjectId}),prior=await strongGet(db,'staging-Holds',eventKey);
  if(prior){if(prior.requestDigest!==digest||prior.actorId!==actor.subjectId)return fail();return {...prior.receipt,replayed:true};}
  if(v.action==='AUTHORIZE_RETURN'){
   if(row.kind!=='COD_RETURN_CASE'||!row.exceptionResolution||v.returnFeasibleConfirmed!==true)return fail('EXCEPTION_CASE_ACTION_NOT_ALLOWED');
   return createReturnDisposition({db:guardReturnDispositionDb(db),authenticate:authority.authenticate,authorizeStaff:authority.authorizeStaff,now,enableFullCash:options.enableFullCash,enableDeliveryFunding:options.enableDeliveryFunding}).authorizeReturn({orderId:v.orderId,offerId:row.offerId,attempt:row.attempt,returnId:row.returnId,expectedVersion:v.expectedVersion,decisionId:v.idempotencyKey,reason:v.reason,returnFeasibleConfirmed:true});
  }
  if(v.action==='CANCEL_BEFORE_PICKUP'){
   if(row.kind!=='CUSTOMER_CANCELLATION'||row.state!=='REQUESTED'&&!(row.state==='CANCELLED'&&row.decision?.decisionId===v.idempotencyKey))return fail('EXCEPTION_CASE_ACTION_NOT_ALLOWED');
   const decision={requestId:row.requestId,expectedVersion:v.expectedVersion,decisionId:v.idempotencyKey,reason:v.reason.trim()};
   if(order.financialAcceptance){
    const service=createStagingCodReassignment({db,authenticate:authority.authenticate,now,enableFullCash:options.enableFullCash,enableDeliveryFunding:options.enableDeliveryFunding,reassignmentWindowSeconds:120,cancelActorKind:'STAFF',authorizeStaff:authority.authorizeStaff,cancellationDecision:decision});
    return service.cancelBeforePickup({orderId:v.orderId,branchId:order.storeId,offerId:order.financialAcceptance.offerId,attempt:order.assignmentAttemptCounter,goodsRetainedByBranch:true,cashCollected:false});
   }
   return createCustomerCancellation({db,authenticate:authority.authenticate,now,enableFullCash:options.enableFullCash,enableDeliveryFunding:options.enableDeliveryFunding,authorizeStaff:(a,o,b)=>{if(a.kind!=='STAFF')return fail('UNAUTHORIZED');return authority.authorizeStaff({kind:'STAFF',subjectId:a.subjectId},o,b);}}).adminCancelUnassigned({orderId:v.orderId,...decision,goodsRetainedByBranch:true,cashCollected:false});
  }
  if(row.version!==v.expectedVersion)return fail();
  if(['CUSTOMER_CANCELLATION','MERCHANT_CANCELLATION'].includes(row.kind)&&['CANCELLED','DECLINED','SUPERSEDED'].includes(row.state)&&row.settlementStatus!=='REVIEW'&&v.action!=='ADD_NOTE')return fail('EXCEPTION_CASE_ACTION_NOT_ALLOWED');
  const at=new Date(now()).toISOString(),next:Row={...row,version:row.version+1,updatedAt:at,...(row.activePhase?{activePhase:{...row.activePhase,respondedAt:row.activePhase.respondedAt??at,responseSource:'ADMIN_REVIEW'}}:{})};
  if(v.action==='DECLINE_CANCELLATION'){
   if(row.kind!=='CUSTOMER_CANCELLATION'||row.state!=='REQUESTED')return fail('EXCEPTION_CASE_ACTION_NOT_ALLOWED');
   next.state='DECLINED';next.decision={decisionId:v.idempotencyKey,actorId:actor.subjectId,reason:v.reason.trim(),at};
  }else if(v.action==='ISSUE_RETURN_INSTRUCTIONS'){
   if(row.kind!=='COD_RETURN_CASE'||row.status!=='ARRIVED_AT_BRANCH'||!row.handoverIssue)return fail('EXCEPTION_CASE_ACTION_NOT_ALLOWED');
   next.returnInstructions={text:v.reason.trim(),actorId:actor.subjectId,recordedAt:at,eventId:v.idempotencyKey};
  }else if(v.action==='REQUEST_EVIDENCE')next.evidenceRequest={actorId:actor.subjectId,reason:v.reason.trim(),requestedAt:at};
  else {if((row.adminNotes??[]).length>=100)return fail('EXCEPTION_CASE_EVIDENCE_LIMIT');next.adminNotes=[...(row.adminNotes??[]),{actorId:actor.subjectId,text:v.reason.trim(),recordedAt:at,eventId:v.idempotencyKey}];}
  const receipt={success:true,orderId:v.orderId,caseId,action:v.action,version:next.version,status:next.state??next.exceptionResolution?.status,replayed:false,financialPosting:false};
  const {Key:_key,...fence}=exactCheck('staging-Holds',ck,row).ConditionCheck;
  const index=await exceptionCaseIndexOperation(db,{caseId,orderId:v.orderId,caseKey:v.caseKey,caseType:row.kind,state:next.state??next.exceptionResolution?.status,open:['CUSTOMER_CANCELLATION','MERCHANT_CANCELLATION'].includes(row.kind)?(next.state==='REQUESTED'||next.settlementStatus==='REVIEW'):true,at,branchId:order.storeId,dueAt:next.activePhase?(next.activePhase.respondedAt?next.activePhase.escalationDueAt:next.activePhase.responseDueAt):at});
  const operations:Row[]=[access.guard,index,{Put:{...fence,Item:next}},{Put:{TableName:'staging-Holds',Item:{...eventKey,kind:'ORDER_EXCEPTION_CASE_EVENT',caseId,actorId:actor.subjectId,actorKind:'STAFF',action:v.action,reason:v.reason.trim(),requestDigest:digest,createdAt:at,receipt},ConditionExpression:'attribute_not_exists(orderId)'}},{Put:{TableName:'staging-AuditLog',Item:{datePartition:'date#'+at.slice(0,10).replace(/-/g,''),sk:at+'#'+v.idempotencyKey,logId:v.idempotencyKey,orderId:v.orderId,caseId,actorId:actor.subjectId,action:'EXCEPTION_CASE_'+v.action,reason:v.reason.trim(),beforeVersion:row.version,afterVersion:next.version,createdAt:at},ConditionExpression:'attribute_not_exists(sk)'}}];
  if(v.action==='ISSUE_RETURN_INSTRUCTIONS'){operations.push(set(exactCheck('WizzOrders',ok,order),{returnInstructions:next.returnInstructions,updatedAt:at}));}
  else if(v.action==='DECLINE_CANCELLATION'){
   operations.push(set(exactCheck('WizzOrders',ok,order),{exceptionCancellation:{requestId:row.requestId,caseId,state:'DECLINED',version:next.version},updatedAt:at}));
  }else operations.push(exactCheck('WizzOrders',ok,order));
  if(!equal(await authority.authenticate(),actor))return fail('UNAUTHORIZED');
  try{await db.send(new TransactWriteCommand({TransactItems:operations as any}));}catch(e){const saved=await strongGet(db,'staging-Holds',eventKey);if(saved?.requestDigest===digest)return {...saved.receipt,replayed:true};throw e;}
  return receipt;
 };
}
