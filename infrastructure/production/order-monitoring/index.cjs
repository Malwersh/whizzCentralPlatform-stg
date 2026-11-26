'use strict';

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { CognitoIdentityProviderClient } = require('@aws-sdk/client-cognito-identity-provider');
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
const { createExceptionStaffAuthority } = require('../../../backend/wallet-service/src/exceptionStaffAuthority');
const { financialDispatchTables } = require('../../../backend/wallet-service/src/walletBindings');
const { financialWaveSK } = require('../../../backend/wallet-service/src/financialDispatchKeys');
const { quoteEntityIdValid: validId } = require('../../../backend/wallet-service/src/deliveryQuoteRecord');
const { allowed } = require('../../../backend/staff-service/catalog');

const NUMBER = /^ORD[0-9]{8,24}$/i;
const PAGE_SIZE = 25;
const MAX_WAVES = 20;
const PATH = '/staff/order-monitoring';
const detailPath = PATH + '/detail';
const assignmentPath = PATH + '/assignment';
const restartPath = PATH + '/restart';
const followupPath = PATH + '/followup';
const followupPolicy = followupPath + '/policy';
const followupHost = 'arn:aws:lambda:us-east-1:746727375268:function:wizz-production-dispatch-followup';
const restartHost = 'arn:aws:lambda:us-east-1:746727375268:function:wizz-production-dispatch-restart';
const financialHost = 'arn:aws:lambda:us-east-1:746727375268:function:wizz-production-order-financial';
const states = [
  ['created', 'createdAt'], ['confirmed', 'confirmedAt'], ['preparing', 'preparingAt'],
  ['ready', 'readyAt'], ['assigned', 'driverAssignedAt', 'assignedAt', 'acceptedAt'],
  ['heading_to_store', 'headingToStoreAt'],
  ['arrived_at_store', 'arrivedAtStoreAt'], ['picked_up', 'pickedUpAt', 'pickupAt'],
  ['arrived_at_customer', 'arrivedAtCustomerAt'], ['delivered', 'deliveredAt'],
  ['cancelled', 'cancelledAt'], ['returned', 'returnedAt'],
];

const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value))
  ? new Date(value).toISOString() : null;
const label = value => typeof value === 'string' && value.length ? value.slice(0, 160) : null;
const code = value => typeof value === 'string' && /^[\w-]{1,60}$/.test(value) ? value : null;
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const present = row => validId(row?.orderId) && row.PK === 'ORDER#' + row.orderId &&
  row.SK === 'META' && !row.isDeleted && row.deletedAt == null &&
  row.deletionRequestId == null && row.deletionStatus == null;

function failure(status, code) {
  throw Object.assign(Error(code), { status, code });
}

function summary(order) {
  return {
    orderId: order.orderId,
    orderNumber: label(order.orderNumber) ?? order.orderId,
    branchId: order.businessId ?? order.storeId ?? null,
    branchName: label(order.storeName ?? order.restaurantName ?? order.businessName),
    status: code(order.status ?? order.orderStatus),
    createdAt: iso(order.createdAt),
    totalIqd: count(order.totalAmount ?? order.total),
    assigned: validId(order.driverId ?? order.assignedDriverId),
  };
}

function decodeCursor(cursor, branchId, employee) {
  if (!cursor) return undefined;
  if (typeof cursor !== 'string' || !/^[\w-]{1,1800}$/.test(cursor)) failure(400, 'INVALID_CURSOR');
  let value;
  try { value = JSON.parse(Buffer.from(cursor, 'base64url').toString()); }
  catch { failure(400, 'INVALID_CURSOR'); }
  const key = value?.key;
  if (value?.employee !== employee.employeeId || value?.version !== employee.version ||
      key?.businessId !== branchId || key?.SK !== 'META' || typeof key?.PK !== 'string' ||
      !key.PK.startsWith('ORDER#') || !validId(key.PK.slice(6)) || !iso(key.createdAt) ||
      Object.keys(key).sort().join(',') !== 'PK,SK,businessId,createdAt') {
    failure(400, 'INVALID_CURSOR');
  }
  return key;
}

function createOrderMonitoring({ db, tables }) {
  const get = async (table, key) =>
    (await db.send(new GetCommand({ TableName: table, Key: key, ConsistentRead: true }))).Item;

  async function find(reference) {
    if (!validId(reference)) failure(400, 'INVALID_ORDER_REFERENCE');
    let id = reference;
    if (NUMBER.test(reference)) {
      const data = await db.send(new QueryCommand({
        TableName: tables.orders, IndexName: 'GSI_OrderNumber', Limit: 3,
        KeyConditionExpression: 'orderNumber = :number',
        ExpressionAttributeValues: { ':number': reference.toUpperCase() },
        ProjectionExpression: 'orderId, PK, SK',
      }));
      const items = (data.Items ?? []).filter(row =>
        validId(row.orderId) && row.PK === 'ORDER#' + row.orderId && row.SK === 'META');
      if (items.length > 1 || data.LastEvaluatedKey) failure(409, 'AMBIGUOUS_ORDER');
      if (items.length !== 1) failure(404, 'ORDER_NOT_FOUND');
      id = items[0].orderId;
    }
    const order = await get(tables.orders, { PK: 'ORDER#' + id, SK: 'META' });
    if (!present(order) || order.orderId !== id ||
        (NUMBER.test(reference) && order.orderNumber !== reference.toUpperCase())) failure(404, 'ORDER_NOT_FOUND');
    return order;
  }

  async function dispatch(order, branchId) {
    const job = await get(tables.jobs, { orderId: order.orderId, SK: 'METADATA' });
    if (!job || job.orderId !== order.orderId || !validId(branchId) || job.restaurantId !== branchId) return null;
    const current = count(job.currentWaveNumber) ?? 0;
    const preparing = count(job.financialPreparingWave) ?? 0;
    const last = Math.max(current, preparing);
    const start = Math.max(1, last - MAX_WAVES + 1);
    let rows = [];
    let historyUnavailable = false;
    try {
      // Validate the persisted dispatch cycle before reading its latest waves.
      const keys = Array.from({ length: Math.max(0, last - start + 1) },
        (_, index) => financialWaveSK(job, start + index));
      rows = await Promise.all(keys.map(SK => get(tables.jobs, { orderId: order.orderId, SK })));
    } catch {
      historyUnavailable = true;
    }
    const waves = rows.flatMap((wave, index) =>
      wave?.kind === 'FINANCIAL_WAVE' && wave.orderId === order.orderId && wave.branchId === branchId &&
      wave.assignmentId === job.dispatchJobId
        ? [{ number: start + index, state: code(wave.state),
          candidates: Array.isArray(wave.driverIds) ? wave.driverIds.length : null,
          deliveredOffers: Array.isArray(wave.delivered) ? wave.delivered.length : null,
          createdAt: iso(wave.createdAt), expiresAt: iso(wave.expiresAt) }]
        : []);
    return {
      status: code(job.status),
      reason: code(job.dispatchReview?.reason ?? job.noDriverReason ?? order.financialSearch?.reason),
      reviewRequired: job.dispatchReview?.reviewStatus === 'REQUIRED' || job.status === 'no_driver_available',
      currentWave: preparing || current || null,
      expiresAt: iso(job.expiresAt),
      waves,
      historyUnavailable: historyUnavailable || waves.length !== Math.max(0, last - start + 1),
      earlierWavesOmitted: start > 1,
      hasRestart: /^DRS:[a-f0-9]{48}$/.test(job.dispatchRestart?.restartId ?? ''),
    };
  }

  async function assertBranchScope(branchId,employee) {
    if(!employee||employee.scope?.allRegions===true)return;
    if(!validId(branchId)||!tables.branch)failure(404,'ORDER_NOT_FOUND');
    const branch=await get(tables.branch,{businessId:branchId});
    if(branch?.businessId!==branchId || !allowed(employee,'orders.read',branch.regionId??null))
      failure(404,'ORDER_NOT_FOUND');
  }

  async function detail(reference,employee) {
    const order = await find(reference);
    const item = summary(order);
    await assertBranchScope(item.branchId,employee);
    if (order.storeId && order.businessId && order.storeId !== order.businessId) failure(409, 'INCONSISTENT_ORDER');
    const timeline = states.flatMap(([event, ...keys]) => {
      const at = keys.map(key => iso(order[key])).find(Boolean);
      return at ? [{ event, at }] : [];
    }).sort((a, b) => a.at.localeCompare(b.at));
    const assignment = await dispatch(order, item.branchId);
    return { item: { ...item, timeline, assignment, paymentMethod: code(order.paymentMethod) } };
  }

  async function list(query, employee) {
    const { branch, cursor } = query;
    if (!validId(branch)) failure(400, 'INVALID_BRANCH');
    await assertBranchScope(branch,employee);
    const page = await db.send(new QueryCommand({
      TableName: tables.orders, IndexName: 'GSI_BusinessId', ScanIndexForward: false, Limit: PAGE_SIZE,
      KeyConditionExpression: 'businessId = :branch',
      ExpressionAttributeValues: { ':branch': branch },
      ProjectionExpression: 'PK, SK, orderId, orderNumber, businessId, storeId, storeName, restaurantName, businessName, #status, orderStatus, createdAt, totalAmount, #total, driverId, assignedDriverId, isDeleted, deletedAt, deletionStatus, deletionRequestId',
      ExpressionAttributeNames: { '#status': 'status', '#total': 'total' },
      ExclusiveStartKey: decodeCursor(cursor, branch, employee),
    }));
    return {
      items: (page.Items ?? []).filter(row => present(row) && row.businessId === branch &&
        (row.storeId == null || row.storeId === branch)).map(summary),
      nextCursor: page.LastEvaluatedKey ? Buffer.from(JSON.stringify({
        employee: employee.employeeId, version: employee.version, key: page.LastEvaluatedKey,
      })).toString('base64url') : null,
    };
  }

  return { detail, list };
}

const reply = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body),
});

async function invokeStaffService(lambda, functionName, payload) {
  const response = await lambda.send(new InvokeCommand({
    FunctionName:functionName, InvocationType:'RequestResponse',
    Payload:Buffer.from(JSON.stringify(payload)),
  }));
  let data;
  try {
    if (response.FunctionError) throw Error();
    data = JSON.parse(Buffer.from(response.Payload).toString());
  } catch {
    failure(503, 'ORDER_MANAGEMENT_UNAVAILABLE');
  }
  if (data?.statusCode !== 200 || !data.result) {
    const status = [400,401,403,404,409,503].includes(data?.statusCode) ? data.statusCode : 503;
    failure(status, code(data?.code) || 'ORDER_MANAGEMENT_UNAVAILABLE');
  }
  return data.result;
}

async function relayAssignment(lambda, accessToken, body) {
  const result=await invokeStaffService(lambda,financialHost,{action:'staff_order_management',body,accessToken});
  if (result.success!==true) failure(503,'ORDER_MANAGEMENT_UNAVAILABLE');
  if (body.action==='READ' && result.item?.orderId===body.orderId) {
    const item=result.item;
    return {item:{orderId:item.orderId, canUnassign:item.canUnassign===true, blocker:code(item.blocker),
      offerId:validId(item.offerId)?item.offerId:null, attempt:count(item.attempt),
      holdAmount:count(item.holdAmount)}};
  }
  if (body.action==='UNASSIGN_REDISPATCH' && result.kind==='COD_UNASSIGNED' &&
      result.orderId===body.orderId && result.offerId===body.offerId && result.attempt===body.attempt) {
    return { success:true, orderId:result.orderId, holdReleased:result.holdReleased===true, replayed:result.replayed===true };
  }
  failure(503,'ORDER_MANAGEMENT_UNAVAILABLE');
}

const hex = /^[a-f0-9]{64}$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

async function restartRequest(event, query, lambda, accessToken, employee) {
  if (event.httpMethod==='GET') {
    if (event.body!=null || Object.keys(query).join(',')!=='orderId' || !validId(query.orderId))
      failure(400,'INVALID_QUERY');
    const result=await invokeStaffService(lambda,restartHost,{accessToken,body:{action:'READ',orderId:query.orderId}});
    const item=result.item;
    if (item?.orderId!==query.orderId) failure(503,'DISPATCH_RESTART_UNAVAILABLE');
    const eligible=item.canRestart===true && hex.test(item.caseId) && hex.test(item.baseDigest);
    return {item:{orderId:item.orderId,canRestart:eligible,
      ...(eligible?{caseId:item.caseId,baseDigest:item.baseDigest}:{blocker:code(item.blocker)}),
      state:['QUEUED','STARTED','NEEDS_REVIEW','STALE','SUPPRESSED_DELETION'].includes(item.state)?item.state:null}};
  }
  if (!allowed(employee,'orders.assign')) failure(403,'PERMISSION_REQUIRED');
  if (Object.keys(query).length || event.isBase64Encoded || typeof event.body!=='string' ||
      Buffer.byteLength(event.body)>4096) failure(400,'INVALID_RESTART_REQUEST');
  let body;
  try { body=JSON.parse(event.body); } catch { failure(400,'INVALID_RESTART_REQUEST'); }
  if (!body || Object.keys(body).sort().join(',')!=='baseDigest,caseId,orderId,reason,requestId' ||
      !validId(body.orderId) || !hex.test(body.caseId) || !hex.test(body.baseDigest) || !uuid.test(body.requestId) ||
      typeof body.reason!=='string' || body.reason.trim().length<5 || body.reason.length>500)
    failure(400,'INVALID_RESTART_REQUEST');
  const result=await invokeStaffService(lambda,restartHost,{accessToken,
    body:{...body,reason:body.reason.trim(),action:'RETRY_SEARCH'}});
  if (result.success!==true || result.orderId!==body.orderId || result.state!=='QUEUED') failure(503,'DISPATCH_RESTART_UNAVAILABLE');
  return {success:true,state:'QUEUED',replayed:result.replayed===true};
}

async function followupRequest(event,path,query,lambda,accessToken) {
  const policy=path===followupPolicy;
  let body;
  if(event.httpMethod==='GET'){
    if(event.body!=null || Object.keys(query).some(key=>policy||key!=='cursor'))
      failure(400,'INVALID_QUERY');
    body=policy?{action:'READ_POLICY'}:{action:'LIST',cursor:query.cursor??null};
  }else{
    if(Object.keys(query).length || event.isBase64Encoded || typeof event.body!=='string' ||
        Buffer.byteLength(event.body)>4096) failure(400,'INVALID_FOLLOWUP');
    try { body=JSON.parse(event.body); } catch { failure(400,'INVALID_FOLLOWUP'); }
    const expected=policy?'baseVersion,reason,requestId,values':'action,baseVersion,caseId,note,orderId,requestId';
    if(!body || Object.keys(body).sort().join(',')!==expected)failure(400,'INVALID_FOLLOWUP');
    if(policy)body.action='SAVE_POLICY';
    else if(!['CLAIM','RELEASE','NOTE'].includes(body.action))failure(400,'INVALID_FOLLOWUP');
  }
  return invokeStaffService(lambda,followupHost,{accessToken,body});
}

function createHandler({ db, cognito, lambda, env = process.env }) {
  return async event => {
    const path = event?.resource;
    if (env.STAGE !== 'production' || env.AWS_REGION !== 'us-east-1' ||
        !env.MONITORING_API_ID || event?.requestContext?.apiId !== env.MONITORING_API_ID ||
        event.requestContext.stage !== 'production' ||
        !(event.httpMethod==='GET' && [PATH,detailPath,assignmentPath,restartPath,followupPath,followupPolicy].includes(path) ||
          event.httpMethod==='POST' && [assignmentPath,restartPath,followupPath,followupPolicy].includes(path))) return reply(404, { error: 'NOT_FOUND' });

    const headers = Object.entries(event.headers ?? {}).filter(([name]) => name.toLowerCase() === 'authorization');
    const multi = Object.entries(event.multiValueHeaders ?? {}).filter(([name]) => name.toLowerCase() === 'authorization');
    const bearer = headers[0]?.[1];
    if (headers.length !== 1 || typeof bearer !== 'string' || bearer.length > 16007 || multi.length > 1 ||
        (multi.length === 1 && (!Array.isArray(multi[0][1]) || multi[0][1].length !== 1 || multi[0][1][0] !== bearer))) {
      return reply(401, { error: 'UNAUTHORIZED' });
    }
    const token = /^Bearer ([\w-]+\.[\w-]+\.[\w-]+)$/i.exec(bearer)?.[1];
    if (!token) return reply(401, { error: 'UNAUTHORIZED' });

    try {
      const query = event.queryStringParameters ?? {};
      if (Object.values(event.multiValueQueryStringParameters ?? {}).some(values =>
        !Array.isArray(values) || values.length !== 1)) failure(400, 'INVALID_QUERY');
      if (path===followupPath || path===followupPolicy)
        return reply(200,await followupRequest(event,path,query,lambda,token));
      const authority = createExceptionStaffAuthority({ db, cognito, accessToken: token });
      const operationalView=path===PATH||path===detailPath;
      const actor = await authority.authenticate(operationalView?'FOLLOWUP':'READ');
      const profile=operationalView?authority.followup:authority.read;
      const { employee } = await profile(actor);
      if (!allowed(employee, 'orders.read')) failure(403, 'PERMISSION_REQUIRED');
      if (path===restartPath) return reply(200,await restartRequest(event,query,lambda,token,employee));
      if (path === assignmentPath && event.httpMethod==='POST') {
        if (!allowed(employee,'orders.assign')) failure(403,'PERMISSION_REQUIRED');
        if (Object.keys(query).length || event.isBase64Encoded || typeof event.body!=='string' ||
            Buffer.byteLength(event.body)>4096) failure(400,'INVALID_ORDER_MANAGEMENT');
        let body;
        try { body=JSON.parse(event.body); } catch { failure(400,'INVALID_ORDER_MANAGEMENT'); }
        if (!body || Object.keys(body).sort().join(',')!=='attempt,confirmBeforePickup,idempotencyKey,offerId,orderId,reason' ||
            !validId(body.orderId) || !validId(body.offerId) || body.confirmBeforePickup!==true ||
            !Number.isSafeInteger(body.attempt) || body.attempt<1 || body.attempt>=1000 ||
            typeof body.reason!=='string' || body.reason.trim().length<5 || body.reason.length>500 ||
            typeof body.idempotencyKey!=='string' ||
            !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(body.idempotencyKey)) {
          failure(400,'INVALID_ORDER_MANAGEMENT');
        }
        const {confirmBeforePickup,...management}=body;
        return reply(200,await relayAssignment(lambda,token,{...management,reason:body.reason.trim(),action:'UNASSIGN_REDISPATCH'}));
      }
      if (event.body != null) failure(400, 'INVALID_QUERY');
      if (path === assignmentPath) {
        if (Object.keys(query).join(',')!=='orderId' || !validId(query.orderId)) failure(400,'INVALID_QUERY');
        return reply(200,await relayAssignment(lambda,token,{orderId:query.orderId,action:'READ'}));
      }

      const api = createOrderMonitoring({ db, tables: financialDispatchTables(env) });
      let result;
      if (path === detailPath) {
        if (Object.keys(query).join(',') !== 'order') failure(400, 'INVALID_QUERY');
        result = { ...(await api.detail(query.order,employee)), permissions: { finance:employee.scope?.allRegions===true&&allowed(employee,'finance.read'), assign:employee.scope?.allRegions===true&&allowed(employee,'orders.assign') } };
      } else {
        if (!query.branch || Object.keys(query).some(key => !['branch', 'cursor'].includes(key))) failure(400, 'INVALID_QUERY');
        result = await api.list(query, employee);
      }
      const latest = await profile(actor);
      if (latest.employee.version !== employee.version || !allowed(latest.employee, 'orders.read')) failure(403, 'PERMISSION_REQUIRED');
      return reply(200, result);
    } catch (error) {
      if (error.status) return reply(error.status, { error: error.code });
      if (error.code === 'UNAUTHORIZED' || ['NotAuthorizedException', 'UserNotFoundException'].includes(error.name)) {
        return reply(401, { error: 'UNAUTHORIZED' });
      }
      if (['EXCEPTION_PERMISSION_REQUIRED', 'EXCEPTION_EMPLOYEE_UNAVAILABLE'].includes(error.code)) {
        return reply(403, { error: 'PERMISSION_REQUIRED' });
      }
      console.error('Order monitoring failed', error.name);
      return reply(503, { error: 'ORDER_MONITORING_UNAVAILABLE' });
    }
  };
}

const config = { region: 'us-east-1', maxAttempts: 2 };
const db = DynamoDBDocumentClient.from(new DynamoDBClient(config));
exports.handler = createHandler({ db, cognito:new CognitoIdentityProviderClient(config),
  lambda:new LambdaClient({ region:'us-east-1',maxAttempts:1 }) });
exports.createOrderMonitoring = createOrderMonitoring;
exports.createHandler = createHandler;
