'use strict';

const CUSTOMER = '/order/cancel';
const MERCHANT = '/auth/order-cancellation';
const identifier = /^[A-Za-z0-9][A-Za-z0-9_:#.-]{0,149}$/;
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const customerFields = new Set([
  'orderId', 'requestedBy', 'reason', 'canceledBy', 'cancellationAction',
  'cancellationProtocolVersion', 'idempotencyKey',
]);
const headers = {
  'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization,Content-Type',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
};
const reply = (statusCode, body) => ({ statusCode, headers, body: body ? JSON.stringify(body) : '' });
const reject = (statusCode, code) => reply(statusCode, { success: false, code });

function objectBody(event) {
  if (event.isBase64Encoded || typeof event.body !== 'string' || Buffer.byteLength(event.body) > 12000) return null;
  const body = JSON.parse(event.body);
  return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
}

function customerOrder(body) {
  if (!body || Object.keys(body).some(key => !customerFields.has(key)) ||
      body.canceledBy !== 'customer' || typeof body.orderId !== 'string' || !identifier.test(body.orderId) ||
      (body.requestedBy !== undefined && (typeof body.requestedBy !== 'string' || !identifier.test(body.requestedBy))) ||
      (body.cancellationProtocolVersion !== undefined && body.cancellationProtocolVersion !== 1)) return false;
  if (body.cancellationAction === 'preview') return true;
  return (body.cancellationAction === undefined || body.cancellationAction === 'request') &&
    typeof body.reason === 'string' && body.reason.trim().length >= 3 && body.reason.length <= 500 &&
    (body.idempotencyKey === undefined || (typeof body.idempotencyKey === 'string' && uuid.test(body.idempotencyKey)));
}

function createHandler({ customer, merchant, authenticateMerchant, env = process.env }) {
  return async event => {
    const route = event.path;
    if (env.ENVIRONMENT !== 'production' || event.requestContext?.stage !== 'production' ||
        ![CUSTOMER, MERCHANT].includes(route)) return reject(404, 'NOT_FOUND');
    if (event.httpMethod === 'OPTIONS') return reply(204);
    if (event.httpMethod !== 'POST' && !(route === MERCHANT && event.httpMethod === 'GET')) {
      return reject(405, 'METHOD_NOT_ALLOWED');
    }
    const credentials = Object.entries(event.headers || {}).filter(([name]) => name.toLowerCase() === 'authorization');
    const token = credentials.length === 1 && typeof credentials[0][1] === 'string'
      ? /^Bearer (\S{1,16000})$/i.exec(credentials[0][1])?.[1]
      : undefined;
    if (!token) return reject(401, 'UNAUTHORIZED');
    let input;
    try {
      input = event.httpMethod === 'POST' ? objectBody(event) : event.queryStringParameters || {};
    } catch { return reject(400, 'INVALID_CANCELLATION'); }
    if (route === CUSTOMER ? !customerOrder(input) : !input || Object.hasOwn(input, 'handover')) {
      return reject(400, 'INVALID_CANCELLATION');
    }
    const normalized = { ...event, headers: { Authorization: 'Bearer ' + token } };
    try {
      const result = route === CUSTOMER
        ? await customer(normalized, input)
        : await merchant(await authenticateMerchant(token), normalized, input);
      return result?.success === true && result.orderId === input.orderId
        ? reply(200, result) : reject(503, 'CANCELLATION_UNAVAILABLE');
    } catch (error) {
      const code = error?.code || error?.message;
      if (code === 'UNAUTHORIZED') return reject(401, code);
      if ([400, 401, 403, 404, 409, 503].includes(error?.status) && /^[A-Z][A-Z0-9_]{0,79}$/.test(code)) {
        return reject(error.status, code);
      }
      return reject(503, 'CANCELLATION_UNAVAILABLE');
    }
  };
}

module.exports = { createHandler };
