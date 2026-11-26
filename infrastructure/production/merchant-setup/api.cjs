'use strict';

const { createHash, randomUUID } = require('node:crypto');
const { GetCommand, QueryCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { createMenuVersionService } = require('../../../../whizzMerchants-stg/backend/functions/products/menu_versions');
const { validSchedule, schedule } = require('../../../../whizzMerchants-stg/backend/functions/business/branch_readiness');
const { createService: branchDrafts } = require('../merchant-branches/branch-drafts.cjs');

const path = '/auth/branch-setup';
const tables = Object.freeze({
  platform: 'wizz-production-MerchantPlatform', products: 'wizz-production-Products',
  categories: 'wizz-production-MenuCategories', businesses: 'wizz-production-Merchants',
  hours: 'wizz-production-WorkingHours', deletion: 'wizz-production-AccountDeletion', staff: 'wizz-production-PlatformStaff',
});
const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const actionNames = new Set(['category', 'product', 'hours', 'publish', 'rollback', 'activate']);
const id = v => typeof v === 'string' && /^[\w-]{1,150}$/.test(v);
const uuid = v => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const fail = (code, status = 400) => Object.assign(new Error(code), { status });
const key = (businessId, sk) => ({ pk: 'BRANCH#' + businessId, sk });
const read = async (db, TableName, Key) => (await db.send(new GetCommand({ TableName, Key, ConsistentRead: true }))).Item;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const checked = (TableName, Key, ConditionExpression, ExpressionAttributeValues, ExpressionAttributeNames) => ({
  ConditionCheck: { TableName, Key, ConditionExpression,
    ...(ExpressionAttributeValues && { ExpressionAttributeValues }),
    ...(ExpressionAttributeNames && { ExpressionAttributeNames }) },
});
const putOnce = (TableName, Item, keyName = 'pk') => ({ Put: { TableName, Item, ConditionExpression: 'attribute_not_exists(' + keyName + ')' } });
const accountKeys = (owner, businessId) => ['ACCOUNT_LIFECYCLE#MERCHANT#' + owner, 'BUSINESS_LIFECYCLE#MERCHANT#' + businessId];
const authorization = (owner, b) => accountKeys(owner, b.businessId).map(pk =>
  checked(tables.deletion, { pk, sk: 'META' }, 'attribute_not_exists(pk)'));
const branchState = '#state=:approved AND ownerId=:owner AND cognitoUserId=:owner AND attribute_not_exists(deletionRequestId) AND attribute_not_exists(deletedAt) AND (attribute_not_exists(isDeleted) OR isDeleted=:no)';
const branchValues = owner => ({ ':approved': 'approved', ':owner': owner, ':no': false });
const branchKey = b => ({ businessId: b.businessId });
const branchCheck = b => checked(tables.businesses, branchKey(b), branchState,
  branchValues(b.ownerId), { '#state': 'status' });

function payload(event) {
  let input;
  try {
    if (event.httpMethod === 'GET') input = event.queryStringParameters;
    else if (typeof event.body === 'string' && !event.isBase64Encoded && Buffer.byteLength(event.body) <= 32000) input = JSON.parse(event.body);
    if (!input || Array.isArray(input) || !id(input.businessId)) throw Error();
    const fields = event.httpMethod === 'GET' ? ['businessId', 'view'] : ['businessId', 'action', 'version', 'requestId', 'data'];
    if (Object.keys(input).some(k => !fields.includes(k))) throw Error();
    if (input.view !== undefined && input.view !== 'readiness') throw Error();
    if (event.httpMethod === 'POST' && (!actionNames.has(input.action) || !uuid(input.requestId))) throw Error();
  } catch { throw fail('INVALID_SETUP_REQUEST'); }
  return input;
}

async function rows(db, branch, prefix, limit) {
  let cursor;
  const results = [];
  do {
    const page = await db.send(new QueryCommand({
      TableName: tables.platform, KeyConditionExpression: 'pk=:pk AND begins_with(sk,:prefix)',
      ExpressionAttributeValues: { ':pk': 'BRANCH#' + branch, ':prefix': prefix },
      ConsistentRead: true, Limit: 100, ...(cursor && { ExclusiveStartKey: cursor }),
    }));
    results.push(...page.Items || []);
    if (results.length > limit) throw fail('MENU_TOO_LARGE', 409);
    cursor = page.LastEvaluatedKey;
  } while (cursor);
  return results;
}

async function catalog(db, branch, kind) {
  const registry = await rows(db, branch, 'MENU_DRAFT#' + kind.toUpperCase() + '#', kind === 'product' ? 1000 : 500);
  const table = kind === 'product' ? tables.products : tables.categories;
  const keyName = kind + 'Id';
  const out = [];
  for (let i = 0; i < registry.length; i += 16) {
    out.push(...await Promise.all(registry.slice(i, i + 16).map(async row => {
      const item = await read(db, table, { [keyName]: row[keyName] });
      if (item?.businessId !== branch) throw fail('MENU_SOURCE_UNAVAILABLE', 409);
      return item;
    })));
  }
  return out;
}

function menu(db, b) {
  return createMenuVersionService(db, {
    tables, readDraftProducts: branch => catalog(db, branch, 'product'),
    verifyDraft: (draft, body) => {
      if (body.version !== (draft?.version ?? 0)) throw fail('MENU_CHANGED', 409);
    },
    actor: () => ({ sub: b.ownerId, ownerId: b.ownerId, ownerIdFence: b.ownerId,
      roleName: 'OWNER', deviceGuards: authorization(b.ownerId, b) }),
  });
}

function draftFence(version, actual) {
  if (!Number.isSafeInteger(version) || version < 0 || version !== (actual?.version ?? 0)) throw fail('MENU_CHANGED', 409);
  return actual
    ? { ConditionExpression: '#v=:version', ExpressionAttributeNames: { '#v': 'version' },
      ExpressionAttributeValues: { ':version': version } }
    : { ConditionExpression: 'attribute_not_exists(pk)' };
}

function nameOf(value, max, opt = false) {
  if (opt && value === undefined) return '';
  if (typeof value !== 'string' || (!opt && !value.trim()) || value.length > max || /[<>\u0000-\u001F]/.test(value)) {
    throw fail('INVALID_MENU_FIELDS');
  }
  return value.trim();
}
async function saveCatalogItem(db, b, input, meta) {
  const branch = b.businessId;
  const fence = draftFence(input.version, meta);
  const kind = input.action;
  const product = kind === 'product';
  const fields = product ? ['id', 'name', 'description', 'categoryId', 'price', 'available', 'stock'] : ['id', 'name'];
  const values = input.data;
  if (!values || typeof values !== 'object' || Array.isArray(values) || Object.keys(values).some(k => !fields.includes(k)) ||
      (values.id !== undefined && !id(values.id))) throw fail('INVALID_MENU_FIELDS');
  const itemId = values.id || (product ? 'product_' : 'cat_') + hash(branch + input.requestId).slice(0, 32);
  const keyName = kind + 'Id';
  const itemKey = { [keyName]: itemId };
  const table = product ? tables.products : tables.categories;
  const previous = values.id ? await read(db, table, itemKey) : null;
  if (values.id && previous?.businessId !== branch) throw fail('MENU_ITEM_UNAVAILABLE', 404);
  if (!previous) {
    const limit = product ? 1000 : 500;
    const current = await rows(db, branch, 'MENU_DRAFT#' + kind.toUpperCase() + '#', limit);
    if (current.length >= limit) throw fail('MENU_TOO_LARGE', 409);
  }
  const at = new Date().toISOString(), name = nameOf(values.name, 100);
  let data;
  const conditions = [];
  if (product) {
    if (!Number.isSafeInteger(values.price) || values.price < 1 || values.price > 1000000000 ||
        (values.stock != null && (!Number.isSafeInteger(values.stock) || values.stock < 0)) ||
        typeof values.available !== 'boolean' || !id(values.categoryId)) throw fail('INVALID_MENU_FIELDS');
    const categoryKey = { categoryId: values.categoryId };
    const category = await read(db, tables.categories, categoryKey);
    if (category?.businessId !== branch || category.isActive !== true) throw fail('MENU_CATEGORY_UNAVAILABLE', 409);
    conditions.push(checked(tables.categories, categoryKey, 'businessId=:b AND isActive=:yes', { ':b': branch, ':yes': true }));
    data = { name, description: nameOf(values.description, 1000, true), categoryId: values.categoryId,
      price: values.price, isAvailable: values.available, stock: values.stock ?? undefined };
  } else {
    data = { categoryName: name, isActive: true, sortOrder: previous?.sortOrder || 0, version: (previous?.version || 0) + 1 };
  }
  const item = { ...previous, ...itemKey, ...data, businessId: branch, updatedAt: at, createdAt: previous?.createdAt || at };
  const rowKey = key(branch, 'MENU_DRAFT#' + kind.toUpperCase() + '#' + itemId);
  const output = { saved: true, id: itemId, version: input.version + 1 };
  await mutate(db, b, input, output, [
    { Put: { TableName: tables.platform, Item: { ...key(branch, 'MENU_DRAFT#META'), businessId: branch, version: output.version, updatedAt: at }, ...fence } },
    { Put: { TableName: table, Item: item, ...(previous ? {
      ConditionExpression: 'businessId=:b AND updatedAt=:at', ExpressionAttributeValues: { ':b': branch, ':at': previous.updatedAt },
    } : { ConditionExpression: 'attribute_not_exists(' + keyName + ')' }) } },
    { Put: { TableName: tables.platform, Item: { ...rowKey, ...itemKey, businessId: branch } } },
    ...conditions,
  ]);
  return output;
}

const markerKey = (b, input) => key(b.businessId, 'MENU_SETUP_REQUEST#' + input.requestId);
const fingerprint = input => hash(input);
async function mutate(db, b, input, output, operations, branchWrite = false) {
  const at = new Date().toISOString();
  await db.send(new TransactWriteCommand({ TransactItems: [
    ...authorization(b.ownerId, b), ...(!branchWrite ? [branchCheck(b)] : []), ...operations,
    putOnce(tables.platform, { ...markerKey(b, input), fingerprint: fingerprint(input), result: output,
      expiresAt: Math.floor(Date.now() / 1000) + 90 * 86400 }),
    putOnce(tables.platform, { ...key(b.businessId, 'STAFF_AUDIT#OPERATIONS#' + at + '#' + randomUUID()),
      action: 'BRANCH_SETUP_' + input.action.toUpperCase(), actorId: b.ownerId, createdAt: at, after: output }),
  ] }));
}

const parseHours = branchDrafts({
  sdk: {}, regions: { validate() {} }, tables: { platform: tables.platform, policy: tables.staff, lifecycle: tables.deletion },
}).hours;

async function saveHours(db, b, input) {
  const hours = parseHours(input.data);
  if (!hours || hours.some(day => day.periods.length > 1) || !hours.some(day => !day.closed)) throw fail('WORKING_HOURS_REQUIRED', 409);
  if (typeof input.version !== 'string' || input.version !== b.updatedAt) throw fail('MENU_CHANGED', 409);
  const updatedAt = new Date().toISOString();
  const hoursRows = schedule({ ...b, openingHours: hours }, []);
  const output = { saved: true, updatedAt };
  await mutate(db, b, input, output, [
    { Update: { TableName: tables.businesses, Key: branchKey(b),
      UpdateExpression: 'SET openingHours=:hours, updatedAt=:at',
      ConditionExpression: branchState + ' AND updatedAt=:old', ExpressionAttributeNames: { '#state': 'status' },
      ExpressionAttributeValues: { ...branchValues(b.ownerId), ':hours': hours, ':at': updatedAt, ':old': b.updatedAt } } },
    ...hoursRows.map(row => ({ Put: { TableName: tables.hours, Item: { ...row, updatedAt } } })),
  ], true);
  return output;
}

async function readiness(db, b, active, regions) {
  const missing = [];
  if (b.platformSuspended || b.ordersBlocked) missing.push('APPROVAL');
  if (b.onboardingSchemaVersion !== 2 || !(b.businessName || b.name)?.trim() ||
      !/^\+9647\d{9}$/.test(b.phoneNumber || '') || !b.address?.fullAddress?.trim()) missing.push('DETAILS');
  let region;
  try {
    region = await regions.validate(b.regionPath, b.address?.latitude, b.address?.longitude);
    if (region.regionId !== b.regionId) missing.push('LOCATION');
  } catch (error) {
    if (error.status && error.status < 500) missing.push('LOCATION');
    else throw error;
  }
  const draft = b.onboardingDraftId && await read(db, tables.platform, { pk: 'PERSON#' + b.ownerId, sk: 'DRAFT#' + b.onboardingDraftId });
  if (!draft || draft.businessId !== b.businessId || draft.reviewStatus !== 'APPROVED' || !draft.submission?.agreement?.version) missing.push('AGREEMENT');
  const storedHours = (await Promise.all(days.map(weekday => read(db, tables.hours, { ...branchKey(b), weekday })))).filter(Boolean);
  const working = schedule(b, storedHours);
  if (working.length !== 7 || !validSchedule(working)) missing.push('HOURS');
  let available;
  if (active?.publishedVersion) {
    const snapshots = await rows(db, b.businessId, 'MENU_VERSION#' + active.publishedVersion + '#PRODUCT#', 1000);
    for (const row of snapshots) {
      if (row.product?.isAvailable !== true || row.product.businessId !== b.businessId) continue;
      const live = await read(db, tables.products, { productId: row.productId });
      if (live?.businessId === b.businessId && live.isAvailable === true && !live.isDeleted && !live.deletedAt &&
          (live.stock === undefined || live.stock > 0)) {
        available = live;
        break;
      }
    }
  }
  if (!available) missing.push('PUBLISHED_MENU');
  return { missing, draft, working, storedHours, region, available };
}

async function activate(db, b, input, active, ready) {
  if (b.onboardingComplete === true && b.isActive === true) return { activated: true, alreadyActivated: true };
  if (ready.missing.length) return { activated: false, ready: false, missing: ready.missing };
  if (input.version !== b.updatedAt) throw fail('MENU_CHANGED', 409);
  const { draft, working, storedHours, region, available } = ready;
  const at = new Date().toISOString();
  const output = { activated: true, ready: true, acceptingOrders: false };
  await mutate(db, b, input, output, [
    ...region.checks,
    checked(tables.platform, { pk: draft.pk, sk: draft.sk }, 'businessId=:b AND #v=:v AND reviewStatus=:s',
      { ':b': b.businessId, ':v': draft.version, ':s': 'APPROVED' }, { '#v': 'version' }),
    checked(tables.platform, key(b.businessId, 'MENU_VERSION#ACTIVE'), 'publishedVersion=:v', { ':v': active.publishedVersion }),
    checked(tables.products, { productId: available.productId }, 'businessId=:b AND isAvailable=:yes AND #at=:at AND (attribute_not_exists(stock) OR stock>:zero)',
      { ':b': b.businessId, ':yes': true, ':at': available.updatedAt, ':zero': 0 }, { '#at': 'updatedAt' }),
    { Update: {
      TableName: tables.businesses, Key: branchKey(b), ExpressionAttributeNames: { '#state': 'status' },
      ConditionExpression: branchState + ' AND updatedAt=:old AND (attribute_not_exists(platformSuspended) OR platformSuspended=:no) AND (attribute_not_exists(ordersBlocked) OR ordersBlocked=:no)',
      UpdateExpression: 'SET onboardingComplete=:yes, isActive=:yes, acceptingOrders=:no, onlineStatus=:status, operatingStatus=:operating, activatedAt=:at, updatedAt=:at, latitude=:lat, longitude=:lon',
      ExpressionAttributeValues: { ...branchValues(b.ownerId), ':yes': true, ':status': 'offline', ':operating': 'OFFLINE', ':at': at, ':old': b.updatedAt, ':lat': b.address.latitude, ':lon': b.address.longitude },
    } },
    ...(!storedHours.length ? working.map(row => putOnce(tables.hours, { ...row, createdAt: at, updatedAt: at }, 'businessId'))
      : storedHours.map(row => checked(tables.hours, { ...branchKey(b), weekday: row.weekday },
        'opening=:o AND closing=:c AND ' + (row.isClosed === undefined ? 'attribute_not_exists(isClosed)' : 'isClosed=:closed'),
        { ':o': row.opening, ':c': row.closing, ...(row.isClosed !== undefined && { ':closed': row.isClosed }) }))),
  ], true);
  return output;
}

function createApi({ db, authenticate, regions }) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization,Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
  const reply = (statusCode, value) => ({ statusCode, headers, body: value === null ? '' : JSON.stringify(value) });
  return async event => {
    try {
      if (event.path !== path || event.requestContext?.stage !== 'production') throw fail('NOT_FOUND', 404);
      if (event.httpMethod === 'OPTIONS') return reply(204, null);
      if (!['GET', 'POST'].includes(event.httpMethod)) throw fail('METHOD_NOT_ALLOWED', 405);
      const { sub } = await authenticate(event);
      const input = payload(event);
      const b = await read(db, tables.businesses, { businessId: input.businessId });
      if (b?.status !== 'approved' || b.ownerId !== sub || b.cognitoUserId !== sub ||
          b.isDeleted || b.deletedAt || b.deletionRequestId) throw fail('BRANCH_UNAVAILABLE', 404);
      const closing = await Promise.all(accountKeys(sub, b.businessId).map(pk => read(db, tables.deletion, { pk, sk: 'META' })));
      if (closing.some(Boolean)) throw fail('BRANCH_UNAVAILABLE', 409);
      const details = missing => ({ branchVersion: b.updatedAt,
        status: { missing, active: b.onboardingComplete === true && b.isActive === true },
        hours: b.openingHours || [] });
      if (input.view === 'readiness') {
        const active = await read(db, tables.platform, key(b.businessId, 'MENU_VERSION#ACTIVE'));
        const ready = await readiness(db, b, active, regions);
        return reply(200, details(ready.missing));
      }
      const publisher = menu(db, b);
      if (event.httpMethod === 'POST') {
        const replay = await read(db, tables.platform, markerKey(b, input));
        if (replay) {
          if (replay.fingerprint !== fingerprint(input)) throw fail('REQUEST_ID_CONFLICT', 409);
          return reply(200, replay.result);
        }
        if (input.action === 'publish') return reply(200, await publisher.publish(b.businessId, input));
        if (input.action === 'rollback') return reply(200, await publisher.rollback(b.businessId, { version: input.data?.version, requestId: input.requestId }));
        if (input.action === 'hours') return reply(200, await saveHours(db, b, input));
        if (input.action === 'activate') {
          const { active } = await publisher.status(b.businessId);
          return reply(200, await activate(db, b, input, active, await readiness(db, b, active, regions)));
        }
        const meta = await read(db, tables.platform, key(b.businessId, 'MENU_DRAFT#META'));
        return reply(200, await saveCatalogItem(db, b, input, meta));
      }
      const [menuState, products, categories, meta] = await Promise.all([
        publisher.status(b.businessId), catalog(db, b.businessId, 'product'), catalog(db, b.businessId, 'category'),
        read(db, tables.platform, key(b.businessId, 'MENU_DRAFT#META')),
      ]);
      const ready = await readiness(db, b, menuState.active, regions);
      return reply(200, { products: products.map(({ productId, categoryId, name, description, price, isAvailable, stock }) =>
        ({ productId, categoryId, name, description, price, isAvailable, stock })),
        categories: categories.map(({ categoryId, categoryName }) => ({ categoryId, categoryName })),
        menu: menuState, draftVersion: meta?.version ?? 0,
        ...details(ready.missing) });
    } catch (error) {
      const collision = ['TransactionCanceledException', 'ConditionalCheckFailedException'].includes(error.name);
      if (!collision && !error.status) console.warn(JSON.stringify({ event: 'MERCHANT_SETUP_FAILURE', name: error.name }));
      return reply(collision ? 409 : error.status || 503, { code: collision ? 'MENU_CHANGED' : error.status ? error.message : 'SETUP_UNAVAILABLE' });
    }
  };
}
module.exports = { createApi, tables, path };
