const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  PutCommand,
  DeleteCommand,
  GetCommand
} = require('@aws-sdk/lib-dynamodb');

const { verifyJwtMulti } = require('../utils/jwt-multi-verify');
const { ok, badRequest, unauthorized, forbidden, serverError, corsHeaders } = require('../utils/http');

const dynamodb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' })
);

const TOKENS_TABLE = process.env.PUSH_TOKENS_TABLE;

const INTERNAL_API_KEY = String(process.env.NOTIFICATIONS_INTERNAL_KEY || '').trim();

function getHeader(event, name) {
  const headers = event.headers || {};
  const target = String(name || '').toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (String(k).toLowerCase() === target) return v;
  }
  return undefined;
}

function normalizeApp(app) {
  const v = String(app || '').trim().toLowerCase();
  if (['driver', 'user', 'merchant'].includes(v)) return v;
  return null;
}

function normalizePlatform(platform) {
  const v = String(platform || '').trim().toLowerCase();
  if (['ios', 'android'].includes(v)) return v;
  return null;
}

function userTypeHintFromApp(app) {
  if (app === 'merchant') return 'merchant';
  if (app === 'driver') return 'driver';
  if (app === 'user') return 'user';
  return 'central';
}

exports.register = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (!TOKENS_TABLE) return serverError('Missing PUSH_TOKENS_TABLE');

  try {
    const body = JSON.parse(event.body || '{}');
    const token = String(body.token || '').trim();
    const app = normalizeApp(body.app);
    const platform = normalizePlatform(body.platform);
    const deviceId = body.deviceId ? String(body.deviceId).trim() : null;
    const businessId = body.businessId ? String(body.businessId).trim() : null;

    if (!token) return badRequest('Missing token');
    if (!app) return badRequest('Invalid app (driver|user|merchant)');
    if (!platform) return badRequest('Invalid platform (ios|android)');

    // Internal registration path (used for guest tokens via trusted backend)
    const providedKey = String(getHeader(event, 'x-internal-key') || '').trim();
    const allowInternal = Boolean(INTERNAL_API_KEY) && providedKey === INTERNAL_API_KEY;

    let subjectId;
    if (allowInternal) {
      subjectId = String(body.subjectId || '').trim();
      if (!subjectId) return badRequest('Missing subjectId');
      // Safety: only allow guest-style ids from internal callers.
      if (!subjectId.startsWith('GUEST_')) {
        return forbidden('Internal registration only supports guest subjectId (must start with GUEST_)');
      }
    } else {
      const { payload } = await verifyJwtMulti(event, userTypeHintFromApp(app));
      subjectId = payload.sub;

      // Optional: accept subjectId in payload but enforce match
      if (body.subjectId && String(body.subjectId) !== String(subjectId)) {
        return forbidden('subjectId mismatch');
      }
    }

    const nowIso = new Date().toISOString();
    const nowEpoch = Date.now();

    await dynamodb.send(
      new PutCommand({
        TableName: TOKENS_TABLE,
        Item: {
          token,
          subjectId,
          app,
          platform,
          deviceId,
          // For merchant app we optionally bind the token to a businessId.
          // This enables sending merchant order pushes by businessId (storeId) without relying on cross-system subjectId mapping.
          businessId: app === 'merchant' && businessId ? businessId : undefined,
          appVersion: body.appVersion ? String(body.appVersion) : undefined,
          buildNumber: body.buildNumber ? String(body.buildNumber) : undefined,
          env: process.env.STAGE,
          createdAt: nowIso,
          updatedAt: nowIso,
          lastSeenAt: nowIso,
          ttl: Math.floor(nowEpoch / 1000) + 60 * 60 * 24 * 180 // 180 days
        }
      })
    );

    return ok({ success: true, subjectId, app, platform });
  } catch (e) {
    const msg = e?.message || String(e);
    if (msg.includes('Missing Authorization') || msg.includes('Invalid token')) {
      return unauthorized('Invalid or missing token');
    }
    console.error('push-tokens.register error', e);
    return serverError('Failed to register token', { details: msg });
  }
};

exports.unregister = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (!TOKENS_TABLE) return serverError('Missing PUSH_TOKENS_TABLE');

  try {
    const body = JSON.parse(event.body || '{}');
    const token = String(body.token || '').trim();
    const app = normalizeApp(body.app);

    if (!token) return badRequest('Missing token');
    if (!app) return badRequest('Invalid app (driver|user|merchant)');

    const { payload } = await verifyJwtMulti(event, userTypeHintFromApp(app));
    const subjectId = payload.sub;

    const existing = await dynamodb.send(
      new GetCommand({
        TableName: TOKENS_TABLE,
        Key: { token },
        ConsistentRead: true
      })
    );

    if (existing?.Item && String(existing.Item.subjectId) !== String(subjectId)) {
      return forbidden('Token does not belong to this user');
    }

    await dynamodb.send(
      new DeleteCommand({
        TableName: TOKENS_TABLE,
        Key: { token }
      })
    );

    return ok({ success: true });
  } catch (e) {
    const msg = e?.message || String(e);
    if (msg.includes('Missing Authorization') || msg.includes('Invalid token')) {
      return unauthorized('Invalid or missing token');
    }
    console.error('push-tokens.unregister error', e);
    return serverError('Failed to unregister token', { details: msg });
  }
};
