import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient,QueryCommand,TransactWriteCommand} from '@aws-sdk/lib-dynamodb';
import {strongGet,exactCheck} from './driverFinancialTransaction';
import {casePhase,CASE_PRIORITIES} from './exceptionCasePolicy';
import {quoteHash,quoteEntityIdValid} from './deliveryQuoteRecord';
import {CASE_OPEN_PARTITION} from './orderExceptionCaseIndex';
type Row=Record<string,any>;
const EVENTS='staging-WalletLifecycle',HOLDS='staging-Holds';
/** SLA monitoring only. No wallet, hold amount, financial outcome or commercial order updates. */
export function createExceptionCaseSlaWorker(options:{db:Pick<DynamoDBDocumentClient,'send'>;now?:()=>number}){
 const {db}=options,now=options.now??Date.now;
 async function process(pointer:Row){
  if(pointer.kind!=='ORDER_EXCEPTION_CASE_POINTER'||!quoteEntityIdValid(pointer.caseId)||!quoteEntityIdValid(pointer.orderId)||pointer.operationId!=='EXCEPTION_CASE#'+pointer.caseId||pointer.queuePartition!==CASE_OPEN_PARTITION||!Number.isSafeInteger(pointer.version)||!['CUSTOMER_CANCELLATION','MERCHANT_CANCELLATION','CUSTOMER_CASH_REVIEW'].includes(pointer.caseKey)&&!/^RETURN#[1-9][0-9]{0,2}$/.test(pointer.caseKey||''))return 'ignored';
  const key={operationId:pointer.operationId},live=await strongGet(db,EVENTS,key);
  if(!live||live.version!==pointer.version||live.status!=='OPEN'||live.queuePartition!==CASE_OPEN_PARTITION)return 'stale';
  const ck={orderId:pointer.orderId,sk:pointer.caseKey},row=await strongGet(db,HOLDS,ck),t=now(),at=new Date(t).toISOString();
  const operations:Row[]=[],next:Row={...live,version:live.version+1,updatedAt:at};
  const identity=row?.caseId??row?.exceptionResolution?.caseId;
  const closed=row?.kind==='CUSTOMER_CASH_REVIEW_CASE'?row.state==='CLOSED':['CUSTOMER_CANCELLATION','MERCHANT_CANCELLATION'].includes(row?.kind)?(['DECLINED','SUPERSEDED'].includes(row?.state)||row?.state==='CANCELLED'&&row?.settlementStatus!=='REVIEW'):row?.exceptionResolution?.status==='RESOLVED';
  if(!row||identity!==pointer.caseId){next.monitoringStatus='SOURCE_REVIEW_REQUIRED';next.nextAttemptAt=Math.floor(t/1000)+3600;}
  else if(closed){next.status='CLOSED';next.queuePartition='ORDER_EXCEPTIONS_CLOSED';next.monitoringStatus='CLOSED';next.nextAttemptAt=Math.floor(t/1000);}
  else {
   const phase=row.activePhase;
   try{
    if(!phase||!CASE_PRIORITIES.includes(phase.priority)||!row.casePolicySnapshot)throw Error('POLICY_REVIEW_REQUIRED');
    const expected=casePhase(phase.priority==='FINANCIAL'&&phase.startedAt===row.guaranteeResolution?.retainedAt&&row.guaranteeResolution?.state==='RETAINED'?row.guaranteeResolution.slaPolicySnapshot:phase.priority==='CUSTODY'&&phase.startedAt===row.handoverIssue?.reportedAt?row.handoverIssue.slaPolicySnapshot:row.casePolicySnapshot,phase.priority,phase.startedAt);
    for(const field of ['priority','startedAt','responseDueAt','escalationDueAt','policyVersion'])if(expected[field as keyof typeof expected]!==phase[field])throw Error('POLICY_REVIEW_REQUIRED');
    if(phase.respondedAt!=null&&(!Number.isFinite(Date.parse(phase.respondedAt))||Date.parse(phase.respondedAt)<Date.parse(phase.startedAt)||Date.parse(phase.respondedAt)>t+30000))throw Error('POLICY_REVIEW_REQUIRED');
    const phaseKey=quoteHash(expected).slice(0,32),same=live.monitoringPhaseKey===phaseKey;
    next.monitoringPhaseKey=phaseKey;next.monitoringPhaseStartedAt=phase.startedAt;next.monitoringPriority=phase.priority;next.monitoringStatus='MONITORING';
    const lateResponse=t>=Date.parse(phase.responseDueAt)&&!phase.respondedAt,lateEscalation=t>=Date.parse(phase.escalationDueAt);
    next.responseAlertAt=same?live.responseAlertAt??null:null;next.escalatedAt=same?live.escalatedAt??null:null;
    for(const [kind,due]of [['RESPONSE',lateResponse],['ESCALATION',lateEscalation]] as const){
     const field=kind==='RESPONSE'?'responseAlertAt':'escalatedAt';if(!due||next[field])continue;next[field]=at;
     const eventId='SLA:'+quoteHash([pointer.caseId,phaseKey,kind]).slice(0,48);
     operations.push({Put:{TableName:'staging-AuditLog',Item:{datePartition:'date#'+at.slice(0,10).replace(/-/g,''),sk:at+'#'+eventId,logId:eventId,action:'ORDER_EXCEPTION_'+kind+'_OVERDUE',actorId:'ORDER_EXCEPTION_SLA_WORKER',actorKind:'SYSTEM',orderId:pointer.orderId,caseId:pointer.caseId,phase:phase.priority,phaseStartedAt:phase.startedAt,deadlineAt:kind==='RESPONSE'?phase.responseDueAt:phase.escalationDueAt,createdAt:at,noFinancialEffect:true},ConditionExpression:'attribute_not_exists(sk)'}});
    }
    const responseTime=Date.parse(phase.responseDueAt),escalationTime=Date.parse(phase.escalationDueAt);
    next.nextAttemptAt=Math.floor((!phase.respondedAt&&responseTime>t?responseTime:escalationTime>t?escalationTime:t+3600000)/1000);
   }catch{next.monitoringStatus='POLICY_REVIEW_REQUIRED';next.nextAttemptAt=Math.floor(t/1000)+3600;}
  }
  const {Key:_key,...condition}=exactCheck(EVENTS,key,live).ConditionCheck;
  operations.push({Put:{...condition,Item:next}},row?exactCheck(HOLDS,ck,row):{ConditionCheck:{TableName:HOLDS,Key:ck,ConditionExpression:'attribute_not_exists(orderId)'}});
  try{await db.send(new TransactWriteCommand({TransactItems:operations as any}));return 'updated';}catch(e:any){if(e?.name==='TransactionCanceledException'||e?.name==='ConditionalCheckFailedException')return 'stale';throw e;}
 }
 return async function tick(){let cursor;const counts={scanned:0,updated:0,stale:0,ignored:0};for(let page=0;page<4;page++){
  const result:any=await db.send(new QueryCommand({TableName:EVENTS,IndexName:'ByDue',KeyConditionExpression:'queuePartition=:open AND nextAttemptAt<=:now',ExpressionAttributeValues:{':open':CASE_OPEN_PARTITION,':now':Math.floor(now()/1000)},ExclusiveStartKey:cursor,Limit:25}));
  for(const p of result.Items??[]){counts.scanned++;counts[await process(p) as 'updated'|'stale'|'ignored']++;}cursor=result.LastEvaluatedKey;if(!cursor)break;
 }return counts;};
}
export async function exceptionCaseSlaHandler(event:Row){
 if(process.env.STAGE!=='staging'||process.env.AWS_REGION!=='us-east-1'||process.env.EXCEPTION_CASE_SLA_MODE!=='REQUIRED'||!event||event.action!=='tick'||Object.keys(event).join(',')!=='action')throw Error('EXCEPTION_CASE_SLA_DISABLED');
 const db=DynamoDBDocumentClient.from(new DynamoDBClient({region:'us-east-1'}),{marshallOptions:{removeUndefinedValues:true}});return createExceptionCaseSlaWorker({db})();
}
