'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createPublicApi, createStaffApi, publicPath, staffPath } = require('./api.cjs');
const { identities } = require('../wallet-identity-bindings.json');

function fixture(now = () => Date.parse('2026-11-23T12:00:00Z'), offerEligibility) {
  const rows = new Map();
  const transactions = [];
  const images = new Map();
  const assets = {
    async put(key, body) { images.set(key, body); },
    async head(key) {
      const body = images.get(key);
      return body && { ContentLength: body.length, ContentType: key.endsWith('.gif') ? 'image/gif' : 'image/jpeg' };
    },
    async url(key) { return 'https://example.com/' + key; },
  };
  const staff = 'wizz-production-PlatformStaff';
  const admin = {
    pk: 'EMPLOYEE#admin', sk: 'PROFILE', employeeId: 'admin', status: 'ACTIVE',
    version: 2, roles: ['promotions_manager', 'promotions_approver'], scope: { allRegions: true },
  };
  const put = (table, key, data) => rows.set(table + JSON.stringify(key), { ...key, ...data });
  put(staff, { pk: admin.pk, sk: admin.sk }, admin);
  put('wizz-production-Regions', { regionId: 'hirah' }, { parent_id: 'manathera' });
  put('wizz-production-Regions', { regionId: 'manathera' }, {});
  put('wizz-production-Merchants', { businessId: 'branch' }, { isActive: true });
  put('wizz-production-Customers', { userId: 'customer' }, { cognitoSub: 'customer', isActive: true });
  const db = {
    async send(command) {
      const input = command.input;
      if (command.constructor.name === 'GetCommand') {
        assert.match(input.TableName, /^wizz-production-/);
        return { Item: rows.get(input.TableName + JSON.stringify(input.Key)) };
      }
      if (command.constructor.name === 'ScanCommand') {
        return { Items: [...rows.entries()].filter(([key]) => key.startsWith(input.TableName)).map(([, row]) => row) };
      }
      if (command.constructor.name === 'QueryCommand') {
        if (input.ExpressionAttributeValues[':pk'] === 'OPERATIONAL_SETTINGS#ORDER_RECEPTION') return { Items: [] };
        if (input.TableName === 'wizz-production-MerchantPlatform') {
          return { Items: [...rows.entries()].filter(([key, row]) =>
            key.startsWith(input.TableName) && row.pk === input.ExpressionAttributeValues[':p'] &&
            row.sk.startsWith(input.ExpressionAttributeValues[':s'])).map(([, row]) => row) };
        }
        assert.equal(input.IndexName,'BusinessIdIndex');
        return {Items:[...rows.entries()].filter(([key,row])=>key.startsWith(input.TableName) &&
          row.businessId===input.ExpressionAttributeValues[':business']).map(([,row])=>row)};
      }
      assert.equal(command.constructor.name, 'TransactWriteCommand');
      transactions.push(input.TransactItems);
      const event = input.TransactItems[0].Put;
      if (event?.Item.pk.startsWith('EVENT#')) {
        const { pk, sk } = event.Item;
        if (rows.has(event.TableName + JSON.stringify({ pk, sk }))) {
          throw Object.assign(Error(), { name: 'TransactionCanceledException',
            CancellationReasons: [{ Code: 'ConditionalCheckFailed' }] });
        }
        put(event.TableName, { pk, sk }, event.Item);
        return {};
      }
      for (const op of input.TransactItems) {
        assert.ok((op.Put || op.ConditionCheck).TableName.startsWith('wizz-production-'));
        if (op.Put) {
          const { pk, sk } = op.Put.Item;
          put(op.Put.TableName, { pk, sk }, op.Put.Item);
        }
      }
      return {};
    },
  };
  const verify = audience => async token => {
    if (token !== audience) throw new Error('Wrong pool');
    const { poolId, clientId } = identities[audience];
    return {
      iss: 'https://cognito-idp.us-east-1.amazonaws.com/' + poolId,
      client_id: clientId, token_use: 'access', sub: audience, auth_time: now() / 1000, exp: now() / 1000 + 60,
    };
  };
  const adminApi = createStaffApi({
    db, assets, now, verifyAccess: verify('admin'),
    liveIdentity: async () => ({
      Enabled: true, UserStatus: 'CONFIRMED',
      UserAttributes: [{ Name: 'sub', Value: 'admin' }], UserMFASettingList: ['SOFTWARE_TOKEN_MFA'],
    }),
  });
  const publicApi = createPublicApi({ db, assets, now, verifyAccess: verify('customer'), offerEligibility });
  function event(path, httpMethod, token, input, queryStringParameters) {
    return {
      path, httpMethod, requestContext: { stage: 'production' },
      headers: token ? { Authorization: 'Bearer ' + token } : {},
      body: input && JSON.stringify(input), queryStringParameters,
    };
  }
  return {
    admin, transactions, put,
    staff: (suffix = '', method = 'GET', body, token = 'admin', query) =>
      adminApi(event(staffPath + suffix, method, token, body, query)),
    sounds: (suffix = '', method = 'GET', body) => adminApi(event('/staff/settings/notification-sounds' + suffix, method, 'admin', body)),
    public: (query, token) => publicApi(event(publicPath, 'GET', token, null, query)),
    track: (body, query, token) => publicApi(event(publicPath, 'POST', token, body, query)),
  };
}
const section = (id, fields = {}) => ({
  id, title: id, source: 'region', audience: 'all', enabled: true, regionIds: [], limit: 6, ...fields,
});

test('production publishes the same app contract and fences draft, roles and revision', async () => {
  const f = fixture();
  const read = JSON.parse((await f.staff()).body);
  assert.equal(read.version, 0);
  const options = JSON.parse((await f.staff('/options')).body);
  assert.deepEqual(options.merchants.map(row => row.id), ['branch']);
  const sections = [
    section('local', { source: 'curated', merchantIds: ['branch'], regionIds: ['manathera'] }),
    section('history', { source: 'pastOrders', audience: 'signedIn' }),
    section('future', { startAt: '2026-12-01T00:00:00Z' }),
  ];
  const draft = await f.staff('/draft', 'POST', { baseVersion: 0, sections });
  assert.equal(draft.statusCode, 200, draft.body);
  assert.equal(JSON.parse((await f.public()).body).layout.configured, false);
  assert.equal((await f.staff('/publish', 'POST', { baseVersion: 0 })).statusCode, 409);
  const published = await f.staff('/publish', 'POST', { baseVersion: 1 });
  assert.equal(published.statusCode, 200, published.body);
  assert.ok(f.transactions.every(tx => tx.some(row => row.ConditionCheck?.Key.pk === 'EMPLOYEE#admin')));
  const guest = JSON.parse((await f.public({ layoutVersion: '3', regionId: 'hirah' })).body);
  assert.deepEqual(guest.layout.sections.map(row => row.id), ['local']);
  assert.equal(guest.layout.version, 2);
  assert.deepEqual(guest.slides, []);
  assert.equal(guest.layout.filters.items.find(row => row.kind === 'offers').enabled, false);
  assert.equal(guest.layout.history, undefined);

  const customer = JSON.parse((await f.public({ layoutVersion: '3', regionId: 'hirah' }, 'customer')).body);
  assert.deepEqual(customer.layout.sections.map(row => row.id), ['local', 'history']);
  assert.equal((await f.public({ userId: 'other' }, 'customer')).statusCode, 403);
  assert.equal((await f.public({ userId: 'customer' })).statusCode, 401);
  assert.equal((await f.public({}, 'admin')).statusCode, 401);
  assert.equal((await f.staff('', 'GET', undefined, 'customer')).statusCode, 401);
});

test('notification settings require dedicated production permissions and independent approval', async () => {
  const f = fixture();
  const pk = 'OPERATIONAL_SETTINGS#ORDER_RECEPTION';
  const { DEFAULTS: values } = require('../../../backend/staff-service/notification-settings-contract');
  f.put('wizz-production-PlatformStaff', { pk, sk: 'CURRENT' }, { version: 1, values });
  assert.equal((await f.sounds()).statusCode, 403);
  f.admin.roles.push('settings_manager', 'settings_approver');
  const current = await f.sounds();
  assert.equal(current.statusCode, 200, current.body);
  assert.equal(JSON.parse(current.body).current.values.merchantAcceptanceSeconds, 300);
  const requested = await f.sounds('/request', 'POST', {
    baseVersion: 1, values: { ...values, merchantAcceptanceSeconds: 360 }, reason: 'Extend acceptance window',
  });
  assert.equal(requested.statusCode, 200, requested.body);
  const { changeId, status } = JSON.parse(requested.body);
  assert.equal(status, 'PENDING');
  const approval = await f.sounds('/approve', 'POST', { changeId });
  assert.equal(approval.statusCode, 403, approval.body);
  assert.equal(JSON.parse(approval.body).error, 'SELF_APPROVAL_FORBIDDEN');
});

test('production classification writes validate branches and guard revisions', async () => {
  const f = fixture();
  const catalog = {
    baseVersion: 0,
    cuisines: [{ id: 'iraqi', label: 'عراقي' }],
    brands: [],
    profiles: { branch: { cuisineIds: ['iraqi'] } },
  };
  assert.equal((await f.staff('/classifications', 'POST', {
    ...catalog, profiles: { missing: { cuisineIds: ['iraqi'] } },
  })).statusCode, 400);
  const save = await f.staff('/classifications', 'POST', catalog);
  assert.equal(save.statusCode, 200, save.body);
  const read = JSON.parse((await f.staff('/classifications')).body);
  assert.deepEqual(read.profiles.branch.cuisineIds, ['iraqi']);
  assert.equal((await f.staff('/classifications', 'POST', catalog)).statusCode, 409);
});

test('production interface templates remain drafts until approved and use the published branch catalog', async () => {
  const f = fixture();
  const root = '/interfaces';
  const query = { surface: 'store', branchId: 'branch', storeStructureVersion: '2' };
  const section = (source, extra = {}) => ({ id: source, title: source, source, layout: 'vertical',
    enabled: true, audience: 'all', deduplicate: true, limit: 12, ...extra });
  const template = { id: 'branch-template', name: 'Branch store', surface: 'store', enabled: true,
    priority: 0, target: { branchIds: ['branch'] }, sections: [section('menu'), section('curated', { productIds: ['item'] }), section('bestsellers')] };
  assert.equal(JSON.parse((await f.public(query)).body).interface.configured, false);
  assert.equal((await f.staff(root + '/draft', 'POST', { baseVersion: 0, templates: [template] })).statusCode, 400);
  const pk = 'BRANCH#branch';
  const table = 'wizz-production-MerchantPlatform';
  f.put(table, { pk, sk: 'MENU_VERSION#ACTIVE' }, { publishedVersion: '1' });
  f.put(table, { pk, sk: 'MENU_VERSION#1#PRODUCT#item' }, {
    product: { productId: 'item', businessId: 'branch', categoryId: 'menu', publishedCategory: { name: 'Menu' } },
  });
  const draft = await f.staff(root + '/draft', 'POST', { baseVersion: 0, templates: [template] });
  assert.equal(draft.statusCode, 200, draft.body);
  assert.equal(JSON.parse((await f.public(query)).body).interface.configured, false);
  const publish = await f.staff(root + '/publish', 'POST', { baseVersion: 1 });
  assert.equal(publish.statusCode, 200, publish.body);
  assert.equal(JSON.parse((await f.public(query)).body).interface.templateId, template.id);
  const staffTable = 'wizz-production-PlatformStaff';
  const expiresAt = '2026-11-23T13:00:00Z';
  const asOf = '2026-11-23T11:30:00Z';
  f.put(staffTable, { pk: 'HOME_DISCOVERY', sk: 'PRODUCTS#branch' }, { asOf, expiresAt, counts: { item: 3 } });
  assert.deepEqual(JSON.parse((await f.public(query)).body).interface.itemCounts, {});
  f.put(staffTable, { pk: 'HOME_DISCOVERY', sk: 'COMPLETED_ORDERS' }, { asOf, expiresAt });
  assert.deepEqual(JSON.parse((await f.public(query)).body).interface.itemCounts, { item: 3 });

  assert.equal((await f.public({ ...query, branchId: 'missing' })).statusCode, 404);
  assert.equal((await f.staff(root + '/rollback', 'POST', { baseVersion: 2, revision: 999 })).statusCode, 400);
});

test('published navigation signs only verified navigation uploads', async () => {
  const f = fixture();
  const image = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  const upload = await f.staff('/slides', 'POST', { action: 'uploadNavigation', contentType: 'image/gif', image });
  assert.equal(upload.statusCode, 200, upload.body);
  const { imageKey, imageUrl } = JSON.parse(upload.body);
  const navigation = { enabled: true, items: [{
    id: 'all', kind: 'all', label: 'الكل', enabled: true, value: null, audience: 'all', icon: 'grid',
    regionIds: [], imageKey,
  }] };
  const missing = { ...navigation, items: [{ ...navigation.items[0], imageKey: imageKey.replace(/[^/]+$/, 'missing.gif') }] };
  assert.equal((await f.staff('/draft', 'POST', { baseVersion: 0, sections: [], navigation: missing })).statusCode, 400);
  assert.equal((await f.staff('/draft', 'POST', { baseVersion: 0, sections: [], navigation })).statusCode, 200);
  assert.equal((await f.staff('/publish', 'POST', { baseVersion: 1 })).statusCode, 200);
  const data = JSON.parse((await f.public({ layoutVersion: '3' })).body);
  assert.equal(data.layout.navigation.items[0].imageUrl, imageUrl);
});

test('production publishes the header independently and isolates its feed', async () => {
  const f = fixture(undefined, {});
  const draft = await f.staff('/draft', 'POST', {
    baseVersion: 0, sections: [section('unpublished')],
    promotionHeader: { enabled: true, source: 'merchant' },
  });
  assert.equal(draft.statusCode, 200, draft.body);
  const query = { headerOffers: '1', regionId: 'hirah' };
  assert.equal(JSON.parse((await f.public(query)).body).settings.enabled, false);
  const published = await f.staff('/promotion-header/publish', 'POST', { baseVersion: 1 });
  assert.equal(published.statusCode, 200, published.body);
  const feed = await f.public(query);
  assert.equal(feed.statusCode, 200, feed.body);
  const { settings, campaigns } = JSON.parse(feed.body);
  assert.equal(settings.enabled, true);
  assert.equal(settings.source, 'merchant');
  assert.deepEqual(campaigns, []);
  assert.deepEqual(JSON.parse((await f.public({ layoutVersion: '3' })).body).layout.sections, []);
  assert.equal((await f.public({ ...query, campaigns: '1' })).statusCode, 400);
});

test('merchant header uses eligible branch and its active published menu', async () => {
  const f = fixture(() => Math.floor(Date.now() / 1000) * 1000, { eligibility: async () => ({ merchants: ['branch'] }) });
  const table = 'wizz-production-MerchantPlatform';
  const pk = 'BRANCH#branch';
  f.put('wizz-production-Merchants', { businessId: 'branch' }, {
    isActive: true, status: 'approved', regionId: 'hirah', businessName: 'Branch',
  });
  f.put(table, { pk, sk: 'MENU_VERSION#ACTIVE' }, { publishedVersion: '1' });
  for (const [version, productId] of [['1', 'published'], ['2', 'draft']]) {
    f.put(table, { pk, sk: 'MENU_VERSION#' + version + '#PRODUCT#' + productId }, {
      product: { businessId: 'branch', productId, imageUrl: 'https://example.com/' + productId },
    });
  }
  f.put('wizz-production-MerchantDiscounts', { discountId: 'discount' }, {
    businessId: 'branch', title: 'Discount', type: 'percentage', value: 10,
    status: 'active', isActive: true, validFrom: new Date(Date.now() - 3600000).toISOString(),
    validTo: new Date(Date.now() + 3600000).toISOString(), customerSegments: ['all'],
  });
  f.put('wizz-production-PlatformDiscounts', { discountId: 'benefit' }, {
    title: 'Benefit', status: 'active', benefit: { type: 'freeDelivery' },
  });
  const offers = await f.staff('/options', 'GET', undefined, 'admin', { headerOffers: '1' });
  assert.equal(offers.statusCode, 200, offers.body);
  assert.deepEqual(JSON.parse(offers.body).offers.map(offer => [offer.source, offer.id]), [
    ['benefit', 'benefit'], ['merchant', 'discount'],
  ]);
  const menu = await f.staff('/options', 'GET', undefined, 'admin', { headerBranch: 'branch' });
  assert.equal(menu.statusCode, 200, menu.body);
  assert.deepEqual(JSON.parse(menu.body).products.map(product => product.id), ['published']);
  const draft = await f.staff('/draft', 'POST', {
    baseVersion: 0, sections: [], promotionHeader: { enabled: true, source: 'merchant',
      selection: { source: 'merchant', id: 'discount' } },
  });
  assert.equal(draft.statusCode, 200, draft.body);
  const published = await f.staff('/promotion-header/publish', 'POST', { baseVersion: 1 });
  assert.equal(published.statusCode, 200, published.body);
  const query = { headerOffers: '1', regionId: 'hirah' };
  const feed = await f.public(query);
  assert.equal(feed.statusCode, 200, feed.body);
  assert.deepEqual(JSON.parse(feed.body).campaigns[0]?.scene.products.map(product => product.id), ['published']);
  assert.deepEqual(JSON.parse((await f.public({ ...query, regionId: 'unknown' })).body).campaigns, []);
  const offersOnly = section('eligible', { filters: { offersOnly: true } });
  const filterItems = require('../../../backend/staff-service/home-filters').defaults();
  const homeDraft = await f.staff('/draft', 'POST', { baseVersion: 2, sections: [offersOnly], filters: filterItems });
  assert.equal(homeDraft.statusCode, 200, homeDraft.body);
  const homePublish = await f.staff('/publish', 'POST', { baseVersion: 3 });
  assert.equal(homePublish.statusCode, 200, homePublish.body);
  const homeQuery = { layoutVersion: '3', regionId: 'hirah' };
  const home = JSON.parse((await f.public(homeQuery)).body).layout;
  assert.equal(home.sections[0].filters.offersOnly, true);
  assert.equal(home.filters.items.find(row => row.kind === 'offers').enabled, true);
  assert.deepEqual(home.discovery.offers.merchantIds, ['branch']);
  const otherRegion = JSON.parse((await f.public({ ...homeQuery, regionId: 'unknown' })).body).layout;
  assert.deepEqual(otherRegion.discovery.offers.merchantIds, []);

});

test('rejects invalid query and unauthorised global publication', async () => {
  const f = fixture();
  assert.equal((await f.public({ priceBusinessIds: 'one,one' })).statusCode, 400);
  f.admin.roles.splice(1, 1);
  assert.equal((await f.staff('/publish', 'POST', { baseVersion: 0 })).statusCode, 403);
  assert.equal(f.transactions.length, 0);
});

test('home slides publish separately from drafts, require eligibility, and can be paused and archived', async () => {
  const f = fixture();
  const command = body => f.staff('/slides', 'POST', body);
  const upload = await command({ action: 'upload', contentType: 'image/gif',
    image: 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' });
  assert.equal(upload.statusCode, 200, upload.body);
  const { imageKey } = JSON.parse(upload.body);
  const slide = {
    title: 'إعلان لتجربة العرض', audience: 'registered', regionIds: ['manathera'],
    action: { type: 'announcement', id: 'announcement' }, displayOrder: 2, imageKey,
    startAt: '2026-11-23T11:00:00.000Z', endAt: '2026-11-24T11:00:00.000Z',
  };
  const save = await command({ action: 'save', id: 'announcement', baseVersion: 0, slide });
  assert.equal(save.statusCode, 200, save.body);
  const feed = async (token, regionId, slideActions = '2') =>
    JSON.parse((await f.public({ regionId, slideActions, layoutVersion: '3' }, token)).body).slides;
  assert.deepEqual(await feed('customer', 'hirah'), []);
  f.admin.roles.splice(1, 1);
  assert.equal((await command({ action: 'publish', id: 'announcement', baseVersion: 1 })).statusCode, 403);
  f.admin.roles.push('promotions_approver');
  const publish = await command({ action: 'publish', id: 'announcement', baseVersion: 1 });
  assert.equal(publish.statusCode, 200, publish.body);
  assert.deepEqual(await feed(undefined, 'hirah'), []);
  assert.deepEqual(await feed('customer', 'nonexistent'), []);
  assert.deepEqual(JSON.parse((await f.public({ regionId: 'hirah' }, 'customer')).body).slides, []);
  assert.equal((await feed('customer', 'hirah'))[0].title, slide.title);
  const edit = await command({ action: 'save', id: 'announcement', baseVersion: 2, slide: { ...slide, title: 'نسخة جديدة' } });
  assert.equal(edit.statusCode, 200, edit.body);
  assert.equal((await feed('customer', 'hirah'))[0].title, slide.title);
  assert.equal((await command({ action: 'pause', id: 'announcement', baseVersion: 2 })).statusCode, 409);
  assert.equal((await command({ action: 'archive', id: 'announcement', baseVersion: 3 })).statusCode, 409);
  assert.equal((await command({ action: 'pause', id: 'announcement', baseVersion: 3 })).statusCode, 200);
  assert.deepEqual(await feed('customer', 'hirah'), []);
  assert.equal((await command({ action: 'archive', id: 'announcement', baseVersion: 4 })).statusCode, 200);
  assert.deepEqual(JSON.parse((await f.staff('/slides')).body).slides, []);
});

test('rejects foreign assets, unsupported destinations, and unauthenticated reads', async () => {
  const f = fixture();
  const request = (id, slide) => f.staff('/slides', 'POST', { action: 'save', id, baseVersion: 0, slide });
  const content = { title: 'واجهة', audience: 'all', regionIds: [], displayOrder: 0,
    imageKey: 'home-slideshow/other/test.jpg', startAt: '2026-11-23T11:00:00.000Z', endAt: '2026-11-24T11:00:00.000Z' };
  assert.equal((await request('foreign', { ...content, action: { id: 'foreign', type: 'announcement' } })).statusCode, 403);
  assert.equal((await request('campaign', { ...content, action: { id: 'offer', type: 'category', merchantId: 'branch' } })).statusCode, 400);
  assert.equal((await f.staff('/slides', 'GET', undefined, 'customer')).statusCode, 401);
});


test('campaign list and details sign only eligible published campaign imagery and filter branch products',async()=>{
  const previous={...process.env};
  Object.assign(process.env,{ENVIRONMENT:'production',AWS_REGION:'us-east-1'});
  try {
    const engine=require(process.env.WIZZ_HOME_OFFER_ELIGIBILITY ??
      '../../../../wizzuser-stg/backend/src/functions/shared/offer-eligibility');
    const f=fixture(() => Math.floor(Date.now() / 1000) * 1000,engine);
    const t=name=>'wizz-production-'+name;
    const now=Date.now(), date=ms=>new Date(now+ms).toISOString();
    const key='home-slideshow/campaigns-'+'a'.repeat(64)+'/ff17a5ee-babb-4bb5-b8be-5d027f38695b.gif';
    const campaign={title:'خصم الحيرة',code:'HIRA',discountSource:'campaign',type:'fixedAmount',value:500,
      status:'active',isActive:true,validFrom:date(-3600000),validTo:date(3600000),targetRegionIds:['manathera'],
      targetRestaurants:['branch'],usageLimit:10,usageCount:0,customerSegments:['all'],imageKey:key,
      applicability:'specificItems',applicable_item_ids:['item'],version:1};
    f.put(t('Merchants'),{businessId:'branch'},{isActive:true,status:'approved',regionId:'hirah',businessName:'مطعم الحيرة'});
    f.put(t('MenuCategories'),{categoryId:'menu'},{businessId:'branch',isActive:true});
    f.put(t('Products'),{productId:'item'},{businessId:'branch',categoryId:'menu',isAvailable:true,price:2000,name:'طبق'});
    f.put(t('Products'),{productId:'other'},{businessId:'branch',categoryId:'menu',isAvailable:true,price:2500});
    f.put(t('PlatformDiscounts'),{discountId:'campaign'},campaign);
    for(const [id,patch] of Object.entries({paused:{status:'paused'},future:{validFrom:date(1800000)},
      spent:{usageCount:10},private:{customerSegments:['registered']},otherRegion:{targetRegionIds:['other-region']}}))
      f.put(t('PlatformDiscounts'),{discountId:id},{...campaign,...patch});
    const command = body => f.staff('/slides', 'POST', body);
    const upload = await command({ action: 'upload', contentType: 'image/gif',
      image: 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' });
    assert.equal(upload.statusCode, 200, upload.body);
    const slide = { title: 'حملة خاصة', audience: 'all', regionIds: [], displayOrder: 1,
      startAt: date(-3600000), endAt: date(7200000), imageKey: JSON.parse(upload.body).imageKey,
      action: { type: 'campaign', id: 'private' } };
    const save = await command({ action: 'save', id: 'linked-slide', baseVersion: 0, slide });
    assert.equal(save.statusCode, 200, save.body);
    const publish = await command({ action: 'publish', id: 'linked-slide', baseVersion: 1 });
    assert.equal(publish.statusCode, 200, publish.body);
    const homeQuery = { layoutVersion: '3', slideActions: '3', regionId: 'hirah' };
    assert.deepEqual(JSON.parse((await f.public(homeQuery)).body).slides, []);
    assert.deepEqual(JSON.parse((await f.public({ ...homeQuery, slideActions: '2' }, 'customer')).body).slides, []);
    const linked = JSON.parse((await f.public(homeQuery, 'customer')).body).slides[0];
    assert.equal(linked.id, 'linked-slide');
    assert.equal(linked.action.id, 'private');
    assert.equal(linked.standalone, true);
    assert.equal(linked.endAt, campaign.validTo);
    const interaction = { slideId: 'linked-slide', type: 'tap',
      sessionId: '11111111-1111-4111-8111-111111111111' };
    assert.equal((await f.track(interaction, { regionId: 'hirah' })).statusCode, 404);
    assert.equal((await f.track(interaction, { regionId: 'hirah' }, 'customer')).statusCode, 200);
    assert.equal((await f.track({ ...interaction, sessionId: '22222222-2222-4222-8222-222222222222' },
      { regionId: 'hirah' }, 'customer')).statusCode, 200);
    const counters = f.transactions.filter(tx => tx[1]?.Update?.Key.pk === 'STATS#linked-slide');
    assert.equal(counters.length, 2);
    assert.equal(counters[0][0].Put.Item.pk, counters[1][0].Put.Item.pk);
    const query={campaigns:'1',regionId:'hirah'};
    const feed=await f.public(query);
    assert.equal(feed.statusCode,200,feed.body);
    assert.deepEqual(JSON.parse(feed.body).campaigns.map(row=>row.id),['campaign']);
    const res=await f.public({campaignId:'campaign',merchantId:'branch',regionId:'hirah'});
    assert.equal(res.statusCode,200,res.body);
    const row=JSON.parse(res.body);
    assert.equal(row.offer.imageUrl,'https://example.com/'+key);
    assert.equal(row.slide.standalone,true);
    assert.deepEqual(row.products.map(p=>p.id),['item']);
    assert.deepEqual(JSON.parse((await f.public(query,'customer')).body).campaigns.map(row=>row.id).sort(),['campaign','private']);
    assert.equal((await f.public({campaignId:'campaign',merchantId:'outsider',regionId:'hirah'})).statusCode,404);
    assert.equal((await f.public({campaignId:'campaign',regionId:'other-region'})).statusCode,404);
    assert.equal((await f.public({campaignId:'private',regionId:'hirah'})).statusCode,404);
    assert.equal((await f.public({...query,campaignId:'campaign'})).statusCode,400);
    assert.equal((await f.public({campaignId:'future',regionId:'hirah'})).statusCode,404);
  } finally {
    process.env=previous;
  }
});
