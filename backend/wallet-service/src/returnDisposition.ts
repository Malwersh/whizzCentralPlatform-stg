import {DynamoDBDocumentClient,TransactWriteCommand} from '@aws-sdk/lib-dynamodb';
import {createCodFlowContext,ReturnActor} from './codFlowContext';
import {strongGet,exactCheck,equal} from './driverFinancialTransaction';
import {setFinancialFields as set} from './financialRelease';
import {quoteHash,quoteEntityIdValid} from './deliveryQuoteRecord';
import {readOrderExceptionPolicy,returnResolution} from './orderExceptionPolicy';
import {exceptionCaseIndexOperation} from './orderExceptionCaseIndex';
type Row=Record<string,any>;
const fail=(code='RETURN_DISPOSITION_CONFLICT'):never=>{throw Object.assign(Error(code),{code});};
/** Permission to return is an independent, recorded decision. No financial write or liability inference. */
export function createReturnDisposition(options:{db:Pick<DynamoDBDocumentClient,'send'>;authenticate:()=>Promise<ReturnActor>;now?:()=>number;enableFullCash?:boolean;enableDeliveryFunding?:boolean;authorizeStaff?:(actor:ReturnActor,order:Row,branch:Row)=>Promise<Row[]>}){
 const {db,authenticate}=options,now=options.now??Date.now,context=createCodFlowContext({...options,now});
 async function load(v:Row,kind:ReturnActor['kind']){
  if(!v||!quoteEntityIdValid(v.orderId)||!quoteEntityIdValid(v.offerId)||!Number.isSafeInteger(v.attempt)||v.attempt<1||!Number.isSafeInteger(v.expectedVersion)||v.expectedVersion<1)return fail('INVALID_RETURN_DISPOSITION');
  const c=await context(v,kind);if(!readOrderExceptionPolicy(c.order)||!c.record?.exceptionResolution||v.returnId!==c.returnId)return fail('RETURN_DISPOSITION_UNAVAILABLE');
  return c;
 }
 async function commit(c:Awaited<ReturnType<typeof context>>,ops:Row[]){if(!equal(c.actor,await authenticate()))return fail('UNAUTHORIZED');await db.send(new TransactWriteCommand({TransactItems:[...c.guards,...ops]as any}));}
 function pending(c:Awaited<ReturnType<typeof context>>,v:Row){if(c.record!.version!==v.expectedVersion||c.record!.status!=='REQUESTED'||c.order.returnStatus!=='REQUESTED'||c.order.returnCaseId!==c.returnId||c.order.status!=='returning'||c.order.financialOutcome!=null||c.order.cashCollected===true||Number(c.order.cashCollectedAmount??0)!==0)return fail();}
 return {
  async recordReadiness(v:Row){
   if(!v||Object.keys(v).sort().join(',')!=='attempt,branchCanReceive,branchId,expectedVersion,note,offerId,orderId,returnId'||v.branchCanReceive!==true||typeof v.note!=='string'||v.note.trim().length<5||v.note.length>1000)return fail('INVALID_RETURN_DISPOSITION');
   const c=await load(v,'MERCHANT_OWNER'),r=c.record!,proof={ownerId:c.actor.subjectId,branchId:c.offer.branchId,branchCanReceive:true,note:v.note.trim()};
   if(r.branchReadiness&&equal(proof,Object.fromEntries(Object.entries(r.branchReadiness).filter(([k])=>!['recordedAt','evidenceId'].includes(k)))))return {success:true,orderId:v.orderId,status:r.status,version:r.version,replayed:true};
   pending(c,v);const caseId=r.exceptionResolution.caseId,evidenceId='EV:'+quoteHash([caseId,c.actor.subjectId,v.expectedVersion,proof]).slice(0,48),next:Row={...r,version:r.version+1,updatedAt:c.timestamp,branchReadiness:{...proof,recordedAt:c.timestamp,evidenceId},evidenceIds:[...(r.evidenceIds??[]),evidenceId]};
   if(next.evidenceIds.length>100)return fail('EXCEPTION_CASE_EVIDENCE_LIMIT');const {Key:_key,...fence}=exactCheck('staging-Holds',c.returnKey,r).ConditionCheck;
   await commit(c,[exactCheck('WizzOrders',c.key,c.order),{Put:{...fence,Item:next}},{Put:{TableName:'staging-Holds',Item:{orderId:v.orderId,sk:'CASE_EVIDENCE#'+evidenceId,kind:'ORDER_EXCEPTION_EVIDENCE',caseId,evidenceId,type:'BRANCH_RETURN_READINESS',actorKind:c.actor.kind,actorId:c.actor.subjectId,proof:next.branchReadiness,createdAt:c.timestamp},ConditionExpression:'attribute_not_exists(orderId)'}},{Put:{TableName:'staging-AuditLog',Item:{datePartition:'date#'+c.timestamp.slice(0,10).replace(/-/g,''),sk:c.timestamp+'#'+evidenceId,logId:evidenceId,action:'RETURN_BRANCH_READINESS_RECORDED',caseId,orderId:v.orderId,actorId:c.actor.subjectId,actorKind:c.actor.kind,createdAt:c.timestamp,financialPosting:false},ConditionExpression:'attribute_not_exists(sk)'}}]);
   return {success:true,orderId:v.orderId,status:next.status,version:next.version,financialPosting:false};
  },
  async authorizeReturn(v:Row){
   if(!v||Object.keys(v).sort().join(',')!=='attempt,decisionId,expectedVersion,offerId,orderId,reason,returnFeasibleConfirmed,returnId'||v.returnFeasibleConfirmed!==true||!quoteEntityIdValid(v.decisionId)||typeof v.reason!=='string'||v.reason.trim().length<5||v.reason.length>1000)return fail('INVALID_RETURN_DISPOSITION');
   const c=await load(v,'STAFF'),r=c.record!,digest=quoteHash({...v,actorId:c.actor.subjectId}),dk={orderId:v.orderId,sk:'CASE_DECISION#'+r.exceptionResolution.caseId+'#'+v.decisionId},prior=await strongGet(db,'staging-Holds',dk);
   if(prior){if(prior.requestDigest!==digest)return fail();return {...prior.receipt,replayed:true};}
   pending(c,v);if(!r.branchReadiness||r.branchReadiness.ownerId!==c.branch.ownerId||r.branchReadiness.branchId!==c.offer.branchId||r.branchReadiness.branchCanReceive!==true)return fail('RETURN_BRANCH_READINESS_REQUIRED');
   const disposition={type:'RETURN_TO_MERCHANT',status:'AUTHORIZED',decisionId:v.decisionId,authorizedBy:c.actor.subjectId,authorizedAt:c.timestamp,reason:v.reason.trim(),returnFeasibleConfirmed:true,branchEvidenceId:r.branchReadiness.evidenceId,assignmentAttempt:v.attempt,returnId:c.returnId};
   const next={...r,status:'RETURNING',version:r.version+1,updatedAt:c.timestamp,disposition,activePhase:{...r.activePhase,respondedAt:r.activePhase?.respondedAt??c.timestamp,responseSource:'AUTHORIZED_DISPOSITION'},exceptionResolution:returnResolution(c.order,c.offer,r,'RETURNING',c.timestamp)},receipt={success:true,orderId:v.orderId,caseId:r.exceptionResolution.caseId,status:'RETURNING',version:next.version,financialPosting:false};
   const {Key:_key,...fence}=exactCheck('staging-Holds',c.returnKey,r).ConditionCheck,index=await exceptionCaseIndexOperation(db,{caseId:r.exceptionResolution.caseId,orderId:v.orderId,caseKey:c.returnKey.sk,caseType:'COD_DELIVERY_EXCEPTION',state:next.exceptionResolution!.status,open:true,branchId:c.offer.branchId,at:c.timestamp,dueAt:next.activePhase.escalationDueAt});
   await commit(c,[index,set(exactCheck('WizzOrders',c.key,c.order),{returnStatus:'RETURNING',updatedAt:c.timestamp}),{Put:{...fence,Item:next}},{Put:{TableName:'staging-Holds',Item:{...dk,kind:'ORDER_EXCEPTION_DECISION',caseId:r.exceptionResolution.caseId,actorKind:'STAFF',actorId:c.actor.subjectId,action:'AUTHORIZE_RETURN',reason:v.reason.trim(),requestDigest:digest,disposition,receipt,createdAt:c.timestamp},ConditionExpression:'attribute_not_exists(orderId)'}},{Put:{TableName:'staging-AuditLog',Item:{datePartition:'date#'+c.timestamp.slice(0,10).replace(/-/g,''),sk:c.timestamp+'#'+v.decisionId,logId:v.decisionId,caseId:r.exceptionResolution.caseId,orderId:v.orderId,actorId:c.actor.subjectId,actorKind:'STAFF',action:'RETURN_AUTHORIZED',createdAt:c.timestamp,financialPosting:false},ConditionExpression:'attribute_not_exists(sk)'}}]);
   return receipt;
  }
 };
}
