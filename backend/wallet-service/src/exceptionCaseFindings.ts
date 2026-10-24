import {DynamoDBDocumentClient,TransactWriteCommand} from '@aws-sdk/lib-dynamodb';
import {strongGet,exactCheck,equal} from './driverFinancialTransaction';
import {quoteHash,quoteEntityIdValid} from './deliveryQuoteRecord';
import {readOrderExceptionPolicy} from './orderExceptionPolicy';
import {createExceptionStaffAuthority} from './exceptionStaffAuthority';
import {exceptionCaseIndexOperation} from './orderExceptionCaseIndex';
type Row=Record<string,any>;
const parties=['CUSTOMER','MERCHANT','DRIVER','PLATFORM','EXTERNAL','SYSTEM'];
const fail=(code='EXCEPTION_FINDING_CONFLICT'):never=>{throw Object.assign(Error(code),{code});};
export function createExceptionCaseFindings(options:{db:Pick<DynamoDBDocumentClient,'send'>;authority:ReturnType<typeof createExceptionStaffAuthority>;now?:()=>number}){
 const {db,authority}=options,now=options.now??Date.now;
 return async(v:Row)=>{
  const evidence=v?.action==='ADD_CASE_EVIDENCE',finding=v?.action==='SET_RESPONSIBILITY';
  const fields=['orderId','caseKey','caseId','expectedVersion','action','reason','idempotencyKey',...(evidence?['reportedByParty','reference']:finding?['allocations','evidenceIds','supersedesFindingId']:[])];
  if(!v||!evidence&&!finding||Object.keys(v).sort().join(',')!==fields.sort().join(',')||![v.orderId,v.caseId].every(quoteEntityIdValid)||!['CUSTOMER_CANCELLATION','MERCHANT_CANCELLATION'].includes(v.caseKey)&&!/^RETURN#[1-9][0-9]{0,2}$/.test(v.caseKey)||!Number.isSafeInteger(v.expectedVersion)||v.expectedVersion<1||typeof v.reason!=='string'||v.reason.trim().length<5||v.reason.length>2000||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v.idempotencyKey||''))return fail('INVALID_EXCEPTION_FINDING');
  if(evidence&&(!parties.includes(v.reportedByParty)||typeof v.reference!=='string'||v.reference.trim().length<3||v.reference.length>500))return fail('INVALID_EXCEPTION_FINDING');
  if(finding){if(!Array.isArray(v.allocations)||v.allocations.length>4||!Array.isArray(v.evidenceIds)||!v.evidenceIds.length||v.evidenceIds.length>20||new Set(v.evidenceIds).size!==v.evidenceIds.length||!v.evidenceIds.every(quoteEntityIdValid)||v.supersedesFindingId!==null&&!quoteEntityIdValid(v.supersedesFindingId))return fail('INVALID_EXCEPTION_FINDING');let sum=0;const seen=new Set();for(const a of v.allocations){if(!a||Object.keys(a).sort().join(',')!=='basisPoints,party'||!parties.slice(0,4).includes(a.party)||seen.has(a.party)||!Number.isSafeInteger(a.basisPoints)||a.basisPoints<1||a.basisPoints>10000)return fail('INVALID_EXCEPTION_FINDING');seen.add(a.party);sum+=a.basisPoints;}if(v.allocations.length&&sum!==10000)return fail('INVALID_EXCEPTION_FINDING');}
  const actor=await authority.authenticate(),access=await authority.operate(actor),ok={PK:'ORDER#'+v.orderId,SK:'META'},ck={orderId:v.orderId,sk:v.caseKey},order=await strongGet(db,'WizzOrders',ok),row=await strongGet(db,'staging-Holds',ck);
  if(!order||order.orderId!==v.orderId||!readOrderExceptionPolicy(order)||!row||(row.caseId??row.exceptionResolution?.caseId)!==v.caseId)return fail('EXCEPTION_CASE_UNAVAILABLE');
  const ek={orderId:v.orderId,sk:(evidence?'CASE_EVIDENCE#':'CASE_FINDING#')+v.idempotencyKey},digest=quoteHash({...v,actorId:actor.subjectId}),prior=await strongGet(db,'staging-Holds',ek);
  if(prior){if(prior.requestDigest!==digest)return fail();return {...prior.receipt,replayed:true};}
  if(row.version!==v.expectedVersion)return fail();
  const closed=['DECLINED','SUPERSEDED'].includes(row.state)||row.state==='CANCELLED'&&row.settlementStatus!=='REVIEW'||row.exceptionResolution?.status==='RESOLVED';if(finding&&closed)return fail('EXCEPTION_CASE_ACTION_NOT_ALLOWED');
  const guards:Row[]=[],sources=new Set<string>();
  if(finding){if((row.activeResponsibilityFindingId??null)!==v.supersedesFindingId)return fail();for(const id of v.evidenceIds){const key={orderId:v.orderId,sk:'CASE_EVIDENCE#'+id},r=await strongGet(db,'staging-Holds',key);if(!r||r.kind!=='ORDER_EXCEPTION_EVIDENCE'||r.caseId!==v.caseId||r.evidenceId!==id)return fail('EXCEPTION_EVIDENCE_REQUIRED');guards.push(exactCheck('staging-Holds',key,r));const source=r.actorKind==='MERCHANT_OWNER'?'MERCHANT':r.actorKind==='DRIVER'?'DRIVER':r.actorKind==='CUSTOMER'?'CUSTOMER':r.type==='SUPPORT_RECORD'?r.proof?.reportedByParty:r.actorKind==='SYSTEM'?'SYSTEM':null;if(source)sources.add(source);}if(v.allocations.length&&sources.size<2)return fail('INDEPENDENT_EVIDENCE_REQUIRED');}
  const at=new Date(now()).toISOString(),next:Row={...row,version:row.version+1,updatedAt:at,...(!closed&&row.activePhase?{activePhase:{...row.activePhase,respondedAt:row.activePhase.respondedAt??at,responseSource:'ADMIN_REVIEW'}}:{})};
  const receipt={success:true,orderId:v.orderId,caseId:v.caseId,version:next.version,action:v.action,recordId:v.idempotencyKey,financialPosting:false};
  const record:Row={...ek,caseId:v.caseId,actorId:actor.subjectId,actorKind:'STAFF',reason:v.reason.trim(),requestDigest:digest,createdAt:at,receipt,financialPosting:false};
  if(evidence){if((row.evidenceIds??[]).length>=100)return fail('EXCEPTION_CASE_EVIDENCE_LIMIT');Object.assign(record,{kind:'ORDER_EXCEPTION_EVIDENCE',evidenceId:v.idempotencyKey,type:'SUPPORT_RECORD',proof:{reportedByParty:v.reportedByParty,reference:v.reference.trim(),note:v.reason.trim(),classification:'REPORTED_AS_RECEIVED',doesNotEstablishResponsibility:true}});next.evidenceIds=[...(row.evidenceIds??[]),v.idempotencyKey];}
  else{if((row.responsibilityFindingIds??[]).length>=100)return fail('EXCEPTION_CASE_EVIDENCE_LIMIT');Object.assign(record,{kind:'ORDER_EXCEPTION_FINDING',findingId:v.idempotencyKey,allocations:v.allocations,evidenceIds:v.evidenceIds,supersedesFindingId:v.supersedesFindingId,decisionStatus:v.allocations.length?'CONFIRMED':'UNDETERMINED',noAutomaticCharge:true});next.responsibilityFindingIds=[...(row.responsibilityFindingIds??[]),v.idempotencyKey];next.activeResponsibilityFindingId=v.idempotencyKey;next.responsibility=v.allocations.length>1?'SHARED':v.allocations[0]?.party??'UNDETERMINED';if(row.exceptionResolution)next.exceptionResolution={...row.exceptionResolution,responsibility:next.responsibility,updatedAt:at};}
  const {Key:_key,...fence}=exactCheck('staging-Holds',ck,row).ConditionCheck;
  const index=await exceptionCaseIndexOperation(db,{caseId:v.caseId,orderId:v.orderId,caseKey:v.caseKey,caseType:row.kind,state:next.exceptionResolution?.status??next.state,open:!closed,at,branchId:order.storeId,dueAt:next.activePhase?.escalationDueAt??at});
  const ops=[access.guard,exactCheck('WizzOrders',ok,order),...guards,index,{Put:{...fence,Item:next}},{Put:{TableName:'staging-Holds',Item:record,ConditionExpression:'attribute_not_exists(orderId)'}},{Put:{TableName:'staging-AuditLog',Item:{datePartition:'date#'+at.slice(0,10).replace(/-/g,''),sk:at+'#'+v.idempotencyKey,logId:v.idempotencyKey,caseId:v.caseId,orderId:v.orderId,actorId:actor.subjectId,actorKind:'STAFF',action:v.action,createdAt:at,reason:v.reason.trim(),financialPosting:false},ConditionExpression:'attribute_not_exists(sk)'}}];
  if(!equal(actor,await authority.authenticate()))return fail('UNAUTHORIZED');
  try{await db.send(new TransactWriteCommand({TransactItems:ops as any}));}catch(e){const saved=await strongGet(db,'staging-Holds',ek);if(saved?.requestDigest===digest)return {...saved.receipt,replayed:true};throw e;}
  return receipt;
 };
}
