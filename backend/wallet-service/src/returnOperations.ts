import {SecretsManagerClient} from '@aws-sdk/client-secrets-manager';
import {createMapboxSecretReader} from './routingCredentials';
import {createMapboxRoadRouter} from './roadRouting';
import {casePhase} from './exceptionCasePolicy';
import {TransactWriteCommand} from '@aws-sdk/lib-dynamodb';
import {createCodFlowContext} from './codFlowContext';
import {strongGet,exactCheck,equal} from './driverFinancialTransaction';
import {setFinancialFields as set} from './financialRelease';
import {quoteHash,quoteEntityIdValid} from './deliveryQuoteRecord';
import {readExceptionSettings} from './orderExceptionSettings';
import {assertPosition} from './deliveryAttempt';
import {readReturnOperations,branchClosingAt} from './returnOperationsPolicy';
import {exceptionCaseIndexOperation} from './orderExceptionCaseIndex';
type Row=Record<string,any>;
const fail=(code='RETURN_OPERATIONS_CONFLICT'):never=>{throw Object.assign(Error(code),{code});};
export const acceptanceKey=(branchId:string)=>({pk:'RETURN_ACCEPTANCE#'+branchId,sk:'CURRENT'});
function branchOpen(b:Row){return b.status==='approved'&&b.isActive===true&&b.operatingStatus==='AVAILABLE'&&b.isOpen!==false&&b.temporarilyClosed!==true&&b.ordersBlocked!==true&&b.platformSuspended!==true;}
export async function planAutomaticReturn(db:any,c:Row,record:Row,position:Row|undefined,router:any){
 const manual=(reason:string)=>({manualReason:reason,assessedAt:c.timestamp});
 try{
  const policy=await readReturnOperations(db);if(!policy.snapshot.values.enabled)return manual('AUTOMATIC_RETURN_DISABLED');if(!branchOpen(c.branch))return manual('BRANCH_OPEN_STATUS_UNCONFIRMED');if(!['CUSTOMER_REFUSED','CUSTOMER_UNREACHABLE'].includes(record.reason))return manual('INCIDENT_REQUIRES_REVIEW');if(c.order.status!=='arrived_at_customer'||!router||!position)return manual('CUSTOMER_ARRIVAL_OR_ROUTE_UNCONFIRMED');
  const key=acceptanceKey(c.offer.branchId),consent=await strongGet(db,'staging-MerchantPlatform',key);if(!consent||consent.enabled!==true||consent.ownerId!==c.branch.ownerId||consent.branchId!==c.offer.branchId||consent.termsVersion!=='RETURN_ACCEPTANCE_V1')return manual('OWNER_ACCEPTANCE_REQUIRED');
  const settings=await readExceptionSettings(db),proof=assertPosition(position,c.offer.source.order.customerPoint,settings.snapshot.values,Date.parse(c.timestamp));
  const origin={latitude:proof.latitude,longitude:proof.longitude},destination=c.offer.source.order.branchPoint,route=await router.getRoute(origin,destination),t=Date.parse(c.timestamp),end=branchClosingAt(c.branch.openingHours,t),duration=route?.route?.durationSeconds;
  if(!end||!Number.isSafeInteger(duration)||duration<0||duration>7200||route.route.quality!=='ROAD'||!equal(route.origin,origin)||!equal(route.destination,destination)||Date.parse(route.route.expiresAt)<=t||t-Date.parse(route.route.measuredAt)>120000||t+duration*1000+policy.snapshot.values.closingMarginSeconds*1000>end)return manual('RETURN_BEFORE_CLOSING_UNCONFIRMED');
  const decisionId='AUTO:'+quoteHash([record.returnId,consent.version,policy.snapshot.digest]).slice(0,48),disposition={type:'RETURN_TO_MERCHANT',status:'AUTHORIZED',decisionId,authorizedBy:'SYSTEM',authorizedAt:c.timestamp,source:'AUTOMATIC_POLICY',policySnapshot:policy.snapshot,consentVersion:consent.version,reason:'تصريح آلي وفق موافقة المطعم وحالة العمل ومسار العودة',returnFeasibleConfirmed:true,assignmentAttempt:record.attempt,returnId:record.returnId,checks:{branchOpen:true,ownerConsent:true,closingAt:new Date(end).toISOString(),estimatedArrivalAt:new Date(t+duration*1000).toISOString(),route,position:proof}};
  return {disposition,guards:[policy.condition,settings.condition,exactCheck('staging-MerchantPlatform',key,consent)],decision:{Put:{TableName:'staging-Holds',Item:{orderId:record.orderId,sk:'CASE_DECISION#'+record.exceptionResolution.caseId+'#'+decisionId,kind:'ORDER_EXCEPTION_DECISION',caseId:record.exceptionResolution.caseId,actorKind:'SYSTEM',actorId:'SYSTEM',action:'AUTOMATIC_RETURN_AUTHORIZED',disposition,createdAt:c.timestamp,financialPosting:false},ConditionExpression:'attribute_not_exists(orderId)'}}};
 }catch{return manual('CHECKS_UNAVAILABLE_OR_POSITION_UNCONFIRMED');}
}
export function createReturnOperations(options:any){
 const {db,authenticate}=options,now=options.now??Date.now,context=createCodFlowContext({...options,now});
 async function commit(c:Row,ops:Row[]){if(!equal(c.actor,await authenticate()))return fail('UNAUTHORIZED');await db.send(new TransactWriteCommand({TransactItems:[...c.guards,...ops]as any}));}
 function audit(c:Row,id:string,action:string){return {Put:{TableName:'staging-AuditLog',Item:{datePartition:'date#'+c.timestamp.slice(0,10).replace(/-/g,''),sk:c.timestamp+'#'+id,logId:id,orderId:c.order.orderId,actorId:c.actor.subjectId,actorKind:c.actor.kind,action,createdAt:c.timestamp,financialPosting:false},ConditionExpression:'attribute_not_exists(sk)'}};}
 return {
 async setAcceptance(v:Row){if(!v||Object.keys(v).sort().join(',')!=='attempt,branchId,enabled,offerId,orderId'||typeof v.enabled!=='boolean')return fail('INVALID_RETURN_OPERATIONS');const c=await context(v,'MERCHANT_OWNER'),policy=await readReturnOperations(db),key=acceptanceKey(c.offer.branchId),old=await strongGet(db,'staging-MerchantPlatform',key);
  if(old?.enabled===v.enabled&&old.ownerId===c.actor.subjectId&&old.termsVersion==='RETURN_ACCEPTANCE_V1')return {success:true,orderId:v.orderId,enabled:v.enabled,replayed:true};
  const next={...key,kind:'RETURN_ACCEPTANCE_POLICY',branchId:c.offer.branchId,ownerId:c.actor.subjectId,enabled:v.enabled,version:(old?.version??0)+1,policyVersion:policy.snapshot.policyVersion,termsVersion:'RETURN_ACCEPTANCE_V1',recordedAt:c.timestamp},check=old?exactCheck('staging-MerchantPlatform',key,old).ConditionCheck:{ConditionExpression:'attribute_not_exists(pk)'},{Key:_k,...fence}=check as Row;
  await commit(c,[policy.condition,exactCheck('WizzOrders',c.key,c.order),{Put:{TableName:'staging-MerchantPlatform',...fence,Item:next}},audit(c,'RAC:'+quoteHash(next).slice(0,40),'RETURN_ACCEPTANCE_POLICY_CHANGED')]);return {success:true,orderId:v.orderId,enabled:v.enabled,version:next.version};
 },
 async reportObstacle(v:Row){
  if(!v||Object.keys(v).sort().join(',')!=='attempt,issueId,note,offerId,orderId,position,reason,returnId'||!quoteEntityIdValid(v.issueId)||!['BRANCH_CLOSED','AUTHORIZED_PERSON_ABSENT','RECEIPT_REFUSED','RECEIVED_WITHOUT_CONFIRMATION','OTHER'].includes(v.reason)||typeof v.note!=='string'||v.note.trim().length<5||v.note.length>1000)return fail('INVALID_RETURN_OPERATIONS');
  const c=await context(v,'DRIVER'),r=c.record;if(!r||v.returnId!==c.returnId||r.status!=='ARRIVED_AT_BRANCH'||c.order.returnStatus!=='ARRIVED_AT_BRANCH'||c.order.financialOutcome!=null)return fail();
  const fingerprint=quoteHash({reason:v.reason,note:v.note.trim(),actor:c.subject});if(r.handoverIssue){if(r.handoverIssue.issueId===v.issueId&&r.handoverIssue.fingerprint===fingerprint)return {success:true,orderId:v.orderId,handoverIssue:r.handoverIssue,replayed:true};return fail('RETURN_OBSTACLE_ALREADY_RECORDED');}
  const settings=await readExceptionSettings(db),policy=await readReturnOperations(db),proof=assertPosition(v.position,c.offer.source.order.branchPoint,settings.snapshot.values,now()),id='EV:'+quoteHash([c.returnId,v.issueId]).slice(0,48),deadlineAt=new Date(Date.parse(c.timestamp)+policy.snapshot.values.branchWaitSeconds*1000).toISOString();
  const slaBody={...r.casePolicySnapshot,version:policy.snapshot.version,policyVersion:policy.snapshot.policyVersion,values:{...r.casePolicySnapshot.values,sla:{...r.casePolicySnapshot.values.sla,CUSTODY:{responseSeconds:Math.min(60,Math.floor(policy.snapshot.values.branchWaitSeconds/2)),escalationSeconds:policy.snapshot.values.branchWaitSeconds}}}};delete slaBody.digest;const slaPolicySnapshot={...slaBody,digest:quoteHash(slaBody)};
  const issue={slaPolicySnapshot,issueId:v.issueId,fingerprint,reason:v.reason,note:v.note.trim(),reportedAt:c.timestamp,escalationAt:deadlineAt,waitSeconds:policy.snapshot.values.branchWaitSeconds,state:'AWAITING_SUPPORT',evidenceId:id,reportedBy:c.subject,verification:'DRIVER_REPORT_NOT_PROOF_OF_BRANCH_FAULT',position:proof,policySnapshot:policy.snapshot},next={...r,version:r.version+1,updatedAt:c.timestamp,handoverIssue:issue,evidenceIds:[...(r.evidenceIds??[]),id],activePhase:casePhase(slaPolicySnapshot,'CUSTODY',c.timestamp),exceptionResolution:{...r.exceptionResolution,status:'HANDOVER_BLOCKED',updatedAt:c.timestamp}};
  if(next.evidenceIds.length>100)return fail('EXCEPTION_CASE_EVIDENCE_LIMIT');const {Key:_key,...fence}=exactCheck('staging-Holds',c.returnKey,r).ConditionCheck,index=await exceptionCaseIndexOperation(db,{caseId:r.exceptionResolution.caseId,orderId:v.orderId,caseKey:c.returnKey.sk,caseType:'COD_DELIVERY_EXCEPTION',state:'HANDOVER_BLOCKED',open:true,branchId:c.offer.branchId,at:c.timestamp,dueAt:c.timestamp});
  await commit(c,[settings.condition,policy.condition,index,set(exactCheck('WizzOrders',c.key,c.order),{returnHandover:{reason:v.reason,note:v.note.trim(),reportedAt:c.timestamp,escalationAt:deadlineAt,state:'AWAITING_SUPPORT'},updatedAt:c.timestamp}),{Put:{...fence,Item:next}},{Put:{TableName:'staging-Holds',Item:{orderId:v.orderId,sk:'CASE_EVIDENCE#'+id,kind:'ORDER_EXCEPTION_EVIDENCE',caseId:r.exceptionResolution.caseId,evidenceId:id,type:'RETURN_HANDOVER_OBSTACLE',actorKind:'DRIVER',actorId:c.subject,proof:issue,createdAt:c.timestamp},ConditionExpression:'attribute_not_exists(orderId)'}},audit(c,id,'RETURN_HANDOVER_OBSTACLE_REPORTED')]);return {success:true,orderId:v.orderId,handoverIssue:issue,financialPosting:false};
 }
 };
}

export function createReturnRoadRouter(){return {getRoute:(origin:any,destination:any)=>{const getAccessToken=createMapboxSecretReader({secrets:new SecretsManagerClient({region:'us-east-1'}),secretArn:process.env.FINANCIAL_ROUTING_SECRET_ARN??'',accountId:'699561669180',region:'us-east-1',timeoutMs:1500});return createMapboxRoadRouter({getAccessToken,profile:'driving',ttlSeconds:60,timeoutMs:5000}).getRoute(origin,destination);}};}
