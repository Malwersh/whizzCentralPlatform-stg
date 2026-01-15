const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  QueryCommand
} = require('@aws-sdk/lib-dynamodb');

const { verifyJwtMulti } = require('../utils/jwt-multi-verify');
const { getMessaging } = require('../utils/firebase');
const { ok, badRequest, unauthorized, forbidden, serverError, corsHeaders } = require('../utils/http');

const dynamodb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' })
);

const TOKENS_TABLE = process.env.PUSH_TOKENS_TABLE;

function toStringMap(obj) {
  const out = {};
  if (!obj || typeof obj !== 'object') return out;
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    out[String(k)] = typeof v === 'string' ? v : JSON.stringify(v);
  }
  return out;
}

exports.sendTest = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (!TOKENS_TABLE) return serverError('Missing PUSH_TOKENS_TABLE');

  try {
    const { payload, pool } = await verifyJwtMulti(event, 'support');

    // Hard gate: only central pool can send (support agents)
    if (pool !== 'central') return forbidden('Support token required');

    const groups = payload['cognito:groups'] || [];
    if (Array.isArray(groups) && groups.length > 0 && !groups.includes('support')) {
      return forbidden('Missing support group');
    }

    const body = JSON.parse(event.body || '{}');
    const target = body.target || {};
    const subjectId = String(target.subjectId || '').trim();

    if (!subjectId) return badRequest('Missing target.subjectId');

    const notification = body.notification || {};
    const title = String(notification.title || '').trim();
    const messageBody = String(notification.body || '').trim();

    if (!title || !messageBody) return badRequest('Missing notification.title or notification.body');

    const data = toStringMap(body.data || {});

    const tokensResp = await dynamodb.send(
      new QueryCommand({
        TableName: TOKENS_TABLE,
        IndexName: 'SubjectIdIndex',
        KeyConditionExpression: 'subjectId = :sid',
        ExpressionAttributeValues: { ':sid': subjectId }
      })
    );

    const tokens = (tokensResp.Items || []).map((it) => it.token).filter(Boolean);

    if (tokens.length === 0) {
      return ok({ success: false, error: 'No tokens registered for subjectId', subjectId, tokensCount: 0 });
    }

    const messaging = await getMessaging();

    const multicastMessage = {
      tokens,
      notification: {
        title,
        body: messageBody
      },
      data
    };

    const result = await messaging.sendEachForMulticast(multicastMessage);

    const failures = [];
    result.responses.forEach((r, i) => {
      if (!r.success) {
        const err = r.error;
        failures.push({
          token: tokens[i],
          code: err?.code,
          errorInfoCode: err?.errorInfo?.code,
          errorInfoMessage: err?.errorInfo?.message,
          message: err?.message || String(err)
        });
      }
    });

    return ok({
      success: true,
      subjectId,
      tokensCount: tokens.length,
      successCount: result.successCount,
      failureCount: result.failureCount,
      failures: failures.slice(0, 10)
    });
  } catch (e) {
    const msg = e?.message || String(e);
    if (msg.includes('Missing Authorization') || msg.includes('Invalid token')) {
      return unauthorized('Invalid or missing token');
    }
    console.error('push-admin.sendTest error', e);
    return serverError('Failed to send test push', { details: msg });
  }
};
