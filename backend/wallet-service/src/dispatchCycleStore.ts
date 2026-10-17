import {DynamoDBDocumentClient,TransactWriteCommand} from '@aws-sdk/lib-dynamodb';
import {readDeliveryOperations} from './deliveryOperations';
import {createDispatchCycle,validateDispatchCycle} from './dispatchCycle';
import {createStagingDriverOfferOrderReader,prepareDriverOfferFinancialSnapshot} from './driverOfferOrderReader';
import {strongGet,exactCheck,updateChecked,detach,equal,FinancialRow as Row} from './driverFinancialTransaction';
import {quoteHash,quoteEntityIdValid} from './deliveryQuoteRecord';
const {isFinancialOrder,FINANCIAL_FIELDS}=require('../../order-service/legacy-order-policy');
const T={jobs:'WizzDispatchJobs_staging',orders:'WizzOrders',branches:'WhizzMerchants_Businesses',deletions:'staging-AccountDeletion'};
const fail=(code='DISPATCH_CYCLE_CONFLICT'):never=>{throw Object.assign(Error(code),{code});};
/** Server-only creation primitive for the existing Creator, not a new trigger.
 * No live entry point calls it until Creator's old Put/Update/Invoke are replaced
 * together. Existing jobs are never migrated. No wallet, ledger or offer writes.
 */
export function createStagingDispatchCycleStore(options:{db:Pick<DynamoDBDocumentClient,'send'>;now?:()=>number}) {
  const {db}=options,now=options.now??Date.now;
  return {async create(input:{requestId:string;job:Row}) {
    if(!input||Object.keys(input).sort().join(',')!=='job,requestId'||!quoteEntityIdValid(input.requestId)||!input.job||typeof input.job!=='object'||Array.isArray(input.job))return fail();
    const job=detach(input.job),orderId=job.orderId;
    if(![orderId,job.dispatchJobId,job.restaurantId].every(quoteEntityIdValid)||job.SK!=='METADATA'||job.status!=='searching'||job.currentWaveNumber!==0||job.assignedDriverId!=null||job.driverId!=null||job.dispatchCycle!==undefined||job.dispatchCreation!==undefined)return fail();
    const digest=quoteHash(input),key={orderId,SK:'METADATA'};
    function replay(saved:Row|null) {
      if(!saved)return null;
      if(saved.dispatchCreation?.requestId!==input.requestId||saved.dispatchCreation?.digest!==digest)return fail();
      const cycle=validateDispatchCycle(saved.dispatchCycle);
      if(cycle.orderId!==orderId||cycle.assignmentId!==job.dispatchJobId||cycle.id!==input.requestId||saved.dispatchCreation.receipt?.cycleId!==cycle.id||saved.dispatchCreation.receipt?.policyVersion!==cycle.policy.version)return fail();
      return {...saved.dispatchCreation.receipt,replayed:true};
    }
    const prior=replay(await strongGet(db,T.jobs,key));if(prior)return prior;
    const orderKey={PK:'ORDER#'+orderId,SK:'META'},order=await strongGet(db,T.orders,orderKey);
    if(!order||order.orderId!==orderId||order.PK!==orderKey.PK||order.SK!=='META'||![order.status,order.orderStatus].some(s=>s==='ready_for_pickup')||[order.status,order.orderStatus].some(s=>s!==undefined&&s!=='ready_for_pickup')||
      [order.driverId,order.assignedDriverId,order.holdId,order.walletPendingHoldId,order.financialAcceptance,order.financialOutcome,order.returnCaseId,order.returnStatus,order.cancellationRequestId,order.cancellationStatus,order.deletionRequestId,order.deletionStatus,order.deletedAt].some(v=>v!=null)||order.isDeleted===true||order.deliveryJobId!=null||['ACTIVE','SETTLED','CAPTURED'].includes(order.holdStatus)||
      ![order.storeId,order.businessId].some(v=>v===job.restaurantId)||[order.storeId,order.businessId].some(v=>v!==undefined&&v!==job.restaurantId))return fail();
    const engine=isFinancialOrder(order)?'FINANCIAL':'LEGACY';
    if(engine==='FINANCIAL') {
      // Reuse the authoritative snapshot reader; malformed/archived evidence must
      // not downgrade to legacy or be repriced by this creation primitive.
      const financial=await createStagingDriverOfferOrderReader({db}).read({orderId,branchId:job.restaurantId});
      if(financial.nextAssignmentAttempt!==1||financial.priorRelease||(order.assignmentAttemptCounter??0)!==0||order.financialRelease!=null||!equal(order.financialSnapshot,prepareDriverOfferFinancialSnapshot(financial.snapshot)))return fail();
    }
    const branchKey={businessId:job.restaurantId},branch=await strongGet(db,T.branches,branchKey);
    if(!branch||branch.status!=='approved'||!quoteEntityIdValid(branch.ownerId)||branch.deletionRequestId!=null||branch.deletedAt!=null||branch.isDeleted===true)return fail();
    const operating=await readDeliveryOperations(db,{DELIVERY_OPERATIONS_MODE:'CENTRAL'});
    if(!operating.values.dispatch||!operating.condition)return fail('DISPATCH_POLICY_NOT_CONFIGURED');
    const startedAt=new Date(now()).toISOString();
    const cycle=createDispatchCycle({id:input.requestId,orderId,assignmentId:job.dispatchJobId,engine,startedAt,policy:{version:operating.version,values:operating.values}});
    const profile=cycle.policy.values.dispatch!.profiles[engine];
    const receipt={created:true,orderId,dispatchJobId:job.dispatchJobId,cycleId:cycle.id,policyVersion:cycle.policy.version,searchDeadline:cycle.searchDeadline,replayed:false};
    const item={...job,financialDispatch:engine==='FINANCIAL',maxWaves:profile.normalWaves.length,createdAt:startedAt,updatedAt:startedAt,expiresAt:cycle.searchDeadline,
      dispatchCycle:cycle,dispatchCreation:{requestId:input.requestId,digest,receipt}};
    const fields=[...new Set([...Object.keys(order),...FINANCIAL_FIELDS,'driverId','assignedDriverId','holdId','walletPendingHoldId','financialAcceptance','financialOutcome','returnStatus','returnCaseId','cancellationStatus','cancellationRequestId','deletionRequestId','deletionStatus','deletedAt','isDeleted','deliveryJobId'])];
    const tx=[{Put:{TableName:T.jobs,Item:item,ConditionExpression:'attribute_not_exists(orderId)'}},
      updateChecked(exactCheck(T.orders,orderKey,order,fields),'SET #job=:job',{'#job':'deliveryJobId'},{':job':job.dispatchJobId}),
      exactCheck(T.branches,branchKey,branch,[...new Set([...Object.keys(branch),'ownerId','deletionRequestId','deletedAt','isDeleted'])]),operating.condition,
      ...['BUSINESS_LIFECYCLE#MERCHANT#'+job.restaurantId,'ACCOUNT_LIFECYCLE#MERCHANT#'+branch.ownerId].map(pk=>({ConditionCheck:{TableName:T.deletions,Key:{pk,sk:'META'},ConditionExpression:'attribute_not_exists(pk)'}}))];
    if(Buffer.byteLength(JSON.stringify(tx))>3500000)return fail();
    try {await db.send(new TransactWriteCommand({TransactItems:tx as any,ClientRequestToken:quoteHash(tx).slice(0,36)}));}
    catch {const committed=replay(await strongGet(db,T.jobs,key));if(committed)return committed;return fail('DISPATCH_CYCLE_UNAVAILABLE');}
    return receipt;
  }};
}
