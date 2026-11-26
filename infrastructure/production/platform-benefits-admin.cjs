'use strict';

const {DynamoDBClient} = require('@aws-sdk/client-dynamodb');
const {DynamoDBDocumentClient, GetCommand, QueryCommand, ScanCommand} = require('@aws-sdk/lib-dynamodb');
const {CognitoIdentityProviderClient, AdminGetUserCommand} = require('@aws-sdk/client-cognito-identity-provider');
const {CognitoJwtVerifier} = require('aws-jwt-verify');
const {route} = require('../../backend/staff-service/platform-benefits');
const {exact} = require('../../backend/staff-service/dispatch-followup-core');
const {authenticateStaff} = require('./admin-session/live-admin.cjs');
const {identities:{admin}} = require('./wallet-identity-bindings.json');

const path = '/staff/benefits';
const tables = Object.fromEntries(Object.entries({
  campaigns:'PlatformDiscounts', grants:'OfferJourney', regions:'Regions', branches:'Merchants',
  customers:'Customers', staff:'PlatformStaff', deletion:'AccountDeletion',
}).map(([key,value]) => [key,'wizz-production-'+value]));
const fail = (status, error) => { throw Object.assign(Error(error),{status}); };
const reply = (statusCode,value) => ({statusCode,
  headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'},
  body:JSON.stringify(value)});
const epoch = value => new Date(value).toISOString();
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const active = row => row?.isActive !== false && row?.isDeleted !== true && row?.deletedAt == null && row?.deletionRequestId == null;

function phoneNumber(value) {
  if (typeof value !== 'string' || value.length > 40) fail(400,'BENEFIT_PHONE_INVALID');
  const compact = value.replace(/[٠-٩۰-۹]/g, digit =>
    String((digit.charCodeAt(0) - (digit <= '٩' ? 0x660 : 0x6f0)))).replace(/[ ()-]/g,'');
  const match = /^(?:\+?964|0)?(7\d{9})$/.exec(compact);
  if (!match) fail(400,'BENEFIT_PHONE_INVALID');
  return '+964'+match[1];
}

function createHandler({db, verifyStaff, getStaff, apiId, now = Date.now}) {
  const get = async (TableName, Key) => (await db.send(new GetCommand({TableName,Key,ConsistentRead:true}))).Item;
  const personKey = userId => ({userId});
  const lifecycleKey = userId => ({pk:'ACCOUNT_LIFECYCLE#CUSTOMER#'+userId,sk:'META'});
  const validProfile = (id,row) => uuid.test(id) && row?.userId === id && row.cognitoSub === id && active(row) && row.phoneVerified === true;
  async function customerGuard(id, profile) {
    if (!validProfile(id,profile)) fail(409,'BENEFIT_ACCOUNT_UNAVAILABLE');
    const key = lifecycleKey(id);
    if (await get(tables.deletion,key)) fail(409,'BENEFIT_ACCOUNT_UNAVAILABLE');
    return exact(tables.deletion,key,null,['pk']);
  }
  async function lookupCustomers(raw) {
    const phone = phoneNumber(raw);
    const result = await db.send(new QueryCommand({
      TableName:tables.customers, IndexName:'phone-index', KeyConditionExpression:'#phone = :phone',
      ExpressionAttributeNames:{'#phone':'phone'}, ExpressionAttributeValues:{':phone':phone},
      ProjectionExpression:'userId', Limit:5,
    }));
    if (result.LastEvaluatedKey) fail(409,'BENEFIT_CUSTOMER_LOOKUP_LIMIT');
    const ids = [...new Set((result.Items ?? []).map(row => row.userId))];
    const entries = await Promise.all(ids.map(async id => {
      if (!uuid.test(id)) return null;
      const row = await get(tables.customers,personKey(id));
      if (!validProfile(id,row) || row.phone !== phone || await get(tables.deletion,lifecycleKey(id))) return null;
      return {id,name:row.name || row.fullName || 'زبون',phone};
    }));
    const customers = entries.filter(Boolean);
    if (customers.length > 1) fail(409,'BENEFIT_CUSTOMER_LOOKUP_LIMIT');
    return customers;
  }

  async function catalog(TableName, ProjectionExpression, filter, names) {
    const rows = [];
    let cursor;
    for (let page=0; page<20; page++) {
      const result = await db.send(new ScanCommand({
        TableName,ProjectionExpression,Limit:200,ExclusiveStartKey:cursor,ExpressionAttributeNames:names,
      }));
      rows.push(...(result.Items ?? []).filter(filter));
      cursor = result.LastEvaluatedKey;
      if (!cursor) return rows;
    }
    fail(409,'BENEFIT_TARGET_LIST_LIMIT');
  }

  async function targets() {
    const [regions,branches] = await Promise.all([
      catalog(tables.regions,'regionId,#ar,#name,is_active,archived',
        row => !row.archived && row.is_active !== false, {'#ar':'name_ar','#name':'name'}),
      catalog(tables.branches,'businessId,businessName,#name,regionId,isActive,isDeleted,deletedAt,deletionRequestId',
        row => active(row) && typeof row.regionId === 'string', {'#name':'name'}),
    ]);
    return {
      regions:regions.map(row => ({id:row.regionId,label:row.name_ar || row.name || row.regionId})),
      merchants:branches.map(row => ({id:row.businessId,label:row.businessName || row.name || row.businessId,regionId:row.regionId})),
    };
  }

  return async event => {
    if (!apiId || event?.resource !== path || event?.requestContext?.stage !== 'production' ||
        event.requestContext.apiId !== apiId) return reply(404,{error:'NOT_FOUND'});
    const method = event.httpMethod;
    if (!['GET','POST'].includes(method)) return reply(405,{error:'METHOD_NOT_ALLOWED'});
    try {
      const {actor} = await authenticateStaff(event,{verifyStaff,getStaff},db,now,'promotions.read','PERMISSION_REQUIRED');
      const q = event.queryStringParameters ?? {};
      if (Object.values(event.multiValueQueryStringParameters ?? {}).some(values => values.length !== 1))
        fail(400,'BENEFIT_INVALID');
      if (method === 'GET' && q.view === 'targets' && Object.keys(q).length === 1) return reply(200,await targets());
      let input = q;
      if (method === 'GET') {
        if (Object.keys(q).length && (q.view !== 'customers' || Object.keys(q).sort().join(',') !== 'phone,view'))
          fail(400,'BENEFIT_INVALID');
      } else {
        if (Object.keys(q).length || event.isBase64Encoded || typeof event.body !== 'string' || Buffer.byteLength(event.body) > 16000)
          fail(400,'BENEFIT_INVALID');
        try { input = JSON.parse(event.body); } catch { fail(400,'BENEFIT_INVALID'); }
        if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400,'BENEFIT_INVALID');
      }
      return reply(200,await route({
        db, now, benefitTables:tables, lookupCustomers, customerGuard,
        authorizeWrite:async action => {
          const permission = {CREATE:'promotions.create',UPDATE:'promotions.edit',PUBLISH:'promotions.approve',
            PAUSE:'promotions.edit',RESUME:'promotions.edit',GRANT:'promotions.grant',REVOKE:'promotions.grant'}[action];
          const {actor:current} = await authenticateStaff(event,{verifyStaff,getStaff},db,now,permission,'PERMISSION_REQUIRED');
          if (current.employeeId !== actor.employeeId || current.version !== actor.version)
            fail(409,'VERSION_OR_STATE_CONFLICT');
        },
        validateTargets:benefit => Promise.all(benefit.customerIds.map(async id =>
          customerGuard(id,await get(tables.customers,personKey(id))))),
        guard:employee => exact(tables.staff,{pk:'EMPLOYEE#'+employee.employeeId,sk:'PROFILE'},employee,
          [...new Set([...Object.keys(employee),'roles','minimumAuthTime','deletedAt','deletionRequestId','isDeleted'])]),
        audit:(employeeId,action,before,after,requestId) => ({
          Put:{TableName:tables.staff,Item:{pk:'AUDIT#'+employeeId,sk:'BENEFIT#'+requestId,action,who:employeeId,
            benefitId:after.discountId,fromState:before?.status ?? null,toState:after.status,
            recipientId:['GRANT','REVOKE'].includes(input.action) ? input.userSub : null,
            reason:['GRANT','REVOKE'].includes(input.action) ? input.reason.trim() : null,at:epoch(now())},
          ConditionExpression:'attribute_not_exists(pk)'},
        }),
      },actor,method,input));
    } catch (error) {
      const code = error?.message;
      if (/^(BENEFIT_|VERSION_OR_STATE_CONFLICT$|REQUEST_ID_CONFLICT$|REGION_SCOPE_REQUIRED$|PERMISSION_REQUIRED$|ADMIN_MFA_REQUIRED$|UNAUTHORIZED$)/.test(code ?? ''))
        return reply(error.status ?? 409,{error:code});
      console.error('Benefits administration failed',error?.name ?? 'Error');
      return reply(503,{error:'BENEFIT_SERVICE_UNAVAILABLE'});
    }
  };
}
const opts = {region:'us-east-1',maxAttempts:2};
const db = DynamoDBDocumentClient.from(new DynamoDBClient(opts),{marshallOptions:{removeUndefinedValues:true}});
const cognito = new CognitoIdentityProviderClient(opts);
const jwt = CognitoJwtVerifier.create({userPoolId:admin.poolId,clientId:admin.clientId,tokenUse:'access'});
const live = createHandler({db,apiId:process.env.BENEFITS_API_ID,verifyStaff:token=>jwt.verify(token),
  getStaff:Username=>cognito.send(new AdminGetUserCommand({Username,UserPoolId:admin.poolId}))});
module.exports = {createHandler,tables,handler:event => process.env.STAGE==='production' && process.env.AWS_REGION==='us-east-1'
  ? live(event) : reply(503,{error:'BENEFIT_SERVICE_UNAVAILABLE'})};
