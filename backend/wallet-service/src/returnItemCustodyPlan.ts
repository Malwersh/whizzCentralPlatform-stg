import {DynamoDBDocumentClient,TransactWriteCommand} from '@aws-sdk/lib-dynamodb';
import {strongGet,exactCheck,equal} from './driverFinancialTransaction';
import {quoteHash,quoteEntityIdValid} from './deliveryQuoteRecord';
import {readOrderExceptionPolicy} from './orderExceptionPolicy';
import {createExceptionStaffAuthority} from './exceptionStaffAuthority';
type Row=Record<string,any>;
const fail=(code='RETURN_ITEM_PLAN_CONFLICT'):never=>{throw Object.assign(Error(code),{code});};
const actions=['RETURN_TO_MERCHANT','TRANSFER_TO_CUSTODIAN','DISPOSE_AUTHORIZED','INVESTIGATE_MISSING'];
/** A reviewed instruction, never a physical receipt, loss finding, or financial posting. */
export function createReturnItemCustodyPlan(options:{db:Pick<DynamoDBDocumentClient,'send'>;authority:ReturnType<typeof createExceptionStaffAuthority>;now?:()=>number}){
 const {db,authority}=options,now=options.now??Date.now;
 return async(v:Row)=>{
  const fields=['orderId','caseKey','caseId','expectedVersion','action','reason','idempotencyKey','lines','evidenceIds','supersedesPlanId'];
  if(!v||Object.keys(v).sort().join(',')!==fields.sort().join(',')||v.action!=='AUTHORIZE_RETURN_ITEM_PLAN'||![v.orderId,v.caseId].every(quoteEntityIdValid)||!/^RETURN#[1-9][0-9]{0,2}$/.test(v.caseKey)||!Number.isSafeInteger(v.expectedVersion)||v.expectedVersion<1||typeof v.reason!=='string'||v.reason.trim().length<5||v.reason.length>2000||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v.idempotencyKey||'')||!Array.isArray(v.lines)||!v.lines.length||v.lines.length>100||!Array.isArray(v.evidenceIds)||!v.evidenceIds.length||v.evidenceIds.length>20||new Set(v.evidenceIds).size!==v.evidenceIds.length||!v.evidenceIds.every(quoteEntityIdValid)||v.supersedesPlanId!==null&&!quoteEntityIdValid(v.supersedesPlanId))return fail('INVALID_RETURN_ITEM_PLAN');
  const seen=new Set();for(const line of v.lines){if(!line||Object.keys(line).sort().join(',')!=='destinationReference,lineId,quantity,treatment'||!quoteEntityIdValid(line.lineId)||seen.has(line.lineId)||!Number.isSafeInteger(line.quantity)||line.quantity<1||!actions.includes(line.treatment)||typeof line.destinationReference!=='string'||line.destinationReference.trim().length<3||line.destinationReference.length>300)return fail('INVALID_RETURN_ITEM_PLAN');seen.add(line.lineId);}
  const actor=await authority.authenticate();if(actor.kind!=='STAFF')return fail('UNAUTHORIZED');const access=await authority.operate(actor);
  const ok={PK:'ORDER#'+v.orderId,SK:'META'},ck={orderId:v.orderId,sk:v.caseKey},ek={orderId:v.orderId,sk:'CASE_ITEM_PLAN#'+v.idempotencyKey},digest=quoteHash({...v,actorId:actor.subjectId});
  const order=await strongGet(db,'WizzOrders',ok),row=await strongGet(db,'staging-Holds',ck);
  if(!order||order.orderId!==v.orderId||!readOrderExceptionPolicy(order)||!row||row.kind!=='COD_RETURN_CASE'||row.orderId!==v.orderId||row.exceptionResolution?.caseId!==v.caseId)return fail('EXCEPTION_CASE_UNAVAILABLE');
  const prior=await strongGet(db,'staging-Holds',ek);if(prior){if(prior.requestDigest!==digest)return fail();return {...prior.receipt,replayed:true};}
  if(row.itemExecution?.recordIds?.length)return fail('RETURN_ITEM_PLAN_LOCKED');
  if(row.version!==v.expectedVersion||(row.itemCustodyPlan?.planId??null)!==v.supersedesPlanId)return fail();
  if(row.exceptionResolution.status==='RESOLVED'||row.taskCompletion||!['return_arrived','returning'].includes(order.status)||!['REVIEW_REQUIRED','ARRIVED_AT_BRANCH','REQUESTED'].includes(row.status)||!row.itemManifest||order.financialOutcome!=null||order.cashCollected===true||Number(order.cashCollectedAmount??0)!==0)return fail('EXCEPTION_CASE_ACTION_NOT_ALLOWED');
  if(order.financialAcceptance?.offerId!==row.offerId||order.assignmentAttemptCounter!==row.attempt||order.storeId!==row.branchId||row.cashCollected!==false)return fail();
  const at=new Date(now()).toISOString(),manifest=row.itemManifest;if(!Array.isArray(manifest.lines)||!manifest.lines.length)return fail();
  if(!row.itemReceipt&&row.status==='REVIEW_REQUIRED'||row.itemReceipt&&!row.confirmationDigest)return fail();
  if(!row.itemReceipt&&row.status==='REQUESTED'&&v.lines.some((line:Row)=>line.treatment==='RETURN_TO_MERCHANT'))return fail('RETURN_BRANCH_READINESS_REQUIRED');
  const baseline=row.itemCustodyOrigin??(!row.itemReceipt?(()=>{const lines=manifest.lines.map((line:Row)=>({...line,receivedQty:0,unresolvedQty:line.expectedQty,condition:'UNVERIFIED'})),total=lines.reduce((n:number,line:Row)=>n+line.expectedQty,0),body={schemaVersion:1,manifestDigest:manifest.digest,source:'SERVER_MANIFEST_CUSTODY_BASELINE',notAMerchantReceipt:true,receivedMeaning:'DOCUMENTED_RECEIPTS_ONLY_NOT_PHYSICAL_LOCATION',lines,expectedTotal:total,receivedTotal:0,unresolvedTotal:total,createdByStaff:actor.subjectId,createdAt:at};return {...body,digest:quoteHash(body)};})():null);
  const receipt=row.itemReceipt??baseline,{digest:md,...mb}=manifest,{digest:rd,...rb}=receipt??{};
  if(md!==quoteHash(mb)||rd!==quoteHash(rb)||receipt?.manifestDigest!==md||receipt.unresolvedTotal<1||manifest.orderId!==v.orderId||manifest.attempt!==row.attempt||manifest.offerDigest!==row.offerDigest)return fail();
  const remaining:Row[]=receipt.lines.filter((line:Row)=>line.unresolvedQty>0);
  if(remaining.length!==v.lines.length||remaining.some(line=>!v.lines.some((input:Row)=>input.lineId===line.lineId&&input.quantity===line.unresolvedQty)))return fail('INVALID_RETURN_ITEM_PLAN');
  if((row.itemCustodyPlanIds??[]).length>=50)return fail('EXCEPTION_CASE_EVIDENCE_LIMIT');
  const guards:Row[]=[];for(const id of v.evidenceIds){const key={orderId:v.orderId,sk:'CASE_EVIDENCE#'+id},evidence=await strongGet(db,'staging-Holds',key);if(!evidence||evidence.kind!=='ORDER_EXCEPTION_EVIDENCE'||evidence.caseId!==v.caseId||evidence.evidenceId!==id||!(row.evidenceIds??[]).includes(id))return fail('EXCEPTION_EVIDENCE_REQUIRED');guards.push(exactCheck('staging-Holds',key,evidence));}
  const plan={schemaVersion:1,planId:v.idempotencyKey,caseId:v.caseId,manifestDigest:md,receiptDigest:rd,status:'AUTHORIZED_PENDING_EXECUTION',lines:v.lines.map((line:Row)=>({...line,name:remaining.find(x=>x.lineId===line.lineId)!.name,destinationReference:line.destinationReference.trim()})),evidenceIds:v.evidenceIds,supersedesPlanId:v.supersedesPlanId,reason:v.reason.trim(),authorizedBy:actor.subjectId,authorizedAt:at,physicalCustodyChanged:false,financialPosting:false,resaleAuthorized:false};
  const result={success:true,orderId:v.orderId,caseId:v.caseId,version:row.version+1,action:v.action,planId:plan.planId,status:plan.status,financialPosting:false,physicalCustodyChanged:false};
  const next={...row,version:row.version+1,updatedAt:at,...(baseline&&!row.itemReceipt?{itemCustodyOrigin:baseline}:{}),itemCustodyPlan:{...plan,digest:quoteHash(plan)},itemCustodyPlanIds:[...(row.itemCustodyPlanIds??[]),plan.planId]};
  if(Buffer.byteLength(JSON.stringify(next),'utf8')>300000)return fail('RETURN_CONTINUATION_LIMIT');
  const {Key:_key,...fence}=exactCheck('staging-Holds',ck,row).ConditionCheck;
  const record={...ek,kind:'ORDER_EXCEPTION_CASE_EVENT',caseId:v.caseId,actorId:actor.subjectId,actorKind:'STAFF',action:v.action,reason:plan.reason,createdAt:at,requestDigest:digest,plan:next.itemCustodyPlan,receipt:result,financialPosting:false};
  const operations=[access.guard,exactCheck('WizzOrders',ok,order),...guards,{Put:{...fence,Item:next}},{Put:{TableName:'staging-Holds',Item:record,ConditionExpression:'attribute_not_exists(orderId)'}},{Put:{TableName:'staging-AuditLog',Item:{datePartition:'date#'+at.slice(0,10).replace(/-/g,''),sk:at+'#'+plan.planId,logId:plan.planId,caseId:v.caseId,orderId:v.orderId,actorId:actor.subjectId,action:v.action,reason:plan.reason,createdAt:at,financialPosting:false,physicalCustodyChanged:false},ConditionExpression:'attribute_not_exists(sk)'}}];
  if(!equal(actor,await authority.authenticate()))return fail('UNAUTHORIZED');
  try{await db.send(new TransactWriteCommand({TransactItems:operations as any}));}catch(error){const saved=await strongGet(db,'staging-Holds',ek);if(saved?.requestDigest===digest)return {...saved.receipt,replayed:true};throw error;}
  return result;
 };
}
