const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  PutCommand,
  DeleteCommand,
  GetCommand,
  TransactWriteCommand
} = require('@aws-sdk/lib-dynamodb');

const { verifyJwtMulti } = require('../utils/jwt-multi-verify');
const { isProduction } = require('../utils/notification-provider-bindings');
const { ok, badRequest, unauthorized, forbidden, serverError, corsHeaders } = require('../utils/http');

const dynamodb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' })
);

const TOKENS_TABLE = process.env.PUSH_TOKENS_TABLE;
const production = isProduction(process.env);
const APP_POOLS = { user: 'users', driver: 'drivers', merchant: 'merchants' };
const DELETION_TABLE = production ? 'wizz-production-AccountDeletion' : 'staging-AccountDeletion';
const productionToken = value => typeof value === 'string' && /^(?!.*\s).{1,2048}$/.test(value) &&
  Buffer.byteLength(value, 'utf8') <= 2048;
const productionBranch = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:#-]{0,149}$/.test(value);

function registryConfigured() {
  return production ? TOKENS_TABLE === 'wizz-production-PushDeviceTokens' : Boolean(TOKENS_TABLE);
}

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

  if (!registryConfigured()) return serverError('Token registry unavailable');

  try {
    const body = JSON.parse(event.body || '{}');
    const token = String(body.token || '').trim();
    const app = normalizeApp(body.app);
    const platform = normalizePlatform(body.platform);
    const deviceId = body.deviceId ? String(body.deviceId).trim() : null;
    const businessId = body.businessId ? String(body.businessId).trim() : null;

    if (production && (!productionToken(body.token) ||
        (businessId !== null && (app !== 'merchant' || !productionBranch(body.businessId))))) {
      return badRequest('Invalid device registration');
    }
    if (!token) return badRequest('Missing token');
    if (!app) return badRequest('Invalid app (driver|user|merchant)');
    if (!platform) return badRequest('Invalid platform (ios|android)');

    // Internal registration path (used for guest tokens via trusted backend)
    const providedKey = String(getHeader(event, 'x-internal-key') || '').trim();
    const allowInternal = !production && Boolean(INTERNAL_API_KEY) && providedKey === INTERNAL_API_KEY;

    let subjectId;
    if (allowInternal) {
      subjectId = String(body.subjectId || '').trim();
      if (!subjectId) return badRequest('Missing subjectId');
      // Safety: only allow guest-style ids from internal callers.
      if (!subjectId.startsWith('GUEST_')) {
        return forbidden('Internal registration only supports guest subjectId (must start with GUEST_)');
      }
    } else {
      const { payload, pool } = await verifyJwtMulti(event, userTypeHintFromApp(app));
      if (pool !== APP_POOLS[app]) return forbidden('Token does not belong to this app');
      subjectId = payload.sub;

      // Optional: accept subjectId in payload but enforce match
      if (body.subjectId && String(body.subjectId) !== String(subjectId)) {
        return forbidden('subjectId mismatch');
      }
    }

    const nowIso = new Date().toISOString();
    const nowEpoch = Date.now();

    const item={
        TableName: TOKENS_TABLE,
        ...(production ? {
          ConditionExpression: 'attribute_not_exists(#token) OR (#subject = :subject AND #app = :app)',
          ExpressionAttributeNames: {'#token': 'token', '#subject': 'subjectId', '#app': 'app'},
          ExpressionAttributeValues: {':subject': subjectId, ':app': app}
        } : {}),
        Item: {
          token,
          subjectId,
          app,
          platform,
          deviceId,
          soundEnabled: body.soundEnabled !== false,
          soundReady: Array.isArray(body.soundReady)?body.soundReady.filter(v=>typeof v==='string'&&/^(custom_[a-f0-9]{64}|[a-z_]{1,40})$/.test(v)).slice(0,30):[],
          orderTrackingVersion: body.orderTrackingVersion===1?1:0,
          // For merchant app we optionally bind the token to a businessId.
          // This enables sending merchant order pushes by businessId (storeId) without relying on cross-system subjectId mapping.
          ...(app === 'merchant' && businessId ? { businessId } : {}),
          ...(body.appVersion ? { appVersion: String(body.appVersion) } : {}),
          ...(body.buildNumber ? { buildNumber: String(body.buildNumber) } : {}),
          env: process.env.STAGE,
          createdAt: nowIso,
          updatedAt: nowIso,
          lastSeenAt: nowIso,
          ttl: Math.floor(nowEpoch / 1000) + 60 * 60 * 24 * 180 // 180 days
        }
      };
    if(allowInternal)await dynamodb.send(new PutCommand(item));
    else {
      if(!production && process.env.STAGE!=='staging')throw new Error('Staging push lifecycle configuration required');
      const type=({user:'CUSTOMER',driver:'DRIVER',merchant:'MERCHANT'})[app];
      const checks=[{ConditionCheck:{TableName:DELETION_TABLE,Key:{pk:`ACCOUNT_LIFECYCLE#${type}#${subjectId}`,sk:'META'},ConditionExpression:'attribute_not_exists(pk)'}}];
      if(app==='merchant'&&businessId) {
        checks.push({ConditionCheck:{TableName:DELETION_TABLE,Key:{pk:`BUSINESS_LIFECYCLE#MERCHANT#${businessId}`,sk:'META'},ConditionExpression:'attribute_not_exists(pk)'}});
        if(production) checks.push({ConditionCheck:{
          TableName:'wizz-production-Merchants',Key:{businessId},
          ConditionExpression:'ownerId = :subject AND cognitoUserId = :subject AND attribute_not_exists(deletionRequestId) AND attribute_not_exists(deletedAt) AND (attribute_not_exists(isDeleted) OR isDeleted = :false)',
          ExpressionAttributeValues:{':subject':subjectId,':false':false}
        }});
      }
      await dynamodb.send(new TransactWriteCommand({TransactItems:[...checks,{Put:item}]}));
    }

    return ok({ success: true, subjectId, app, platform });
  } catch (e) {
    const msg = e?.message || String(e);
    if (msg.includes('Missing Authorization') || msg.includes('Invalid token')) {
      return unauthorized('Invalid or missing token');
    }
    if (production && e?.name === 'TransactionCanceledException' &&
        e.CancellationReasons?.some(reason => reason.Code === 'ConditionalCheckFailed')) {
      return forbidden('Device or branch registration not permitted');
    }
    console.error('push-tokens.register error', production ? { name: e?.name } : e);
    return serverError('Failed to register token', production ? {} : { details: msg });
  }
};

exports.unregister = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (!registryConfigured()) return serverError('Token registry unavailable');

  try {
    const body = JSON.parse(event.body || '{}');
    const token = String(body.token || '').trim();
    const app = normalizeApp(body.app);

    if (!token || (production && !productionToken(body.token))) return badRequest('Invalid token');
    if (!app) return badRequest('Invalid app (driver|user|merchant)');

    const { payload, pool } = await verifyJwtMulti(event, userTypeHintFromApp(app));
    if (production && pool !== APP_POOLS[app]) return forbidden('Token does not belong to this app');
    const subjectId = payload.sub;

    const existing = await dynamodb.send(
      new GetCommand({
        TableName: TOKENS_TABLE,
        Key: { token },
        ConsistentRead: true
      })
    );

    if (existing?.Item && (String(existing.Item.subjectId) !== String(subjectId) || existing.Item.app !== app)) {
      return forbidden('Token does not belong to this user');
    }

    await dynamodb.send(
      new DeleteCommand({
        TableName: TOKENS_TABLE,
        Key: { token },
        ConditionExpression: 'attribute_not_exists(#token) OR (#subject = :subject AND #app = :app)',
        ExpressionAttributeNames: {'#token': 'token', '#subject': 'subjectId', '#app': 'app'},
        ExpressionAttributeValues: {':subject': subjectId, ':app': app}
      })
    );

    return ok({ success: true });
  } catch (e) {
    const msg = e?.message || String(e);
    if (msg.includes('Missing Authorization') || msg.includes('Invalid token')) {
      return unauthorized('Invalid or missing token');
    }
    if (e?.name === 'ConditionalCheckFailedException') return forbidden('Token ownership changed');
    console.error('push-tokens.unregister error', {name: e?.name});
    return serverError('Failed to unregister token', production ? {} : { details: msg });
  }
};

// Authenticated device policy refresh; contains only shared operational settings.
exports.soundSettings = async event => {
 if(event.httpMethod==='OPTIONS')return {statusCode:200,headers:corsHeaders,body:''};
 let identity;
 try{identity=await verifyJwtMulti(event);}catch(_){return unauthorized('Invalid or missing token');}
 if(production&&!['drivers','merchants'].includes(identity.pool))return forbidden('Unsupported device account');
 try{
  const table=production?'wizz-production-PlatformStaff':undefined;
  const notificationPolicy=await require('./notification-sound-policy').readPolicy(dynamodb,table);
  const result=ok({success:true,notificationPolicy});
  return {...result,headers:{...result.headers,'Cache-Control':'no-store'}};
 }
 catch(_){return serverError('Notification settings unavailable');}
};
