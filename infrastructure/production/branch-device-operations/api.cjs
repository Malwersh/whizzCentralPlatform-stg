'use strict';

const {GetCommand, TransactWriteCommand} = require('@aws-sdk/lib-dynamodb');
const {composeDispatchTransaction} = require('../../../backend/wallet-service/src/dispatchTransaction');
const {quoteHash} = require('../../../backend/wallet-service/src/deliveryQuoteRecord');
const {mutate} = require('../../../../whizzMerchants-stg/backend/functions/shared/branch-device-menu');
const {prepare} = require('../../../../whizzMerchants-stg/backend/functions/shared/branch-device-hours-audit');
const {schedule} = require('../../../../whizzMerchants-stg/backend/functions/business/branch_readiness');
const {complete} = require('../../../../whizzMerchants-stg/backend/functions/shared/menu-auto-publish');
const {createMenuVersionService} = require('../../../../whizzMerchants-stg/backend/functions/products/menu_versions');

const tables = {
  hours: 'wizz-production-WorkingHours', businesses: 'wizz-production-Merchants',
  platform: 'wizz-production-MerchantPlatform', products: 'wizz-production-Products',
};
const id = '[A-Za-z0-9_-]{1,150}';
const validId = new RegExp('^' + id + '$');
const hoursRoute = new RegExp('^/businesses/(' + id + ')/working-hours$');
const productRoute = new RegExp('^/products/(' + id + ')$');
const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const time = /^([01]\d|2[0-3]):[0-5]\d$/;
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const fail = (status, code) => {throw Object.assign(Error(code), {status});};
const headers = {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'};
const reply = (statusCode, result) => ({statusCode, headers, body: JSON.stringify(result)});
const read = async (db, TableName, Key) => (await db.send(new GetCommand({TableName, Key, ConsistentRead: true}))).Item;

function operation(path, method, body) {
  const hours = hoursRoute.exec(path);
  if (hours && ['GET', 'PUT'].includes(method)) {
    return {scope: hours[1], required: [method === 'GET' ? 'hours.read' : 'hours.write'], type: 'hours'};
  }
  const product = productRoute.exec(path);
  if (method === 'GET' && (path === '/categories' || path === '/products' || product)) {
    return {required: ['menu.read'], type: 'catalog', productId: product?.[1]};
  }
  if (method === 'POST' && path === '/products') return {required: ['menu.create'], type: 'catalog'};
  if (method === 'DELETE' && product) return {required: ['menu.delete'], type: 'catalog', productId: product[1]};
  if (method !== 'PUT' || !product) fail(404, 'NOT_FOUND');
  const allowed = {'name':'menu.edit', 'description':'menu.edit', 'cuisineIds':'menu.edit',
    'price':'menu.price.write', 'isAvailable':'menu.availability.write'};
  const fields = Object.keys(body).filter(key => !['businessId','requestId'].includes(key));
  if (!fields.length || fields.some(field => !Object.prototype.hasOwnProperty.call(allowed, field))) fail(400, 'INVALID_MENU_UPDATE');
  return {required: [...new Set(fields.map(field => allowed[field]))], type: 'catalog', productId: product[1]};
}

function writeWithAuthority(db, verify) {
  return {send: async command => {
    if (command.constructor.name !== 'TransactWriteCommand') return db.send(command);
    const access = await verify();
    const operations = command.input.TransactItems;
    const guards = access.actor.guards;
    const mutations = operations.filter(item => !item.ConditionCheck);
    const checks = operations.filter(item => item.ConditionCheck);
    return db.send(new TransactWriteCommand({...command.input,
      TransactItems: composeDispatchTransaction(mutations, [...checks, ...guards], []),
    }));
  }};
}

const weekday = day => day[0].toUpperCase() + day.slice(1);

async function hours(db, secured, actor, branch, method, body) {
  const rows = await Promise.all(days.map(key => read(db, tables.hours, {businessId: branch.businessId, weekday: weekday(key)})));
  const fallback = new Map(schedule(branch, []).map(row => [row.weekday, row]));
  const version = quoteHash({rows: rows.map(row => row ?? null), openingHours: branch.openingHours ?? null});
  if (method === 'GET') {
    const workingHours = Object.fromEntries(days.map((key, index) => {
      const row = rows[index] ?? fallback.get(weekday(key));
      const isOpen = Boolean(row && row.isClosed !== true && time.test(row.opening) && time.test(row.closing));
      return [key, {isOpen, isClosed: !isOpen, openTime: isOpen ? row.opening : 'closed', closeTime: isOpen ? row.closing : 'closed'}];
    }));
    return reply(200, {success: true, workingHours, hoursVersion: version});
  }
  if (Object.keys(body).some(key => !['businessId','workingHours','hoursVersion'].includes(key)) ||
      !record(body.workingHours) || Object.keys(body.workingHours).length !== days.length) fail(400, 'INVALID_WORKING_HOURS');
  if (body.hoursVersion !== version) fail(409, 'WORKING_HOURS_CHANGED');
  const openingHours = days.map((key, index) => {
    const day = body.workingHours[key];
    if (!record(day) || typeof day.isOpen !== 'boolean' || (day.isClosed !== undefined && day.isClosed !== !day.isOpen) ||
        (day.isOpen && (!time.test(day.openTime) || !time.test(day.closeTime) || day.openTime >= day.closeTime))) {
      fail(400, 'INVALID_WORKING_HOURS');
    }
    return {day:index, closed:!day.isOpen, periods:day.isOpen ? [{open:day.openTime, close:day.closeTime}] : []};
  });
  const updatedAt = new Date().toISOString();
  const writes = schedule({...branch, openingHours}, []).map(row => ({Put: {TableName: tables.hours, Item:{...row,updatedAt}}}));
  // Fence against the rows read before the prospective update, including concurrent owner edits.
  const existing = new Map(rows.filter(Boolean).map(row => [row.weekday,row]));
  const baseline = {send: async cmd => ({Item: existing.get(cmd.input.Key.weekday)})};
  const audit = await prepare(baseline, actor, writes, {hoursTable:tables.hours, auditTable:tables.platform});
  const fence = {Update:{TableName:tables.businesses, Key:{businessId:branch.businessId},
    UpdateExpression:'SET openingHours=:hours, updatedAt=:now',
    ConditionExpression:branch.openingHours === undefined ? 'attribute_not_exists(openingHours)' : 'openingHours=:before',
    ExpressionAttributeValues:{':hours':openingHours, ':now':updatedAt,
      ...(branch.openingHours !== undefined && {':before':branch.openingHours})}}};
  await secured.send(new TransactWriteCommand({TransactItems:[...writes, fence, ...audit]}));
  return reply(200,{success:true});
}

function createApi({db, authorize, catalogRead, env = process.env}) {
  return async event => {
    if (event.requestContext?.stage !== 'production' || !event.path?.startsWith('/branch-device/')) return reply(404, {code:'NOT_FOUND'});
    if (env.ENVIRONMENT !== 'production' || env.MERCHANT_STAFF_PERMISSION_MODE !== 'CENTRAL' ||
        env.PRODUCTS_TABLE !== tables.products || env.MERCHANT_PLATFORM_TABLE !== tables.platform ||
        env.BUSINESSES_TABLE !== tables.businesses || env.CATEGORIES_TABLE !== 'wizz-production-MenuCategories' ||
        env.DISCOVERY_TABLE !== 'wizz-production-PlatformStaff') return reply(503, {code:'BRANCH_OPERATIONS_UNAVAILABLE'});
    try {
      const {httpMethod:method, queryStringParameters:query} = event;
      const path = event.path.slice('/branch-device'.length);
      if (event.isBase64Encoded || (event.body != null && (typeof event.body !== 'string' || Buffer.byteLength(event.body)>40000))) fail(400, 'INVALID_REQUEST');
      let body;
      try { body = JSON.parse(event.body || '{}'); } catch { fail(400, 'INVALID_REQUEST'); }
      if (!record(body) || (method === 'GET' && Object.keys(body).length)) fail(400, 'INVALID_REQUEST');
      const route = operation(path, method, body);
      const branch = route.scope ?? body.businessId ?? query?.businessId;
      if (!validId.test(branch ?? '') || typeof branch !== 'string') fail(400, 'INVALID_BRANCH_SCOPE');
      if ([body.businessId, query?.businessId].some(value => value !== undefined && value !== branch)) fail(403, 'BRANCH_SCOPE_REQUIRED');
      if (Object.keys(query ?? {}).some(key => key !== 'businessId')) fail(400, 'INVALID_REQUEST');
      const start = await authorize(event, branch, route.required);
      const verify = async () => {
        const current = await authorize(event, branch, route.required);
        if (current.scopeHash !== start.scopeHash) fail(409, 'VERSION_OR_STATE_CONFLICT');
        return current;
      };
      const secured = writeWithAuthority(db, verify);
      const actor = {sub:start.actor.subjectId, ownerId:start.actor.ownerId, businessId:branch,
        actorName:start.actorName, roleName:start.roleName, deviceId:start.deviceId, sessionId:start.sessionId,
        permissionVersion:start.membershipVersion, policyVersion:start.policyVersion,
        ownerIdFence:start.actor.ownerId, canClassifyMenu:start.permissions.includes('menu.edit'), deviceGuards:[]};
      let result;
      if (route.type === 'hours') {
        const current = await read(db, tables.businesses, {businessId:branch});
        if (current?.businessId !== branch || current?.ownerId !== actor.ownerId || current?.cognitoUserId !== actor.ownerId) fail(409, 'VERSION_OR_STATE_CONFLICT');
        result = await hours(db, secured, actor, current, method, body);
      } else if (method === 'GET') {
        if (route.productId) {
          const product = await read(db, tables.products, {productId:route.productId});
          if (product?.businessId !== branch) fail(404, 'PRODUCT_UNAVAILABLE');
          result = reply(200, {success:true,product:{...product,id:product.productId}});
        } else {
          result = await catalogRead(actor, {...event,path,httpMethod:method,queryStringParameters:{businessId:branch}});
        }
      } else {
        const input = {...event,path,pathParameters:{businessId:branch,productId:route.productId},body:JSON.stringify({...body,businessId:branch})};
        const mutation = await mutate(secured, actor, input);
        const versions = createMenuVersionService(secured,{actor:()=>actor});
        result = await complete(mutation, values => versions.publish(branch,values));
      }
      if (result.statusCode >= 500) return reply(503, {code:'BRANCH_OPERATIONS_UNAVAILABLE'});
      if (method === 'GET') await verify();
      return {...result, headers};
    } catch (error) {
      if (error.name === 'TransactionCanceledException') return reply(409, {code:'VERSION_OR_STATE_CONFLICT'});
      if ([400,401,403,404,409].includes(error.status) && /^[A-Z_]+$/.test(error.message)) return reply(error.status, {code:error.message});
      return reply(503, {code:'BRANCH_OPERATIONS_UNAVAILABLE'});
    }
  };
}

module.exports = {createApi};
