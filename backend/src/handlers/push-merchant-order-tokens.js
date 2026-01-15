const { getMessaging } = require('../utils/firebase');
const { ok, badRequest, unauthorized, serverError, corsHeaders } = require('../utils/http');

const INTERNAL_API_KEY = String(process.env.NOTIFICATIONS_INTERNAL_KEY || '').trim();

function getHeader(event, name) {
  const headers = event.headers || {};
  const target = String(name || '').toLowerCase();
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

exports.sendMerchantOrderTokens = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (!INTERNAL_API_KEY) return serverError('Missing NOTIFICATIONS_INTERNAL_KEY');

  const providedKey = String(getHeader(event, 'x-internal-key') || '').trim();
  if (!providedKey || providedKey !== INTERNAL_API_KEY) {
    return unauthorized('Invalid internal key');
  }

  try {
    const body = JSON.parse(event.body || '{}');

    const tokens = Array.isArray(body.tokens) ? body.tokens.map((t) => String(t || '').trim()).filter(Boolean) : [];
    const action = String(body.action || body.event || '').trim();
    const orderId = String(body.orderId || '').trim();

    const orderNumber = body.orderNumber ? String(body.orderNumber).trim() : '';
    const businessId = body.businessId ? String(body.businessId).trim() : '';
    const businessName = body.businessName ? String(body.businessName).trim() : '';
    const customerName = body.customerName ? String(body.customerName).trim() : '';
    const totalAmount = body.totalAmount;

    if (!tokens.length) return badRequest('Missing tokens');
    if (!action) return badRequest('Missing action');
    if (!orderId) return badRequest('Missing orderId');

    const title = titleForAction(action);
    const bodyText = bodyForAction({ action, orderNumber: orderNumber || orderId, businessName, customerName, totalAmount });

    const data = toStringMap({
      type: 'merchant_order',
      action,
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
      action,
      orderId,
      tokensCount: tokens.length,
      successCount: result.successCount,
      failureCount: result.failureCount,
      failures: failures.slice(0, 10)
    });
  } catch (e) {
    console.error('push-merchant-order-tokens.sendMerchantOrderTokens error', e);
    return serverError('Failed to send merchant order push (tokens)', { details: e?.message || String(e) });
  }
};
