'use strict';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const test = require('node:test');

process.env.DISCOVERY_TABLE = 'wizz-production-PlatformStaff';
const { createApi, tables, path } = require('./api.cjs');

const branch = 'business_test';
const version = '2026-11-24T10:00:00.000Z';
const storageKeys = {
  [tables.platform]: ['pk', 'sk'], [tables.deletion]: ['pk', 'sk'], [tables.staff]: ['pk', 'sk'],
  [tables.products]: ['productId'], [tables.categories]: ['categoryId'],
  [tables.businesses]: ['businessId'], [tables.hours]: ['businessId', 'weekday'],
};

function fixture() {
  const records = new Map();
  const tx = [];
  const key = (table, input) => JSON.stringify([table, ...storageKeys[table].map(k => input[k])]);
  const put = (table, record) => records.set(key(table, record), record);
  const db = { async send({ input }) {
    if (input.Key) return { Item: records.get(key(input.TableName, input.Key)) };
    if (input.TransactItems) {
      tx.push(input.TransactItems);
      for (const { Put, Update } of input.TransactItems) {
        if (Put) put(Put.TableName, Put.Item);
        if (Update) {
          const previous = records.get(key(Update.TableName, Update.Key));
          const data = Object.fromEntries(Update.UpdateExpression.slice(4).split(',').map(pair => {
            const [k, v] = pair.trim().split('=');
            return [k, Update.ExpressionAttributeValues[v]];
          }));
          put(Update.TableName, { ...previous, ...data });
        }
      }
      return {};
    }
    assert.equal(input.TableName, tables.platform);
    const clauses = input.ExpressionAttributeValues;
    const items = [...records.entries()].filter(([k, row]) =>
      JSON.parse(k)[0] === tables.platform &&
      row.pk === (clauses[':pk'] ?? clauses[':p']) &&
      row.sk.startsWith(clauses[':prefix'] ?? clauses[':s'])).map(([, row]) => row);
    return { Items: items };
  }};
  put(tables.businesses, {
    businessId: branch, status: 'approved', ownerId: 'owner', cognitoUserId: 'owner',
    onboardingSchemaVersion: 2, onboardingDraftId: 'draft', businessName: 'فتوش',
    phoneNumber: '+9647000000000', address: { latitude: 32, longitude: 44, fullAddress: 'حي اختبار' },
    regionId: 'region', regionPath: ['country', 'governorate', 'district', 'region'],
    updatedAt: version, isActive: false, openingHours: [],
  });
  put(tables.platform, { pk: 'PERSON#owner', sk: 'DRAFT#draft', version: 2, businessId: branch,
    reviewStatus: 'APPROVED', submission: { agreement: { version: 'initial' } } });
  const app = createApi({ db, authenticate: async e => ({ sub: e.sub }),
    regions: { async validate() { return { regionId: 'region', checks: [] }; } } });
  async function call(input, sub = 'owner', query = {}) {
    const response = await app({ path, sub, requestContext: { stage: 'production' },
      httpMethod: input ? 'POST' : 'GET', queryStringParameters: { businessId: branch, ...query },
      body: JSON.stringify(input && { businessId: branch, ...input }) });
    return { status: response.statusCode, data: JSON.parse(response.body) };
  }
  return { call, put, records, tx };
}

test('catalog preparation publishes immutable pricing before activating the branch', async () => {
  const f = fixture();
  assert.deepEqual((await f.call()).data.status.missing, ['HOURS', 'PUBLISHED_MENU']);
  const category = { action: 'category', version: 0, requestId: randomUUID(), data: { name: 'مقبلات' } };
  const saved = await f.call(category);
  assert.equal(saved.status, 200);
  assert.deepEqual(await f.call(category), saved);
  assert.equal(f.tx.length, 1);
  assert.equal((await f.call({ ...category, requestId: randomUUID() })).data.code, 'MENU_CHANGED');
  assert.equal((await f.call({ ...category, data: { name: 'أخرى' } })).data.code, 'REQUEST_ID_CONFLICT');
  const categoryId = saved.data.id;
  const product = { action: 'product', version: 1, requestId: randomUUID(),
    data: { name: 'فتوش', categoryId, price: 5000, stock: 12, available: true } };
  assert.equal((await f.call(product)).status, 200);
  const days = Array.from({ length: 7 }, (_, day) => ({ day, closed: day !== 2,
    periods: day === 2 ? [{ open: '09:00', close: '19:00' }] : [] }));
  assert.equal((await f.call({ action: 'hours', version, requestId: randomUUID(), data: days })).status, 200);
  assert.deepEqual((await f.call()).data.status.missing, ['PUBLISHED_MENU']);
  const publish = await f.call({ action: 'publish', version: 2, requestId: randomUUID() });
  assert.equal(publish.status, 200);
  const snapshot = [...f.records.values()].find(row => row.product);
  assert.equal(snapshot.product.publishedCategory.categoryName, 'مقبلات');
  assert.equal(snapshot.product.price, 5000);
  assert.equal(snapshot.product.stock, undefined);
  const setup = (await f.call()).data;
  assert.deepEqual(setup.status.missing, []);
  assert.equal(setup.status.active, false);
  const activated = await f.call({ action: 'activate', version: setup.branchVersion, requestId: randomUUID() });
  assert.deepEqual(activated.data, { activated: true, ready: true, acceptingOrders: false });
  assert.equal((await f.call()).data.status.active, true);
  assert.equal(f.tx.at(-1).filter(item => item.ConditionCheck?.TableName === tables.hours).length, 7);
});

test('ownership and account closure prevent catalog access or writes', async () => {
  const f = fixture();
  assert.equal((await f.call(null, 'another')).status, 404);
  const category = { action: 'category', version: 0, requestId: randomUUID(), data: { id: 'foreign', name: 'فئة' } };
  f.put(tables.categories, { categoryId: 'foreign', businessId: 'another' });
  assert.equal((await f.call(category)).status, 404);
  f.put(tables.deletion, { pk: 'ACCOUNT_LIFECYCLE#MERCHANT#owner', sk: 'META' });
  assert.equal((await f.call(category)).status, 409);
  assert.deepEqual(f.tx, []);
});


test('branch readiness avoids legacy draft rows when the shared catalog owns products', async () => {
  const f = fixture();
  f.put(tables.platform, { pk: 'BRANCH#' + branch, sk: 'MENU_DRAFT#PRODUCT#old', productId: 'old' });
  const result = await f.call(null, 'owner', { view: 'readiness' });
  assert.equal(result.status, 200);
  assert.deepEqual(result.data.status.missing, ['HOURS', 'PUBLISHED_MENU']);
  assert.equal(result.data.products, undefined);
  assert.equal((await f.call(null, 'other', { view: 'readiness' })).status, 404);
});
