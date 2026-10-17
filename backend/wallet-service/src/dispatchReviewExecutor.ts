import {DynamoDBDocumentClient,QueryCommand,TransactWriteCommand} from '@aws-sdk/lib-dynamodb';
import {CognitoIdentityProviderClient,AdminGetUserCommand} from '@aws-sdk/client-cognito-identity-provider';
import {strongGet,exactCheck,FinancialRow as Row} from './driverFinancialTransaction';
import {quoteHash} from './deliveryQuoteRecord';
import {readDeliveryOperations} from './deliveryOperations';
import {createDispatchCycle,validateDispatchCycle} from './dispatchCycle';
import {readLegacyOrderAmounts} from './dispatchLegacySource';
import {setFinancialFields as set} from './financialRelease';
import {composeDispatchTransaction} from './dispatchTransaction';
const {createReviewReader}=require('../../staff-service/dispatch-reviews');
const {allowed}=require('../../staff-service/catalog');
const T={staff:'staging-PlatformStaff',jobs:'WizzDispatchJobs_staging',orders:'WizzOrders',holds:'staging-Holds',deletions:'staging-AccountDeletion'};
const statuses=['EXECUTED','STALE','AUTHORIZATION_CHANGED','NEEDS_REVIEW','SUPPRESSED_DELETION'];
const fail=(code='DISPATCH_REVIEW_EXECUTION_CONFLICT'):never=>{throw Error(code);};
/** Trusted single-decision executor, never a public HTTP event. No owner/driver
 * impersonation, money writes or external sends. Numeric policies are unchanged.
 * Retry is limited to proven initial Legacy and an explicit independent mode.
 */
export function createStagingDispatchReviewExecutor(options:{db:Pick<DynamoDBDocumentClient,'send'>;cognito:Pick<CognitoIdentityProviderClient,'send'>;now?:()=>number;mode?:string}){
 const {db,cognito}=options,now=options.now??Date.now;
 return {async process(caseId:string){
  const mode=options.mode??process.env.DISPATCH_REVIEW_EXECUTION_MODE;
  if(!['SAFE_INITIAL_LEGACY','SAFE_LEGACY_RETRY'].includes(mode??''))return fail('DISPATCH_REVIEW_EXECUTION_DISABLED');
  if(!/^[a-f0-9]{64}$/.test(caseId))return fail();
  const key={pk:'DISPATCH_REVIEW#'+caseId,sk:'DECISION'},stored=await strongGet(db,T.staff,key);
  if(!stored)return {missing:true};const decision:Row=stored;
  if(!Number.isSafeInteger(now())||!Number.isFinite(Date.parse(decision.createdAt))||Date.parse(decision.createdAt)>now())return fail('DISPATCH_REVIEW_TIME_CONFLICT');
  if(decision.kind!=='DISPATCH_REVIEW_DECISION'||decision.schemaVersion!==1||decision.caseId!==caseId||!/^[-a-f0-9]{36}$/i.test(decision.requestId??''))return fail();
  const receipt=(r:Row,replayed=false)=>({...r.receipt,status:r.status,executed:r.status==='EXECUTED',requestId:r.requestId,caseId,replayed});
  if(statuses.includes(decision.status)){if(!decision.receipt||decision.receipt.caseId!==caseId||decision.receipt.requestId!==decision.requestId)return fail();return receipt(decision,true);}
  if(decision.legalHold===true||decision.retentionHold===true)return fail('DOCUMENTED_RETENTION_HOLD');
  if(!['PENDING_EXECUTION','BLOCKED_DEPENDENCY'].includes(decision.status)||decision.financialArchiveConfirmed)return fail();
  const actorKey={pk:'EMPLOYEE#'+decision.actorId,sk:'PROFILE'},actor=await strongGet(db,T.staff,actorKey),at=new Date(now()).toISOString(),executionId='DRE:'+quoteHash({caseId,requestId:decision.requestId}).slice(0,48);
  async function identity(){
   if(!actor||actor.employeeId!==decision.actorId||actor.version!==decision.actorVersion||actor.status!=='ACTIVE'||!actor.username||!allowed(actor,'orders.read')||!allowed(actor,decision.action==='CANCEL_BEFORE_PICKUP'?'orders.cancel':'orders.assign',decision.regionId))return false;
   const live=await cognito.send(new AdminGetUserCommand({UserPoolId:'us-east-1_wz7vwZZxz',Username:actor.username}));
   return live.Enabled===true&&live.UserStatus==='CONFIRMED'&&live.UserAttributes?.find(a=>a.Name==='sub')?.Value===actor.employeeId&&live.UserMFASettingList?.includes('SOFTWARE_TOKEN_MFA')===true;
  }
  const actorGuard=actor?exactCheck(T.staff,actorKey,actor):{ConditionCheck:{TableName:T.staff,Key:actorKey,ConditionExpression:'attribute_not_exists(pk)'}};
  async function finish(status:string,resultCode:string,writes:Row[]=[],guards:Row[]=[],extra:Row={}){
   if(decision.status==='BLOCKED_DEPENDENCY'&&status==='BLOCKED_DEPENDENCY'&&decision.resultCode===resultCode)return receipt(decision,true);
   const result={status,executed:status==='EXECUTED',requestId:decision.requestId,caseId,executionId,resultCode,holdReleased:false,notificationsDelivered:false,...(extra.receiptFields??{})};
   const next={status,resultCode,executionId,receipt:result,executedAt:at};
   const audit={Put:{TableName:T.staff,Item:{pk:'AUDIT',sk:executionId+'#'+status,actorId:decision.actorId,action:'DISPATCH_REVIEW_DECISION_'+status,orderId:decision.orderId,caseId,requestId:decision.requestId,resultCode,createdAt:at},ConditionExpression:'attribute_not_exists(pk)'}};
   const tx=composeDispatchTransaction([set(exactCheck(T.staff,key,decision),next),audit,...writes],[actorGuard,...guards]);
   try{await db.send(new TransactWriteCommand({TransactItems:tx as any,ClientRequestToken:quoteHash(tx).slice(0,36)}));}
   catch(error){const saved=await strongGet(db,T.staff,key);if(saved?.executionId===executionId&&saved?.status===status&&saved.receipt?.requestId===decision.requestId)return receipt(saved,true);throw error;}
   return result;
  }
  // Provider failure is retryable, not evidence of revocation. Disabled/mismatched
  // live identity is a definitive denial and cannot reach an order mutation.
  if(!await identity())return finish('AUTHORIZATION_CHANGED','EMPLOYEE_AUTHORITY_CHANGED');
  const reader=createReviewReader({db,table:T.staff,employee:async()=>actor,guard:()=>actorGuard},actor);
  let c:Row;
  try{c=await reader.load(decision.selector);}catch(error:any){if(error?.message==='REVIEW_UNAVAILABLE')return finish('STALE','SOURCE_UNAVAILABLE');throw error;}
  if(c.item.caseId!==caseId||c.item.orderId!==decision.orderId||c.item.branchId!==decision.branchId||c.item.regionId!==decision.regionId||c.decision?.requestId!==decision.requestId||c.decision?.requestDigest!==decision.requestDigest)return fail();
  if(!c.item.active||c.baseDigest!==decision.baseDigest)return finish('STALE','SOURCE_CHANGED',[],c.guards);
  if(decision.action==='RETRY_SEARCH'&&mode!=='SAFE_LEGACY_RETRY')return finish('BLOCKED_DEPENDENCY','RETRY_EXECUTION_DISABLED',[],c.guards);
  if(decision.action==='CHECK_RESERVATION'){
   // No assignment/hold resolution can be inferred from timeout or a missing
   // HTTP reply. Keep unresolved evidence for an explicit financial review.
   return finish('NEEDS_REVIEW','RESERVATION_REQUIRES_RECONCILIATION',[],c.guards);
  }
  if(!['CANCEL_BEFORE_PICKUP','RETRY_SEARCH'].includes(decision.action)||decision.selector.source!=='SEARCH')return fail();
  const orderKey={PK:'ORDER#'+decision.orderId,SK:'META'},jobKey={orderId:decision.orderId,SK:'METADATA'};
  const order=await strongGet(db,T.orders,orderKey),job=await strongGet(db,T.jobs,jobKey);if(!order||!job)return fail();
  let cycle:Row;try{cycle=validateDispatchCycle(job.dispatchCycle);readLegacyOrderAmounts(order);}catch{return finish('BLOCKED_DEPENDENCY','FINANCIAL_OR_SOURCE_WORKFLOW_REQUIRED',[],c.guards);}
  if(cycle.engine!=='LEGACY'||cycle.orderId!==order.orderId||cycle.assignmentId!==job.dispatchJobId||order.deliveryJobId!==job.dispatchJobId||job.financialDispatch!==false||job.assignedDriverId!=null||job.driverId!=null||job.status!=='no_driver_available'||job.dispatchReview?.cycleId!==cycle.id||job.dispatchReview?.intentId!==job.dispatchTransition?.id||job.dispatchReview?.reviewStatus!=='REQUIRED'||
   order.status!=='ready_for_pickup'||order.orderStatus!=null&&order.orderStatus!=='ready_for_pickup'||c.item.goodsState!=='BEFORE_PICKUP_RECORDED'||c.item.pendingAcceptance||c.attempts.length>0||[order.holdId,order.walletPendingHoldId,order.driverId,order.assignedDriverId,order.returnCaseId,order.returnStatus,order.financialRelease].some(v=>v!=null)||(order.assignmentAttemptCounter??0)!==0||(order.holdAmount??0)!==0||![undefined,null,'NONE','NOT_REQUIRED'].includes(order.holdStatus))return finish('NEEDS_REVIEW','GOODS_OR_RESERVATION_UNCONFIRMED',[],c.guards);
  const transitionKey={orderId:order.orderId,SK:'DISPATCH_TRANSITION#'+job.dispatchTransition.id},transition=await strongGet(db,T.jobs,transitionKey);
  if(!transition||transition.action!=='REVIEW'||transition.state!=='APPLIED'||transition.cycleId!==cycle.id||transition.assignmentId!==job.dispatchJobId||transition.cycleDigest!==cycle.digest)return finish('NEEDS_REVIEW','SEARCH_REVIEW_PROOF_REQUIRED',[],c.guards);
  let cursor:Row|undefined;const holds:Row[]=[];const seen=new Set();
  for(let page=0;page<5;page++){const r=await db.send(new QueryCommand({TableName:T.holds,KeyConditionExpression:'orderId=:id',ExpressionAttributeValues:{':id':order.orderId},ConsistentRead:true,Limit:20,ExclusiveStartKey:cursor}));holds.push(...r.Items??[]);cursor=r.LastEvaluatedKey;if(!cursor)break;const s=quoteHash(cursor);if(seen.has(s))return fail('DISPATCH_REVIEW_HOLD_INVENTORY_INCOMPLETE');seen.add(s);}
  if(cursor)return fail('DISPATCH_REVIEW_HOLD_INVENTORY_INCOMPLETE');
  if(holds.length)return finish('NEEDS_REVIEW','ORDER_HAS_FINANCIAL_RECORDS',[],c.guards);
  const absent=['HOLD','PROMOTION_FUNDING','FINANCIAL_OUTCOME'].map(sk=>({ConditionCheck:{TableName:T.holds,Key:{orderId:order.orderId,sk},ConditionExpression:'attribute_not_exists(orderId)'}}));
  if(decision.action==='RETRY_SEARCH'){
   if(c.branch.status!=='approved'||c.branch.isActive!==true||c.branch.ordersBlocked===true||c.branch.platformSuspended===true)return finish('NEEDS_REVIEW','BRANCH_UNAVAILABLE_FOR_SEARCH',[],c.guards);
   // A late decline integration still needs the previous cycle. Do not orphan it.
   let responseCursor:Row|undefined;const responseGuards:Row[]=[];
   for(let page=0;page<5;page++){
    const r=await db.send(new QueryCommand({TableName:T.jobs,KeyConditionExpression:'orderId=:id AND begins_with(SK,:prefix)',ExpressionAttributeValues:{':id':order.orderId,':prefix':'DISPATCH_RESPONSE#'},ConsistentRead:true,Limit:20,ExclusiveStartKey:responseCursor}));
    for(const event of r.Items??[]){if(event.orderId!==order.orderId||event.kind!=='DISPATCH_RESPONSE_OUTBOX')return fail('DISPATCH_RESTART_RESPONSE_PROOF_REQUIRED');if(!['INTEGRATED','SUPPRESSED_DELETION'].includes(event.state))return finish('BLOCKED_DEPENDENCY','RESPONSE_INTEGRATION_PENDING',[],c.guards);responseGuards.push(exactCheck(T.jobs,{orderId:order.orderId,SK:event.SK},event));}
    responseCursor=r.LastEvaluatedKey;if(!responseCursor)break;
   }
   if(responseCursor)return fail('DISPATCH_RESTART_RESPONSE_INVENTORY_INCOMPLETE');
   // Freeze fresh central policy in the same transaction, never extend the old cycle.
   const policy=await readDeliveryOperations(db,{DELIVERY_OPERATIONS_MODE:'CENTRAL'});
   if(!policy.condition||!policy.values.dispatch)return fail('DISPATCH_POLICY_NOT_CONFIGURED');
   const token=quoteHash({caseId,requestId:decision.requestId}),newCycle=createDispatchCycle({id:'DC:'+token,assignmentId:'DISPATCH:'+token,orderId:order.orderId,engine:'LEGACY',startedAt:at,policy:{version:policy.version,values:policy.values},keyVersion:2});
   const restartId='DRS:'+token.slice(0,48),startKey={orderId:order.orderId,SK:'DISPATCH_RESTART#'+restartId};
   const start={...startKey,kind:'DISPATCH_RESTART_START',schemaVersion:1,state:'PENDING',version:1,attempts:0,nextAttemptAt:now(),restartId,caseId,requestId:decision.requestId,orderId:order.orderId,branchId:job.restaurantId,cycleId:newCycle.id,cycleDigest:newCycle.digest,assignmentId:newCycle.assignmentId,previousCycleId:cycle.id,createdAt:at,updatedAt:at};
   const history={orderId:order.orderId,SK:'DISPATCH_CYCLE_HISTORY#'+quoteHash(cycle.id),kind:'DISPATCH_CYCLE_HISTORY',schemaVersion:1,state:'ARCHIVED',cycleId:cycle.id,assignmentId:cycle.assignmentId,branchId:job.restaurantId,replacementCycleId:newCycle.id,cycleDigest:cycle.digest,policyVersion:cycle.policy.version,caseId,requestId:decision.requestId,createdAt:at,source:{dispatchCycle:cycle,dispatchJobId:job.dispatchJobId,currentWaveNumber:job.currentWaveNumber,dispatchTransition:job.dispatchTransition,dispatchReview:job.dispatchReview,status:job.status,maxWaves:job.maxWaves,expiresAt:job.expiresAt}};
   const jobWrite=set(exactCheck(T.jobs,jobKey,job),{status:'searching',dispatchJobId:newCycle.assignmentId,dispatchCycle:newCycle,currentWaveNumber:0,maxWaves:newCycle.policy.values.dispatch!.profiles.LEGACY.normalWaves.length,expiresAt:newCycle.searchDeadline,dispatchRestart:{restartId,caseId,previousCycleId:cycle.id},updatedAt:at});
   const removed=['dispatchTransition','dispatchReview','noDriverReason','dispatchReviewOutcome'].map((k,i)=>{jobWrite.Update.ExpressionAttributeNames['#restartRemove'+i]=k;return '#restartRemove'+i;});jobWrite.Update.UpdateExpression+=' REMOVE '+removed.join(',');
   if(!await identity())return finish('AUTHORIZATION_CHANGED','EMPLOYEE_AUTHORITY_CHANGED',[],c.guards);
   return finish('EXECUTED','SEARCH_RESTART_QUEUED',[jobWrite,set(exactCheck(T.orders,orderKey,order),{deliveryJobId:newCycle.assignmentId,updatedAt:at}),{Put:{TableName:T.jobs,Item:history,ConditionExpression:'attribute_not_exists(orderId)'}},{Put:{TableName:T.jobs,Item:start,ConditionExpression:'attribute_not_exists(orderId)'}}],[...c.guards,...absent,exactCheck(T.jobs,transitionKey,transition),policy.condition,...responseGuards],{receiptFields:{restartId,cycleId:newCycle.id,assignmentId:newCycle.assignmentId,startStatus:'PENDING'}});
  }
  const summary={caseId,requestId:decision.requestId,executionId,status:'EXECUTED',resultCode:'CANCELLED_WITHOUT_RESERVATION'};
  if(!await identity())return finish('AUTHORIZATION_CHANGED','EMPLOYEE_AUTHORITY_CHANGED',[],c.guards);
  return finish('EXECUTED','CANCELLED_WITHOUT_RESERVATION',[
   set(exactCheck(T.orders,orderKey,order),{status:'cancelled',orderStatus:'cancelled',cancelledAt:at,cancelledBy:decision.actorId,cancellationSource:'PLATFORM_STAFF_REVIEW',dispatchReviewOutcome:summary,updatedAt:at}),
   set(exactCheck(T.jobs,jobKey,job),{status:'cancelled',dispatchReviewOutcome:summary,updatedAt:at})
  ],[...c.guards,...absent,exactCheck(T.jobs,transitionKey,transition)]);
 }};
}
