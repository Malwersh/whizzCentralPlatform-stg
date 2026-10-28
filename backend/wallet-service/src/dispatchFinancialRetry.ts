import {reconcilePriorFinancialSearch} from './dispatchRetryReconciliation';
import {retainFullCashFundingCommitment} from './fullCashFundingCommitment';
import {DynamoDBDocumentClient,QueryCommand} from '@aws-sdk/lib-dynamodb';
import {strongGet,exactCheck,FinancialRow as Row} from './driverFinancialTransaction';
import {createStagingDriverOfferOrderReader} from './driverOfferOrderReader';
import {prepareDeliveryFundingRetention} from './deliveryFundingRetention';
import {createDispatchCycle,validateDispatchCycle} from './dispatchCycle';
import {readDeliveryOperations} from './deliveryOperations';
import {quoteHash} from './deliveryQuoteRecord';
import {setFinancialFields as set} from './financialRelease';
const JOBS='WizzDispatchJobs_staging',ORDERS='WizzOrders';
/** Initial, never-offered funded COD recovery only. Preserve funding and the complete
 * immutable price envelope. Searches after any driver offer/acceptance require a
 * separate reconciliation workflow; no deletion, hold creation or repricing here. */
export async function planInitialFinancialRetry(input:{db:Pick<DynamoDBDocumentClient,'send'>;order:Row;job:Row;decision:Row;context:Row;at:string;enableFullCash?:boolean;allowPriorOffers?:boolean}) {
 const {db,order,job,decision,context:c,at}=input,cycle=validateDispatchCycle(job.dispatchCycle),orderId=order.orderId;
 const blocked=(resultCode:string)=>({ready:false as const,resultCode,writes:[] as Row[],guards:[] as Row[]});
 if(cycle.engine!=='FINANCIAL'||cycle.orderId!==orderId||cycle.assignmentId!==job.dispatchJobId||job.financialDispatch!==true||order.deliveryJobId!==cycle.assignmentId||job.status!=='no_driver_available'||job.driverId!=null||job.assignedDriverId!=null||job.dispatchReview?.cycleId!==cycle.id||job.dispatchReview?.intentId!==job.dispatchTransition?.id||job.dispatchReview?.reviewStatus!=='REQUIRED'||c.item.goodsState!=='BEFORE_PICKUP_RECORDED'||c.item.pendingAcceptance||c.attempts.length||(!input.allowPriorOffers&&(order.assignmentAttemptCounter??0)!==0))return blocked('FINANCIAL_INITIAL_RETRY_PROOF_REQUIRED');
 const read=await createStagingDriverOfferOrderReader({db,enableDeliveryFunding:true,enableFullCash:input.enableFullCash}).read({orderId,branchId:job.restaurantId});
 const fullCash=order.financialSnapshot?.schemaVersion===3;
 if((!input.allowPriorOffers&&read.releaseCondition)||(!fullCash&&(!read.deliveryFunding||order.financialSnapshot?.schemaVersion!==2)))return blocked('FUNDED_INITIAL_ORDER_REQUIRED');
 if(c.branch.status!=='approved'||c.branch.isActive!==true||c.branch.ordersBlocked===true||c.branch.platformSuspended===true)return blocked('BRANCH_UNAVAILABLE_FOR_SEARCH');
 const transitionKey={orderId,SK:'DISPATCH_TRANSITION#'+job.dispatchTransition.id},transition=await strongGet(db,JOBS,transitionKey);
 if(!transition||transition.action!=='REVIEW'||transition.state!=='APPLIED'||transition.cycleId!==cycle.id||transition.assignmentId!==cycle.assignmentId||transition.cycleDigest!==cycle.digest)return blocked('SEARCH_REVIEW_PROOF_REQUIRED');
 async function inventory(table:string,prefix?:string){
  const rows:Row[]=[],seen=new Set<string>();let cursor:Row|undefined;
  for(let page=0;page<10;page++){
   const result=await db.send(new QueryCommand({TableName:table,ConsistentRead:true,Limit:25,ExclusiveStartKey:cursor,KeyConditionExpression:'orderId=:id'+(prefix?' AND begins_with(SK,:prefix)':''),ExpressionAttributeValues:{':id':orderId,...(prefix?{':prefix':prefix}:{})}}));
   rows.push(...result.Items??[]);cursor=result.LastEvaluatedKey;if(!cursor)return rows;const digest=quoteHash(cursor);if(seen.has(digest))break;seen.add(digest);
  }throw Error('FINANCIAL_RETRY_INVENTORY_INCOMPLETE');
 }
 // All issuers/acceptors fence METADATA. Its atomic replacement below prevents
 // a concurrent old-cycle proposal from becoming valid after this inventory.
 const priorOffers=await inventory('WaveOffers_staging');
 if(!input.allowPriorOffers&&priorOffers.length)return blocked('PRIOR_DRIVER_OFFERS_REQUIRE_RECONCILIATION');
 const rows=await inventory(JOBS),guards:Row[]=[read.condition,...(read.releaseCondition?[read.releaseCondition]:[]),exactCheck(JOBS,transitionKey,transition)];
 for(const row of rows){
  if(row.kind==='LEGACY_ACCEPTANCE_ATTEMPT'||row.SK?.startsWith('DISPATCH_ACCEPTANCE#')||row.kind==='DISPATCH_RESPONSE_OUTBOX'&&(!input.allowPriorOffers||!['INTEGRATED','SUPPRESSED_DELETION'].includes(row.state)))return blocked('PRIOR_ACCEPTANCE_REQUIRES_RECONCILIATION');
  if(row.kind==='FINANCIAL_WAVE'){
   if(!Array.isArray(row.delivered)||!Array.isArray(row.driverIds)||row.driverIds.length>25||(!input.allowPriorOffers&&(row.delivered.length||!(row.state==='PREPARING'||row.state==='READY'&&row.driverIds.length===0)))||(input.allowPriorOffers&&!['PREPARING','READY','EXPIRED'].includes(row.state)))return blocked('PRIOR_WAVE_REQUIRES_RECONCILIATION');
   guards.push(exactCheck(JOBS,{orderId,SK:row.SK},row));
  }
 }
 const fundingGuards=fullCash?[await retainFullCashFundingCommitment(db,{orderId,snapshotDigest:order.financialSnapshot.digest,deliveryFunding:read.deliveryFunding??null,goodsAmount:read.snapshot.allocation.platformGoodsDiscount,goodsExposure:order.commercialPricing?.funding?.exposure})]:await prepareDeliveryFundingRetention(db,{orderId,at,operationId:'RETRY:'+decision.requestId,deliveryFunding:read.deliveryFunding,goodsAmount:read.snapshot.allocation.platformGoodsDiscount,commercialPricing:read.commercialPricing});
 const holds=await inventory('staging-Holds');
 if(input.allowPriorOffers){
  const proof=await reconcilePriorFinancialSearch({db,order,job,offers:priorOffers,rows,holds,at});
  if(!proof.ready)return blocked(proof.resultCode);
  guards.push(...proof.guards);
 }
 for(const hold of holds){
  if(fundingGuards.some(g=>g.ConditionCheck?.TableName==='staging-Holds'&&g.ConditionCheck.Key.orderId===orderId&&g.ConditionCheck.Key.sk===hold.sk))continue;
  if(input.allowPriorOffers&&(hold.sk==='HOLD'&&hold.status==='RELEASED'||hold.kind==='COD_ASSIGNMENT_RELEASE'&&hold.outcome==='UNASSIGNED'))continue;
  return blocked('UNEXPECTED_FINANCIAL_RECORDS');
 }
 guards.push(...fundingGuards);
 const hold=holds.find(h=>h.sk==='HOLD');
 guards.push(hold?exactCheck('staging-Holds',{orderId,sk:'HOLD'},hold):{ConditionCheck:{TableName:'staging-Holds',Key:{orderId,sk:'HOLD'},ConditionExpression:'attribute_not_exists(orderId)'}});
 const policy=await readDeliveryOperations(db,{DELIVERY_OPERATIONS_MODE:'CENTRAL'});if(!policy.condition||!policy.values.dispatch)throw Error('DISPATCH_POLICY_NOT_CONFIGURED');
 guards.push(policy.condition);
 const token=quoteHash({caseId:decision.caseId,requestId:decision.requestId}),newCycle=createDispatchCycle({id:'DC:'+token,assignmentId:'DISPATCH:'+token,orderId,engine:'FINANCIAL',startedAt:at,policy:{version:policy.version,values:policy.values},keyVersion:input.allowPriorOffers?3:2});
 const restartId='DRS:'+token.slice(0,48),history={orderId,SK:'DISPATCH_CYCLE_HISTORY#'+quoteHash(cycle.id),kind:'DISPATCH_CYCLE_HISTORY',schemaVersion:1,state:'ARCHIVED',cycleId:cycle.id,assignmentId:cycle.assignmentId,branchId:job.restaurantId,replacementCycleId:newCycle.id,cycleDigest:cycle.digest,policyVersion:cycle.policy.version,caseId:decision.caseId,requestId:decision.requestId,createdAt:at,source:job};
 const start={orderId,SK:'DISPATCH_RESTART#'+restartId,kind:'DISPATCH_RESTART_START',schemaVersion:1,engine:'FINANCIAL',state:'PENDING',version:1,attempts:0,nextAttemptAt:Date.parse(at),restartId,caseId:decision.caseId,requestId:decision.requestId,branchId:job.restaurantId,cycleId:newCycle.id,cycleDigest:newCycle.digest,assignmentId:newCycle.assignmentId,previousCycleId:cycle.id,createdAt:at,updatedAt:at};
 const jobWrite=set(exactCheck(JOBS,{orderId,SK:'METADATA'},job),{status:'searching',dispatchJobId:newCycle.assignmentId,dispatchCycle:newCycle,currentWaveNumber:0,maxWaves:newCycle.policy.values.dispatch!.profiles.FINANCIAL.normalWaves.length,expiresAt:newCycle.searchDeadline,dispatchRestart:{restartId,caseId:decision.caseId,previousCycleId:cycle.id,priorDriverPolicy:'REOFFER_ALL_ELIGIBLE'},excludedDrivers:[],financialExcludedDriverIds:[],updatedAt:at});
 const removed=['dispatchTransition','dispatchReview','noDriverReason','dispatchReviewOutcome','financialPreparingWave','financialSearchVersion','financialSearchMaxWave','financialRedispatch'].filter(k=>Object.prototype.hasOwnProperty.call(job,k)).map((k,i)=>{jobWrite.Update.ExpressionAttributeNames['#retryRemove'+i]=k;return '#retryRemove'+i;});if(removed.length)jobWrite.Update.UpdateExpression+=' REMOVE '+removed.join(',');
 return {ready:true as const,resultCode:'SEARCH_RESTART_QUEUED',writes:[jobWrite,set(exactCheck(ORDERS,{PK:'ORDER#'+orderId,SK:'META'},order),{deliveryJobId:newCycle.assignmentId,updatedAt:at}),{Put:{TableName:JOBS,Item:history,ConditionExpression:'attribute_not_exists(orderId)'}},{Put:{TableName:JOBS,Item:start,ConditionExpression:'attribute_not_exists(orderId)'}}],guards,receiptFields:{restartId,cycleId:newCycle.id,assignmentId:newCycle.assignmentId,startStatus:'PENDING',priorDriverPolicy:'REOFFER_ALL_ELIGIBLE'}};
}
