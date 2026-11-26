'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { GetCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { createHandler } = require('./api.cjs');

const event = (path, method = 'GET', body) => ({
  path, httpMethod: method, requestContext: { stage: 'production' },
  queryStringParameters: { businessId: 'business_original' },
  ...(body && { body: JSON.stringify(body) }),
});

function fixture({ owner = 'owner', closed = false } = {}) {
  const commands = [], requests = [], media = [];
  const handler = createHandler({
    db: { async send({ input }) {
      commands.push(input);
      if (input.TableName === 'wizz-production-Merchants') {
        return { Item: { businessId: 'business_original', status: 'approved', ownerId: owner,
          cognitoUserId: owner, onboardingSchemaVersion: 2, isActive: false } };
      }
      assert.equal(input.TableName, 'wizz-production-AccountDeletion');
      return { Item: closed ? { ...input.Key } : undefined };
    } },
    authenticate: async () => ({ sub: 'owner' }),
    redirectMedia: async key => {
      media.push(key);
      return 'https://s3.example/' + key;
    },
    runCatalog: async (actor, request) => {
      requests.push({ actor, request, kind: 'catalog' });
      return { statusCode: 200, body: JSON.stringify({ success: true }) };
    },
    runUpload: async (actor, request) => {
      requests.push({ actor, request, kind: 'upload' });
      return { statusCode: 200, body: JSON.stringify({ success: true }) };
    },
    runDiscounts: async (actor, request) => {
      requests.push({ actor, request, kind: 'discounts' });
      return { statusCode: 200, body: JSON.stringify({ success: true }) };
    },
  });
  return { handler, commands, requests, media };
}

test('the original menu, options, intake and media routes receive the verified branch scope', async () => {
  const f = fixture();
  for (const [path, method, param, value] of [
    ['/products', 'POST'],
    ['/products/item_1', 'PUT', 'productId', 'item_1'],
    ['/products/item_1', 'DELETE', 'productId', 'item_1'],
    ['/products/inventory', 'POST'],
    ['/products/imports/job_1/commit', 'POST', 'importJobId', 'job_1'],
    ['/categories/business-type/RESTAURANT', 'GET', 'businessType', 'RESTAURANT'],
    ['/categories/category_1', 'DELETE', 'categoryId', 'category_1'],
    ['/menu/versions/rollback', 'POST'],
    ['/upload/product-image', 'POST'],
  ]) {
    assert.equal((await f.handler(event(path, method))).statusCode, 200);
    const call = f.requests.at(-1);
    assert.deepEqual(call.actor, { sub: 'owner', ownerId: 'owner', businessId: 'business_original',
      roleName: 'OWNER', preparingFirstMenu: true });
    if (param) assert.equal(call.request.pathParameters[param], value);
    assert.equal(call.kind, path.startsWith('/upload/') ? 'upload' : 'catalog');
  }
  assert.ok(f.commands.every(({ ConsistentRead }) => ConsistentRead === true));
});

test('other branches, closing accounts, unexpected actions and staging cannot reach the catalog', async () => {
  const foreign = fixture({ owner: 'other' });
  assert.equal((await foreign.handler(event('/products'))).statusCode, 404);
  assert.deepEqual(foreign.requests, []);
  const closed = fixture({ closed: true });
  assert.equal((await closed.handler(event('/products', 'POST'))).statusCode, 409);
  assert.deepEqual(closed.requests, []);
  const f = fixture();
  assert.equal((await f.handler(event('/products', 'POST', { businessId: 'other' }))).statusCode, 403);
  assert.equal((await f.handler(event('/uploads/business-photo'))).statusCode, 404);
  assert.equal((await f.handler(event('/products/imports/preview', 'DELETE'))).statusCode, 405);
  assert.equal((await f.handler({ ...event('/products'), requestContext: { stage: 'staging' } })).statusCode, 404);
  assert.deepEqual(f.commands, []);
});

test('public media only signs existing product-image key shapes for GET', async () => {
  const f = fixture();
  const route = '/media/merchants/business_original/product-images/photo.jpg';
  const result = await f.handler(event(route));
  assert.equal(result.statusCode, 302);
  assert.equal(result.headers.Location, 'https://s3.example/merchants/business_original/product-images/photo.jpg');
  assert.equal((await f.handler(event(route, 'POST'))).statusCode, 405);
  for (const path of [route.replace('photo.jpg', 'photo.pdf'),
    route.replace('product-images', 'registration'), route.replace('photo.jpg', '../photo.jpg')]) {
    assert.equal((await f.handler(event(path))).statusCode, 404);
  }
  assert.equal(f.media.length, 1);
  assert.deepEqual(f.commands, []);
});

test('discount routes use the verified owner branch and the existing mutation methods', async () => {
  const f = fixture();
  for (const [path, method] of [
    ['/discounts', 'GET'], ['/discounts', 'POST'], ['/discounts/welcome', 'PUT'],
    ['/discounts/welcome', 'DELETE'], ['/discounts/welcome/toggle-status', 'PATCH'],
  ]) {
    assert.equal((await f.handler(event(path, method))).statusCode, 200);
    const { actor, request, kind } = f.requests.at(-1);
    assert.equal(kind, 'discounts');
    assert.equal(actor.sub, 'owner');
    assert.equal(actor.businessId, 'business_original');
    assert.equal(request.pathParameters.discountId, path.split('/')[2]);
  }
  assert.equal((await f.handler(event('/discounts/welcome/toggle-status', 'PUT'))).statusCode, 405);
  const foreign = fixture({ owner: 'other' });
  assert.equal((await foreign.handler(event('/discounts', 'POST'))).statusCode, 404);
  assert.deepEqual(foreign.requests, []);
});

test('the existing lifecycle guard adds production ownership, deletion and menu revision fences', async () => {
  const previous = { ...process.env };
  Object.assign(process.env, { ENVIRONMENT: 'production', BUSINESSES_TABLE: 'wizz-production-Merchants',
    MERCHANT_PLATFORM_TABLE: 'wizz-production-MerchantPlatform' });
  try {
    const { merchantRequestContext, merchantLifecycleClient } = require('../../../../whizzMerchants-stg/backend/functions/shared/merchant-lifecycle');
    const requests = [];
    const db = merchantLifecycleClient({ async send(command) {
      assert.equal(command.constructor.name, TransactWriteCommand.name);
      requests.push(command.input.TransactItems);
      return {};
    } });
    const actor = { sub: 'owner', ownerId: 'owner', businessId: 'business_original' };
    await merchantRequestContext.run(actor, () => db.send(new TransactWriteCommand({ TransactItems: [
      { Put: { TableName: 'wizz-production-Products', Item: { productId: 'item', businessId: actor.businessId } } },
    ] })));
    const operations = requests[0].map(item => Object.values(item)[0]);
    assert.ok(operations.every(o => o.TableName.startsWith('wizz-production-')));
    assert.equal(operations.filter(o => o.TableName === 'wizz-production-AccountDeletion').length, 2);
    const branch = operations.find(o => o.TableName === 'wizz-production-Merchants');
    assert.equal(branch.ExpressionAttributeValues[':sub'], actor.sub);
    assert.equal(branch.ExpressionAttributeValues[':lifecycleApproved'], 'approved');
    assert.ok(operations.some(o => o.TableName === 'wizz-production-MerchantPlatform' && o.Key.sk === 'MENU_DRAFT#META'));
  } finally {
    process.env = previous;
  }
});

test('owner discounts use production tables, fence revisions and keep shared terms locked', async () => {
  const previous = { ...process.env };
  Object.assign(process.env, { ENVIRONMENT:'production', BUSINESSES_TABLE:'wizz-production-Merchants',
    DISCOUNTS_TABLE:'wizz-production-MerchantDiscounts' });
  try {
    const { merchantRequestContext } = require('../../../../whizzMerchants-stg/backend/functions/shared/merchant-lifecycle');
    const { authorizedHandler } = require('../../../../whizzMerchants-stg/backend/functions/discounts/discount_management_handler');
    const { revision } = require('../../../../whizzMerchants-stg/backend/functions/shared/campaign-version');
    let row, shared = false;
    const writes = [];
    const db = { async send(command) {
      const input = command.input;
      switch (command.constructor.name) {
        case 'GetCommand':
          assert.equal(input.ConsistentRead, true);
          if (input.TableName === 'wizz-production-MerchantDiscounts') {
            return { Item: input.Key.discountId === row?.discountId ? row : undefined };
          }
          assert.equal(input.TableName, 'wizz-production-MerchantPlatform');
          return { Item: shared && input.Key.pk.startsWith('CAMPAIGN_SHARING_LOCK#MERCHANT#') ? input.Key : undefined };
        case 'TransactWriteCommand':
          writes.push(input.TransactItems);
          assert.ok(input.TransactItems.every(op => Object.values(op)[0].TableName.startsWith('wizz-production-')));
          row = input.TransactItems.find(op => op.Put?.Item.discountId)?.Put.Item;
          return {};
        default: throw Error(command.constructor.name);
      }
    }};
    const call = (method, path, body, expected) => {
      const request = event(path, method, body);
      request.pathParameters = path.split('/')[2] ? {discountId:path.split('/')[2]} : {};
      request.queryStringParameters.baseRevision = expected;
      return merchantRequestContext.run({ sub:'owner', ownerId:'owner', businessId:'business_original',
        campaignBaseRevision:expected }, () => authorizedHandler(db, request));
    };
    const offer = { title:'عرض',type:'percentage',value:10,validFrom:'2020-01-01T00:00:00Z',
      validTo:'2099-01-01T00:00:00Z' };
    assert.equal((await call('POST','/discounts',{...offer,type:'freeDelivery'})).statusCode,409);
    const created = await call('POST','/discounts',offer);
    assert.equal(created.statusCode,201,created.body);
    assert.equal(row.version,1);
    assert.equal(row.businessId,'business_original');
    assert.equal(writes[0].filter(op => op.ConditionCheck?.TableName === 'wizz-production-AccountDeletion').length,2);
    const path = '/discounts/' + row.discountId;
    const known = revision(row);
    assert.equal((await call('PUT',path,{value:20},'f'.repeat(64))).statusCode,409);
    assert.equal(writes.length,1);
    const updated = await call('PUT',path,{value:20},known);
    assert.equal(updated.statusCode,200,updated.body);
    assert.equal(row.value,20);
    assert.equal(row.version,2);
    assert.equal(writes[1].filter(op => op.ConditionCheck?.TableName === 'wizz-production-MerchantPlatform').length,2);
    shared = true;
    const locked = await call('PUT',path,{value:30},revision(row));
    assert.equal(locked.statusCode,409,locked.body);
    assert.equal(JSON.parse(locked.body).code,'SHARED_DISCOUNT_TERMS_LOCKED');
    assert.equal(writes.length,2);
  } finally {
    process.env = previous;
  }
});

test('production image upload registration cannot pass the branch closure fence', async () => {
  const previous = { ...process.env };
  Object.assign(process.env, { ENVIRONMENT: 'production', BUSINESSES_TABLE: 'wizz-production-Merchants',
    MERCHANT_PLATFORM_TABLE: 'wizz-production-MerchantPlatform' });
  try {
    const { merchantRequestContext, beginMerchantUpload } =
      require('../../../../whizzMerchants-stg/backend/functions/shared/merchant-lifecycle');
    const actor = { sub: 'owner', ownerId: 'owner', businessId: 'business_original' };
    let uploads = 0;
    const db = { async send(command) {
      const items = command.input.TransactItems;
      assert.ok(items.some(({ ConditionCheck: check }) =>
        check?.Key?.pk === 'BUSINESS_LIFECYCLE#MERCHANT#' + actor.businessId &&
        check.ConditionExpression === 'attribute_not_exists(pk)'));
      assert.ok(items.some(({ Put: put }) => put?.Item?.businessId === actor.businessId &&
        put.Item.pk === 'ACCOUNT_OPERATION#MERCHANT#' + actor.sub));
      throw Object.assign(Error('branch closed'), { name: 'TransactionCanceledException' });
    } };
    await assert.rejects(merchantRequestContext.run(actor, async () => {
      const release = await beginMerchantUpload(db);
      uploads++;
      await release();
    }), /branch closed/);
    assert.equal(uploads, 0);
  } finally {
    process.env = previous;
  }
});
