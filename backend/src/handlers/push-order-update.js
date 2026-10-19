const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');

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

function statusTitle(status) {
  switch (String(status || '').toLowerCase()) {
    case 'pending':
      return 'تم استلام طلبك';
    case 'confirmed':
      return 'تم تأكيد طلبك';
    case 'preparing':
      return 'طلبك قيد التحضير';
    case 'ready':
      return 'طلبك جاهز';
    case 'on_the_way':
      return 'طلبك في الطريق';
    case 'delivered':
      return 'تم توصيل طلبك';
    case 'cancelled':
      return 'تم إلغاء الطلب';
    case 'rejected':
      return 'تم رفض الطلب';
    default:
      return 'تحديث على طلبك';
  }
}

function statusBody({ orderNumber, businessName }) {
  const parts = [];
  if (orderNumber) parts.push(`طلب #${orderNumber}`);
  if (businessName) parts.push(`من ${businessName}`);
  if (parts.length === 0) return 'افتح التطبيق لعرض التفاصيل';
  return `${parts.join(' - ')} - افتح التطبيق لعرض التفاصيل`;
}

exports.sendOrderUpdate = async (event) => {
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

    const userId = String(body.userId || body.subjectId || '').trim();
    const orderId = String(body.orderId || '').trim();
    const orderNumber = String(body.orderNumber || '').trim();
    const status = String(body.status || '').trim();
    const businessName = String(body.businessName || '').trim();

    if (!userId) return badRequest('Missing userId');
    if (!orderId) return badRequest('Missing orderId');

    // Background Live Activity updates must not depend on an FCM token or an
    // open app. Use the committed order, never the notification hint's status.
    if (process.env.ORDER_LIVE_ACTIVITY_UPDATES === 'REQUIRED') {
      try {
        const {Item: order} = await dynamodb.send(new GetCommand({
          TableName: 'WizzOrders', Key: {PK: 'ORDER#'+orderId, SK: 'META'}, ConsistentRead: true,
        }));
        if (order && order.orderId === orderId && order.isDeleted !== true && !order.deletedAt && !order.deletionRequestId) {
          const {content}=require('./order-arrival-content');
          const {terminal}=require('./live-activity-order-access');
          await require('./live-activity-push').pushForOrder(orderId,content(order),terminal(order.status)?'end':'update');
        }
      } catch (_) {
        // Preserve the existing FCM path. A dedicated metric exposes failures.
        console.warn(JSON.stringify({metric:'LiveActivityOrderUpdateFailed',count:1}));
      }
    }

    const canonical=(await dynamodb.send(new GetCommand({TableName:'WizzOrders',Key:{PK:'ORDER#'+orderId,SK:'META'},ConsistentRead:true}))).Item;
    const owner=canonical?.userId??canonical?.customerId;
    const tracking=canonical&&owner===userId&&!canonical.isDeleted&&!canonical.deletedAt&&!canonical.deletionRequestId?{...require('./order-arrival-content').content(canonical),orderId,updatedAt:canonical.updatedAt??canonical.createdAt}:null;
    const tokensResp = await dynamodb.send(
      new QueryCommand({
        TableName: TOKENS_TABLE,
        IndexName: 'SubjectIdIndex',
        KeyConditionExpression: 'subjectId = :sid',
        ExpressionAttributeValues: { ':sid': userId }
      })
    );

    const tokens = Array.from(new Set((tokensResp.Items || []).map((it) => it.token).filter(Boolean)));

    if (tokens.length === 0) {
      return ok({ success: false, error: 'No tokens registered for userId', userId, tokensCount: 0 });
    }

    const title = statusTitle(status);
    const bodyText = statusBody({
      orderNumber: orderNumber || orderId,
      businessName: businessName || ''
    });

    const data = toStringMap({
      type: 'order_update',
      action: 'order_status_update',
      userId,
      orderId,
      orderNumber: orderNumber || '',
      status,
      businessName: businessName || '',
      updatedAt: body.updatedAt || new Date().toISOString(),
    });

    const messaging = await getMessaging();

    const collapseId = `order:${orderId}`;

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
          channelId: 'order_updates',
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

    const androidTokens=new Set((tokensResp.Items||[]).filter(it=>it.app==='user'&&it.platform==='android'&&it.orderTrackingVersion===1).map(it=>it.token));
    const ordered=[],result={responses:[],successCount:0,failureCount:0};
    for(const android of [false,true]){const selected=tokens.filter(t=>androidTokens.has(t)===android);if(!selected.length)continue;let message={...multicastMessage,tokens:selected};
      if(android&&tracking){message={tokens:selected,data:toStringMap({...data,tracking}),android:{collapseKey:collapseId,priority:'high',ttl:3600000}};}
      const sent=await messaging.sendEachForMulticast(message);ordered.push(...selected);result.responses.push(...sent.responses);result.successCount+=sent.successCount;result.failureCount+=sent.failureCount;
    }

    const failures = [];
    result.responses.forEach((r, i) => {
      if (!r.success) {
        const err = r.error;
        failures.push({
          token: ordered[i],
          code: err?.code,
          errorInfoCode: err?.errorInfo?.code,
          errorInfoMessage: err?.errorInfo?.message,
          message: err?.message || String(err)
        });
      }
    });

    return ok({
      success: true,
      userId,
      orderId,
      status,
      tokensCount: tokens.length,
      successCount: result.successCount,
      failureCount: result.failureCount,
      failures: failures.slice(0, 10)
    });
  } catch (e) {
    console.error('push-order-update.sendOrderUpdate error', e);
    return serverError('Failed to send order update push', { details: e?.message || String(e) });
  }
};
