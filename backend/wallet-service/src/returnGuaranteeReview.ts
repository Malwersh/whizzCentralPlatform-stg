import {DynamoDBDocumentClient,TransactWriteCommand} from '@aws-sdk/lib-dynamodb';
import {strongGet,exactCheck,equal} from './driverFinancialTransaction';
import {createCodFlowContext} from './codFlowContext';
import {createExceptionStaffAuthority} from './exceptionStaffAuthority';
import {prepareCodRelease,setFinancialFields as set} from './financialRelease';
import {quoteEntityIdValid,quoteHash} from './deliveryQuoteRecord';
import {readOrderExceptionPolicy} from './orderExceptionPolicy';
import {toWholeIqdExact} from './money';
import {exceptionCaseIndexOperation} from './orderExceptionCaseIndex';
type Row=Record<string,any>;
const fail=(code='RETURN_GUARANTEE_REVIEW_CONFLICT'):never=>{throw Object.assign(Error(code),{code});};
/** Explicit authorized release only. No driver charge, fare, merchant compensation or cash refund. */
export function createReturnGuaranteeReview(options:{db:Pick<DynamoDBDocumentClient,'send'>;authority:ReturnType<typeof createExceptionStaffAuthority>;now?:()=>number;enableFullCash?:boolean;enableDeliveryFunding?:boolean}){
 const {db,authority}=options,now=options.now??Date.now;
 return async(v:Row)=>{
 const fields=['orderId','caseKey','caseId','expectedVersion','action','reason','idempotencyKey','findingId','confirmRelease'];
 if(!v||Object.keys(v).sort().join(',')!==fields.sort().join(',')||v.action!=='RELEASE_RETURN_GUARANTEE'||!/^RETURN#[1-9][0-9]{0,2}$/.test(v.caseKey||'')||![v.orderId,v.caseId,v.findingId].every(quoteEntityIdValid)||!Number.isSafeInteger(v.expectedVersion)||v.expectedVersion<1||v.confirmRelease!==true||typeof v.reason!=='string'||v.reason.trim().length<5||v.reason.length>2000||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v.idempotencyKey||''))return fail('INVALID_RETURN_GUARANTEE_REVIEW');
 const actor=await authority.authenticate();if(actor.kind!=='STAFF')return fail('UNAUTHORIZED');
 const ck={orderId:v.orderId,sk:v.caseKey},row=await strongGet(db,'staging-Holds',ck);if(!row||row.kind!=='COD_RETURN_CASE'||row.exceptionResolution?.caseId!==v.caseId)return fail();
 const ek={orderId:v.orderId,sk:'CASE_EVENT#'+v.caseId+'#'+v.idempotencyKey},digest=quoteHash({...v,actorId:actor.subjectId}),prior=await strongGet(db,'staging-Holds',ek);
 await authority.financial(actor,0);
 if(prior){if(prior.requestDigest!==digest||prior.actorId!==actor.subjectId)return fail();return {...prior.receipt,replayed:true};}
 const context=createCodFlowContext({db,authenticate:authority.authenticate,now,enableFullCash:options.enableFullCash,enableDeliveryFunding:options.enableDeliveryFunding,authorizeStaff:authority.authorizeStaff}),c=await context({orderId:v.orderId,offerId:row.offerId,attempt:row.attempt},'STAFF');
 if(!equal(c.record,row)||!readOrderExceptionPolicy(c.order)||row.version!==v.expectedVersion||row.status!=='REVIEW_REQUIRED'||row.taskCompletion?.returnId!==row.returnId||row.allItemsReceived!==true||row.exceptionResolution?.custody?.verified!==true||c.order.status!=='returned'||!c.order.returnTaskCompletedAt||c.order.financialOutcome!=null||c.order.cashCollected===true||c.order.cashCollectedAmount!=null&&c.order.cashCollectedAmount!==0||row.guaranteeReview||row.guaranteeResolution)return fail();
 const fk={orderId:v.orderId,sk:'CASE_FINDING#'+v.findingId},finding=await strongGet(db,'staging-Holds',fk);
 if(row.activeResponsibilityFindingId!==v.findingId||!finding||finding.kind!=='ORDER_EXCEPTION_FINDING'||finding.findingId!==v.findingId||finding.caseId!==v.caseId||!['CONFIRMED','UNDETERMINED'].includes(finding.decisionStatus)||!Array.isArray(finding.allocations)||finding.allocations.some((a:Row)=>a.party==='DRIVER'&&a.basisPoints>0)||!Array.isArray(finding.evidenceIds)||!finding.evidenceIds.length)return fail('RETURN_GUARANTEE_FINDING_REQUIRED');
 const evidenceGuards:Row[]=[];for(const id of finding.evidenceIds){const key={orderId:v.orderId,sk:'CASE_EVIDENCE#'+id},e=await strongGet(db,'staging-Holds',key);if(!e||e.caseId!==v.caseId||e.kind!=='ORDER_EXCEPTION_EVIDENCE')return fail('EXCEPTION_EVIDENCE_REQUIRED');evidenceGuards.push(exactCheck('staging-Holds',key,e));}
 const amount=toWholeIqdExact(c.offer.allocation.driverWalletHold),financial=await authority.financial(actor,amount),operationId='CR:'+quoteHash({returnId:row.returnId,purpose:'REVIEWED_GUARANTEE_RELEASE_V1'}).slice(0,48),release=await prepareCodRelease(db,c.order,c.offer,c.timestamp,operationId,true,options.enableDeliveryFunding===true,undefined,options.enableFullCash===true);
 const review={state:'RELEASED',operationId,amountIqd:amount,actorId:actor.subjectId,findingId:v.findingId,reason:v.reason.trim(),releasedAt:c.timestamp,noLiabilityCharge:true},result={success:true,kind:'COD_RETURN',holdStatus:amount?'RELEASED':'NOT_REQUIRED',orderId:v.orderId,caseId:v.caseId,action:v.action,version:row.version+1,operationId,holdReleased:true,holdAmount:amount,financialPosting:true,driverFarePaid:false,merchantCompensationPaid:false},next={...row,version:row.version+1,guaranteeReview:review,updatedAt:c.timestamp,exceptionResolution:{...row.exceptionResolution,status:'SETTLEMENT_PENDING',updatedAt:c.timestamp}};
 const {Key:unused,...fence}=exactCheck('staging-Holds',ck,row).ConditionCheck,index=await exceptionCaseIndexOperation(db,{caseId:v.caseId,orderId:v.orderId,caseKey:v.caseKey,caseType:'COD_DELIVERY_EXCEPTION',state:'SETTLEMENT_PENDING',open:true,branchId:c.offer.branchId,at:c.timestamp,dueAt:row.activePhase?.responseDueAt??c.timestamp});
 if(!c.guards.some(g=>equal(g,financial.guard)))return fail('EXCEPTION_EMPLOYEE_UNAVAILABLE');
 const ops:Row[]=[...c.guards,exactCheck('staging-Holds',fk,finding),...evidenceGuards,...release.operations,index,set(exactCheck('WizzOrders',c.key,c.order),{holdStatus:amount?'RELEASED':'NOT_REQUIRED',walletFinancialStatus:'RETURNED',financialOutcome:operationId,updatedAt:c.timestamp}),{Put:{...fence,Item:next}},
 {Put:{TableName:'staging-Holds',Item:{orderId:v.orderId,sk:'FINANCIAL_OUTCOME',kind:'COD_RETURN_JOURNAL',...(c.order.financialAcceptance.schemaVersion===3?{schemaVersion:3,settlementModel:'FULL_CASH_AT_DELIVERY_V1',deliveryFunding:c.order.financialAcceptance.deliveryFunding}:c.order.financialAcceptance.schemaVersion===2?{schemaVersion:2,deliveryFunding:c.order.financialAcceptance.deliveryFunding}:{}),operationId,outcome:'RETURNED',returnId:row.returnId,driverId:c.order.driverId,subjectId:c.subject,branchId:c.offer.branchId,offerId:row.offerId,attempt:row.attempt,journalLines:release.journalLines,receipt:result,createdAt:c.timestamp},ConditionExpression:'attribute_not_exists(orderId)'}},
 {Put:{TableName:'staging-Holds',Item:{...ek,kind:'ORDER_EXCEPTION_CASE_EVENT',caseId:v.caseId,actorId:actor.subjectId,actorKind:'STAFF',action:v.action,reason:v.reason.trim(),requestDigest:digest,createdAt:c.timestamp,receipt:result},ConditionExpression:'attribute_not_exists(orderId)'}},
 {Put:{TableName:'staging-AuditLog',Item:{datePartition:'date#'+c.timestamp.slice(0,10).replace(/-/g,''),sk:c.timestamp+'#'+v.idempotencyKey,logId:v.idempotencyKey,orderId:v.orderId,caseId:v.caseId,actorId:actor.subjectId,actorKind:'STAFF',action:v.action,createdAt:c.timestamp,reason:v.reason.trim(),findingId:v.findingId,amountIqd:amount,operationId},ConditionExpression:'attribute_not_exists(sk)'}}];
 if(!equal(await authority.authenticate(),actor))return fail('UNAUTHORIZED');
 try{await db.send(new TransactWriteCommand({TransactItems:ops as any}));}catch(e){const saved=await strongGet(db,'staging-Holds',ek);if(saved?.actorId===actor.subjectId&&saved.requestDigest===digest)return {...saved.receipt,replayed:true};throw e;}return result;
 };
}
