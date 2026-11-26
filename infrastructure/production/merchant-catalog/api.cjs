'use strict';

const { GetCommand } = require('@aws-sdk/lib-dynamodb');

const branches = 'wizz-production-Merchants';
const deletion = 'wizz-production-AccountDeletion';
const id = '[A-Za-z0-9_-]{1,150}';
const mediaPath = new RegExp('^/media/(merchants/' + id + '/product-images/[A-Za-z0-9_-]{1,150}\\.(?:jpg|jpeg|png|gif|webp))$');
const routes = [
  [/^\/products$/, ['GET', 'POST']],
  [/^\/products\/(?:search|global-search)$/, ['GET']],
  [/^\/products\/inventory$/, ['GET', 'POST']],
  [/^\/products\/imports\/preview$/, ['POST']],
  [new RegExp('^/products/imports/(?<importJobId>' + id + ')/commit$'), ['POST']],
  [new RegExp('^/products/imports/(?<importJobId>' + id + ')$'), ['GET']],
  [new RegExp('^/products/(?<productId>' + id + ')$'), ['GET', 'PUT', 'DELETE']],
  [/^\/categories$/, ['GET', 'POST']],
  [new RegExp('^/categories/business-type/(?<businessType>' + id + ')$'), ['GET']],
  [new RegExp('^/categories/(?<categoryId>' + id + ')$'), ['PUT', 'DELETE']],
  [/^\/menu\/versions$/, ['GET']],
  [/^\/menu\/versions\/(?:publish|rollback)$/, ['POST']],
  [/^\/upload\/product-image$/, ['POST']],
  [/^\/discounts$/, ['GET', 'POST']],
  [new RegExp('^/discounts/(?<discountId>' + id + ')$'), ['GET', 'PUT', 'DELETE']],
  [new RegExp('^/discounts/(?<discountId>' + id + ')/toggle-status$'), ['PATCH']],
];
const responseHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
};
const reply = (statusCode, code) => ({
  statusCode, headers: responseHeaders,
  body: code ? JSON.stringify({ success: false, code }) : '',
});

function createHandler({ db, authenticate, runCatalog, runUpload, runDiscounts, redirectMedia }) {
  async function read(TableName, Key) {
    return (await db.send(new GetCommand({ TableName, Key, ConsistentRead: true }))).Item;
  }
  return async event => {
    if (event.requestContext?.stage !== 'production' || typeof event.path !== 'string') {
      return reply(404, 'NOT_FOUND');
    }
    const media = event.path.match(mediaPath);
    if (media) {
      if (event.httpMethod === 'OPTIONS') return reply(204);
      if (event.httpMethod !== 'GET') return reply(405, 'METHOD_NOT_ALLOWED');
      try {
        return { statusCode: 302, headers: { Location: await redirectMedia(media[1]),
          'Cache-Control': 'public, max-age=60', 'Access-Control-Allow-Origin': '*' }, body: '' };
      } catch { return reply(503, 'MEDIA_UNAVAILABLE'); }
    }
    const found = routes.find(([pattern]) => pattern.test(event.path));
    if (!found) return reply(404, 'NOT_FOUND');
    if (event.httpMethod === 'OPTIONS') return reply(204);
    if (!found[1].includes(event.httpMethod)) return reply(405, 'METHOD_NOT_ALLOWED');
    if (event.isBase64Encoded) return reply(400, 'INVALID_REQUEST');

    const isUpload = event.path === '/upload/product-image';
    const isDiscount = event.path === '/discounts' || event.path.startsWith('/discounts/');
    const limit = isUpload ? 4 * 1024 * 1024 + 512 : isDiscount ? 64 * 1024 : 2 * 1024 * 1024;
    if (event.body != null && (typeof event.body !== 'string' || Buffer.byteLength(event.body) > limit)) {
      return reply(413, 'PAYLOAD_TOO_LARGE');
    }
    let body;
    try {
      body = JSON.parse(event.body || '{}');
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error();
    } catch { return reply(400, 'INVALID_REQUEST'); }

    const queryBranch = event.queryStringParameters?.businessId;
    const businessId = queryBranch ?? body.businessId;
    if (typeof businessId !== 'string' || !new RegExp('^' + id + '$').test(businessId)) {
      return reply(400, 'INVALID_BRANCH_SCOPE');
    }
    if (body.businessId !== undefined && body.businessId !== businessId) {
      return reply(403, 'BRANCH_SCOPE_CONFLICT');
    }

    try {
      const { sub } = await authenticate(event);
      const b = await read(branches, { businessId });
      if (b?.businessId !== businessId || b.status !== 'approved' || b.ownerId !== sub ||
          b.cognitoUserId !== sub || b.deletedAt || b.isDeleted || b.deletionRequestId) {
        return reply(404, 'BRANCH_UNAVAILABLE');
      }
      const closed = await Promise.all([
        read(deletion, { pk: 'ACCOUNT_LIFECYCLE#MERCHANT#' + sub, sk: 'META' }),
        read(deletion, { pk: 'BUSINESS_LIFECYCLE#MERCHANT#' + businessId, sk: 'META' }),
      ]);
      if (closed.some(Boolean)) return reply(409, 'ACCOUNT_CLOSING');
      const actor = { sub, ownerId: sub, businessId, roleName: 'OWNER',
        preparingFirstMenu: b.onboardingSchemaVersion === 2 && b.onboardingComplete !== true && b.isActive !== true };
      const operation = isUpload ? runUpload : isDiscount ? runDiscounts : runCatalog;
      const result = await operation(actor, {
        ...event,
        pathParameters: { ...event.path.match(found[0]).groups, businessId },
        queryStringParameters: { ...event.queryStringParameters, businessId },
      });
      if (result.statusCode >= 500) return reply(503, 'CATALOG_UNAVAILABLE');
      return { ...result, headers: { ...result.headers, ...responseHeaders } };
    } catch (error) {
      const status = error.status || (error.name === 'UserNotFoundException' ? 401 : 503);
      return reply(status, status === 401 ? 'UNAUTHORIZED' : 'CATALOG_UNAVAILABLE');
    }
  };
}

module.exports = { createHandler };
