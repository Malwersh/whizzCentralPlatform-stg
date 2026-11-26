'use strict';

const { GetCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const layout = require('../../../backend/staff-service/home-layout');
const filters = require('../../../backend/staff-service/home-filters');
const dispatchSettings = require('../../../backend/staff-service/dispatch-settings');
const driverMapSettings = require('../../../backend/staff-service/driver-map-settings-329');
const notificationSettings = require('../../../backend/staff-service/notification-settings-contract');
const operationalSettings = new Map([[notificationSettings.PATH, notificationSettings],
  [dispatchSettings.PATH, dispatchSettings], ['/staff/settings/driver-map', driverMapSettings]]);
const interfaces = require('../../../backend/staff-service/interface-layout');
const scenes = require('../../../backend/staff-service/promotion-scenes');
const { normalize: offerInfo } = require('../../../backend/staff-service/offers');
const slideshow = require('./slides.cjs');
const campaigns = require('./campaigns.cjs');
const media = require('./media.cjs');
const discovery = require('../../../backend/staff-service/home-discovery');
const { allowed } = require('../driver-review/catalog');
const audit = require('../../../backend/staff-service/audit-trail');
const { identities } = require('../wallet-identity-bindings.json');

const table = 'wizz-production-PlatformStaff';
const homeTables = {
  regions: 'wizz-production-Regions',
  merchants: 'wizz-production-Merchants',
  merchantPlatform: 'wizz-production-MerchantPlatform',
  products: 'wizz-production-Products',
  merchantDiscounts: 'wizz-production-MerchantDiscounts',
  platformDiscounts: 'wizz-production-PlatformDiscounts',
  categories: 'wizz-production-MenuCategories',
};
const staffPath = '/staff/home-layout';
const publicPath = '/customer/home-layout';
const validId = value => typeof value === 'string' && /^[-\w]{1,128}$/.test(value);
const failure = (status, message) => Object.assign(new Error(message), { status });
const ctxFor = (db, assets, now) => ({
  db,
  table,
  homeTables,
  assets,
  now,
  selectableMerchant: isSelectableMerchant,
  validateHomeFilters: productionFilters,
  publishedInterfaceCatalog: async branchId => {
    const rows = await scenes.menu({ db, promotionMenuTable: homeTables.merchantPlatform }, branchId);
    const categories = new Map();
    const products = rows.filter(row => validId(row.productId)).map(row => {
      const category = row.publishedCategory;
      const categoryId = row.categoryId;
      if (category && validId(categoryId)) categories.set(categoryId, {
        id: categoryId, label: category.name_ar || category.categoryName || category.name || categoryId,
      });
      return { id: row.productId, label: row.name_ar || row.name || row.productName || row.productId, categoryId };
    });
    return { products, categories: [...categories.values()] };
  },
  categoryImageUrl: key => media.navigationImage(key) ? assets.url(key) : null,
  checkNavigationImages: (actor, items, current) => media.checkNavigationImages(assets, actor, items, current),
});
const productionFilters = value => {
  const settings = filters.validate(value);
  const explicitOfferFilter = value?.items?.some(row => row.kind === 'offers');
  return explicitOfferFilter ? settings : { ...settings,
    items: settings.items.map(row => row.kind === 'offers' ? { ...row, enabled: false } : row),
  };
};
const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
const publicHeaders = {
  ...headers,
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
};
function reply(statusCode, value, outgoingHeaders) {
  return { statusCode, headers: outgoingHeaders, body: value === null ? '' : JSON.stringify(value) };
}

async function identity(event, verify, audience, now) {
  const auth = Object.entries(event.headers || {}).filter(([name]) => name.toLowerCase() === 'authorization');
  if (!auth.length && audience === 'customer') return null;
  const bearer = auth.length === 1 && /^Bearer ([\w.-]{1,8192})$/i.exec(auth[0][1]);
  if (!bearer) throw failure(401, 'UNAUTHORIZED');
  let claims;
  try {
    claims = await verify(bearer[1]);
  } catch (error) {
    if (['FetchError', 'NonRetryableFetchError', 'WaitPeriodNotYetEndedJwkError'].includes(error.name)) throw error;
    throw failure(401, 'UNAUTHORIZED');
  }
  const { poolId, clientId } = identities[audience];
  if (claims?.iss !== 'https://cognito-idp.us-east-1.amazonaws.com/' + poolId ||
      claims.client_id !== clientId || claims.token_use !== 'access' ||
      !validId(claims.sub) || !Number.isFinite(claims.exp) || claims.exp * 1000 <= now()) {
    throw failure(401, 'UNAUTHORIZED');
  }
  return claims;
}

async function get(db, TableName, Key) {
  return (await db.send(new GetCommand({ TableName, Key, ConsistentRead: true }))).Item;
}

async function ancestors(db, regionId) {
  const regionIds = [];
  while (regionId && regionIds.length < 8 && !regionIds.includes(regionId)) {
    const region = await get(db, homeTables.regions, { regionId });
    if (!region || region.archived || region.deletedAt) break;
    regionIds.push(regionId);
    regionId = region.parent_id;
  }
  return regionIds;
}

function createPublicApi({ db, assets, verifyAccess, now = Date.now, offerEligibility }) {
  return async event => {
    try {
      if (event.requestContext?.stage !== 'production' || event.path !== publicPath) throw failure(404, 'NOT_FOUND');
      if (event.httpMethod === 'OPTIONS') return reply(204, null, publicHeaders);
      const tracking = event.httpMethod === 'POST';
      if (event.httpMethod !== 'GET' && !tracking) throw failure(405, 'METHOD_NOT_ALLOWED');
      const q = event.queryStringParameters || {};
      const interfaceQuery=q.surface!==undefined;
      const headerQuery=q.headerOffers!==undefined;
      const campaignQuery=q.campaigns!==undefined || q.campaignId!==undefined;
      const allowedQuery=tracking?['regionId','userId']:interfaceQuery?
        ['surface','branchId','regionId','userId','offerSlotsVersion','storeStructureVersion']:headerQuery?['headerOffers','regionId','userId']:campaignQuery?
        ['campaigns','campaignId','merchantId','offerSource','regionId','userId']:
        ['layoutVersion','regionId','userId','priceBusinessIds','slideActions'];
      if ((headerQuery && q.headerOffers !== '1') || Object.keys(q).some(key => !allowedQuery.includes(key)) ||
          Object.values(event.multiValueQueryStringParameters ?? {}).some(values=>values.length!==1) ||
          (q.campaigns!==undefined && (q.campaigns!=='1'||q.campaignId!==undefined||q.merchantId!==undefined||q.offerSource!==undefined)) ||
          (q.campaignId!==undefined && !validId(q.campaignId)) ||
          (q.merchantId!==undefined && !validId(q.merchantId)) ||
          (q.offerSource!==undefined && !['merchant','platform'].includes(q.offerSource)) ||
          (q.slideActions !== undefined && !['2', '3'].includes(q.slideActions)) ||
          (q.regionId !== undefined && !validId(q.regionId)) ||
          (q.userId !== undefined && !validId(q.userId)) ||
          (q.layoutVersion !== undefined && !['1', '2', '3'].includes(q.layoutVersion))) {
        throw failure(400, 'INVALID_QUERY');
      }
      const priceBusinessIds = q.priceBusinessIds === '' ? [] : q.priceBusinessIds?.split(',');
      if (priceBusinessIds && (priceBusinessIds.length > 12 || priceBusinessIds.some(id => !validId(id)) ||
          new Set(priceBusinessIds).size !== priceBusinessIds.length)) throw failure(400, 'INVALID_PRICE_LOOKUP');

      const claims = await identity(event, verifyAccess, 'customer', now);
      if (q.userId !== undefined && !claims) throw failure(401, 'UNAUTHORIZED');
      let customerIdentity;
      if (claims) {
        const userId = q.userId ?? claims.sub;
        const profile = await get(db, 'wizz-production-Customers', { userId });
        if (!profile || profile.isActive === false || profile.isDeleted || profile.deletedAt || profile.deletionRequestId ||
            (profile.cognitoSub && profile.cognitoSub !== claims.sub) ||
            !(profile.userId === claims.sub || profile.cognitoSub === claims.sub ||
              (claims.username && profile.cognitoUsername === claims.username))) {
          throw failure(403, 'ACCOUNT_UNAVAILABLE');
        }
        if ((campaignQuery || headerQuery || tracking || interfaceQuery) && await get(db,'wizz-production-AccountDeletion',{pk:'ACCOUNT_LIFECYCLE#CUSTOMER#'+claims.sub,sk:'META'}))
          throw failure(403,'ACCOUNT_UNAVAILABLE');
        customerIdentity={sub:claims.sub,userId,profile};
      }
      const ctx = ctxFor(db, assets, now);
      const scope = {
        signedIn: Boolean(claims),
        regionIds: await ancestors(db, q.regionId),
        layoutVersion: Number(q.layoutVersion ?? '1'),
        priceBusinessIds,
        now: now(),
      };
      if (interfaceQuery) {
        if (!Object.hasOwn(interfaces.sources, q.surface) || !validId(q.branchId) ||
            (q.offerSlotsVersion !== undefined && q.offerSlotsVersion !== '1') ||
            (q.storeStructureVersion !== undefined && !['1', '2'].includes(q.storeStructureVersion))) {
          throw failure(400, 'INVALID_QUERY');
        }
        if (q.offerSlotsVersion === '1') {
          const journey = offerEligibility ?? campaigns.eligibility();
          Object.assign(scope, { identity: customerIdentity, eligibility: journey.eligibility,
            getCustomer: () => journey.customerState(db, customerIdentity), offerInfo,
            offerLive: row => campaigns.available(row, offerInfo(row), scope.now, Boolean(row.businessId)),
            imageUrl: key => media.campaignImageKey(key) ? assets.url(key) : '',
          });
        }
        return reply(200, { interface: await interfaces.feed(ctx, scope, q) }, publicHeaders);
      }
      if (tracking) {
        let input;
        try {
          if (event.isBase64Encoded || typeof event.body !== 'string' || Buffer.byteLength(event.body) > 1024) throw Error();
          input = JSON.parse(event.body);
          if (!input || Array.isArray(input) || Object.keys(input).some(key => !['slideId', 'type', 'sessionId'].includes(key)) ||
              !validId(input.slideId) || !/^[a-f0-9-]{36}$/i.test(input.sessionId ?? '') ||
              !['view', 'tap'].includes(input.type)) throw Error();
        } catch {
          throw failure(400, 'INVALID_BODY');
        }
        await slideshow.recordEvent(ctx, scope, customerIdentity, offerEligibility, input);
        return reply(200, { recorded: true }, publicHeaders);
      }
      if (headerQuery) {
        const current = await get(db, ctx.table, layout.KEY);
        const settings = require('../../../backend/staff-service/home-promotion-settings')
          .project(current?.published?.promotionHeader, scope.now);
        if (!settings.enabled || settings.selection?.source === 'benefit') {
          return reply(200, { settings, campaigns: [] }, publicHeaders);
        }
        const sources = settings.selection ? [settings.selection.source] :
          settings.source === 'both' ? ['platform', 'merchant'] : [settings.source];
        const results = await Promise.all(sources.map(offerSource => campaigns.browse(ctx, {
          offerSource, campaignId: settings.selection?.id,
        }, scope, customerIdentity, offerEligibility, { headerSettings: settings })));
        return reply(200, { settings, campaigns: results.flatMap(source => source.campaigns).slice(0, 100) }, publicHeaders);
      }
      if (campaignQuery)
        return reply(200,await campaigns.browse(ctx,q,scope,customerIdentity,offerEligibility),publicHeaders);
      scope.validateHomeFilters = productionFilters;
      scope.resolveOfferFacts = async () => {
        try {
          return await campaigns.discoveryFacts(ctx, scope, customerIdentity, offerEligibility);
        } catch (error) {
          console.error(JSON.stringify({ event: 'HOME_OFFER_DISCOVERY_UNAVAILABLE', name: error.name }));
          return { merchantIds: [], allMerchants: false, expiresAt: new Date(scope.now + 60000).toISOString() };
        }
      };
      const [result, slideResult] = await Promise.all([
        layout.feed(ctx, scope),
        slideshow.publicFeed(ctx, scope, Number(q.slideActions ?? '1'), customerIdentity, offerEligibility).catch(error => {
          console.error(JSON.stringify({ event: 'HOME_SLIDES_UNAVAILABLE', name: error.name }));
          return { version: 0, slides: [] };
        }),
      ]);
      return reply(200, { ...slideResult, layout: result }, publicHeaders);
    } catch (error) {
      return respondError(event, error, publicHeaders);
    }
  };
}

async function readOptions(db) {
  async function scan(TableName, ProjectionExpression, ExpressionAttributeNames) {
    let cursor;
    const rows = [];
    do {
      const page = await db.send(new ScanCommand({
        TableName, ProjectionExpression, ExpressionAttributeNames, ExclusiveStartKey: cursor,
      }));
      rows.push(...(page.Items || []));
      cursor = page.LastEvaluatedKey;
      if (rows.length > 5000) throw failure(503, 'HOME_OPTIONS_CAPACITY');
    } while (cursor);
    return rows;
  }
  const [regions, merchants] = await Promise.all([
    scan(homeTables.regions, 'regionId, #name, name_ar, parent_id, archived, deletedAt', { '#name': 'name' }),
    scan(homeTables.merchants,
      'businessId, businessName, business_name, #name, isActive, isDeleted, deletedAt, platformSuspended, deletionRequestId, #status',
      { '#name': 'name', '#status': 'status' }),
  ]);
  const byRegion = new Map(regions.map(row => [row.regionId, row]));
  const label = region => region.name_ar || region.name || region.regionId;
  return {
    regions: regions.filter(row => !row.archived && !row.deletedAt).map(row => ({
      id: row.regionId,
      name: [label(row), byRegion.has(row.parent_id) && label(byRegion.get(row.parent_id))].filter(Boolean).join(' · '),
    })),
    merchants: merchants.filter(isSelectableMerchant).map(row => ({
      id: row.businessId, name: row.businessName || row.business_name || row.name || row.businessId,
    })),
  };
}

function isSelectableMerchant(row) {
  return row?.isActive === true && !row.isDeleted && !row.deletedAt &&
    !row.platformSuspended && !row.deletionRequestId &&
    !['DRAFT', 'PENDING', 'REJECTED', 'SUSPENDED', 'DELETED'].includes(String(row.status || '').toUpperCase());
}

function parseBody(event, action) {
  let input;
  try {
    if (event.isBase64Encoded || typeof event.body !== 'string' ||
        Buffer.byteLength(event.body) > (action === 'classifications' ? 350000 : 160000)) throw new Error();
    input = JSON.parse(event.body);
    const interfaceKeys = { 'interfaces/catalog': ['branchId'], 'interfaces/draft': ['baseVersion', 'templates'],
      'interfaces/publish': ['baseVersion'], 'interfaces/rollback': ['baseVersion', 'revision'] };
    const keys = interfaceKeys[action] ?? (action === 'draft' ? ['baseVersion', 'sections', 'welcome', 'navigation', 'filters', 'promotionHeader']
      : action === 'classifications' ? ['baseVersion', 'cuisines', 'brands', 'profiles']
      : action === 'rollback' ? ['baseVersion', 'revision'] : ['baseVersion']);
    if (!input || typeof input !== 'object' || Array.isArray(input) ||
        Object.keys(input).some(key => !keys.includes(key))) throw new Error();
  } catch {
    throw failure(400, 'INVALID_BODY');
  }
  return input;
}

function createStaffApi({ db, assets, verifyAccess, liveIdentity, now = Date.now }) {
  return async event => {
    try {
      const path = event.path ?? '';
      const method = event.httpMethod;
      const action = path.startsWith(staffPath + '/') ? path.slice(staffPath.length + 1) : '';
      const settingsPath = [...operationalSettings.keys()].find(base =>
        (method === 'GET' && [base, base + '/changes'].includes(path)) ||
        (method === 'POST' && ['/request', '/approve', '/reject',
          ...(base === notificationSettings.PATH ? ['/upload'] : [])].some(suffix => path === base + suffix)));
      if (event.requestContext?.stage !== 'production' ||
          !(settingsPath || method === 'GET' && [staffPath, staffPath + '/options', staffPath + '/slides', staffPath + '/classifications', staffPath + '/interfaces'].includes(path) ||
            method === 'POST' && ['draft', 'publish', 'rollback', 'slides', 'promotion-header/publish', 'classifications', 'interfaces/catalog', 'interfaces/draft', 'interfaces/publish', 'interfaces/rollback'].includes(action))) {
        throw failure(404, 'NOT_FOUND');
      }
      const claims = await identity(event, verifyAccess, 'admin', now);
      const key = { pk: 'EMPLOYEE#' + claims.sub, sk: 'PROFILE' };
      const actor = await get(db, table, key);
      if (!actor || actor.employeeId !== claims.sub || actor.status !== 'ACTIVE' ||
          !Number.isSafeInteger(actor.version) || !Number.isInteger(claims.auth_time) ||
          (actor.minimumAuthTime || 0) > claims.auth_time || actor.scope?.allRegions !== true ||
          !allowed(actor, settingsPath ? 'settings.read' : 'promotions.read')) throw failure(403, 'PERMISSION_REQUIRED');

      const live = await liveIdentity(claims);
      if (!live?.Enabled || live.UserStatus !== 'CONFIRMED' ||
          live.UserAttributes?.find(attr => attr.Name === 'sub')?.Value !== claims.sub ||
          !live.UserMFASettingList?.includes('SOFTWARE_TOKEN_MFA')) throw failure(403, 'ADMIN_MFA_REQUIRED');

      const ctx = {
        ...ctxFor(db, assets, now),
        guard: (person = actor) => ({
          ConditionCheck: {
            TableName: table, Key: { pk: 'EMPLOYEE#' + person.employeeId, sk: 'PROFILE' }, ConditionExpression: '#version=:version AND #status=:status',
            ExpressionAttributeNames: { '#version': 'version', '#status': 'status' },
            ExpressionAttributeValues: { ':version': person.version, ':status': 'ACTIVE' },
          },
        }),
        audit: (id, action, before, after, trace) => audit.write(table, actor, id, action, before, after, trace),
      };
      if (settingsPath) {
        let input = {};
        if (method === 'POST') {
          try {
            if (event.isBase64Encoded || typeof event.body !== 'string' || Buffer.byteLength(event.body) >
                (path.endsWith('/upload') ? 351000 : 20000)) throw Error();
            input = JSON.parse(event.body);
            if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error();
          } catch {
            throw failure(400, 'INVALID_BODY');
          }
        }
        const result = await operationalSettings.get(settingsPath).route({
          ...ctx, claims, allowed, enrolled: true,
          employee: employeeId => get(db, table, { pk: 'EMPLOYEE#' + employeeId, sk: 'PROFILE' }),
          recent: session => {
            if (now() / 1000 - session.auth_time > 300) throw failure(403, 'REAUTH_REQUIRED');
          },
        }, actor, method, path, input);
        return reply(200, result, headers);
      }
      if (action === 'interfaces' || action.startsWith('interfaces/')) {
        return reply(200, await interfaces.route(ctx, actor, method, path, method === 'POST' ? parseBody(event, action) : {}), headers);
      }
      if (action === 'classifications') {
        const input = method === 'POST' ? parseBody(event, action) : undefined;
        return reply(200, await discovery.route(ctx, actor, method, input), headers);
      }
      if (action === 'slides') {
        let input = {};
        if (method === 'POST') {
          try {
            if (event.isBase64Encoded || typeof event.body !== 'string' ||
                Buffer.byteLength(event.body) > 4250000) throw new Error();
            input = JSON.parse(event.body);
            if (!input || typeof input !== 'object' || Array.isArray(input) ||
                !['upload', 'uploadNavigation', 'save', 'publish', 'pause', 'archive'].includes(input.action)) throw new Error();
            if (!['upload', 'uploadNavigation'].includes(input.action) && (!validId(input.id) || !Number.isInteger(input.baseVersion))) {
              throw new Error();
            }
          } catch {
            throw failure(400, 'INVALID_BODY');
          }
        }
        if (input.action === 'uploadNavigation') {
          if (!allowed(actor, 'promotions.edit')) throw failure(403, 'PERMISSION_REQUIRED');
          return reply(200, await media.uploadNavigationImage(assets, actor, input), headers);
        }
        return reply(200, await slideshow.staffRoute(ctx, actor, method, input, () => readOptions(db)), headers);
      }
      if (action === 'options') {
        const query = event.queryStringParameters ?? {};
        if (Object.keys(query).length) {
          if (Object.keys(query).length === 1 && query.headerOffers === '1') {
            return reply(200, { offers: await campaigns.headerChoices(db) }, headers);
          }
          if (Object.keys(query).length !== 1 || !validId(query.headerBranch)) throw failure(400, 'INVALID_QUERY');
          const branch = await get(db, homeTables.merchants, { businessId: query.headerBranch });
          if (!isSelectableMerchant(branch)) throw failure(404, 'NOT_FOUND');
          const products = await require('../../../backend/staff-service/promotion-scenes').menu(
            { db, promotionMenuTable: 'wizz-production-MerchantPlatform' }, query.headerBranch,
          );
          return reply(200, { products: products.filter(row => validId(row.productId)).map(row => ({
            id: row.productId, name: row.name_ar || row.name || row.productName || row.productId,
          })) }, headers);
        }
        const [options, catalog] = await Promise.all([readOptions(db), discovery.route(ctx, actor, 'GET')]);
        return reply(200, { ...options, cuisines: catalog.cuisines, brands: catalog.brands }, headers);
      }
      const input = method === 'POST' ? parseBody(event, action) : {};
      const data = await layout.route(ctx, actor, method, path, input);
      if (method === 'GET') {
        return reply(200, {
          ...data,
          draftFilters: productionFilters(data.draftFilters),
          defaultWelcome: layout.DEFAULT_COPY,
        }, headers);
      }
      return reply(200, data, headers);
    } catch (error) {
      return respondError(event, error, headers);
    }
  };
}

function respondError(event, error, outgoingHeaders) {
  if (error.name === 'TransactionCanceledException' && [...operationalSettings.keys()].some(path => event.path?.startsWith(path))) {
    return reply(409, { error: 'VERSION_OR_STATE_CONFLICT' }, outgoingHeaders);
  }
  const status = error.status || 503;
  if (!error.status) {
    console.error(JSON.stringify({ event: 'CUSTOMER_HOME_FAILURE', requestId: event.requestContext?.requestId, name: error.name }));
  }
  return reply(status, { error: error.status ? error.message : 'HOME_SETTINGS_UNAVAILABLE' }, outgoingHeaders);
}

module.exports = { createPublicApi, createStaffApi, publicPath, staffPath };
