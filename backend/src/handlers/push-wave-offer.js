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

exports.sendWaveOffer = async (event) => {
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

    if (Object.prototype.hasOwnProperty.call(body,'financialPushVersion')) {
      try { return await require('../utils/financial-offer-notification-runtime').createStagingFinancialPushHandler({db:dynamodb,getMessaging})(body); }
      catch (_) { return badRequest('FINANCIAL_PUSH_NOT_ALLOWED'); }
    }

    if (Object.prototype.hasOwnProperty.call(body,'legacySourceVersion') || Object.prototype.hasOwnProperty.call(body,'moneyUnit')) {
      try { return await require('../utils/pinned-wave-push-handler').createPinnedWavePushHandler({db:dynamodb,getMessaging})(body); }
      catch (_) { return badRequest('PINNED_WAVE_PUSH_NOT_ALLOWED'); }
    }

    const driverId = String(body.driverId || body.subjectId || '').trim();
    const orderId = String(body.orderId || '').trim();
    const offerId = String(body.offerId || '').trim();
    const waveNumber = body.waveNumber != null ? String(body.waveNumber) : '';
    const restaurantName = String(body.restaurantName || '').trim();
    const expiresAt = String(body.expiresAt || '').trim();
    const isEmergencyWave = body.isEmergencyWave === true || body.isEmergencyWave === 'true';
    
    // Additional details for full offer display
    const restaurantImageUrl = String(body.restaurantImageUrl || '');
    const customerName = String(body.customerName || 'عميل');
    const customerAddress = String(body.customerAddress || '');
    const deliveryFee = body.deliveryFee != null ? String(body.deliveryFee) : '';
    const bonusAmount = body.bonusAmount != null ? String(body.bonusAmount) : '';
    const orderTotal = body.orderTotal != null ? String(body.orderTotal) : '';
    const estimatedEarnings = body.estimatedEarnings != null ? String(body.estimatedEarnings) : '';
    const distance = body.distance != null ? String(body.distance) : '';
    const estimatedMinutes = body.estimatedMinutes != null ? String(body.estimatedMinutes) : '';
    const itemsCount = body.itemsCount != null ? String(body.itemsCount) : '';
    const currency = String(body.currency || 'IQD');

    if (!driverId) return badRequest('Missing driverId');
    if (!orderId) return badRequest('Missing orderId');
    if (!offerId) return badRequest('Missing offerId');

    const tokensResp = await dynamodb.send(
      new QueryCommand({
        TableName: TOKENS_TABLE,
        IndexName: 'SubjectIdIndex',
        KeyConditionExpression: 'subjectId = :sid',
        ExpressionAttributeValues: { ':sid': driverId }
      })
    );

    const tokens = Array.from(
      new Set((tokensResp.Items || []).map((it) => it.token).filter(Boolean))
    );

    if (tokens.length === 0) {
      return ok({ success: false, error: 'No tokens registered for driverId', driverId, tokensCount: 0 });
    }

    const title = isEmergencyWave ? '🚨 عرض توصيل عاجل' : 'عرض توصيل جديد';
    const bodyText = restaurantName
      ? `من ${restaurantName} - افتح التطبيق للقبول` 
      : 'افتح التطبيق للقبول';

    const data = toStringMap({
      type: 'new_wave_offer',
      action: 'wave_assignment',
      driverId,
      orderId,
      offerId,
      waveNumber,
      restaurantName,
      restaurantImageUrl,
      customerName,
      customerAddress,
      deliveryFee,
      bonusAmount,
      orderTotal,
      estimatedEarnings,
      distance,
      estimatedMinutes,
      itemsCount,
      currency,
      expiresAt,
      isEmergencyWave: String(isEmergencyWave)
    });

    const messaging = await getMessaging();

    const multicastMessage = {
      tokens,
      notification: {
        title,
        body: bodyText
      },
      data,
      android: {
        // Collapse repeated notifications for the same order (across waves) on Android.
        collapseKey: `wave-order:${orderId}`,
        priority: 'high',
        notification: {
          sound: 'default'
        }
      },
      apns: {
        headers: {
          'apns-priority': '10',
          'apns-push-type': 'alert',
          // Collapse repeated notifications for the same order (across waves) on iOS.
          'apns-collapse-id': `wave-order:${orderId}`
        },
        payload: {
          aps: {
            sound: 'default',
            // Helps iOS deliver custom keys more reliably while app is backgrounded.
            'content-available': 1,
            // Allows richer processing by iOS / FCM SDKs.
            'mutable-content': 1,
            // Helps identify the notification type on iOS.
            category: 'new_wave_offer'
          },

          // Duplicate identifiers at APNs root as a fallback for iOS clients.
          // Some iOS delivery paths may not expose `data` consistently on tap.
          // Include ALL details needed to display full offer from push alone.
          type: 'new_wave_offer',
          action: 'wave_assignment',
          driverId,
          orderId,
          offerId,
          waveNumber,
          restaurantName,
          restaurantImageUrl,
          customerName,
          customerAddress,
          deliveryFee,
          bonusAmount,
          orderTotal,
          estimatedEarnings,
          distance,
          estimatedMinutes,
          itemsCount,
          currency,
          expiresAt,
          isEmergencyWave: String(isEmergencyWave)
        }
      }
    };

    const soundPolicy=await require('./notification-sound-policy').readPolicy(dynamodb);
    const groups=new Map();for(const token of tokens){const row=(tokensResp.Items||[]).find(it=>it.token===token),file=require('./notification-sound-policy').soundFile(soundPolicy,'driverNewOffer',row?.soundEnabled!==false,row?.soundReady??[]),key=file??'';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(token);}
    const ordered=[],result={responses:[],successCount:0,failureCount:0};for(const [file,chosen] of groups){const message=require('../utils/notification-sound-message').applySound({...multicastMessage,tokens:chosen},file||null,'driver_offers');const sent=await messaging.sendEachForMulticast(message);ordered.push(...chosen);result.responses.push(...sent.responses);result.successCount+=sent.successCount;result.failureCount+=sent.failureCount;}

    const failures = [];
    result.responses.forEach((r, i) => {
      if (!r.success) {
        failures.push({ token: ordered[i], error: r.error?.message || String(r.error) });
      }
    });

    return ok({
      success: true,
      driverId,
      tokensCount: tokens.length,
      successCount: result.successCount,
      failureCount: result.failureCount,
      failures: failures.slice(0, 10)
    });
  } catch (e) {
    console.error('push-wave-offer.sendWaveOffer error', e);
    return serverError('Failed to send wave offer push', { details: e?.message || String(e) });
  }
};
