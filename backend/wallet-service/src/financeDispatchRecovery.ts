import {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';
import {strongGet,exactCheck,FinancialRow as Row} from './driverFinancialTransaction';
import {validateDispatchCycle} from './dispatchCycle';
import {quoteHash} from './deliveryQuoteRecord';
/** Independent, bounded recovery of an ALREADY admitted order. Never opens quote
 * admission, new order creation or an old dispatch cycle. A real executed staff
 * decision and its exact replacement cycle are required at every send/accept. */
export async function financialRecoveryProof(db:Pick<DynamoDBDocumentClient,'send'>,env:Row,orderId:string,now:number){
 const fail=():never=>{throw Object.assign(Error('FINANCE_ROLLOUT_ADMISSION_CLOSED'),{code:'FINANCE_ROLLOUT_ADMISSION_CLOSED'});};
 let p:Row;try{if(typeof env.FINANCE_DISPATCH_RECOVERY!=='string'||Buffer.byteLength(env.FINANCE_DISPATCH_RECOVERY)>1500)return fail();p=JSON.parse(env.FINANCE_DISPATCH_RECOVERY);}catch{return fail();}
 if(!p||Object.keys(p).sort().join(',')!=='caseId,cycleId,expiresAt,orderId,requestId,schemaVersion'||p.schemaVersion!==1||p.orderId!==orderId||!/^[a-f0-9]{64}$/.test(p.caseId??'')||!/^[-a-f0-9]{36}$/i.test(p.requestId??'')||!Number.isSafeInteger(now)||!Number.isFinite(Date.parse(p.expiresAt))||now>=Date.parse(p.expiresAt))return fail();
 const token=quoteHash({caseId:p.caseId,requestId:p.requestId});if(p.cycleId!=='DC:'+token)return fail();
 const jobKey={orderId,SK:'METADATA'},decisionKey={pk:'DISPATCH_REVIEW#'+p.caseId,sk:'DECISION'},job=await strongGet(db,'WizzDispatchJobs_staging',jobKey),decision=await strongGet(db,'staging-PlatformStaff',decisionKey);
 if(!job||!decision)return fail();let cycle;try{cycle=validateDispatchCycle(job.dispatchCycle);}catch{return fail();}
 if(cycle.engine!=='FINANCIAL'||![2,3].includes(cycle.keyVersion??0)||cycle.orderId!==orderId||cycle.id!==p.cycleId||cycle.assignmentId!==job.dispatchJobId||cycle.assignmentId!=='DISPATCH:'+token||job.financialDispatch!==true||cycle.searchDeadline!==p.expiresAt||now<Date.parse(cycle.startedAt)||Date.parse(cycle.searchDeadline)-Date.parse(cycle.startedAt)>900000||!['searching','assigned'].includes(job.status)||decision.kind!=='DISPATCH_REVIEW_DECISION'||decision.status!=='EXECUTED'||decision.action!=='RETRY_SEARCH'||decision.resultCode!=='SEARCH_RESTART_QUEUED'||decision.orderId!==orderId||decision.caseId!==p.caseId||decision.requestId!==p.requestId||decision.receipt?.cycleId!==cycle.id||decision.receipt?.assignmentId!==cycle.assignmentId||decision.receipt?.restartId!==job.dispatchRestart?.restartId||decision.legalHold===true||decision.retentionHold===true)return fail();
 return [exactCheck('WizzDispatchJobs_staging',jobKey,job),exactCheck('staging-PlatformStaff',decisionKey,decision)];
}
