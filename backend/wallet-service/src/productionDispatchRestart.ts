import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { createExceptionStaffAuthority } from './exceptionStaffAuthority';
import { createFinanceRollout } from './financeRollout';
import { composeDispatchTransaction } from './dispatchTransaction';
import { planInitialFinancialRetry } from './dispatchFinancialRetry';
import { quoteEntityIdValid, quoteHash } from './deliveryQuoteRecord';
import { strongGet, FinancialRow as Row } from './driverFinancialTransaction';
import { financialDispatchTables } from './walletBindings';

const { createReviewReader } = require('../../staff-service/dispatch-reviews');
const { decisionFollowup } = require('../../staff-service/dispatch-followup');
const { allowed } = require('../../staff-service/catalog');

const hash = /^[a-f0-9]{64}$/;
const requestUuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const fail = (code:string, status = 409):never => { throw Object.assign(Error(code), { status, code }); };
const sameKeys = (value:unknown, keys:string) =>
  value !== null && typeof value === 'object' && Object.keys(value).sort().join(',') === keys;

function restriction(order:Row) {
  if (order.pickupAt != null || order.pickedUpAt != null || order.merchantHandover?.state === 'HANDED_TO_DRIVER' ||
      order.returnCaseId != null || order.returnStatus != null) return 'GOODS_ALREADY_HANDED_OVER';
  if (order.cashCollected === true || Number(order.cashCollectedAmount ?? 0) !== 0 || order.openPaymentClaimId != null ||
      order.cashReviewVerifiedCollection != null || order.cashReturnClearance != null) return 'ORDER_CASH_REVIEW_REQUIRED';
  if (order.cancellationRequestId != null || order.cancellationStatus != null || order.exceptionCancellation?.state === 'REQUESTED')
    return 'ORDER_CANCELLATION_PENDING';
  if (order.status !== 'ready_for_pickup' || order.financialSnapshot?.schemaVersion !== 3)
    return 'RESTART_ORDER_NOT_ELIGIBLE';
  return null;
}

type Authority = ReturnType<typeof createExceptionStaffAuthority>;
type Rollout = ReturnType<typeof createFinanceRollout>;
type DB = Pick<DynamoDBDocumentClient,'send'>;

export function createProductionDispatchRestart({db, authority, rollout, now=Date.now}: {
  db:DB; authority:Authority; rollout:Pick<Rollout,'order'>; now?:()=>number;
}) {
  const tables = financialDispatchTables();
  return async (input:Row) => {
    const read = input?.action === 'READ';
    const write = input?.action === 'RETRY_SEARCH';
    if ((!read && !write) || !quoteEntityIdValid(input.orderId) ||
        !sameKeys(input,read?'action,orderId':'action,baseDigest,caseId,orderId,reason,requestId'))
      return fail('INVALID_RESTART_REQUEST',400);
    if (write && (!hash.test(input.caseId) || !hash.test(input.baseDigest) || !requestUuid.test(input.requestId) ||
        typeof input.reason !== 'string' || input.reason !== input.reason.trim() ||
        input.reason.length < 5 || input.reason.length > 500)) return fail('INVALID_RESTART_REQUEST',400);

    const actor = await authority.authenticate();
    const access = await authority.read(actor);
    if (!allowed(access.employee,'orders.read')) return fail('PERMISSION_REQUIRED',403);
    if (write) await authority.assign(actor);
    await rollout.order(input.orderId,'DRAIN');

    const orderId = input.orderId;
    const orderKey = { PK:'ORDER#'+orderId, SK:'META' };
    const jobKey = { orderId, SK:'METADATA' };
    const decisionKey = (caseId:string) => ({ pk:'DISPATCH_REVIEW#'+caseId, sk:'DECISION' });
    const requestDigest = quoteHash(input);

    async function replay() {
      const saved = await strongGet(db,tables.staff,decisionKey(input.caseId));
      if (!saved) return null;
      if (saved.kind !== 'DISPATCH_REVIEW_DECISION' || saved.orderId !== orderId ||
          saved.caseId !== input.caseId || saved.status !== 'EXECUTED' || saved.resultCode !== 'SEARCH_RESTART_QUEUED' ||
          saved.requestId !== input.requestId || saved.actorId !== actor.subjectId || saved.requestDigest !== requestDigest)
        return fail('RESTART_ALREADY_DECIDED');
      await authority.assign(await authority.authenticate());
      return { success:true, orderId, replayed:true, state:'QUEUED' };
    }
    if (write) {
      const existing=await replay();
      if (existing) return existing;
    }

    const [order,job]=await Promise.all([strongGet(db,tables.orders,orderKey),strongGet(db,tables.jobs,jobKey)]);
    if (!order || order.orderId!==orderId || order.deletedAt!=null || order.deletionStatus!=null ||
        order.deletionRequestId!=null || order.isDeleted===true) return fail('ORDER_NOT_FOUND',404);
    async function previousState() {
      const restartId=job?.dispatchRestart?.restartId;
      if (!/^DRS:[a-f0-9]{48}$/.test(restartId ?? '')) return null;
      const start=await strongGet(db,tables.jobs,{orderId,SK:'DISPATCH_RESTART#'+restartId});
      if (!start || start.kind!=='DISPATCH_RESTART_START' || start.restartId!==restartId ||
          start.orderId!==orderId || start.assignmentId!==job?.dispatchJobId) return null;
      return ['STARTED','NEEDS_REVIEW','STALE','SUPPRESSED_DELETION'].includes(start.state)
        ? start.state : ['PENDING','STARTING'].includes(start.state) ? 'QUEUED' : null;
    }
    const reader=createReviewReader({db,table:tables.staff,orderTables:tables},access.employee);
    const candidate=job?.financialDispatch===true && job.status==='no_driver_available' &&
      job.dispatchReview?.reviewStatus==='REQUIRED' && job.dispatchCycle?.engine==='FINANCIAL';
    if (!candidate) {
      if (write) {
        const repeated=await replay();
        if (repeated) return repeated;
        return fail('RESTART_SEARCH_NOT_EXHAUSTED');
      }
      return {item:{orderId,canRestart:false,blocker:'RESTART_SEARCH_NOT_EXHAUSTED',state:await previousState()}};
    }
    const c=await reader.load({orderId,source:'SEARCH'});
    const blocker=restriction(order) ?? (!allowed(access.employee,'orders.assign') ? 'PERMISSION_REQUIRED' :
      !c.item.canRequestRetry ? (c.item.pendingAcceptance || c.hold?.status==='ACTIVE' ? 'RESTART_RESERVATION_PENDING' :
        c.branch.status!=='approved'||c.branch.isActive!==true||c.branch.ordersBlocked===true||c.branch.platformSuspended===true
          ? 'BRANCH_UNAVAILABLE_FOR_SEARCH' : 'RESTART_ORDER_NOT_ELIGIBLE') : null);
    if (blocker) {
      if (write) {
        const repeated=await replay();
        if (repeated) return repeated;
        return fail(blocker);
      }
      return {item:{orderId,canRestart:false,blocker,state:await previousState()}};
    }
    if (write && (c.item.caseId!==input.caseId || c.baseDigest!==input.baseDigest)) {
      const repeated=await replay();
      if (repeated) return repeated;
      return fail('RESTART_EVIDENCE_CHANGED');
    }
    const time=new Date(now()).toISOString();
    const selector={orderId,source:'SEARCH'};
    const record={...c.decisionKey,kind:'DISPATCH_REVIEW_DECISION',schemaVersion:1,action:'RETRY_SEARCH',selector,
      caseId:c.item.caseId,baseDigest:c.baseDigest,orderId,branchId:c.item.branchId,regionId:c.item.regionId,
      actorId:actor.subjectId,actorVersion:access.employee.version,requestId:input.requestId,
      reason:input.reason,requestDigest,createdAt:time,status:'EXECUTED'};
    const plan=await planInitialFinancialRetry({db,order,job,context:c,decision:record,at:time,
      allowPriorOffers:true,enableFullCash:true});
    if (!plan.ready) {
      if (write) return fail(plan.resultCode);
      return {item:{orderId,canRestart:false,blocker:plan.resultCode,state:await previousState()}};
    }
    if (read) {
      const final=await authority.read(await authority.authenticate());
      if (final.employee.version!==access.employee.version || !allowed(final.employee,'orders.assign'))
        return fail('PERMISSION_REQUIRED',403);
      return {item:{orderId,canRestart:true,caseId:c.item.caseId,baseDigest:c.baseDigest,state:await previousState()}};
    }

    const executionId='DRE:'+quoteHash({caseId:record.caseId,requestId:record.requestId}).slice(0,48);
    const receipt={...plan.receiptFields,caseId:record.caseId,requestId:record.requestId,
      executionId,resultCode:plan.resultCode,holdReleased:false,status:'EXECUTED',executed:true};
    const audit={pk:'AUDIT',sk:executionId,kind:'DISPATCH_REVIEW_AUDIT',action:'DISPATCH_REVIEW_DECISION_EXECUTED',
      actorId:actor.subjectId,orderId,caseId:record.caseId,requestId:record.requestId,resultCode:plan.resultCode,createdAt:time};
    const liveActor=await authority.authenticate();
    if (liveActor.subjectId!==actor.subjectId) return fail('UNAUTHORIZED',401);
    const live=await authority.read(liveActor);
    if (live.employee.version!==access.employee.version || !allowed(live.employee,'orders.assign'))
      return fail('PERMISSION_REQUIRED',403);
    const absence=['CUSTOMER_CANCELLATION','MERCHANT_CANCELLATION','FINANCIAL_OUTCOME'].map(sk=>({
      ConditionCheck:{TableName:tables.holds,Key:{orderId,sk},ConditionExpression:'attribute_not_exists(orderId)'},
    }));
    const followup=await decisionFollowup({db,table:tables.staff,now},access.employee,c);
    const tx=composeDispatchTransaction([
      ...plan.writes,...followup.filter((op:Row)=>op.Put),
      ...[{...record,executedAt:time,executionId,resultCode:plan.resultCode,receipt},audit].map(Item=>({
        Put:{TableName:tables.staff,Item,ConditionExpression:'attribute_not_exists(pk)'},
      })),
    ],[live.guard,...c.guards,...plan.guards,...absence,...followup.filter((op:Row)=>op.ConditionCheck)],[tables.jobs,tables.offers]);
    try {
      await db.send(new TransactWriteCommand({TransactItems:tx as any,ClientRequestToken:quoteHash(tx).slice(0,36)}));
    } catch (error:any) {
      const repeated=await replay();
      if (repeated) return repeated;
      if (error.name==='TransactionCanceledException') return fail('RESTART_EVIDENCE_CHANGED');
      throw error;
    }
    return { success:true,orderId,replayed:false,state:'QUEUED' };
  };
}

export async function handler(event:Row) {
  const env=process.env;
  if (env.STAGE!=='production' || env.AWS_REGION!=='us-east-1' || env.FINANCIAL_COD_ACCOUNT_ID!=='746727375268' ||
      env.FINANCE_GENERAL_RELEASE_MODE!=='REQUIRED' || env.FINANCIAL_DELIVERY_FUNDING_MODE!=='REQUIRED' || env.FINANCIAL_SETTLEMENT_MODEL!=='FULL_CASH_AT_DELIVERY_V1' ||
      env.DELIVERY_OPERATIONS_MODE!=='CENTRAL') return {statusCode:503,code:'DISPATCH_RESTART_UNAVAILABLE'};
  if (!sameKeys(event,'accessToken,body') || typeof event.accessToken!=='string')
    return {statusCode:401,code:'UNAUTHORIZED'};
  try {
    const raw=DynamoDBDocumentClient.from(new DynamoDBClient({maxAttempts:2}),{marshallOptions:{removeUndefinedValues:true}});
    const rollout=createFinanceRollout({db:raw,dispatch:true});
    const authority=createExceptionStaffAuthority({db:rollout.db,cognito:new CognitoIdentityProviderClient({maxAttempts:2}),accessToken:event.accessToken});
    const run=createProductionDispatchRestart({db:rollout.db,authority,rollout});
    return {statusCode:200,result:await run(event.body)};
  } catch(error:any) {
    if (error.code==='UNAUTHORIZED' || ['NotAuthorizedException','UserNotFoundException'].includes(error.name))
      return {statusCode:401,code:'UNAUTHORIZED'};
    if (error.status===403 || ['EXCEPTION_PERMISSION_REQUIRED','EXCEPTION_EMPLOYEE_UNAVAILABLE'].includes(error.code))
      return {statusCode:403,code:'PERMISSION_REQUIRED'};
    if (error.code==='FINANCE_ROLLOUT_OUT_OF_SCOPE' || error.message==='REVIEW_UNAVAILABLE')
      return {statusCode:404,code:'ORDER_NOT_FOUND'};
    if ([400,404,409].includes(error.status)) return {statusCode:error.status,code:error.code};
    if (['FULL_CASH_BUDGET_COMMITMENT_REQUIRED','FINANCIAL_RETRY_INVENTORY_INCOMPLETE'].includes(error.message))
      return {statusCode:409,code:error.message};
    if (error.message==='DELIVERY_OPERATIONS_UNAVAILABLE') return {statusCode:503,code:error.message};
    return {statusCode:503,code:'DISPATCH_RESTART_UNAVAILABLE'};
  }
}
