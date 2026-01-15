const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const { getMessaging } = require('../utils/firebase');
const { ok, badRequest, unauthorized, serverError, corsHeaders } = require('../utils/http');

const dynamodb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' })
);

const TOKENS_TABLE = process.env.PUSH_TOKENS_TABLE;
const INTERNAL_API_KEY = String(process.env.NOTIFICATIONS_INTERNAL_KEY || '').trim();

function getHeader(event, name) {
  const headers = event.headers || {};
  const target = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (String(k).toLowerCase() === target) return v;
  }
  return undefined;
}

function toStringMap(obj) {
  const out = {};
  if (!obj || typeof obj !== 'object') return out;
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    out[String(k)] = typeof v === 'string' ? v : JSON.stringify(v);
  }
  return out;
}

function titleForAction(action) {
  switch (String(action || '').toLowerCase()) {
    case 'new_order':
      return 'طلب جديد';
    case 'cancelled_by_customer':
    case 'canceled_by_user':
      return 'تم إلغاء الطلب من العميل';
    case 'cancelled_by_store':
    case 'canceled_by_store':
      return 'تم إلغاء الطلب';
    case 'order_status_update':
      return 'تحديث على طلب';
    default:
      return 'إشعار للمطعم';
  }
}

function bodyForAction({ action, orderNumber, businessName, customerName, totalAmount }) {
  const parts = [];

  const safeOrder = orderNumber ? `#${orderNumber}` : null;
  if (safeOrder) parts.push(`طلب ${safeOrder}`);
  if (businessName) parts.push(`من ${businessName}`);

  const base = parts.length ? parts.join(' - ') : 'افتح التطبيق لعرض التفاصيل';

  if (String(action || '').toLowerCase() === 'new_order') {
    const extra = [];
    if (customerName) extra.push(customerName);
    if (totalAmount !== undefined && totalAmount !== null && String(totalAmount) !== '') {
      extra.push(`${totalAmount} IQD`);
    }
    return extra.length ? `${base} - ${extra.join(' - ')}` : base;
  }

  return base;
}

exports.sendMerchantOrder = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (!TOKENS_TABLE) return serverError('Missing PUSH_TOKENS_TABLE');
  if (!INTERNAL_API_KEY) return serverError('Missing NOTIFICATIONS_INTERNAL_KEY');

  const providedKey = String(getHeader(event, 'x-internal-key') || '').trim();
  if (!providedKey || providedKey !== INTERNAL_API_KEY) {
    return unauthorized('Invalid internal key');
  }

  try {
    const body = JSON.parse(event.body || '{}');

    const subjectId = String(body.subjectId || body.merchantUserId || '').trim();
    const businessId = body.businessId ? String(body.businessId).trim() : '';
    const action = String(body.action || body.event || '').trim();
    const orderId = String(body.orderId || '').trim();

    const orderNumber = body.orderNumber ? String(body.orderNumber).trim() : '';
    const businessName = body.businessName ? String(body.businessName).trim() : '';
    const customerName = body.customerName ? String(body.customerName).trim() : '';
    const totalAmount = body.totalAmount;

    if (!subjectId && !businessId) return badRequest('Missing subjectId or businessId');
    if (!action) return badRequest('Missing action');
    if (!orderId) return badRequest('Missing orderId');

    // Preferred targeting: businessId -> deliver to all merchant devices of that store.
    // Fallback targeting: subjectId -> deliver to merchant user.
    const tokensResp = await dynamodb.send(
      new QueryCommand({
        TableName: TOKENS_TABLE,
        IndexName: businessId ? 'BusinessIdIndex' : 'SubjectIdIndex',
        KeyConditionExpression: businessId ? 'businessId = :bid' : 'subjectId = :sid',
        ExpressionAttributeValues: businessId ? { ':bid': businessId } : { ':sid': subjectId }
      })
    );

    const items = tokensResp.Items || [];
    const merchantItems = items.filter((it) => String(it?.app || '').toLowerCase() === 'merchant');
    const tokens = Array.from(new Set(merchantItems.map((it) => it.token).filter(Boolean)));

    if (tokens.length === 0) {
      return ok({
        success: false,
        error: businessId
          ? 'No merchant tokens registered for businessId'
          : 'No merchant tokens registered for subjectId',
        subjectId: subjectId || undefined,
        businessId: businessId || undefined,
        tokensCount: 0,
        totalTokensForTarget: Array.from(new Set(items.map((it) => it.token).filter(Boolean))).length
      });
    }

    const title = titleForAction(action);
    const bodyText = bodyForAction({ action, orderNumber: orderNumber || orderId, businessName, customerName, totalAmount });

    const data = toStringMap({
      type: 'merchant_order',
      action,
      subjectId: subjectId || '',
      businessId,
      businessName,
      orderId,
      orderNumber,
      updatedAt: body.updatedAt || new Date().toISOString(),
    });

    const messaging = await getMessaging();

    const collapseId = `merchant-order:${orderId}`;

    const multicastMessage = {
      tokens,
      notification: {
        title,
        body: bodyText,
      },
      data,
      android: {
        collapseKey: collapseId,
        priority: 'high',
        notification: {
          sound: 'default',
          channelId: 'merchant_orders',
        }
      },
      apns: {
        headers: {
          'apns-priority': '10',
          'apns-push-type': 'alert',
          'apns-collapse-id': collapseId,
        },
        payload: {
          aps: {
            sound: 'default'
          }
        }
      }
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
      action,
      orderId,
      tokensCount: tokens.length,
      successCount: result.successCount,
      failureCount: result.failureCount,
      failures: failures.slice(0, 10)
    });
  } catch (e) {
    console.error('push-merchant-order.sendMerchantOrder error', e);
    return serverError('Failed to send merchant order push', { details: e?.message || String(e) });
  }
};
