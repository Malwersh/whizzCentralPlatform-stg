import {DynamoDBDocumentClient,QueryCommand,ScanCommand,TransactWriteCommand} from '@aws-sdk/lib-dynamodb';
import {strongGet,exactCheck,FinancialRow as Row} from './driverFinancialTransaction';
import {setFinancialFields as set} from './financialRelease';
import {quoteHash,quoteEntityIdValid} from './deliveryQuoteRecord';
import {validateDispatchCycle} from './dispatchCycle';
import {createStagingDispatchCoordinator} from './dispatchCoordinator';
import {createStagingDispatchRestartStart} from './dispatchRestartStart';
const {dispatchWaveSK}=require('../../src/utils/dispatch-cycle-keys');
const JOBS='WizzDispatchJobs_staging';
/** Bounded host over existing Jobs and periodic timeout. A persisted cursor resumes
 * empty pages too; no timer per offer, new queue/table or financial engine.
 */
function createDispatchHost(options:{db:Pick<DynamoDBDocumentClient,'send'>;now?:()=>number;mode?:string;engine?:'LEGACY'|'FINANCIAL';enableDeliveryFunding?:boolean;remainingMs?:()=>number;start:(input:{orderId:string;assignmentId:string;cycleId:string})=>Promise<unknown>}){
 const {db}=options,now=options.now??Date.now,engine=options.engine??'LEGACY',financial=engine==='FINANCIAL',checkpoint={orderId:'SYSTEM#DISPATCH_HOST',SK:'CURSOR#'+engine},coordinator=createStagingDispatchCoordinator({db,now,enableDeliveryFunding:options.enableDeliveryFunding});
 const enabled=()=>{if((options.mode??process.env[financial?'DISPATCH_FINANCIAL_HOST_MODE':'DISPATCH_LEGACY_HOST_MODE'])!=='REQUIRED')throw Error(financial?'DISPATCH_FINANCIAL_HOST_DISABLED':'DISPATCH_LEGACY_HOST_DISABLED');};
 const consumer=createStagingDispatchRestartStart({db,now,mode:'REQUIRED',start:options.start});
 async function processOrder(orderId:string,expectedAssignment?:string){
  enabled();if(!quoteEntityIdValid(orderId))throw Error('DISPATCH_HOST_SELECTOR_INVALID');
  const job=await strongGet(db,JOBS,{orderId,SK:'METADATA'});if(!job)return {skipped:'MISSING'};
  if(expectedAssignment&&job.dispatchJobId!==expectedAssignment)return {skipped:'SUPERSEDED'};
  if(!job.dispatchCycle||job.financialDispatch!==financial)return {skipped:'OTHER_ENGINE'};
  const cycle=validateDispatchCycle(job.dispatchCycle);if(cycle.engine!==engine||cycle.assignmentId!==job.dispatchJobId||cycle.orderId!==orderId)throw Error('DISPATCH_HOST_SOURCE_INVALID');
  // An uncertain reservation is not a reason to launch another offer or release money.
  if(!financial){let cursor:Row|undefined;for(let page=0;page<5;page++){const q=await db.send(new QueryCommand({TableName:JOBS,ConsistentRead:true,Limit:20,ExclusiveStartKey:cursor,KeyConditionExpression:'orderId=:id AND begins_with(SK,:prefix)',ExpressionAttributeValues:{':id':orderId,':prefix':'DISPATCH_ACCEPTANCE#'}}));for(const a of q.Items??[]){if(a.kind!=='LEGACY_ACCEPTANCE_ATTEMPT'||a.orderId!==orderId)throw Error('DISPATCH_HOST_ACCEPTANCE_INVALID');if(['RESERVATION_PENDING','ASSIGNMENT_PENDING','REVIEW_REQUIRED'].includes(a.state))return {skipped:'RESERVATION_REVIEW'};if(a.state!=='ASSIGNED')throw Error('DISPATCH_HOST_ACCEPTANCE_INVALID');}cursor=q.LastEvaluatedKey;if(!cursor)break;}if(cursor)throw Error('DISPATCH_HOST_ACCEPTANCE_INCOMPLETE');}
  if(job.dispatchRestart){if(financial)throw Error('FINANCIAL_RESTART_NOT_READY');const r=await strongGet(db,JOBS,{orderId,SK:'DISPATCH_RESTART#'+job.dispatchRestart.restartId});if(!r)throw Error('DISPATCH_HOST_RESTART_MISSING');if(r.state!=='STARTED')return consumer.process(orderId,r.restartId,'host:'+quoteHash({orderId,at:now()}).slice(0,32));}
  if(job.status!=='searching')return {skipped:'NOT_SEARCHING'};
  const plan=await coordinator.plan({orderId,assignmentId:job.dispatchJobId,source:'TIMEOUT'});
  let resumeDelivery=false;if(plan.action==='WAIT'&&job.currentWaveNumber>0){const wave=await strongGet(db,JOBS,{orderId,SK:dispatchWaveSK(cycle,job.currentWaveNumber)});if(!wave||wave.kind!==(financial?'FINANCIAL_WAVE':'DISPATCH_WAVE')||(financial?wave.operatingLimits?.version!==cycle.policy.version:wave.cycleDigest!==cycle.digest)||!Array.isArray(wave.driverIds)||!Array.isArray(wave.delivered))throw Error('DISPATCH_HOST_WAVE_INVALID');resumeDelivery=wave.driverIds.some((id:string)=>!wave.delivered.includes(id));}
  if(plan.action==='START_WAVE'||plan.action==='RESUME'||resumeDelivery){enabled();await options.start({orderId,assignmentId:job.dispatchJobId,cycleId:cycle.id});return {action:'START_ATTEMPTED'};}
  return {action:plan.action};
 }
 async function tick(owner:string){
  enabled();if(!quoteEntityIdValid(owner))throw Error('DISPATCH_HOST_OWNER_INVALID');
  const previous=await strongGet(db,JOBS,checkpoint),time=now();if(!Number.isSafeInteger(time))throw Error('DISPATCH_HOST_TIME_INVALID');
  if(previous&&(previous.kind!=='DISPATCH_HOST_CURSOR'||!Number.isSafeInteger(previous.version)||previous.version<1||!Number.isSafeInteger(previous.leaseUntil)))throw Error('DISPATCH_HOST_CURSOR_INVALID');
  if(previous?.leaseUntil>time)return {busy:true};
  const claimed={...checkpoint,kind:'DISPATCH_HOST_CURSOR',version:(previous?.version??0)+1,cursor:previous?.cursor??null,leaseOwner:owner,leaseUntil:time+60000,updatedAt:new Date(time).toISOString()};
  const condition=previous?exactCheck(JOBS,checkpoint,previous).ConditionCheck:{ConditionExpression:'attribute_not_exists(orderId)'};const {TableName,Key,...putCondition}=condition as Row;void TableName;void Key;
  try{await db.send(new TransactWriteCommand({TransactItems:[{Put:{TableName:JOBS,Item:claimed,...putCondition}}],ClientRequestToken:quoteHash(claimed).slice(0,36)}));}catch(error){const fresh=await strongGet(db,JOBS,checkpoint);if(fresh?.leaseOwner!==owner||fresh?.version!==claimed.version)return {busy:true};throw error;}
  let processed=0,failed=0,complete=true,next=claimed.cursor;
  try{
   const seen=new Set<string>();
   for(let pageNumber=0;pageNumber<(financial?20:1);pageNumber++){
   const page=await db.send(new ScanCommand({TableName:JOBS,ConsistentRead:true,Select:'SPECIFIC_ATTRIBUTES',Limit:25,ExclusiveStartKey:next??undefined,ProjectionExpression:'orderId,SK',FilterExpression:'(#kind=:restart AND (#state=:pending OR #state=:starting)) OR (SK=:meta AND #status=:searching AND attribute_exists(dispatchCycle))',ExpressionAttributeNames:{'#kind':'kind','#state':'state','#status':'status'},ExpressionAttributeValues:{':restart':'DISPATCH_RESTART_START',':pending':'PENDING',':starting':'STARTING',':meta':'METADATA',':searching':'searching'}}));
   for(const r of page.Items??[]){if((options.remainingMs?.()??60000)<35000||now()>=claimed.leaseUntil){complete=false;break;}if(!seen.has(r.orderId)){seen.add(r.orderId);try{await processOrder(r.orderId);processed++;}catch{failed++;}}next={orderId:r.orderId,SK:r.SK};}
   if(complete)next=page.LastEvaluatedKey??null;
   if(!complete||next===null||(options.remainingMs?.()??60000)<35000||now()>=claimed.leaseUntil)break;
   }
   enabled();await db.send(new TransactWriteCommand({TransactItems:[set(exactCheck(JOBS,checkpoint,claimed),{cursor:next,leaseUntil:0,processed,failed,updatedAt:new Date(now()).toISOString()})] as any}));
   return {processed,failed,complete,hasContinuation:next!==null};
  }catch(error){
   // Keep the previous page cursor. A crash or write conflict can be retried once
   // this short lease expires; downstream writes and sends have their own fences.
   throw error;
  }
 }
 return {tick,processOrder};
}

// Share cursor/lease/pagination recovery, but never legacy acceptance or restart handling.
type HostOptions=Omit<Parameters<typeof createDispatchHost>[0],'engine'>;
export function createStagingDispatchLegacyHost(options:HostOptions){return createDispatchHost({...options,engine:'LEGACY'});}
export function createStagingDispatchFinancialHost(options:HostOptions){return createDispatchHost({...options,engine:'FINANCIAL'});}
