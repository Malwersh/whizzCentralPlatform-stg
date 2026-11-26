'use strict';

const {randomUUID} = require('node:crypto');
const {DynamoDBClient} = require('@aws-sdk/client-dynamodb');
const {DynamoDBDocumentClient, GetCommand, QueryCommand} = require('@aws-sdk/lib-dynamodb');
const {AdminGetUserCommand, CognitoIdentityProviderClient} = require('@aws-sdk/client-cognito-identity-provider');
const {S3Client, GetObjectCommand} = require('@aws-sdk/client-s3');
const {belongsToComplaint, bytes} = require('../../backend/staff-service/complaint-image-retention');
const {CognitoJwtVerifier} = require('aws-jwt-verify');
const {createCustomerOrderComplaints, KEY} = require('../../backend/staff-service/customer-order-complaints');
const {casePhase, readExceptionCasePolicy} = require('../../backend/wallet-service/src/exceptionCasePolicy');
const {exceptionCaseIndexOperation} = require('../../backend/wallet-service/src/orderExceptionCaseIndex');
const {allowed} = require('../../backend/staff-service/catalog');
const {exact} = require('../../backend/staff-service/dispatch-followup-core');
const {benefitGrantKey} = require('../../backend/staff-service/platform-benefits-runtime');
const {voucherState, route: linkVoucher} = require('../../backend/staff-service/customer-benefit-compensation');
const {authenticateStaff} = require('./admin-session/live-admin.cjs');
const {identities} = require('./wallet-identity-bindings.json');

const namespace = 'wizz-production-';
const tables = Object.freeze(Object.fromEntries(Object.entries({
  cases: 'Holds', orders: 'Orders', sessions: 'SupportChatSessions', deletion: 'AccountDeletion',
  customers: 'Customers', staff: 'PlatformStaff', attachments: 'SupportAttachments',
  messages: 'SupportChatMessages', notifications: 'WalletNotifications', lifecycle: 'WalletLifecycle',
  benefits: 'OfferJourney', campaigns: 'PlatformDiscounts',
}).map(([key, value]) => [key, namespace + value])));
const routes = {customer:'/complaints/customer', staff:'/complaints/staff'};
const readPermissions = ['orders.read', 'finance.read'];
const reviewPermissions = ['orders.cancel', 'finance.approve'];
const caseType = 'CUSTOMER_POST_DELIVERY_CASE';
const orderId = /^[A-Za-z0-9][A-Za-z0-9_.:#-]{0,149}$/;
const orderNumber = /^ORD[0-9]{10,20}$/i;
const subPattern = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const fail = (status, code) => { throw Object.assign(Error(code), {status, code}); };
const reply = (statusCode, body) => ({statusCode, headers:{
  'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff',
}, body:JSON.stringify(body)});
const staffGuard = employee => exact(tables.staff, {pk:'EMPLOYEE#'+employee.employeeId, sk:'PROFILE'}, employee,
  [...new Set([...Object.keys(employee), 'roles', 'scope', 'minimumAuthTime', 'approvalLimit', 'deletedAt',
    'deletionRequestId', 'isDeleted', 'permissions', 'permissionOverrides'])]);

function queueCursor(raw, partition) {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || !/^[A-Za-z0-9_-]{1,420}$/.test(raw)) fail(400, 'COMPLAINT_INVALID_CURSOR');
  let key;
  try { key = JSON.parse(Buffer.from(raw, 'base64url')); } catch { fail(400, 'COMPLAINT_INVALID_CURSOR'); }
  if (!key || Object.keys(key).sort().join(',') !== 'nextAttemptAt,operationId,queuePartition' ||
      key.queuePartition !== partition || typeof key.operationId !== 'string' || !/^EXCEPTION_CASE#[A-Za-z0-9_.:#-]{1,150}$/.test(key.operationId) ||
      !Number.isSafeInteger(key.nextAttemptAt) || key.nextAttemptAt < 1) fail(400, 'COMPLAINT_INVALID_CURSOR');
  return key;
}

function createHandler({db, verifyCustomer, verifyStaff, getStaff, evidenceObject, apiId, now = Date.now}) {
  const get = async (TableName, Key) => (await db.send(new GetCommand({TableName, Key, ConsistentRead:true}))).Item;
  async function voucherProof(order, row) {
    const key = {pk:'USER#'+order.userSub, sk:'CASE_COMPENSATION#'+row.caseId};
    const link = await get(tables.benefits, key);
    const guards = [exact(tables.benefits, key, link)];
    if (!link) return {link:null, valid:false, guards};
    if (link.orderId !== order.orderId || link.caseId !== row.caseId || link.caseKey !== KEY)
      fail(409, 'COMPLAINT_REMEDY_REQUIRED');
    const grantKey = benefitGrantKey(link.campaignId, order.userSub), campaignKey = {discountId:link.campaignId};
    const [grant, campaign] = await Promise.all([get(tables.benefits, grantKey), get(tables.campaigns, campaignKey)]);
    guards.push(exact(tables.benefits, grantKey, grant), exact(tables.campaigns, campaignKey, campaign, Object.keys(campaign ?? campaignKey)));
    const valid = grant?.compensationReference?.caseId === row.caseId &&
      grant?.compensationReference?.orderId === order.orderId && campaign?.benefit?.amountIqd === link.amountIqd &&
      ['AVAILABLE','RESERVED','USED'].includes(voucherState(campaign, grant, now()));
    return {link, valid, guards};
  }

  async function findOrderByNumber(value) {
    if (typeof value !== 'string' || !orderId.test(value)) fail(400,'INVALID_COMPLAINT');
    if (!orderNumber.test(value)) return value;
    const result = await db.send(new QueryCommand({
      TableName:tables.orders, IndexName:'GSI_OrderNumber', KeyConditionExpression:'orderNumber = :number',
      ExpressionAttributeValues:{':number':value.toUpperCase()}, ProjectionExpression:'orderId,PK,SK', Limit:2,
    }));
    const row = result.Items?.[0];
    if (result.Items?.length !== 1 || result.LastEvaluatedKey || row.SK !== 'META' ||
        typeof row.orderId !== 'string' || !orderId.test(row.orderId) || row.PK !== 'ORDER#'+row.orderId)
      fail(404,'COMPLAINT_UNAVAILABLE');
    return row.orderId;
  }

  async function list(query) {
    const closed = query.state === 'closed';
    if (Object.keys(query).some(k => !['state','cursor'].includes(k)) ||
        query.state !== undefined && !['open','closed'].includes(query.state)) fail(400, 'INVALID_COMPLAINT');
    const partition = closed ? 'ORDER_EXCEPTIONS_CLOSED' : 'ORDER_EXCEPTIONS_OPEN';
    const result = await db.send(new QueryCommand({
      TableName:tables.lifecycle, IndexName:'ByDue', KeyConditionExpression:'queuePartition = :partition',
      ExpressionAttributeValues:{':partition':partition},
      ProjectionExpression:'operationId, queuePartition, nextAttemptAt, orderId, orderNumber, caseType, caseState, updatedAt',
      Limit:30, ScanIndexForward:!closed, ExclusiveStartKey:queueCursor(query.cursor, partition),
    }));
    const items = (result.Items ?? []).filter(row => row.caseType === caseType && typeof row.orderId === 'string' && orderId.test(row.orderId)).map(row =>
      ({orderId:row.orderId, orderNumber:row.orderNumber ?? null, status:row.caseState, updatedAt:row.updatedAt}));
    return {success:true, items, cursor:result.LastEvaluatedKey ?
      Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64url') : null};
  }

  return async event => {
    const staff = event?.resource === routes.staff;
    if (!apiId || event?.requestContext?.apiId !== apiId || event?.requestContext?.stage !== 'production' ||
        (!staff && event?.resource !== routes.customer)) return reply(404, {code:'NOT_FOUND'});
    const method = event.httpMethod;
    if (method !== 'POST' && !(staff && method === 'GET')) return reply(405, {code:'METHOD_NOT_ALLOWED'});

    async function authenticate() {
      if (staff) {
        const {actor} = await authenticateStaff(event, {verifyStaff, getStaff}, db, now, readPermissions, 'EXCEPTION_PERMISSION_REQUIRED');
        return {kind:'STAFF', subjectId:actor.employeeId};
      }
      const headers = Object.entries(event.headers ?? {}).filter(([name]) => name.toLowerCase() === 'authorization');
      const value = headers.length === 1 ? headers[0][1] : null;
      const token = typeof value === 'string' && /^Bearer (\S{1,8192})$/i.exec(value)?.[1];
      if (!token) fail(401, 'UNAUTHORIZED');
      let claims;
      try { claims = await verifyCustomer(token); } catch { fail(401, 'UNAUTHORIZED'); }
      if (!subPattern.test(claims?.sub ?? '')) fail(401, 'UNAUTHORIZED');
      return {kind:'CUSTOMER', subjectId:claims.sub};
    }

    try {
      const query = event.queryStringParameters ?? {};
      if (Object.values(event.multiValueQueryStringParameters ?? {}).some(values => values.length !== 1))
        fail(400, 'INVALID_COMPLAINT');
      const service = createCustomerOrderComplaints({db, tables, authenticate, now,
        phase:casePhase, policy:() => readExceptionCasePolicy(db, tables.staff),
        index:(input, order) => exceptionCaseIndexOperation(db, {...input,
          orderNumber:typeof order.orderNumber === 'string' && orderNumber.test(order.orderNumber) ? order.orderNumber : undefined,
        }, tables.lifecycle), verifyVoucher:voucherProof,
        async authorizeStaff(actor, _order, mode, amount) {
          const permissions = mode === 'READ' ? readPermissions : mode === 'OPERATE' ? reviewPermissions : 'finance.approve';
          const {actor:employee} = await authenticateStaff(event, {verifyStaff, getStaff}, db, now, permissions, 'EXCEPTION_PERMISSION_REQUIRED');
          if (actor.subjectId !== employee.employeeId) fail(401, 'UNAUTHORIZED');
          if (mode === 'FINANCIAL' && (amount % 250 !== 0 || amount > 1000000000))
            fail(400,'COMPLAINT_REMEDY_DENOMINATION_INVALID');
          if (mode === 'FINANCIAL' && (!Number.isSafeInteger(employee.approvalLimit) ||
              employee.approvalLimit < amount)) fail(403, 'EXCEPTION_APPROVAL_LIMIT');
          return {employee, guard:staffGuard(employee)};
        },
      });

      let body;
      if (method === 'POST') {
        if (event.isBase64Encoded || typeof event.body !== 'string' || Buffer.byteLength(event.body) > 16000)
          fail(400, 'INVALID_COMPLAINT');
        try { body = JSON.parse(event.body); } catch { fail(400, 'INVALID_COMPLAINT'); }
      }
      if (staff && query.view === 'voucher') {
        const {actor} = await authenticateStaff(event, {verifyStaff, getStaff}, db, now, readPermissions, 'EXCEPTION_PERMISSION_REQUIRED');
        const keys = Object.keys(query).sort().join(',');
        if (keys !== (method === 'GET' ? 'orderId,view' : 'view') || method === 'POST' &&
            (!body || typeof body !== 'object' || Array.isArray(body) || Object.hasOwn(body, 'caseKey'))) fail(400, 'INVALID_COMPLAINT');
        const input = {...(method === 'GET' ? {orderId:query.orderId} : body), caseKey:KEY};
        const audit = (employeeId, action, _before, after, requestId) => ({
          Put:{TableName:tables.staff, Item:{pk:'AUDIT#'+employeeId, sk:'COMPLAINT#'+requestId, action,
            who:employeeId, after, at:new Date(now()).toISOString()}, ConditionExpression:'attribute_not_exists(pk)'},
        });
        return reply(200, await linkVoucher({db, tables, now, guard:staffGuard, audit,
          async authorizeWrite() {
            const {actor:current} = await authenticateStaff(event, {verifyStaff, getStaff}, db, now, 'finance.approve', 'EXCEPTION_PERMISSION_REQUIRED');
            if (current.employeeId !== actor.employeeId || current.version !== actor.version ||
                !allowed(current, 'promotions.grant')) fail(403,'EXCEPTION_PERMISSION_REQUIRED');
          }}, actor, method, input));
      }
      if (staff && method === 'GET') {
        const {actor} = await authenticateStaff(event, {verifyStaff, getStaff}, db, now, readPermissions, 'EXCEPTION_PERMISSION_REQUIRED');
        if (query.view === 'evidence') {
          if (Object.keys(query).sort().join(',') !== 'attachmentId,orderId,view' ||
              !subPattern.test(query.attachmentId ?? '')) fail(400, 'INVALID_COMPLAINT');
          const view = await service.execute({action:'READ', orderId:query.orderId});
          const row = await get(tables.attachments, {attachmentId:query.attachmentId});
          if (row?.attachmentId !== query.attachmentId || !belongsToComplaint(row, view.case))
            fail(404, 'COMPLAINT_IMAGE_UNAVAILABLE');
          const data = await bytes(await evidenceObject(row.key), row);
          return reply(200, {attachmentId:row.attachmentId, contentType:row.contentType, dataBase64:data.toString('base64')});
        }
        if (Object.keys(query).join(',') === 'orderId') {
          const view = await service.execute({action:'READ', orderId:await findOrderByNumber(query.orderId)});
          if (!view.case) fail(404, 'COMPLAINT_UNAVAILABLE');
          const owner = view.case.ownerId && view.case.ownerId !== actor.employeeId ?
            await get(tables.staff, {pk:'EMPLOYEE#'+view.case.ownerId, sk:'PROFILE'}) : actor;
          const ownerUnavailable = owner?.status !== 'ACTIVE' || owner.scope?.allRegions !== true ||
            !reviewPermissions.some(key => allowed(owner, key));
          return reply(200, {...view, ownerUnavailable, userCanReview:reviewPermissions.some(key => allowed(actor, key)),
            userOwnsCase:view.case.ownerId === actor.employeeId, userCanApproveRemedy:allowed(actor, 'finance.approve'),
            userCanLinkVoucher:allowed(actor,'finance.read') && allowed(actor,'promotions.read')});
        }
        return reply(200, await list(query));
      }
      if (Object.keys(query).length) fail(400, 'INVALID_COMPLAINT');
      return reply(200, await service.execute(body));
    } catch (error) {
      const code = error?.code ?? error?.message;
      if (/^(COMPLAINT_|INVALID_COMPLAINT$|CUSTOMER_COMPENSATION_|EXCEPTION_|PERMISSION_REQUIRED$|UNAUTHORIZED$|ADMIN_MFA_REQUIRED$)/.test(code ?? ''))
        return reply(error.status || 409, {success:false, code});
      console.error('Complaint request failed', error?.name ?? 'Error', randomUUID());
      return reply(503, {success:false, code:'COMPLAINT_SERVICE_UNAVAILABLE'});
    }
  };
}

const db = DynamoDBDocumentClient.from(new DynamoDBClient({region:'us-east-1',maxAttempts:2}),
  {marshallOptions:{removeUndefinedValues:true}});
const cognito = new CognitoIdentityProviderClient({region:'us-east-1',maxAttempts:2});
const verifier = name => CognitoJwtVerifier.create({userPoolId:identities[name].poolId, clientId:identities[name].clientId, tokenUse:'access'});
const staff = verifier('admin'), customer = verifier('customer');
const apiId = process.env.COMPLAINT_API_ID;
const s3 = new S3Client({region:'us-east-1',maxAttempts:2});
const live = createHandler({db, apiId, verifyStaff:token => staff.verify(token), verifyCustomer:token => customer.verify(token),
  evidenceObject:Key => s3.send(new GetObjectCommand({Bucket:process.env.COMPLAINT_EVIDENCE_BUCKET,
    ExpectedBucketOwner:process.env.COMPLAINT_EVIDENCE_BUCKET_OWNER, Key})),
  getStaff:Username => cognito.send(new AdminGetUserCommand({Username, UserPoolId:identities.admin.poolId}))});
module.exports = {createHandler, tables, handler(event) {
  if (process.env.STAGE !== 'production' || process.env.AWS_REGION !== 'us-east-1' || !/^[a-z0-9]{10}$/.test(apiId ?? ''))
    return reply(503, {success:false, code:'COMPLAINT_SERVICE_UNAVAILABLE'});
  return live(event);
}};
