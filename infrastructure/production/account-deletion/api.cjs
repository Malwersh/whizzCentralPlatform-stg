'use strict';

const { GetCommand } = require('@aws-sdk/lib-dynamodb');
const { accountAuth } = require('../../../backend/account-deletion/account-auth');
const { coordinator } = require('../../../backend/account-deletion/coordinator');
const { deletionVerification } = require('../../../backend/account-deletion/deletion-verification');
const { blockers, error, target } = require('../../../backend/account-deletion/policy');
const { receiptAccess } = require('../../../backend/account-deletion/receipt-access');
const { retentionSettings } = require('../../../backend/account-deletion/settings');
const { dynamoStore } = require('../../../backend/account-deletion/store');
const { identities } = require('../wallet-identity-bindings.json');
const { createEvidence, tables } = require('./evidence.cjs');
const { driverSteps } = require('./driver-steps.cjs');
const { customerSteps } = require('./customer-identity.cjs');

const path = '/deletion/{proxy+}';
const production = { environment: 'production' };
const { merchantSteps } = require('./merchant-steps.cjs');
const types = ['CUSTOMER', 'DRIVER', 'MERCHANT'];
const uuid = value => typeof value==='string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const ops = new Map([
  ['eligibility', 'GET'], ['status', 'GET'], ['send', 'POST'], ['request', 'POST'], ['receipt', 'POST'],
]);
const headers = {
  'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': 'https://production.dy2cvcjvju3cf.amplifyapp.com',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
};
const reply = (statusCode, payload) => ({ statusCode, headers, body: payload ? JSON.stringify(payload) : '' });
const errors = {
  UNAUTHORIZED: [401, 'يرجى تسجيل الدخول.'],
  OWNER_REQUIRED: [403, 'إغلاق الفرع متاح لمالكه.'],
  MEMBERSHIP_REQUIRED: [403, 'تعذّر التحقق من عضويتك في هذا الفرع.'],
  OWNERSHIP_TRANSFER_REQUIRED: [403, 'استخدم مسار نقل الملكية أو إغلاق الفرع.'],
  PHONE_VERIFICATION_REQUIRED: [403, 'وثّق رقم هاتف حسابك أولًا.'],
  INVALID_SCOPE: [400, 'تحقّق من الحساب أو الفرع المختار.'],
  INVALID_BODY: [400, 'بيانات الطلب غير صحيحة.'],
  INVALID_REQUEST_ID: [400, 'تعذّر مطابقة مرجع الطلب.'],
  INVALID_CODE: [400, 'الرمز غير صحيح أو انتهت صلاحيته.'],
  BUSINESS_NOT_FOUND: [404, 'الفرع غير متاح.'],
  OWNERSHIP_MISMATCH: [409, 'تعذّر مطابقة الملكية. راجع الدعم.'],
  REQUEST_CONFLICT: [409, 'تغيّرت بيانات الطلب. حدّث صفحة الحالة.'],
  DELETION_SCOPE_EXCEEDS_TRANSACTION_LIMIT: [409, 'راجع الفروع المشمولة وأغلقها من ملفاتها.'],
  TransactionCanceledException: [409, 'تغيّرت بيانات الطلب. حدّث صفحة الحالة.'],
  ConditionalCheckFailedException: [409, 'تغيّرت بيانات الطلب. حدّث صفحة الحالة.'],
};

function readBody(event, fields) {
  try {
    if (event.isBase64Encoded || typeof event.body !== 'string' || Buffer.byteLength(event.body) > 4096) throw Error();
    const input = JSON.parse(event.body);
    if (!input || typeof input !== 'object' || Array.isArray(input) ||
        Object.keys(input).some(key => !fields.includes(key))) throw Error();
    return input;
  } catch {
    throw error('INVALID_BODY');
  }
}

function createApi({
  db, cognito, secret, deliver, executionTypes = new Set(), clock = Date.now,
  inspect = createEvidence({ db }), allowIntake = () => true, allowedTypes = types,
}) {
  const table = tables.deletion;
  const seconds = () => Math.floor(clock() / 1000);
  const clients = Object.fromEntries(types.map(type => {
    const identity = identities[type.toLowerCase()];
    return [type, { pool: identity.poolId, clientId: identity.clientId }];
  }));
  const auth = accountAuth({ cognito, allowedTypes, clients });
  const settings = retentionSettings({ db, table: tables.staff, approvedInventories: executionTypes, ...production });
  const store = dynamoStore({ db, table, clock: seconds, ...production });
  const verify = deletionVerification({ db, table, secret, deliver, clock: seconds, ...production });
  const receipts = receiptAccess({ db, table, store, secret, clock: seconds });
  const deletion = coordinator({ store, settings, verifyDeletionChallenge: verify.verify,
    clock: () => new Date(clock()).toISOString(),
    adapters: Object.fromEntries(types.map(type => [type, { evidence: inspect,
      requiredSteps: scope => type === 'CUSTOMER' ? customerSteps : type === 'DRIVER' ? driverSteps : merchantSteps(scope) }])) });
  const get = async Key => (await db.send(new GetCommand({ TableName: table, Key, ConsistentRead: true }))).Item;

  return async event => {
    if (event.resource !== path || event.requestContext?.stage !== 'production') return reply(404, { code: 'NOT_FOUND' });
    const operation = event.path?.slice('/deletion/'.length);
    if (!ops.has(operation) || event.path !== '/deletion/' + operation) return reply(404, { code: 'NOT_FOUND' });
    if (event.httpMethod === 'OPTIONS') return reply(204);
    if (event.httpMethod !== ops.get(operation)) return reply(405, { code: 'METHOD_NOT_ALLOWED' });
    try {
      if (operation === 'receipt') return reply(200, await receipts.read(readBody(event, ['receiptToken']).receiptToken));
      const actor = await auth(event);
      const query = event.queryStringParameters || {};
      if (event.httpMethod === 'GET') {
        if (Object.keys(query).some(key => !['scope','businessId'].includes(key))) throw error('INVALID_SCOPE');
        const scope = target(actor, { kind: query.scope ?? 'ACCOUNT', businessId: query.businessId });
        if (operation === 'eligibility') {
          const [facts, config] = await Promise.all([inspect(actor, scope, { preview: true }), settings(actor.type)]);
          return reply(200, {
            blockers: blockers(actor, scope, facts), businesses: facts.businesses || [],
            wallets: facts.wallets, activeOrders: facts.activeOrders, activeHolds: facts.activeHolds,
            pendingTransfers: facts.pendingTransfers, pendingPayments: facts.pendingPayments,
            policyVersion: config.retentionPolicyVersion, executionReady: config.inventoryApproved && allowIntake(actor),
          });
        }
        const active = await get({ pk: 'SUBJECT#'+actor.type+'#'+actor.sub, sk: 'ACTIVE#'+scope.kind+'#'+scope.id });
        if (!active) return reply(200, { request: null });
        const request = await store.get(actor, active.requestId);
        if (!request || request.subjectId!==actor.sub || request.actorType!==actor.type ||
            request.scope?.kind!==scope.kind || request.scope?.id!==scope.id) throw error('OWNERSHIP_MISMATCH');
        return reply(200, { request: await deletion.refresh(actor, request.requestId), receiptToken: await receipts.issue(actor, request) });
      }

      if (Object.keys(query).length) throw error('INVALID_BODY');
      const data = readBody(event, operation==='send' ? ['requestId','scope'] : ['requestId','scope','challengeId','code']);
      if (!uuid(data.requestId)) throw error('INVALID_REQUEST_ID');
      if (operation==='request'&&!uuid(data.challengeId)) throw error('INVALID_CODE');
      const input = { ...data, scope: target(actor, data.scope ?? { kind: 'ACCOUNT' }) };
      if (actor.type === 'MERCHANT' && !merchantSteps(input.scope).length) throw error('INVALID_SCOPE');
      if (!executionTypes.has(actor.type) || !allowIntake(actor)) return reply(503, { code:'SERVICE_UNAVAILABLE', message:'تعذّر تقديم طلب الحذف حاليًا.' });
      await settings(actor.type);
      if (operation === 'send') {
        if (input.scope.kind!=='ACCOUNT') await inspect(actor, input.scope);
        const challenge = await verify.send(actor, input);
        return reply(200, { ...challenge, receiptToken: await receipts.prepare(actor, input) });
      }
      const result = await deletion.request(actor, input);
      const record = await store.get(actor, result.requestId);
      return reply(200, { ...result, receiptToken: await receipts.issue(actor, record) });
    } catch (failure) {
      const code = failure.code || failure.name;
      if (operation==='send'&&(code==='TransactionCanceledException'||code==='ConditionalCheckFailedException')){
        return reply(429,{code:'VERIFICATION_RATE_LIMIT',message:'انتظر قبل طلب رمز جديد.'});
      }
      const known = Object.hasOwn(errors, code) ? errors[code] : undefined;
      if (known) return reply(known[0], { code, message: known[1] });
      console.warn('PRODUCTION_ACCOUNT_DELETION_REQUEST_FAILED', { code });
      return reply(503, { code:'SERVICE_UNAVAILABLE', message:'تعذّر إكمال العملية. حدّث حالة الطلب قبل إعادة المحاولة.' });
    }
  };
}

module.exports = { createApi, path };
