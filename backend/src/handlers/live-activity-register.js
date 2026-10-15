const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');

const { verifyJwtMulti } = require('../utils/jwt-multi-verify');
const { ok, badRequest, unauthorized, serverError, corsHeaders } = require('../utils/http');

const dynamodb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' })
);

const TABLE_NAME = process.env.LIVE_ACTIVITIES_TABLE;

function getHeader(event, name) {
  const headers = event.headers || {};
  const target = String(name || '').toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (String(k).toLowerCase() === target) return v;
  }
  return undefined;
}

exports.register = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (!TABLE_NAME) return serverError('Missing LIVE_ACTIVITIES_TABLE');

  try {
    const body = JSON.parse(event.body || '{}');
    const orderId = String(body.orderId || '').trim();
    const activityPushToken = String(body.activityPushToken || '').trim();
    const guestToken = body.guestToken ? String(body.guestToken).trim() : null;
    const app = String(body.app || 'user').toLowerCase();
    const platform = String(body.platform || 'ios').toLowerCase();

    if (!orderId) return badRequest('Missing orderId');
    if (!activityPushToken) return badRequest('Missing activityPushToken');

    let subjectId;
    let userId;

    if (guestToken) {
      subjectId = `GUEST_${guestToken}`;
      userId = subjectId;
    } else {
      try {
        const { payload } = await verifyJwtMulti(event, 'user');
        subjectId = payload.sub;
        userId = payload.sub;
      } catch (e) {
        return unauthorized('Invalid or missing authorization token');
      }
    }

    const nowIso = new Date().toISOString();
    const ttlSeconds = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7; // 7 days

    await dynamodb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          pk: `ORDER#${orderId}`,
          sk: `USER#${subjectId}`,
          orderId,
          userId,
          subjectId,
          activityPushToken,
          app,
          platform,
          status: body.status ? String(body.status) : 'pending',
          createdAt: nowIso,
          updatedAt: nowIso,
          ttl: ttlSeconds,
        },
      })
    );

    return ok({ success: true, orderId, userId, registered: true });
  } catch (e) {
    console.error('live-activity-register error', e);
    return serverError('Failed to register live activity token', { details: e.message });
  }
};
