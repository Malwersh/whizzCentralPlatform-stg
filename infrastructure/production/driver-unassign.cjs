'use strict';

const { LambdaClient } = require('@aws-sdk/client-lambda');
const { invokeFinancialUnassign } = require('../../../whizzDrivers-stg/backend/financial-accept-client');

const route = '/driver/orders/{orderId}/financial-unassign';
const id = /^[A-Za-z0-9][A-Za-z0-9_.:#-]{0,149}$/;
const reasons = new Set(['VehicleIssue', 'Emergency', 'TooFar', 'TrafficJam', 'Other']);
const reply = (statusCode, data) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  body: JSON.stringify(data),
});
const error = (status, code, message) => reply(status, { success: false, code, message });

function accessToken(event) {
  const authorization = entries => Object.entries(entries ?? {}).filter(([name]) => name.toLowerCase() === 'authorization');
  const headers = authorization(event.headers);
  const multi = authorization(event.multiValueHeaders);
  if (headers.length !== 1 || multi.length > 1) return null;
  const value = headers[0][1];
  if (multi.length && (!Array.isArray(multi[0][1]) || multi[0][1].length !== 1 || multi[0][1][0] !== value)) return null;
  return typeof value === 'string' && value.length <= 16000 ? /^Bearer ([\w-]+\.[\w-]+\.[\w-]+)$/.exec(value)?.[1] : null;
}

function createHandler({ apiId, unassign }) {
  return async event => {
    if (event?.requestContext?.apiId !== apiId || event.requestContext.stage !== 'production' ||
        event.resource !== route || event.httpMethod !== 'POST') {
      return error(404, 'NOT_FOUND', 'هذا الإجراء غير متاح.');
    }
    const token = accessToken(event);
    if (!token) return error(401, 'AUTH_REQUIRED', 'يرجى تسجيل الدخول.');

    const orderId = event.pathParameters?.orderId;
    let input;
    try {
      if (typeof orderId !== 'string' || !id.test(orderId) || event.isBase64Encoded ||
          typeof event.body !== 'string' || Buffer.byteLength(event.body) > 2048) throw Error();
      input = JSON.parse(event.body);
      if (!input || typeof input !== 'object' || Array.isArray(input) ||
          Object.keys(input).sort().join(',') !== 'attempt,cashCollected,offerId,reason' ||
          typeof input.offerId !== 'string' || !id.test(input.offerId) ||
          !Number.isSafeInteger(input.attempt) || input.attempt < 1 || input.attempt >= 1000 ||
          input.cashCollected !== false || !reasons.has(input.reason)) throw Error();
    } catch {
      return error(400, 'INVALID_COD_ASSIGNMENT', 'تحقق من بيانات الإسناد وسبب الاعتذار.');
    }

    try {
      const result = await unassign({ ...input, orderId }, token);
      if (result?.success !== true || result.kind !== 'COD_UNASSIGNED' || result.orderId !== orderId ||
          result.offerId !== input.offerId || result.attempt !== input.attempt ||
          typeof result.operationId !== 'string' || !id.test(result.operationId) ||
          typeof result.holdReleased !== 'boolean' || typeof result.replayed !== 'boolean') {
        return error(503, 'COD_ASSIGNMENT_UNAVAILABLE', 'تعذر تأكيد النتيجة. حدّث الطلب قبل إعادة المحاولة.');
      }
      return reply(200, {
        success: true, kind: result.kind, orderId, offerId: result.offerId, attempt: result.attempt,
        operationId: result.operationId, holdReleased: result.holdReleased, replayed: result.replayed,
      });
    } catch (failure) {
      if (failure.statusCode === 401 || failure.code === 'UNAUTHORIZED') {
        return error(401, 'AUTH_REQUIRED', 'يرجى تسجيل الدخول.');
      }
      if (failure.statusCode === 403 || failure.code === 'FORBIDDEN') {
        return error(403, 'ASSIGNMENT_FORBIDDEN', 'الإسناد المطلوب غير متاح لهذا الحساب.');
      }
      if (failure.code === 'COD_ASSIGNMENT_CONFLICT' || failure.code === 'COD_ASSIGNMENT_UNAVAILABLE') {
        return error(409, failure.code, 'تعذر تأكيد فك الإسناد. حدّث الطلب قبل إعادة المحاولة.');
      }
      return error(503, 'COD_ASSIGNMENT_UNAVAILABLE', 'تعذر تأكيد النتيجة. حدّث الطلب قبل إعادة المحاولة.');
    }
  };
}

const apiId = 'kq49g7b6wa';
const client = new LambdaClient({ region: 'us-east-1', maxAttempts: 2 });
const production = createHandler({ apiId, unassign: (body, token) => invokeFinancialUnassign(body, token, client) });
exports.createHandler = createHandler;
exports.handler = event => process.env.ENVIRONMENT === 'production' && process.env.AWS_REGION === 'us-east-1'
  ? production(event)
  : error(503, 'COD_ASSIGNMENT_UNAVAILABLE', 'خدمة فك الإسناد غير متاحة.');
