import {prepareCashAdjudication,cashAdjudicationAdjustment} from './cashAdjudication';
import {createFullCashCompletion} from './fullCashCompletion';
import {DynamoDBDocumentClient, TransactWriteCommand} from '@aws-sdk/lib-dynamodb';
import {detach,equal,exactCheck,strongGet,updateChecked} from './driverFinancialTransaction';
import {quoteHash,quoteEntityIdValid} from './deliveryQuoteRecord';
import {readOrderExceptionPolicy} from './orderExceptionPolicy';
import {readExceptionCasePolicy,casePhase} from './exceptionCasePolicy';
import {exceptionCaseIndexOperation} from './orderExceptionCaseIndex';
import {toWholeIqdExact} from './money';
import {cashAccountingDeduplicate,cashCustomerRefundPosting,cashboxCustodian,cashEmployeeGuard} from './cashboxAccounting';
import {cashboxCode,cashboxKey} from './merchantCashbox';
import {assessReportedCash,createCustomerCashReview,approveCustomerRefund,executeCustomerRefund,
 acknowledgeCustomerRefund,reconcileCustomerRefund,cancelCustomerRefund,CashReviewActor,CashReviewFacts} from './customerCashReview';
type Row=Record<string,any>;
const T={orders:'WizzOrders',holds:'staging-Holds',audit:'staging-AuditLog',platform:'staging-MerchantPlatform'};
const KEY='CUSTOMER_CASH_REVIEW';
const fail=(code='CASH_REVIEW_CONFLICT'):never=>{throw Object.assign(Error(code),{code});};
const uuid=(v:any)=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const text=(v:any)=>typeof v==='string'&&v.trim().length>=5&&v.length<=1000;
const fields:Record<string,string[]>={OPEN_CASH_REVIEW:[],RECORD_CASH_CONTACT:['party','channel','result'],APPROVE_CASH_ADJUDICATION:['reviewBasis','collectedIqd','outcome','evidenceReferences','confirmDelivered'],EXECUTE_CASH_ADJUDICATION:['decisionId','confirmExecution'],CANCEL_CASH_ADJUDICATION:['decisionId'],REPORT_CASH_PAYMENT:['reportedPaidIqd','confirmActualPayment'],
 VERIFY_CASH_COLLECTION:['customerReportId','driverReportId'],APPROVE_CUSTOMER_REFUND:['refundId','amountIqd','sourceKind','cashboxCode'],
 EXECUTE_CUSTOMER_REFUND:['refundId','confirmPhysicalExecution','reference'],ACKNOWLEDGE_CUSTOMER_REFUND:['refundId','confirmFullReceipt'],
 RECONCILE_CUSTOMER_REFUND:['refundId','reference'],CANCEL_CUSTOMER_REFUND:['refundId'],
 RECORD_CASH_SHORTFALL_DECISION:['outcome','evidenceReferences'],RESOLVE_CASH_COLLECTION_REVIEW:['confirmNoFinancialAdjustment'],CLOSE_CUSTOMER_CASH_REVIEW:['confirmCompletedReview']};
function put(table:string,row:Row,key:Row,old:Row|null){
 if(!old)return {Put:{TableName:table,Item:row,ConditionExpression:'attribute_not_exists(#p)',ExpressionAttributeNames:{'#p':Object.keys(key)[0]}}};
 const {Key,...condition}=exactCheck(table,key,old).ConditionCheck;return {Put:{...condition,Item:row}};
}
function setFields(check:Row,fields:Row){
 const names:Row={},values:Row={},assignments=Object.entries(fields).map(([key,value],i)=>{names['#cashU'+i]=key;values[':cashU'+i]=value;return '#cashU'+i+'=:cashU'+i;});
 return updateChecked(check,'SET '+assignments.join(', '),names,values);
}
/** Original-token adapters supply authenticate and current staff authorization.
 * There is one aggregate per ORDER, not per complaint: parallel refunds cannot
 * reserve the same collected cash through different cases. */
export function createCustomerCashCase(options:{db:Pick<DynamoDBDocumentClient,'send'>;
 authenticate:()=>Promise<CashReviewActor>;authorizeStaff:(actor:CashReviewActor,mode:'READ'|'OPERATE'|'FINANCIAL'|'EXECUTE',amount?:number)=>Promise<Row[]>;
 now?:()=>number}){
 const {db,authenticate}=options,now=options.now??Date.now;
 async function context(orderId:string){
  if(!quoteEntityIdValid(orderId))return fail('INVALID_CASH_REVIEW');
  const actor=detach(await authenticate()),key={PK:'ORDER#'+orderId,SK:'META'},order=await strongGet(db,T.orders,key);
  if(!actor||!quoteEntityIdValid(actor.subjectId)||!['CUSTOMER','DRIVER','STAFF'].includes(actor.kind))return fail('UNAUTHORIZED');
  if(!order||order.orderId!==orderId||!readOrderExceptionPolicy(order)||order.isGuestOrder===true||order.deletedAt!=null||order.deletionRequestId!=null||order.isDeleted===true||
   order.financialSnapshot?.schemaVersion!==3||!quoteEntityIdValid(order.userSub)||!quoteEntityIdValid(order.driverId))return fail('CASH_REVIEW_UNAVAILABLE');
  if(actor.kind==='CUSTOMER'&&actor.subjectId!==order.userSub||actor.kind==='DRIVER'&&actor.subjectId!==order.driverId)return fail('CASH_REVIEW_FORBIDDEN');
  const guards:Row[]=actor.kind==='STAFF'?await options.authorizeStaff(actor,'READ'):[];
  if(actor.kind==='DRIVER'){
   const dk={driverId:actor.subjectId},driver=await strongGet(db,'WhizzDrivers_staging',dk);
   if(!driver||(driver.cognitoSub??driver.driverId)!==actor.subjectId||!['APPROVED','VERIFIED'].includes(driver.status)||driver.isSuspended===true||driver.isBanned===true||driver.isDeleted===true||driver.deletionRequestId!=null||driver.deletedAt!=null)return fail('CASH_REVIEW_FORBIDDEN');
   guards.push(exactCheck('WhizzDrivers_staging',dk,driver,[...new Set([...Object.keys(driver),'isSuspended','isBanned','isDeleted','deletionRequestId','deletedAt'])]));
  }
  for(const pk of ['ACCOUNT_LIFECYCLE#CUSTOMER#'+order.userSub,'ACCOUNT_LIFECYCLE#DRIVER#'+order.driverId])guards.push({ConditionCheck:{TableName:'staging-AccountDeletion',Key:{pk,sk:'META'},ConditionExpression:'attribute_not_exists(pk)'}});
  const expectedIqd=toWholeIqdExact(order.financialAcceptance?.allocation?.customerTotal);
  if(!Number.isSafeInteger(expectedIqd)||expectedIqd<0)return fail('CASH_REVIEW_PROOF_REQUIRED');
  const ck={orderId,sk:KEY},row=await strongGet(db,T.holds,ck);
  if(row&&(row.kind!=='CUSTOMER_CASH_REVIEW_CASE'||row.orderId!==orderId||row.customerId!==order.userSub||row.driverId!==order.driverId||row.branchId!==order.storeId||row.acceptedTermsDigest!==quoteHash(order.financialAcceptance)||!Number.isSafeInteger(row.version)||row.version<1))return fail();
  return {actor,key,order,guards,expectedIqd,ck,row,at:new Date(now()).toISOString()};
 }
 async function financialFacts(c:Awaited<ReturnType<typeof context>>,row:Row){
  if(row.collectionVerification){
   const latest=[...(row.reports??[])].reverse();
   if(latest.find((r:Row)=>r.actorKind==='CUSTOMER')?.reportId!==row.collectionVerification.customerReportId||latest.find((r:Row)=>r.actorKind==='DRIVER')?.reportId!==row.collectionVerification.driverReportId)return fail('CASH_REVIEW_PROOF_REQUIRED');
  }
  const key={orderId:c.order.orderId,sk:'FINANCIAL_OUTCOME'},outcome=await strongGet(db,T.holds,key),guards:Row[]=[];
  let collectedIqd:number,settledIqd:number,collectionProofId:string,collectionProofDigest:string;
  if(outcome){
   if(outcome.kind!=='FULL_CASH_COMPLETION_JOURNAL'||outcome.schemaVersion!==3||outcome.outcome!=='COMPLETED'||outcome.driverId!==c.order.driverId||outcome.operationId!==c.order.financialOutcome||outcome.receipt?.cashCollected!==true||outcome.receipt?.cashCollectedAmount!==c.expectedIqd||!outcome.journalDigest)return fail('CASH_REVIEW_PROOF_REQUIRED');
   const journalKey={pk:'FULL_CASH_JOURNAL#'+c.order.orderId,sk:'META'},journal=await strongGet(db,T.platform,journalKey);
   if(!journal||journal.kind!=='FULL_CASH_ACCOUNTING_JOURNAL'||journal.status!=='POSTED'||journal.postingDigest!==outcome.journalDigest||journal.operationId!==outcome.operationId)return fail('CASH_REVIEW_PROOF_REQUIRED');
   // A later overpayment requires separately matched customer/driver reports.
   // The settled expected amount remains proved by the original immutable journal.
   collectedIqd=row.collectionVerification?.collectedIqd??c.expectedIqd;
   if(collectedIqd<c.expectedIqd)return fail('CASH_REVIEW_PROOF_REQUIRED');
   settledIqd=c.expectedIqd;collectionProofId=row.collectionVerification?.verificationId??outcome.operationId;
   collectionProofDigest=quoteHash(row.collectionVerification??outcome);
   guards.push(exactCheck(T.holds,key,outcome),exactCheck(T.platform,journalKey,journal));
  }else{
   if(c.order.financialOutcome!=null||c.order.cashCollected===true||Number(c.order.cashCollectedAmount??0)!==0||!row.collectionVerification)return fail('CASH_REVIEW_PROOF_REQUIRED');
   collectedIqd=row.collectionVerification.collectedIqd;settledIqd=0;
   collectionProofId=row.collectionVerification.verificationId;collectionProofDigest=quoteHash(row.collectionVerification);
   guards.push({ConditionCheck:{TableName:T.holds,Key:key,ConditionExpression:'attribute_not_exists(orderId)'}});
  }
  const f:CashReviewFacts={orderId:c.order.orderId,customerId:c.order.userSub,driverId:c.order.driverId,expectedIqd:c.expectedIqd,
   collectedIqd,settledIqd,collectionProofId,collectionProofDigest,settlementProofDigest:quoteHash(outcome??{state:'UNSETTLED',orderId:c.order.orderId})};
  return {facts:f,guards};
 }
 function view(c:Awaited<ReturnType<typeof context>>,row:Row|null){
  return {success:true,orderId:c.order.orderId,caseKey:KEY,caseId:row?.caseId??null,version:row?.version??0,
   status:row?.state??'NOT_OPENED',expectedIqd:c.expectedIqd,
   reports:(row?.reports??[]).filter((r:Row)=>c.actor.kind==='STAFF'||r.actorKind===c.actor.kind&&r.actorId===c.actor.subjectId),
   collectionVerification:row?.collectionVerification?{collectedIqd:row.collectionVerification.collectedIqd,verifiedAt:row.collectionVerification.verifiedAt}:null,
   shortfallDecision:c.actor.kind==='STAFF'?row?.shortfallDecision??null:null,
   adjudication:row?.adjudication?(c.actor.kind==='STAFF'?row.adjudication:{status:row.adjudication.status,outcome:row.adjudication.outcome,collectedIqd:row.adjudication.collectedIqd,shortfallIqd:row.adjudication.shortfallIqd}):null,contactAttempts:c.actor.kind==='STAFF'?row?.contactAttempts??[]:[],
   refunds:(row?.refunds?.refunds??[]).filter((r:Row)=>c.actor.kind!=='DRIVER'||r.source.kind==='DRIVER_UNSETTLED').map((r:Row)=>({refundId:r.refundId,voucherNumber:r.voucherNumber,amountIqd:r.amountIqd,status:r.status,source:c.actor.kind==='STAFF'?r.source:{kind:r.source.kind},executionReference:r.execution?.reference??null})),
   liability:'NOT_AUTOMATIC',sourceExecutionRecorded:(row?.refunds?.refunds??[]).some((r:Row)=>!!r.execution)};
 }
 async function execute(v:Row){
  if(v?.action==='READ_CUSTOMER_CASH_CASE'){
   if(Object.keys(v).sort().join(',')!=='action,orderId')return fail('INVALID_CASH_REVIEW');const c=await context(v.orderId);return view(c,c.row);
  }
  const extra=fields[v?.action],common=['orderId','action','expectedVersion','idempotencyKey','reason'];
  if(!v||!extra||Object.keys(v).sort().join(',')!==[...common,...extra].sort().join(',')||!uuid(v.idempotencyKey)||!Number.isSafeInteger(v.expectedVersion)||v.expectedVersion<0||!text(v.reason))return fail('INVALID_CASH_REVIEW');
  const c=await context(v.orderId),eventKey={orderId:v.orderId,sk:'CUSTOMER_CASH_EVENT#'+v.idempotencyKey},digest=quoteHash({...v,actor:c.actor}),prior=await strongGet(db,T.holds,eventKey);
  if(prior){if(prior.requestDigest!==digest)return fail();return {...prior.receipt,replayed:true};}
  if((c.row?.version??0)!==v.expectedVersion)return fail();
  if(!c.row&&!['REPORT_CASH_PAYMENT','OPEN_CASH_REVIEW'].includes(v.action))return fail('CASH_REVIEW_UNAVAILABLE');
  if(c.row?.state==='CLOSED'&&v.action!=='REPORT_CASH_PAYMENT')return fail('CASH_REVIEW_CLOSED');
  let row:Row=c.row?detach(c.row):{...c.ck,kind:'CUSTOMER_CASH_REVIEW_CASE',financialSchemaVersion:4,caseId:'OEX:'+quoteHash({orderId:v.orderId,kind:KEY}).slice(0,48),customerId:c.order.userSub,driverId:c.order.driverId,branchId:c.order.storeId,acceptedTermsDigest:quoteHash(c.order.financialAcceptance),version:0,createdAt:c.at,reports:[],refunds:createCustomerCashReview(v.orderId),state:'REVIEW_REQUIRED'};
  const ops:Row[]=[],guards=[...c.guards];let sourceProof:Row|null=null;
  if(!c.row){const policy=await readExceptionCasePolicy(db);row.casePolicySnapshot=policy.snapshot;row.activePhase=casePhase(policy.snapshot,'COD',c.at);guards.push(policy.condition);}
  if(v.action==='OPEN_CASH_REVIEW'){
   if(c.actor.kind!=='STAFF')return fail('CASH_REVIEW_FORBIDDEN');guards.push(...await options.authorizeStaff(c.actor,'OPERATE'));
   if(c.row||c.order.financialOutcome!=null||c.order.returnCaseId!=null||!['picked_up','heading_to_customer','arrived_at_customer'].includes(c.order.status))return fail('CASH_REVIEW_UNAVAILABLE');
   ops.push(setFields(exactCheck(T.orders,c.key,c.order),{openPaymentClaimId:row.caseId,updatedAt:c.at}));
  }else if(v.action==='RECORD_CASH_CONTACT'){
   if(c.actor.kind!=='STAFF')return fail('CASH_REVIEW_FORBIDDEN');guards.push(...await options.authorizeStaff(c.actor,'OPERATE'));
   if(!['CUSTOMER','DRIVER'].includes(v.party)||!['PHONE','IN_APP','IN_PERSON'].includes(v.channel)||!['NO_RESPONSE','REFUSED','RESPONDED'].includes(v.result))return fail('INVALID_CASH_REVIEW');
   if(row.adjudication?.status==='EXECUTED'||(row.contactAttempts??[]).length>=30)return fail('CASH_REVIEW_LIMIT');
   row.contactAttempts=[...(row.contactAttempts??[]),{contactId:v.idempotencyKey,party:v.party,channel:v.channel,result:v.result,note:v.reason.trim(),recordedBy:c.actor.subjectId,at:c.at}];
  }else if(v.action==='APPROVE_CASH_ADJUDICATION'){
   if(c.actor.kind!=='STAFF')return fail('CASH_REVIEW_FORBIDDEN');
   if(c.order.financialOutcome!=null||row.adjudication?.status==='EXECUTED'||row.refunds.refunds.some((r:Row)=>r.status!=='CANCELLED'))return fail('CASH_ADJUDICATION_CHANGED');
   const decision=prepareCashAdjudication(row,c.order,v,c.actor.subjectId,c.at);
   // Authorize the full order amount: approval can settle collateral/payables,
   // not merely the disputed difference, even when the decision finds no deficit.
   const authority=await options.authorizeStaff(c.actor,'FINANCIAL',c.expectedIqd);guards.push(...authority);
   row.adjudication=decision;row.adjudicationApprovalGuards=detach(authority);
  }else if(v.action==='CANCEL_CASH_ADJUDICATION'){
   if(c.actor.kind!=='STAFF'||row.adjudication?.status!=='APPROVED'||row.adjudication.decisionId!==v.decisionId)return fail('CASH_ADJUDICATION_CHANGED');
   guards.push(...await options.authorizeStaff(c.actor,'FINANCIAL',c.expectedIqd));row.adjudication={...row.adjudication,status:'CANCELLED',cancelledAt:c.at,cancelledBy:c.actor.subjectId};
  }else if(v.action==='EXECUTE_CASH_ADJUDICATION'){
   if(c.actor.kind!=='STAFF'||v.confirmExecution!==true)return fail('CASH_REVIEW_FORBIDDEN');
   guards.push(...await options.authorizeStaff(c.actor,'EXECUTE'),...await options.authorizeStaff(c.actor,'FINANCIAL',c.expectedIqd));
   if(!Array.isArray(row.adjudicationApprovalGuards)||!row.adjudicationApprovalGuards.length)return fail('CASH_ADJUDICATION_CHANGED');
   guards.push(...row.adjudicationApprovalGuards);
   const plan:any=await createFullCashCompletion({db,enabled:true,now,authenticateDriver:async()=>{throw Error('UNAUTHORIZED');},authenticateStaff:authenticate}).prepareAdministrative(v.orderId,v.decisionId);
   ops.push(...plan.operations);const adjustment=cashAdjudicationAdjustment(row.adjudication);
   row.adjudication={...row.adjudication,status:'EXECUTED',execution:{actorId:c.actor.subjectId,at:c.at,operationId:plan.receipt.operationId,adjustment}};
   row.state=adjustment.receivableIqd?'AWAITING_CUSTOMER_PAYMENT':'CLOSED';
   if(row.state==='CLOSED'){row.closedAt=c.at;row.closedBy=c.actor.subjectId;row.closureReason=v.reason.trim();}
  }else if(v.action==='REPORT_CASH_PAYMENT'){
   if(!['CUSTOMER','DRIVER'].includes(c.actor.kind)||v.confirmActualPayment!==true)return fail('CASH_REVIEW_FORBIDDEN');
   const assessment=assessReportedCash(c.expectedIqd,v.reportedPaidIqd);
   if(row.reports.length>=50)return fail('CASH_REVIEW_LIMIT');
   row.reports.push({reportId:v.idempotencyKey,actorKind:c.actor.kind,actorId:c.actor.subjectId,reportedPaidIqd:v.reportedPaidIqd,reason:v.reason.trim(),assessment,createdAt:c.at});
   if(row.state==='CLOSED'){row.state='REVIEW_REQUIRED';row.activePhase=casePhase(row.casePolicySnapshot,'COD',c.at);}
   // Freeze an ACTIVE collection dispute, not an already settled delivery.
   if(c.order.financialOutcome==null){
    if(!['picked_up','heading_to_customer','arrived_at_customer'].includes(c.order.status)||c.order.returnCaseId!=null)return fail('CASH_REVIEW_UNAVAILABLE');
    ops.push(setFields(exactCheck(T.orders,c.key,c.order,[...new Set([...Object.keys(c.order),'openPaymentClaimId','financialOutcome'])]),{openPaymentClaimId:row.caseId,updatedAt:c.at}));
   }
  }else if(v.action==='VERIFY_CASH_COLLECTION'){
   if(c.actor.kind!=='STAFF')return fail('CASH_REVIEW_FORBIDDEN');guards.push(...await options.authorizeStaff(c.actor,'OPERATE'));
   const reports=row.reports as Row[],customer=reports.find(r=>r.reportId===v.customerReportId&&r.actorKind==='CUSTOMER'&&r.actorId===c.order.userSub),driver=reports.find(r=>r.reportId===v.driverReportId&&r.actorKind==='DRIVER'&&r.actorId===c.order.driverId);
   if(!customer||!driver||customer.reportedPaidIqd!==driver.reportedPaidIqd||[...reports].reverse().find(r=>r.actorKind==='CUSTOMER'&&r.actorId===customer.actorId)?.reportId!==customer.reportId||[...reports].reverse().find(r=>r.actorKind==='DRIVER'&&r.actorId===driver.actorId)?.reportId!==driver.reportId)return fail('CASH_REVIEW_MATCHING_REPORTS_REQUIRED');
   if(row.refunds.refunds.some((r:Row)=>r.status!=='CANCELLED'))return fail('CASH_REVIEW_REFUNDS_ALREADY_RESERVED');
   row.collectionVerification={verificationId:v.idempotencyKey,collectedIqd:customer.reportedPaidIqd,customerReportId:customer.reportId,driverReportId:driver.reportId,verifiedBy:c.actor.subjectId,verifiedAt:c.at,reason:v.reason.trim()};
  }else if(v.action==='RESOLVE_CASH_COLLECTION_REVIEW'){
   if(c.actor.kind!=='STAFF'||v.confirmNoFinancialAdjustment!==true)return fail('CASH_REVIEW_FORBIDDEN');
   guards.push(...await options.authorizeStaff(c.actor,'OPERATE'));
   if(row.adjudication?.status==='EXECUTED'||!row.collectionVerification||row.collectionVerification.collectedIqd!==c.expectedIqd||row.refunds.refunds.some((r:Row)=>r.status!=='CANCELLED'))return fail('CASH_REVIEW_FINANCIAL_ADJUSTMENT_REQUIRED');
   const reports=row.reports as Row[];
   if([...reports].reverse().find(r=>r.actorKind==='CUSTOMER')?.reportId!==row.collectionVerification.customerReportId||[...reports].reverse().find(r=>r.actorKind==='DRIVER')?.reportId!==row.collectionVerification.driverReportId)return fail('CASH_REVIEW_MATCHING_REPORTS_REQUIRED');
   if(c.order.openPaymentClaimId!==row.caseId||c.order.financialOutcome!=null)return fail('CASH_REVIEW_FINANCIAL_ADJUSTMENT_REQUIRED');
   ops.push(setFields(exactCheck(T.orders,c.key,c.order),{openPaymentClaimId:null,updatedAt:c.at,
    ...(c.expectedIqd>0?{cashReviewVerifiedCollection:{caseId:row.caseId,verificationId:row.collectionVerification.verificationId,collectedIqd:c.expectedIqd,verifiedAt:row.collectionVerification.verifiedAt}}:{})}));
   row.state='CLOSED';row.closedAt=c.at;row.closedBy=c.actor.subjectId;row.closureReason=v.reason.trim();
   if(row.adjudication?.status==='APPROVED')row.adjudication={...row.adjudication,status:'SUPERSEDED_BY_MATCHED_DECLARATIONS',resolvedAt:c.at};
   if(row.shortfallDecision)row.shortfallDecision={...row.shortfallDecision,status:'SUPERSEDED_BY_VERIFIED_FULL_COLLECTION',resolvedAt:c.at};
  }else if(v.action==='RECORD_CASH_SHORTFALL_DECISION'){
   if(c.actor.kind!=='STAFF'||!['CUSTOMER_COLLECTION_REQUIRED','COMPANY_COVERAGE_REVIEW','DRIVER_LIABILITY_REVIEW','ORDER_ADJUSTMENT_REVIEW'].includes(v.outcome)||!Array.isArray(v.evidenceReferences)||!v.evidenceReferences.length||v.evidenceReferences.length>10||!v.evidenceReferences.every(text))return fail('INVALID_CASH_REVIEW');
   const proof=await financialFacts(c,row),shortfall=c.expectedIqd-proof.facts.collectedIqd;if(shortfall<=0)return fail('CASH_REVIEW_NO_SHORTFALL');
   guards.push(...proof.guards,...await options.authorizeStaff(c.actor,'FINANCIAL',shortfall));
   row.shortfallDecision={outcome:v.outcome,shortfallIqd:shortfall,evidenceReferences:v.evidenceReferences,reason:v.reason.trim(),actorId:c.actor.subjectId,at:c.at,status:'PENDING_SEPARATE_EXECUTION',financialPosting:false};
  }else if(v.action==='CANCEL_CUSTOMER_REFUND'){
   if(c.actor.kind!=='STAFF')return fail('CASH_REVIEW_FORBIDDEN');const r=row.refunds.refunds.find((r:Row)=>r.refundId===v.refundId);if(!r)return fail('REFUND_STATE_CONFLICT');guards.push(...await options.authorizeStaff(c.actor,'FINANCIAL',r.amountIqd));
   row.refunds=cancelCustomerRefund(row.refunds,c.actor,{refundId:v.refundId,reason:v.reason},c.at);
  }else if(v.action==='CLOSE_CUSTOMER_CASH_REVIEW'){
   if(c.actor.kind!=='STAFF'||v.confirmCompletedReview!==true)return fail('CASH_REVIEW_FORBIDDEN');
   const proof=await financialFacts(c,row),f=proof.facts;
   if(c.order.openPaymentClaimId!=null||f.settledIqd!==c.expectedIqd||row.refunds.refunds.some((r:Row)=>!['CANCELLED','RECONCILED'].includes(r.status))||
    (row.reports??[]).some((r:Row,i:number,all:Row[])=>!all.slice(i+1).some(l=>l.actorKind===r.actorKind)&&r.reportedPaidIqd!==f.collectedIqd))return fail('CASH_REVIEW_FINANCIAL_ADJUSTMENT_REQUIRED');
   guards.push(...proof.guards,...await options.authorizeStaff(c.actor,'FINANCIAL',f.collectedIqd));
   for(const r of row.refunds.refunds.filter((r:Row)=>r.status==='RECONCILED')){
    const saved=row.refundSourceProofs?.[r.refundId];if(!saved)return fail('REFUND_RECONCILIATION_REQUIRED');
    const journal=await strongGet(db,saved.table,saved.key);if(!journal)return fail('REFUND_RECONCILIATION_REQUIRED');const {digest,...body}=journal;
    if(quoteHash(body)!==digest||digest!==saved.digest||journal.refundId!==r.refundId||journal.orderId!==v.orderId||journal.journalId!==r.execution.sourceJournalId)return fail('REFUND_RECONCILIATION_REQUIRED');
    guards.push(exactCheck(saved.table,saved.key,journal));
   }
   row.state='CLOSED';row.closedAt=c.at;row.closedBy=c.actor.subjectId;row.closureReason=v.reason.trim();
  }else{
   const proof=await financialFacts(c,row);guards.push(...proof.guards);const f=proof.facts;
   if(v.action==='APPROVE_CUSTOMER_REFUND'){
    if(c.actor.kind!=='STAFF')return fail('CASH_REVIEW_FORBIDDEN');const approvalGuards=await options.authorizeStaff(c.actor,'FINANCIAL',v.amountIqd);guards.push(...approvalGuards);
    let source:any;
    if(v.sourceKind==='DRIVER_UNSETTLED'){if(v.cashboxCode!==null)return fail('REFUND_SOURCE_INVALID');source={kind:'DRIVER_UNSETTLED',driverId:c.order.driverId};}
    else if(v.sourceKind==='COMPANY_CASHBOX'&&cashboxCode(v.cashboxCode)){
     const box=await strongGet(db,T.platform,cashboxKey(v.cashboxCode));if(!box||box.kind!=='MERCHANT_CASHBOX'||box.status!=='ACTIVE')return fail('PAYOUT_CASHBOX_UNAVAILABLE');
     const custodian=await cashboxCustodian(db,box.custodianEmployeeId);guards.push(exactCheck(T.platform,cashboxKey(box.code),box),cashEmployeeGuard(custodian));source={kind:'COMPANY_CASHBOX',code:box.code,custodianId:custodian.employeeId};
    }else return fail('REFUND_SOURCE_INVALID');
    row.refunds=approveCustomerRefund(row.refunds,f,c.actor,{refundId:v.refundId,amountIqd:v.amountIqd,source,reason:v.reason},c.at);
    row.refundApprovalGuards={...(row.refundApprovalGuards??{}),[v.refundId]:detach(approvalGuards)};
   }else if(v.action==='EXECUTE_CUSTOMER_REFUND'){
    const r=row.refunds.refunds.find((r:Row)=>r.refundId===v.refundId);if(!r)return fail('REFUND_STATE_CONFLICT');
    const approvalGuards=row.refundApprovalGuards?.[v.refundId];if(!Array.isArray(approvalGuards)||!approvalGuards.length||approvalGuards.some(g=>!g.ConditionCheck||g.ConditionCheck.TableName!=='staging-PlatformStaff'))return fail('CASH_REVIEW_PROOF_REQUIRED');
    guards.push(...approvalGuards);
    let journalId:string;
    if(r.source.kind==='COMPANY_CASHBOX'){
     if(c.actor.kind!=='STAFF')return fail('CASH_REVIEW_FORBIDDEN');guards.push(...await options.authorizeStaff(c.actor,'EXECUTE'));
     const posting=await cashCustomerRefundPosting(db,{orderId:v.orderId,refundId:r.refundId,amountIqd:r.amountIqd,voucherNumber:r.voucherNumber,code:r.source.code,custodianId:r.source.custodianId,reason:r.reason},c.actor.subjectId,c.at);
     journalId=posting.journalId;ops.push(...posting.ops);sourceProof=posting.journal;
    }else{
     journalId='DRIVER-REFUND-'+quoteHash({orderId:v.orderId,refundId:r.refundId}).slice(0,40);
     sourceProof={orderId:v.orderId,sk:'DRIVER_CASH_REFUND#'+r.refundId,kind:'DRIVER_UNSETTLED_CASH_REFUND',financialSchemaVersion:4,branchId:c.order.storeId,journalId,refundId:r.refundId,driverId:c.order.driverId,amountIqd:r.amountIqd,voucherNumber:r.voucherNumber,at:c.at,collectionProofDigest:f.collectionProofDigest,settlementProofDigest:f.settlementProofDigest,accountingEffect:'REDUCE_UNSETTLED_CUSTOMER_CASH_CUSTODY',walletPosting:false};sourceProof={...sourceProof,digest:quoteHash(sourceProof)};
     ops.push(put(T.holds,sourceProof,{orderId:v.orderId,sk:sourceProof.sk},null));
    }
    row.refunds=executeCustomerRefund(row.refunds,f,c.actor,{refundId:v.refundId,confirmPhysicalExecution:v.confirmPhysicalExecution,sourceJournalId:journalId,reference:v.reference},c.at);
    row.refundSourceProofs={...(row.refundSourceProofs??{}),[r.refundId]:{table:r.source.kind==='COMPANY_CASHBOX'?T.platform:T.holds,key:r.source.kind==='COMPANY_CASHBOX'?{pk:sourceProof!.pk,sk:sourceProof!.sk}:{orderId:v.orderId,sk:sourceProof!.sk},digest:sourceProof!.digest,journalId}};
   }else if(v.action==='ACKNOWLEDGE_CUSTOMER_REFUND'){
    row.refunds=acknowledgeCustomerRefund(row.refunds,f,c.actor,{refundId:v.refundId,confirmFullReceipt:v.confirmFullReceipt},c.at);
   }else if(v.action==='RECONCILE_CUSTOMER_REFUND'){
    if(c.actor.kind!=='STAFF')return fail('CASH_REVIEW_FORBIDDEN');const r=row.refunds.refunds.find((r:Row)=>r.refundId===v.refundId),saved=row.refundSourceProofs?.[v.refundId];
    if(!r||!saved)return fail('REFUND_RECONCILIATION_REQUIRED');guards.push(...await options.authorizeStaff(c.actor,'FINANCIAL',r.amountIqd));
    const journal=await strongGet(db,saved.table,saved.key);if(!journal)return fail('REFUND_RECONCILIATION_REQUIRED');const {digest,...body}=journal;
    if(digest!==saved.digest||quoteHash(body)!==digest||journal.refundId!==v.refundId||journal.orderId!==v.orderId||journal.journalId!==saved.journalId)return fail('REFUND_RECONCILIATION_REQUIRED');
    guards.push(exactCheck(saved.table,saved.key,journal));row.refunds=reconcileCustomerRefund(row.refunds,c.actor,{refundId:v.refundId,verifiedSourceJournalId:saved.journalId,reference:v.reference},c.at);
   }
  }
  if(c.actor.kind==='STAFF'&&!row.activePhase.respondedAt)row.activePhase={...row.activePhase,respondedAt:c.at,responseSource:v.action};
  row={...row,version:row.version+1,updatedAt:c.at};
  if(Buffer.byteLength(JSON.stringify(row))>300000)return fail('CASH_REVIEW_LIMIT');
  const receipt=view(c,row),index=await exceptionCaseIndexOperation(db,{caseId:row.caseId,orderId:v.orderId,caseKey:KEY,caseType:'CUSTOMER_CASH_REVIEW',state:row.state,open:row.state!=='CLOSED',at:c.at,branchId:c.order.storeId,dueAt:row.activePhase.responseDueAt});
  if(!ops.some(op=>op.Update?.TableName===T.orders))guards.push(exactCheck(T.orders,c.key,c.order,[...new Set([...Object.keys(c.order),'openPaymentClaimId','financialOutcome','cashCollectedAmount'])]));
  const event={...eventKey,kind:'ORDER_EXCEPTION_CASE_EVENT',cashReviewSchemaVersion:1,financialSchemaVersion:4,branchId:c.order.storeId,driverId:c.order.driverId,caseId:row.caseId,actorKind:c.actor.kind,actorId:c.actor.subjectId,action:v.action,reason:v.reason.trim(),createdAt:c.at,requestDigest:digest,receipt};
  ops.push(index,put(T.holds,row,c.ck,c.row),put(T.holds,event,eventKey,null),{Put:{TableName:T.audit,Item:{datePartition:'date#'+c.at.slice(0,10).replace(/-/g,''),sk:c.at+'#'+v.idempotencyKey,logId:v.idempotencyKey,orderId:v.orderId,caseId:row.caseId,actorId:c.actor.subjectId,actorKind:c.actor.kind,action:v.action,reason:v.reason.trim(),createdAt:c.at},ConditionExpression:'attribute_not_exists(sk)'}});
  if(!equal(c.actor,await authenticate()))return fail('UNAUTHORIZED');
  const planned=cashAccountingDeduplicate([...guards,...ops]);if(planned.length>100||Buffer.byteLength(JSON.stringify(planned))>3500000)return fail('CASH_REVIEW_LIMIT');
  await db.send(new TransactWriteCommand({TransactItems:planned as any,ClientRequestToken:digest.slice(0,36)}));
  return receipt;
 }
 return {execute};
}
