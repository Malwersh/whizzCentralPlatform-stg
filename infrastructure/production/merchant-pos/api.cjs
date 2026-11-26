'use strict';

const { GetCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');

const branches = 'wizz-production-Merchants';
const platform = 'wizz-production-MerchantPlatform';
const deletion = 'wizz-production-AccountDeletion';
const defaults = { enabled: false, systemType: 'genericApi', apiEndpoint: '', locationId: '',
  testMode: false, autoSendOrders: false, autoAcceptOrders: true, timeoutSeconds: 30 };
const systems = new Set(['genericApi', 'square', 'toast', 'clover', 'shopify', 'woocommerce']);
const fail = (code, status = 400) => { throw Object.assign(Error(code), { status }); };
const view = row => ({ ...defaults, ...row?.settings, apiKey: '', apiKeyConfigured: !!row?.apiKey });

function approvedEndpoint(raw, approved) {
  let url;
  try { url = new URL(raw); } catch { return fail('POS_ENDPOINT_INVALID'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || url.search) fail('POS_ENDPOINT_INVALID');
  if (!approved.has(url.href)) fail('POS_ENDPOINT_NOT_APPROVED', 403);
  return url.href;
}

function createMerchantPosApi({ db, authenticate, approvedEndpoints = [], request = fetch, now = Date.now }) {
  const approved = new Set(approvedEndpoints);
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  const reply = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });
  const read = async (TableName, Key) => (await db.send(new GetCommand({ TableName, Key, ConsistentRead: true }))).Item;
  function parse(event) {
    try {
      if (event.isBase64Encoded || typeof event.body !== 'string' || Buffer.byteLength(event.body) > 4096) throw Error();
      const input = JSON.parse(event.body);
      if (!input || typeof input !== 'object' || Array.isArray(input) ||
          Object.keys(input).some(key => key !== 'apiKey' && !Object.hasOwn(defaults, key))) throw Error();
      return input;
    } catch { fail('INVALID_POS_SETTINGS'); }
  }
  function settings(input, previous) {
    const next = {};
    for (const [key, baseline] of Object.entries(defaults)) {
      const value = input[key] ?? previous?.settings?.[key] ?? baseline;
      if (typeof value !== typeof baseline) fail('INVALID_POS_SETTINGS');
      next[key] = value;
    }
    if (!systems.has(next.systemType) || !Number.isInteger(next.timeoutSeconds) ||
        next.timeoutSeconds < 10 || next.timeoutSeconds > 120 ||
        !/^[\x20-\x7e]{0,150}$/.test(next.locationId)) fail('INVALID_POS_SETTINGS');
    if (next.autoSendOrders) fail('POS_AUTO_SEND_UNAVAILABLE', 409);
    if (next.apiEndpoint) next.apiEndpoint = approvedEndpoint(next.apiEndpoint, approved);
    const replacement = input.apiKey;
    if (replacement !== undefined && (typeof replacement !== 'string' || !/^[\x21-\x7e]{0,512}$/.test(replacement))) {
      fail('INVALID_POS_SETTINGS');
    }
    const apiKey = replacement || (next.apiEndpoint === previous?.settings?.apiEndpoint ? previous?.apiKey : '') || '';
    if (next.enabled && (!next.apiEndpoint || !apiKey)) fail('POS_CREDENTIALS_REQUIRED');
    return { settings: next, apiKey };
  }

  return async event => {
    try {
      const route = event?.path?.match(/^\/businesses\/([\w-]{1,150})\/pos-settings(\/test-connection)?$/);
      if (event?.requestContext?.stage !== 'production' || !route) fail('NOT_FOUND', 404);
      const [, businessId, test] = route;
      if (!(test ? ['POST'] : ['GET', 'PUT']).includes(event.httpMethod)) fail('METHOD_NOT_ALLOWED', 405);
      const { sub } = await authenticate(event);
      const lockKeys = ['ACCOUNT_LIFECYCLE#MERCHANT#' + sub, 'BUSINESS_LIFECYCLE#MERCHANT#' + businessId]
        .map(pk => ({ pk, sk: 'META' }));
      const position = { pk: 'MERCHANT_POS#' + businessId, sk: 'SETTINGS' };
      async function assertOwner() {
        const branch = await read(branches, { businessId });
        if (!branch || branch.ownerId !== sub || branch.cognitoUserId !== sub || branch.status !== 'approved' ||
            branch.deletedAt || branch.isDeleted || branch.deletionRequestId || branch.orderIntakeDeletionRequestId) {
          fail('BRANCH_UNAVAILABLE', 404);
        }
        if ((await Promise.all(lockKeys.map(key => read(deletion, key)))).some(Boolean)) fail('BRANCH_UNAVAILABLE', 409);
      }
      await assertOwner();
      const saved = await read(platform, position);
      const current = saved?.ownerId === sub ? saved : undefined;
      if (event.httpMethod === 'GET') return reply(200, view(current));
      const next = settings(parse(event), current);
      if (test) {
        if (!next.settings.apiEndpoint || !next.apiKey) fail('POS_CREDENTIALS_REQUIRED');
        await assertOwner();
        let success = false;
        try {
          const response = await request(next.settings.apiEndpoint, { method: 'POST', redirect: 'error',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + next.apiKey,
              'X-Location-Id': next.settings.locationId, 'X-POS-System': next.settings.systemType },
            body: JSON.stringify({ event: 'pos.test', systemType: next.settings.systemType,
              locationId: next.settings.locationId, timestamp: new Date(now()).toISOString() }),
            signal: AbortSignal.timeout(10000) });
          success = response.ok;
          await response.body?.cancel();
        } catch { /* Keep provider response and secret out of the public result. */ }
        return reply(200, { success, message: success ? 'نجح الاتصال بنقطة البيع.' : 'تعذر الاتصال بنقطة البيع.' });
      }
      const version = (saved?.version || 0) + 1;
      await db.send(new TransactWriteCommand({ TransactItems: [
        ...lockKeys.map(Key => ({ ConditionCheck: { TableName: deletion, Key, ConditionExpression: 'attribute_not_exists(pk)' } })),
        { ConditionCheck: { TableName: branches, Key: { businessId },
          ConditionExpression: 'ownerId=:owner AND cognitoUserId=:owner AND #s=:approved AND attribute_not_exists(deletionRequestId) AND attribute_not_exists(orderIntakeDeletionRequestId) AND attribute_not_exists(deletedAt) AND (attribute_not_exists(isDeleted) OR isDeleted=:no)',
          ExpressionAttributeNames: { '#s': 'status' },
          ExpressionAttributeValues: { ':owner': sub, ':approved': 'approved', ':no': false } } },
        { Put: { TableName: platform, Item: { ...position, ...next, version, ownerId: sub, businessId, updatedAt: new Date(now()).toISOString() },
          ConditionExpression: saved ? 'ownerId=:owner AND #v=:version' : 'attribute_not_exists(pk)',
          ...(saved ? { ExpressionAttributeNames: { '#v': 'version' },
            ExpressionAttributeValues: { ':owner': saved.ownerId, ':version': saved.version } } : {}) } },
      ] }));
      return reply(200, { success: true, settings: view(next) });
    } catch (error) {
      if (error.name === 'TransactionCanceledException') return reply(409, { code: 'POS_SETTINGS_CHANGED' });
      return reply(error.status || 503, { code: error.status ? error.message : 'POS_UNAVAILABLE' });
    }
  };
}

module.exports = { createMerchantPosApi };
