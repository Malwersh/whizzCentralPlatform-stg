import {DynamoDBDocumentClient,TransactWriteCommand} from '@aws-sdk/lib-dynamodb';
import {strongGet,exactCheck,equal} from './driverFinancialTransaction';
import {quoteHash,quoteEntityIdValid} from './deliveryQuoteRecord';
import {readOrderExceptionPolicy} from './orderExceptionPolicy';
import {createExceptionStaffAuthority} from './exceptionStaffAuthority';
type Row=Record<string,any>;
const evidenceIdValid=(v:unknown)=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:#-]{0,199}$/.test(v);
const fail=(code='DRIVER_PERFORMANCE_DECISION_CONFLICT'):never=>{throw Object.assign(Error(code),{code});};
/** Explicit operational decision, independent of compensation and financial closure. */
export function createDriverPerformanceDecision(options:{db:Pick<DynamoDBDocumentClient,'send'>;authority:ReturnType<typeof createExceptionStaffAuthority>;now?:()=>number}){
 const {db,authority}=options,now=options.now??Date.now;
 return async(v:Row)=>{
  const fields=['orderId','caseKey','caseId','expectedVersion','action','reason','idempotencyKey','decision','evidenceIds','supersedesDecisionId','offerId','attempt'];
  if(!v||Object.keys(v).sort().join(',')!==fields.sort().join(',')||v.action!=='SET_DRIVER_PERFORMANCE'||![v.orderId,v.caseId,v.offerId].every(quoteEntityIdValid)||!['CUSTOMER_CANCELLATION','MERCHANT_CANCELLATION'].includes(v.caseKey)&&!/^RETURN#[1-9][0-9]{0,2}$/.test(v.caseKey)||!Number.isSafeInteger(v.expectedVersion)||v.expectedVersion<1||!Number.isSafeInteger(v.attempt)||v.attempt<1||v.attempt>=1000||!['COUNT_FAILURE','EXCUSED','PENDING_REVIEW'].includes(v.decision)||typeof v.reason!=='string'||v.reason.trim().length<5||v.reason.length>2000||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v.idempotencyKey||'')||v.supersedesDecisionId!==null&&!quoteEntityIdValid(v.supersedesDecisionId)||!Array.isArray(v.evidenceIds)||v.evidenceIds.length>20||new Set(v.evidenceIds).size!==v.evidenceIds.length||!v.evidenceIds.every(evidenceIdValid)||v.decision!=='PENDING_REVIEW'&&!v.evidenceIds.length)return fail('INVALID_DRIVER_PERFORMANCE_DECISION');
  const actor=await authority.authenticate();if(actor.kind!=='STAFF')return fail('UNAUTHORIZED');const access=await authority.operate(actor);
  const ok={PK:'ORDER#'+v.orderId,SK:'META'},ck={orderId:v.orderId,sk:v.caseKey},ek={orderId:v.orderId,sk:'PERFORMANCE_DECISION#'+v.idempotencyKey};
  const order=await strongGet(db,'WizzOrders',ok),row=await strongGet(db,'staging-Holds',ck);
  if(!order||order.orderId!==v.orderId||!readOrderExceptionPolicy(order)||order.isDeleted===true||order.deletedAt!=null||order.deletionRequestId!=null||!row||(row.caseId??row.exceptionResolution?.caseId)!==v.caseId||['DECLINED','SUPERSEDED'].includes(row.state))return fail('EXCEPTION_CASE_UNAVAILABLE');
  if(v.decision==='COUNT_FAILURE'&&(row.appealReviewRequired||(row.caseAppeals??[]).some((a:Row)=>a.status==='OPEN')))return fail('DRIVER_PERFORMANCE_APPEAL_OPEN');
  const digest=quoteHash({...v,actorId:actor.subjectId}),prior=await strongGet(db,'staging-Holds',ek);if(prior){if(prior.requestDigest!==digest)return fail();return {...prior.receipt,replayed:true};}
  if(row.version!==v.expectedVersion)return fail();
  const ak={orderId:v.orderId,sk:'ASSIGNMENT_RELEASE#'+v.attempt},archive=await strongGet(db,'staging-Holds',ak),guards:Row[]=[];
  let driverId:string;
  if(archive){if(archive.kind!=='COD_ASSIGNMENT_RELEASE'||archive.orderId!==v.orderId||archive.offerId!==v.offerId||archive.attempt!==v.attempt||!['UNASSIGNED','CANCELLED'].includes(archive.outcome)||archive.receipt?.success!==true||archive.receipt.orderId!==v.orderId)return fail('DRIVER_PERFORMANCE_ATTEMPT_UNAVAILABLE');driverId=archive.driverId;guards.push(exactCheck('staging-Holds',ak,archive));}
  else{if(order.financialAcceptance?.offerId!==v.offerId||order.assignmentAttemptCounter!==v.attempt||!['cancelled','canceled','returned'].includes(order.status)||order.status==='returned'&&v.decision==='COUNT_FAILURE')return fail('DRIVER_PERFORMANCE_ATTEMPT_UNAVAILABLE');driverId=order.driverId;guards.push({ConditionCheck:{TableName:'staging-Holds',Key:ak,ConditionExpression:'attribute_not_exists(orderId)'}});}
  if(!quoteEntityIdValid(driverId))return fail('DRIVER_PERFORMANCE_ATTEMPT_UNAVAILABLE');
  const pk={orderId:v.orderId,sk:'DRIVER_PERFORMANCE#'+driverId+'#'+v.attempt},current=await strongGet(db,'staging-Holds',pk);
  if((current?.decisionId??null)!==v.supersedesDecisionId||current&&(current.driverId!==driverId||current.offerId!==v.offerId||current.caseId!==v.caseId||!Number.isSafeInteger(current.version)||current.version<1))return fail();
  const sources=new Set<string>();
  for(const evidenceId of v.evidenceIds){const key={orderId:v.orderId,sk:'CASE_EVIDENCE#'+evidenceId},evidence=await strongGet(db,'staging-Holds',key);if(!evidence||evidence.kind!=='ORDER_EXCEPTION_EVIDENCE'||evidence.caseId!==v.caseId||evidence.evidenceId!==evidenceId)return fail('EXCEPTION_EVIDENCE_REQUIRED');guards.push(exactCheck('staging-Holds',key,evidence));const source=evidence.type==='SUPPORT_RECORD'?evidence.proof?.reportedByParty:{DRIVER:'DRIVER',MERCHANT_OWNER:'MERCHANT',CUSTOMER:'CUSTOMER',SYSTEM:'SYSTEM'}[evidence.actorKind as string];if(['DRIVER','MERCHANT','CUSTOMER','PLATFORM','SYSTEM','EXTERNAL'].includes(source))sources.add(source);}
  if(v.decision==='COUNT_FAILURE'&&sources.size<2)return fail('INDEPENDENT_EVIDENCE_REQUIRED');
  if((row.performanceDecisionIds??[]).length>=100)return fail('EXCEPTION_CASE_EVIDENCE_LIMIT');
  const at=new Date(now()).toISOString(),receipt={success:true,action:v.action,orderId:v.orderId,caseId:v.caseId,version:row.version+1,decisionId:v.idempotencyKey,decision:v.decision,financialPosting:false};
  const decision={...pk,kind:'DRIVER_PERFORMANCE_DECISION',action:'SET_DRIVER_PERFORMANCE',schemaVersion:1,caseId:v.caseId,caseKey:v.caseKey,driverId,offerId:v.offerId,attempt:v.attempt,decisionId:v.idempotencyKey,decision:v.decision,evidenceIds:v.evidenceIds,reason:v.reason.trim(),actorId:actor.subjectId,actorKind:'STAFF',createdAt:at,version:(current?.version??0)+1,supersedesDecisionId:v.supersedesDecisionId,requestDigest:digest,financialPosting:false,receipt};
  const summaries=(row.driverPerformanceDecisions??[]).filter((x:Row)=>!(x.driverId===driverId&&x.attempt===v.attempt));
  const next={...row,version:row.version+1,updatedAt:at,performanceDecisionIds:[...(row.performanceDecisionIds??[]),v.idempotencyKey],driverPerformanceDecisions:[...summaries,{driverId,offerId:v.offerId,attempt:v.attempt,decision:v.decision,decisionId:v.idempotencyKey,reason:v.reason.trim(),createdAt:at}]};
  const {Key:_k,...caseFence}=exactCheck('staging-Holds',ck,row).ConditionCheck,{Key:_p,...pointerFence}=(current?exactCheck('staging-Holds',pk,current).ConditionCheck:{TableName:'staging-Holds',Key:pk,ConditionExpression:'attribute_not_exists(orderId)'});
  const ops=[access.guard,exactCheck('WizzOrders',ok,order),...guards,{ConditionCheck:{TableName:'staging-AccountDeletion',Key:{pk:'ACCOUNT_LIFECYCLE#DRIVER#'+driverId,sk:'META'},ConditionExpression:'attribute_not_exists(pk)'}},{Put:{...caseFence,Item:next}},{Put:{...pointerFence,Item:decision}},{Put:{TableName:'staging-Holds',Item:{...decision,...ek,kind:'DRIVER_PERFORMANCE_DECISION_EVENT'},ConditionExpression:'attribute_not_exists(orderId)'}},{Put:{TableName:'staging-AuditLog',Item:{datePartition:'date#'+at.slice(0,10).replace(/-/g,''),sk:at+'#'+v.idempotencyKey,logId:v.idempotencyKey,action:v.action,orderId:v.orderId,caseId:v.caseId,driverId,actorId:actor.subjectId,decisionId:v.idempotencyKey,decision:v.decision,reason:v.reason.trim(),createdAt:at,financialPosting:false},ConditionExpression:'attribute_not_exists(sk)'}}];
  if(!equal(actor,await authority.authenticate()))return fail('UNAUTHORIZED');
  try{await db.send(new TransactWriteCommand({TransactItems:ops as any}));}catch(e){const saved=await strongGet(db,'staging-Holds',ek);if(saved?.requestDigest===digest)return {...saved.receipt,replayed:true};throw e;}
  return receipt;
 };
}
