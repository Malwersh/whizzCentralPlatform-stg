const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const { sign } = require('jsonwebtoken');
const http2 = require('http2');

const { ok, badRequest, serverError, corsHeaders } = require('../utils/http');

const dynamodb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' })
);
const secrets = new SecretsManagerClient({ region: process.env.AWS_REGION || 'us-east-1' });

const TABLE_NAME = process.env.LIVE_ACTIVITIES_TABLE;
const BUNDLE_ID = process.env.LIVE_ACTIVITY_BUNDLE_ID || 'com.wiz.wizuserapp';
const APNS_HOST = process.env.APNS_HOST || 'api.push.apple.com';
const APNS_FALLBACK_HOST = process.env.APNS_FALLBACK_HOST || 'api.sandbox.push.apple.com';
const APNS_SECRET_ID = process.env.APNS_AUTH_KEY_SECRET_ID;

const { authorize, terminal } = require('./live-activity-order-access');
const { content } = require('./order-arrival-content');

let cachedAuth = null;
let cachedAuthExpiresAt = 0;

function getHeader(event, name) {
  const headers = event.headers || {};
  const target = String(name || '').toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (String(k).toLowerCase() === target) return v;
  }
  return undefined;
}

async function getApnsAuth() {
  if (cachedAuth && Date.now() < cachedAuthExpiresAt) {
    return cachedAuth;
  }
  if (!APNS_SECRET_ID) {
    throw new Error('Missing APNS_AUTH_KEY_SECRET_ID');
  }
  const secret = await secrets.send(new GetSecretValueCommand({ SecretId: APNS_SECRET_ID }));
  const data = JSON.parse(secret.SecretString || '{}');
  if (!data.keyId || !data.teamId || !data.key) {
    throw new Error('APNS auth secret must contain keyId, teamId, and key');
  }
  cachedAuth = data;
  // Re-fetch 10 minutes before the 1-hour JWT expiry to be safe.
  cachedAuthExpiresAt = Date.now() + 1000 * 60 * 50;
  return cachedAuth;
}

function makeApnsJwt(auth) {
  return sign(
    { iss: auth.teamId, iat: Math.floor(Date.now() / 1000) },
    auth.key,
    {
      algorithm: 'ES256',
      header: { alg: 'ES256', kid: auth.keyId },
    }
  );
}

function sendApnsPushToHost(host, activityPushToken, payload) {
  return new Promise(async (resolve, reject) => {
    let client;
    try {
      const auth = await getApnsAuth();
      const jwt = makeApnsJwt(auth);

      client = http2.connect(`https://${host}`);
      const req = client.request({
        ':method': 'POST',
        ':path': `/3/device/${activityPushToken}`,
        ':scheme': 'https',
        ':authority': host,
        'authorization': `bearer ${jwt}`,
        'apns-topic': `${BUNDLE_ID}.push-type.liveactivity`,
        'apns-push-type': 'liveactivity',
        'apns-priority': '10',
        'apns-expiration': '0',
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
      });

      req.on('response', (headers) => {
        let data = '';
        req.on('data', (chunk) => (data += chunk));
        req.on('end', () => {
          const status = headers[':status'];
          client.close();
          if (status === 200) {
            resolve({ status, data });
          } else {
            reject({ status, data: data ? JSON.parse(data) : null });
          }
        });
      });

      req.on('error', (err) => {
        if (client) client.close();
        reject(err);
      });

      req.write(payload);
      req.end();
    } catch (err) {
      if (client) client.close();
      reject(err);
    }
  });
}

// Send to the primary host; if APNs rejects the token as belonging to the
// other environment (debug builds get sandbox tokens), retry on the fallback host.
async function sendApnsPush(activityPushToken, payload, eventType) {
  try {
    return await sendApnsPushToHost(APNS_HOST, activityPushToken, payload);
  } catch (err) {
    const reason = err?.data?.reason;
    if (err?.status === 400 && (reason === 'BadDeviceToken' || reason === 'BadEnvironment')) {
      console.log(`APNS token rejected on ${APNS_HOST} (${reason}); retrying on ${APNS_FALLBACK_HOST}`);
      return await sendApnsPushToHost(APNS_FALLBACK_HOST, activityPushToken, payload);
    }
    throw err;
  }
}

function buildPayload(orderId, statusData, eventType) {
  const timestamp = Math.floor(Date.now() / 1000);
  const contentState = {
    status: statusData.status || 'pending',
    statusLabel: statusData.statusLabel || '',
    storeName: statusData.storeName || '',
    orderNumber: statusData.orderNumber || '',
    etaText: statusData.etaText || '',
    progress: typeof statusData.progress === 'number' ? statusData.progress : 0,
  };

  for (const key of ['arrivalEarliestEpoch', 'arrivalLatestEpoch']) {
    if (Number.isFinite(statusData[key])) contentState[key] = statusData[key];
  }

  const base = {
    aps: {
      timestamp,
      event: eventType,
      'content-state': contentState,
      'attributes-type': 'OrderLiveActivityAttributes',
      attributes: { orderId },
    },
  };

  if (eventType !== 'end' && Number.isFinite(statusData.arrivalLatestEpoch)) {
    base.aps['stale-date'] = statusData.arrivalLatestEpoch;
  }
  if (eventType === 'end') {
    base.aps['dismissal-date'] = Math.floor(Date.now() / 1000) - 1; // remove immediately after completion
  }

  return JSON.stringify(base);
}

async function sendToOrder(orderId, statusData, eventType) {
  if (!TABLE_NAME) throw new Error('Missing LIVE_ACTIVITIES_TABLE');

  const tokensResp = await dynamodb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': `ORDER#${orderId}` },
    })
  );

  const items = tokensResp.Items || [];
  const results = [];

  for (const item of items) {
    const token = item.activityPushToken;
    if (!token) continue;

    const payload = buildPayload(orderId, statusData, eventType);
    try {
      await sendApnsPush(token, payload, eventType);
      results.push({ success: true });
    } catch (err) {
      console.warn('Live activity push failed', { code: err.status || 'APNS_FAILED', reason: err.data?.reason || 'TRANSPORT_FAILURE' });
      results.push({ success: false, error: err.status || 'APNS_FAILED' });
      // Remove tokens that Apple reports as invalid
      if (err.status === 410) {
        await dynamodb.send(
          new DeleteCommand({
            TableName: TABLE_NAME,
            Key: { pk: item.pk, sk: item.sk },
          })
        );
      }
    }
  }

  return { orderId, eventType, tokensAttempted: items.length, results };
}

async function publicPush(event, requestedEnd) {
  if (event.httpMethod === 'OPTIONS') return {statusCode:200,headers:corsHeaders,body:''};
  try {
    const body=JSON.parse(event.body || '{}');
    const {order}=await authorize({event,body,db:dynamodb,allowTerminal:true});
    const ended=terminal(order.status);
    if(requestedEnd && !ended) return badRequest('Order is still active');
    // Client data is only an ownership-bearing request. Status and ETA are canonical.
    const result=await sendToOrder(order.orderId,content(order),ended?'end':'update');
    return ok({success:true,...result});
  }catch(e){
    const status=e instanceof SyntaxError?400:e.status||503;
    return {statusCode:status,headers:corsHeaders,body:JSON.stringify({success:false,error:status===403?'LIVE_ACTIVITY_FORBIDDEN':status===400?'INVALID_REQUEST':'LIVE_ACTIVITY_UNAVAILABLE'})};
  }
}
exports.sendUpdate=event=>publicPush(event,false);
exports.sendEnd=event=>publicPush(event,true);
// Trusted in-process caller only; never map this helper to a public handler.
exports.pushForOrder=sendToOrder;
