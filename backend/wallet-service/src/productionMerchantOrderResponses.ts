import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { CognitoIdentityProviderClient, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { checkoutTables } from './checkoutTables';
import { createFinanceRollout } from './financeRollout';
import { strongGet, exactCheck, updateChecked, equal, FinancialRow as Row } from './driverFinancialTransaction';
import { createMerchantPendingResponse, MerchantResponseActor } from './merchantPendingResponse';
import { quoteHash } from './deliveryQuoteRecord';
import { composeDispatchTransaction } from './dispatchTransaction';

const { createAuthenticator } = require('../../../infrastructure/production/merchant-profile/authenticate.cjs');
const responsePath = '/merchant/order/{orderId}/{action}';
const listPath = '/merchant/orders/{businessId}';
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,150}$/.test(value);
const reply = (statusCode: number, data: Row) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  body: JSON.stringify(data),
});
const failure = (statusCode: number, code: string, message = 'تعذر تحديث الطلب.') =>
  reply(statusCode, { success: false, code, message });

type Database = Pick<DynamoDBDocumentClient, 'send'>;
type Identity = { sub: string };
type Tables = ReturnType<typeof checkoutTables>;
export type DeviceOrderPermission = 'orders.read' | 'orders.accept' | 'orders.reject' | 'orders.prepare' | 'orders.ready';
export type DeviceOrderAccess = {
  actor: MerchantResponseActor;
  deviceId: string;
  deviceVersion?: number;
  deviceExpiresAt?: number;
  receptionOnly: boolean;
  scopeHash: string;
  sessionId?: string;
  actorName?: string;
  roleName?: string;
  membershipVersion?: number;
  policyVersion?: number;
  permissions?: string[];
  expectedOrderRevision?: number | null;
};
type AuthorizeDevice = (event: Row, branchId: string, permission: DeviceOrderPermission) => Promise<DeviceOrderAccess>;

function deviceOrderCommit(db: Database, tables: Tables, verify: () => Promise<DeviceOrderAccess>, initial: DeviceOrderAccess,
  orderId: string, beforeStatus: string, status: string, now: () => number): Database {
  return {send: (async (command: any) => {
    if (!(command instanceof TransactWriteCommand)) return db.send(command);
    const access = await verify();
    if (access.scopeHash !== initial.scopeHash || !access.sessionId || access.receptionOnly) {
      throw Object.assign(Error('SESSION_REVOKED'), {status: 401});
    }
    const operations = command.input.TransactItems ?? [];
    const written = operations.find((item: Row) => item.Update?.TableName === tables.orders)?.Update;
    if (written?.Key?.PK !== 'ORDER#' + orderId || written.Key.SK !== 'META') throw Error('INVALID_DEVICE_ORDER_COMMIT');
    const at = new Date(now()).toISOString(), a = access.actor;
    const audited = [...operations, {Put: {TableName: tables.platform,
      Item: {
        pk: 'BRANCH#' + a.businessId, sk: 'STAFF_AUDIT#OPERATIONS#' + at + '#' + quoteHash(operations).slice(0, 32),
        ownerId: a.ownerId, businessId: a.businessId, actorId: a.subjectId, actorName: access.actorName,
        roleName: access.roleName, sessionId: access.sessionId, deviceId: access.deviceId,
        permissionVersion: access.membershipVersion, policyVersion: access.policyVersion, action: 'ORDER_STATUS_CHANGED',
        entityId: orderId, before: {status: beforeStatus}, after: {status}, result: 'SUCCEEDED', createdAt: at,
      },
      ConditionExpression: 'attribute_not_exists(sk)',
    }}];
    const scoped = composeDispatchTransaction(audited, a.guards, [tables.dispatchJobs]);
    return db.send(new TransactWriteCommand({TransactItems: scoped as any, ClientRequestToken: quoteHash(scoped).slice(0, 36)}));
  }) as Database['send']};
}

async function requireBranchOwner(db: Database, tables: Tables, identity: Identity, branchId: string) {
  const [branch, accountLock, branchLock] = await Promise.all([
    strongGet(db, tables.branches, { businessId: branchId }),
    strongGet(db, tables.deletion, { pk: 'ACCOUNT_LIFECYCLE#MERCHANT#' + identity.sub, sk: 'META' }),
    strongGet(db, tables.deletion, { pk: 'BUSINESS_LIFECYCLE#MERCHANT#' + branchId, sk: 'META' }),
  ]);
  if (!branch || branch.businessId !== branchId || branch.ownerId !== identity.sub ||
      branch.cognitoUserId !== identity.sub || branch.deletionRequestId || branch.isDeleted === true ||
      branch.deletedAt || accountLock || branchLock) {
    throw Object.assign(Error('ORDER_NOT_FOUND'), { status: 404 });
  }
  return { kind: 'MERCHANT' as const, subjectId: identity.sub, ownerId: identity.sub, businessId: branchId, guards: [] };
}

const preparationSteps = {
  preparing: { from: 'confirmed', timestamp: 'preparingAt', auditAction: 'MERCHANT_STARTED_PREPARATION' },
  ready_for_pickup: { from: 'preparing', timestamp: 'readyAt', auditAction: 'MERCHANT_MARKED_ORDER_READY' },
} as const;

async function advancePreparation(db: Database, tables: Tables, order: Row, ownerId: string, branchId: string,
  next: keyof typeof preparationSteps, now: () => number, actorId = ownerId, expectedRevision?: number | null) {
  const orderId = order.orderId;
  const step = preparationSteps[next];
  const ready = next === 'ready_for_pickup';
  const bucket = typeof order.storeStatus === 'string'
    ? /^(.+)#(confirmed|preparing)#(b[0-9])$/.exec(order.storeStatus) : null;
  if (expectedRevision !== undefined && (order.rev ?? null) !== expectedRevision) return failure(409,'ORDER_CHANGED');
  if (order.isDeleted===true || order.deletionRequestId!=null || order.deletedAt!=null ||
      order.cancellationRequestId!=null || order.cancellationStatus!=null || order.financialOutcome!=null ||
      order.assignedDriverId!=null || order.driverId!=null) return failure(409,'ORDER_CHANGED','تغيّرت حالة الطلب.');
  if (order.status === next && order.orderStatus === next) {
    return reply(200, { success: true, orderId, businessId: branchId, status: next, replayed: true });
  }
  if (order.status !== step.from || (order.orderStatus !== undefined && order.orderStatus !== step.from) ||
      bucket?.[1] !== branchId || bucket[2] !== step.from) {
    return failure(409, 'ORDER_CHANGED', 'تغيّرت حالة الطلب.');
  }
  const checked = ['orderId','businessId','storeId','status','orderStatus','storeStatus',
    'isDeleted','deletionRequestId','deletedAt','cancellationRequestId','cancellationStatus','financialOutcome','assignedDriverId','driverId'];
  if (expectedRevision !== undefined) checked.push('rev');
  if (ready) {
    const searchGuards = ['deliveryJobId','deletionStatus','returnCaseId','returnStatus','holdId',
      'walletPendingHoldId','financialAcceptance','financialRelease'];
    if (searchGuards.some(field => order[field] != null) || (order.assignmentAttemptCounter ?? 0) !== 0 ||
        order.financialSnapshot?.schemaVersion !== 3 ||
        order.financialSnapshot.settlementModel !== 'FULL_CASH_AT_DELIVERY_V1' ||
        order.financeRollout?.scopeId !== 'GENERAL_PRODUCTION_FULL_CASH_V1' ||
        order.financeRollout.schemaVersion !== 2) {
      return failure(409, 'DISPATCH_ORDER_UNAVAILABLE', 'الطلب غير مؤهل لبدء البحث عن سائق.');
    }
    checked.push(...searchGuards, 'assignmentAttemptCounter', 'financialSnapshot', 'financeRollout');
  }
  const at = new Date(now()).toISOString(), key = { PK: 'ORDER#' + orderId, SK: 'META' };
  const operation = 'MP:' + quoteHash(ready ? { orderId, branchId, ownerId, next } : { orderId, branchId, ownerId }).slice(0, 48);
  const transact = [
    updateChecked(exactCheck(tables.orders, key, order, checked),
      'SET #status=:next, #orderStatus=:next, #storeStatus=:bucket, #updatedAt=:at, #stepAt=:at',
      { '#status':'status', '#orderStatus':'orderStatus', '#storeStatus':'storeStatus', '#updatedAt':'updatedAt', '#stepAt':step.timestamp },
      { ':next':next, ':bucket':branchId+'#'+next+'#'+bucket[3], ':at':at }),
    {ConditionCheck:{TableName:tables.branches,Key:{businessId:branchId},
      ConditionExpression:'ownerId=:owner AND cognitoUserId=:owner AND isActive=:active AND '+(ready?'#status=:approved':'#status IN (:approved,:enabled)')+' AND attribute_not_exists(deletionRequestId) AND attribute_not_exists(orderIntakeDeletionRequestId) AND attribute_not_exists(deletedAt) AND (attribute_not_exists(isDeleted) OR isDeleted=:no)',
      ExpressionAttributeNames:{'#status':'status'},
      ExpressionAttributeValues:{':owner':ownerId,':active':true,':approved':'approved',':no':false,...(ready?{}:{':enabled':'active'})}}},
    ...['ACCOUNT_LIFECYCLE#MERCHANT#'+ownerId,'BUSINESS_LIFECYCLE#MERCHANT#'+branchId].map(pk=>({
      ConditionCheck:{TableName:tables.deletion,Key:{pk,sk:'META'},ConditionExpression:'attribute_not_exists(pk)'},
    })),
    {Put:{TableName:tables.audit,Item:{datePartition:'date#'+at.slice(0,10).replace(/-/g,''),
      sk:at+'#'+operation,logId:operation,action:step.auditAction,
      actorId,actorKind:'MERCHANT',businessId:branchId,orderId,createdAt:at},
      ConditionExpression:'attribute_not_exists(sk)'}},
  ];
  await db.send(new TransactWriteCommand({TransactItems:transact as any,ClientRequestToken:quoteHash(transact).slice(0,36)}));
  return reply(200,{success:true,orderId,businessId:branchId,status:next,replayed:false});
}

const inactive = ['expired','cancelled','canceled_by_user','canceled_by_store','canceled_by_system','rejected'];
const finished = ['delivered','completed','returned'];
const listFields = [
  'orderId','orderNumber','businessId','storeId','userId','customerId','customerName','customerPhone','customerAddress',
  'deliveryAddress','deliveryInstructions','items','pricing','totalAmount','deliveryFee','status','paymentMethod','createdAt',
  'updatedAt','estimatedReadyAt','estimatedPreparationTime','merchantAcceptanceDeadlineAt','notes','cancelReason',
  'driverId','driverName','driverPhone','driverAssignedAt','vehicleType','vehiclePlate',
  'driverReplacementSearch','driverSearchUnavailable',
];
const deviceListFields = [
  'orderId','orderNumber','businessId','storeId','status','createdAt','merchantAcceptanceDeadlineAt','items','totalAmount',
  'deliveryFee','paymentMethod','estimatedPreparationTime','estimatedReadyAt','notes','deliveryInstructions','driverName','driverPhone',
];
const receptionFields = ['orderId','status','createdAt'];

async function listOrders(db: Database, tables: Tables, branchId: string, status?: string, device?: DeviceOrderAccess) {
  const results: Row[] = [];
  let cursor: Row | undefined;
  for (let page = 0; page < 10 && results.length < 100; page++) {
    const response = await db.send(new QueryCommand({
      TableName: tables.orders, IndexName: 'GSI_BusinessId', ScanIndexForward: false, Limit: 100,
      KeyConditionExpression: 'businessId=:branch',
      ExpressionAttributeValues: { ':branch': branchId }, ExclusiveStartKey: cursor,
    }));
    for (const order of response.Items ?? []) {
      if (!id(order.orderId) || order.PK !== 'ORDER#' + order.orderId || order.SK !== 'META' || order.businessId !== branchId ||
          (order.storeId != null && order.storeId !== branchId) || order.isDeleted || order.deletedAt || order.deletionRequestId) continue;
      if (status === undefined ? inactive.includes(order.status)
        : inactive.includes(status) ? !inactive.includes(order.status)
        : finished.includes(status) ? !finished.includes(order.status)
        : order.status !== status) continue;
      const fields = device ? device.receptionOnly ? receptionFields : deviceListFields : listFields;
      const view = Object.fromEntries(fields.filter(key => order[key] !== undefined).map(key => [key,order[key]]));
      if (inactive.includes(order.status) && !['expired','rejected'].includes(order.status)) view.status='cancelled';
      if (order.status==='completed') view.status='delivered';
      if (!device && order.merchantHandover) view.merchantHandover={state:order.merchantHandover.state};
      if (!device && typeof order.exceptionPolicy?.version === 'string') {
        view.exceptionPolicyVersion = order.exceptionPolicy.version;
      }
      const cancellation = order.exceptionCancellation;
      if (!device && cancellation && ['REQUESTED','CANCELLED','DECLINED'].includes(cancellation.state)) {
        view.exceptionCancellation = { state: cancellation.state, caseId: cancellation.caseId };
      }
      if (!device) {
        const offerId=order.financialAcceptance?.offerId;
        const attempt=order.assignmentAttemptCounter;
        if (id(offerId) && Number.isSafeInteger(attempt) && attempt>0 && attempt<=1000) {
          view.financialAssignment={
            offerId, attempt, ...(id(order.returnCaseId)?{returnId:order.returnCaseId}:{}),
          };
        } else if (order.financialAssignment) {
          view.financialAssignment={
            attempt:order.financialAssignment.attempt, returnId:order.financialAssignment.returnId,
          };
        }
      }
      results.push(view);
      if (results.length===100) break;
    }
    cursor = response.LastEvaluatedKey;
    if (!cursor) break;
  }
  return results;
}

export function createProductionMerchantOrderResponses(options: {
  db: Database;
  authenticate?: (event: Row) => Promise<Identity>;
  authorizeDevice?: AuthorizeDevice;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
}) {
  const { db, authenticate, authorizeDevice, env = process.env, now } = options;
  if (Boolean(authenticate) === Boolean(authorizeDevice)) throw Error('MERCHANT_ORDER_AUTHORITY_REQUIRED');
  const prefix = authorizeDevice ? '/branch-device' : '';
  return async (event: Row) => {
    const list = event?.resource === prefix + listPath && event.httpMethod === 'GET';
    const respond = event?.resource === prefix + responsePath && event.httpMethod === 'PUT';
    if (event?.requestContext?.stage !== 'production' || (!list && !respond)) {
      return failure(404, 'NOT_FOUND');
    }
    if (env.ENVIRONMENT !== 'production' || env.STAGE !== 'production' || env.AWS_REGION !== 'us-east-1' ||
        env.FINANCIAL_COD_ACCOUNT_ID !== '746727375268' || env.MERCHANT_RESPONSE_MODE !== 'REQUIRED') {
      return failure(503, 'MERCHANT_RESPONSE_UNAVAILABLE');
    }

    if (list) {
      const branchId = event.pathParameters?.businessId;
      const status = event.queryStringParameters?.status;
      if (!id(branchId) || (status !== undefined && !id(status))) return failure(400,'INVALID_ORDER_LIST');
      try {
        const tables = checkoutTables(env);
        const check = async () => {
          if (authorizeDevice) return authorizeDevice(event, branchId, 'orders.read');
          await requireBranchOwner(db,tables,await authenticate!(event),branchId);
          return undefined;
        };
        const device = await check();
        const orders = await listOrders(db,tables,branchId,device?.receptionOnly ? 'pending' : status,device);
        const after = await check();
        if (device && after?.scopeHash !== device.scopeHash) return failure(401,'SESSION_REVOKED');
        return reply(200,{success:true,orders,count:orders.length});
      } catch (error: any) {
        if (error.status === 401) return failure(401,authorizeDevice ? error.message : 'UNAUTHORIZED','يرجى تسجيل الدخول.');
        if (error.status === 403) return failure(403,error.message);
        if (error.status === 404) return failure(404,'BRANCH_NOT_FOUND');
        return failure(503,'ORDER_LIST_UNAVAILABLE','تعذر عرض طلبات الفرع.');
      }
    }

    const { orderId, action } = event.pathParameters ?? {};
    if (!id(orderId) || !['confirm', 'reject', 'status'].includes(action) || event.isBase64Encoded ||
        typeof event.body !== 'string' || Buffer.byteLength(event.body) > 4096) {
      return failure(400, 'INVALID_MERCHANT_RESPONSE');
    }
    let input: Row;
    try { input = JSON.parse(event.body); }
    catch { return failure(400, 'INVALID_MERCHANT_RESPONSE'); }
    const fields = ['businessId', action === 'confirm' ? 'estimatedPreparationTime' : action === 'reject' ? 'reason' : 'status'];
    if (!input || typeof input !== 'object' || Array.isArray(input) ||
        Object.keys(input).some(key => !fields.includes(key)) || (input.businessId !== undefined && !id(input.businessId))) {
      return failure(400, 'INVALID_MERCHANT_RESPONSE');
    }

    try {
      const tables = checkoutTables(env);
      const next = authorizeDevice && input.status === 'ready' ? 'ready_for_pickup' : input.status;
      if (authorizeDevice && action === 'status' && next !== 'preparing' && next !== 'ready_for_pickup') {
        return failure(400, 'INVALID_ORDER_TRANSITION', 'تعذر تحديث الطلب إلى هذه الحالة.');
      }
      const permission = action === 'confirm' ? 'orders.accept' : action === 'reject' ? 'orders.reject'
        : next === 'preparing' ? 'orders.prepare' : 'orders.ready';
      if (authorizeDevice && !id(input.businessId)) return failure(400, 'INVALID_MERCHANT_RESPONSE');
      const verify = () => authorizeDevice!(event, input.businessId, permission);
      const device = authorizeDevice ? await verify() : undefined;
      const actor = device ? undefined : await authenticate!(event);
      const order = await strongGet(db, tables.orders, { PK: 'ORDER#' + orderId, SK: 'META' });
      const branchId = order?.storeId;
      if (!id(branchId) || order?.orderId !== orderId ||
          (order?.businessId != null && order.businessId !== branchId) ||
          (input.businessId !== undefined && input.businessId !== branchId)) {
        return failure(404, 'ORDER_NOT_FOUND');
      }
      const verified = device ? {...device.actor, guards: []} : await requireBranchOwner(db,tables,actor!,branchId);
      const status = action === 'confirm' ? 'confirmed' : action === 'reject' ? 'cancelled' : next;
      const commitDb = device ? deviceOrderCommit(db, tables, verify, device, orderId, order.status, status, now ?? Date.now) : db;
      if (action==='status') {
        if (next !== 'preparing' && next !== 'ready_for_pickup') {
          return failure(400, 'INVALID_ORDER_TRANSITION', 'تعذر تحديث الطلب إلى هذه الحالة.');
        }
        return await advancePreparation(commitDb, tables, order, verified.ownerId, branchId, next, now ?? Date.now, verified.subjectId, device?.expectedOrderRevision);
      }
      let writeDb = commitDb;
      if (order.financialSnapshot || order.commercialPricing) {
        const rollout = createFinanceRollout({ db: commitDb, env, now, merchantResponse: true });
        if (!rollout.containsOrder(orderId, order)) return failure(409, 'FINANCE_ROLLOUT_OUT_OF_SCOPE');
        writeDb = rollout.db;
      }
      let first = true;
      const engine = createMerchantPendingResponse({
        db: writeDb, now, env,
        enableDeliveryFunding: env.FINANCIAL_DELIVERY_FUNDING_MODE === 'REQUIRED',
        enableFullCash: env.FINANCIAL_SETTLEMENT_MODEL === 'FULL_CASH_AT_DELIVERY_V1',
        authenticate: async () => {
          if (!first) {
            if (!device) return requireBranchOwner(db,tables,await authenticate!(event),branchId);
            const latest = await verify();
            if (latest.scopeHash !== device.scopeHash || !equal({...latest.actor, guards: []}, verified)) {
              throw Object.assign(Error('SESSION_REVOKED'), {status: 401});
            }
          }
          first = false;
          return verified;
        },
      });
      const result = action === 'confirm'
        ? await engine.accept(orderId, input.estimatedPreparationTime ?? 20)
        : await engine.run(orderId, 'REJECT', input.reason);
      return reply(200, { success: true, orderId, businessId: branchId, ...result });
    } catch (error: any) {
      if (error.status === 401) return failure(401, authorizeDevice ? error.message : 'UNAUTHORIZED', 'يرجى تسجيل الدخول.');
      if (error.status === 403) return failure(403, error.message);
      if (error.status === 404) return failure(404, 'ORDER_NOT_FOUND');
      if (['INVALID_PREPARATION_TIME', 'INVALID_MERCHANT_RESPONSE'].includes(error.code)) {
        return failure(400, error.code, 'تحقّق من بيانات الطلب ثم أعد المحاولة.');
      }
      if (error.code === 'MERCHANT_RESPONSE_EXPIRED') return failure(409, error.code, 'انتهت مهلة قبول الطلب.');
      if (error.name === 'TransactionCanceledException' || [
        'ORDER_ALREADY_HANDLED', 'MERCHANT_RESPONSE_UNAVAILABLE', 'MERCHANT_RESPONSE_FINANCIAL_REVIEW_REQUIRED',
        'MERCHANT_RESPONSE_POLICY_REQUIRED', 'MERCHANT_RESPONSE_UNAUTHORIZED',
      ].includes(error.code)) return failure(409, error.code || 'ORDER_CHANGED', 'تغيّرت حالة الطلب. حدّث القائمة وأعد المحاولة.');
      return failure(503, 'MERCHANT_RESPONSE_UNAVAILABLE', 'تعذر الاتصال بخدمة الطلبات. أعد المحاولة.');
    }
  };
}

export const handler = createProductionMerchantOrderResponses({
  db: DynamoDBDocumentClient.from(new DynamoDBClient({ maxAttempts: 2 }), { marshallOptions: { removeUndefinedValues: true } }),
  authenticate: createAuthenticator({ cognito: new CognitoIdentityProviderClient({ maxAttempts: 2 }), AdminGetUserCommand }),
});
