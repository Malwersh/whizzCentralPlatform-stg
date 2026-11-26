/**
 * WaveSystem_UpdateDriverMetrics Lambda Function
 * 
 * Purpose: تحديث WizzDriverPerformanceMetrics تلقائياً من DynamoDB Streams
 * 
 * Triggered by: 
 * - DynamoDB Stream on WaveOffers (when responseStatus changes)
 * - DynamoDB Stream on WizzOrders (when order is completed/canceled)
 * 
 * Updates:
 * - Lifetime counters (totalOffersLifetime, totalAcceptedLifetime, etc.)
 * - Sliding window stats (last 100 offers)
 * - Calculated rates (acceptanceRate, completionRate)
 * - Consecutive rejections counter
 * - Syncs snapshot to WizzDriverLiveState
 * 
 * Environment Variables:
 * - PERFORMANCE_METRICS_TABLE: WizzDriverPerformanceMetrics
 * - WAVE_OFFERS_TABLE: WaveOffers
 * - DRIVER_LIVE_STATE_TABLE: WizzDriverLiveState
 * - ORDERS_TABLE: WizzOrders
 * - WINDOW_SIZE: 100
 */

const AWS = require('aws-sdk');
const dynamodb = new AWS.DynamoDB.DocumentClient();

const PERFORMANCE_METRICS_TABLE = process.env.PERFORMANCE_METRICS_TABLE || 'WizzDriverPerformanceMetrics';
const WAVE_OFFERS_TABLE = process.env.WAVE_OFFERS_TABLE || 'WaveOffers';
const DRIVER_LIVE_STATE_TABLE = process.env.DRIVER_LIVE_STATE_TABLE || 'WizzDriverLiveState';
const WINDOW_SIZE = parseInt(process.env.WINDOW_SIZE || '100');

async function driverFencedWrite(driverId, operation) {
  if (PERFORMANCE_METRICS_TABLE !== 'WizzDriverPerformanceMetrics_staging' || DRIVER_LIVE_STATE_TABLE !== 'WizzDriverLiveState_staging') throw new Error('STAGING_DRIVER_TABLE_REQUIRED');
  const key = {pk: 'ACCOUNT_LIFECYCLE#DRIVER#' + driverId, sk: 'META'};
  try {
    return await dynamodb.transactWrite({TransactItems: [
      {ConditionCheck: {TableName: 'staging-AccountDeletion', Key: key, ConditionExpression: 'attribute_not_exists(pk)'}},
      operation,
    ]}).promise();
  } catch (error) {
    if (error.code !== 'TransactionCanceledException' && error.name !== 'TransactionCanceledException') throw error;
    const marker = await dynamodb.get({TableName: 'staging-AccountDeletion', Key: key, ConsistentRead: true}).promise();
    if (!marker.Item || marker.Item.subjectId !== driverId) throw error;
    // Late stream records for a closing account are acknowledged, not retried
    // indefinitely and not permitted to recreate location or metrics records.
    return {accountClosing: true};
  }
}

// =====================================
// Main Handler
// =====================================
exports.handler = async (event) => {
  console.log('Driver metrics batch received', {count: event.Records?.length});

  try {
    for (const record of event.Records) {
      
      // تحديد نوع الحدث
      const eventSource = record.eventSourceARN;
      
      if (eventSource.includes('WaveOffers')) {
        await handleWaveOfferChange(record);
      } else if (eventSource.includes('WizzOrders')) {
        await handleOrderChange(record);
      }
    }
    
    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Metrics updated successfully' })
    };
    
  } catch (error) {
    console.error('❌ Error in UpdateDriverMetrics:', error);
    throw error;
  }
};

// =====================================
// معالجة تغيير WaveOffer
// =====================================
async function handleWaveOfferChange(record) {
  
  if (record.eventName !== 'MODIFY') return;
  
  const oldImage = AWS.DynamoDB.Converter.unmarshall(record.dynamodb.OldImage);
  const newImage = AWS.DynamoDB.Converter.unmarshall(record.dynamodb.NewImage);
  
  const oldStatus = oldImage.responseStatus;
  const newStatus = newImage.responseStatus;
  
  // فقط عند تغيير responseStatus
  if (oldStatus === newStatus) return;
  
  // فقط الحالات النهائية
  if (!['accepted', 'rejected', 'expired'].includes(newStatus)) return;
  
  const driverId = newImage.driverId;
  const orderId = newImage.orderId;
  
  console.log(`📊 Updating metrics for driver ${driverId}: ${oldStatus} → ${newStatus}`);
  
  await updateDriverMetricsFromOffer(driverId, newStatus, newImage);
}

// =====================================
// معالجة تغيير Order
// =====================================
async function handleOrderChange(record) {
  
  if (record.eventName !== 'MODIFY') return;
  
  const oldImage = AWS.DynamoDB.Converter.unmarshall(record.dynamodb.OldImage);
  const newImage = AWS.DynamoDB.Converter.unmarshall(record.dynamodb.NewImage);
  
  const oldStatus = oldImage.status;
  const newStatus = newImage.status;
  const driverId = newImage.driverId;
  
  if (!driverId) return;
  if (oldStatus === newStatus) return;
  
  // حالة: تم التسليم بنجاح
  if (newStatus === 'delivered') {
    console.log(`✅ Order ${newImage.orderId} delivered by ${driverId}`);
    await updateMetricsOnCompletion(driverId, newImage.orderId);
  }
  
  // حالة: تم الإلغاء بعد الإسناد
  if (newStatus === 'canceled' && oldStatus === 'assigned') {
    const canceledBy = newImage.canceledBy;
    
    if (canceledBy === 'driver') {
      console.log(`❌ Order ${newImage.orderId} canceled by driver ${driverId}`);
      await updateMetricsOnCancellation(driverId, newImage.orderId);
    }
  }
}

// =====================================
// تحديث Metrics من WaveOffer
// =====================================
async function updateDriverMetricsFromOffer(driverId, responseStatus, offerData) {
  
  // Step 1: جلب أو إنشاء Metrics
  let metrics = await getDriverMetrics(driverId);
  
  if (!metrics) {
    metrics = createDefaultMetrics(driverId);
  }
  
  // Step 2: تحديث العدادات التراكمية
  metrics.totalOffersLifetime = (metrics.totalOffersLifetime || 0) + 1;
  
  if (responseStatus === 'accepted') {
    metrics.totalAcceptedLifetime = (metrics.totalAcceptedLifetime || 0) + 1;
  } else if (responseStatus === 'rejected') {
    metrics.totalRejectedLifetime = (metrics.totalRejectedLifetime || 0) + 1;
  } else if (responseStatus === 'expired') {
    metrics.totalExpiredLifetime = (metrics.totalExpiredLifetime || 0) + 1;
  }
  
  // Step 3: حساب إحصاءات النافذة
  const recentOffers = await getRecentOffers(driverId, WINDOW_SIZE);
  const windowStats = calculateWindowStats(recentOffers);
  
  metrics.windowOffersCount = windowStats.total;
  metrics.windowAccepted = windowStats.accepted;
  metrics.windowRejected = windowStats.rejected;
  metrics.windowExpired = windowStats.expired;
  metrics.windowCompleted = windowStats.completed;
  metrics.windowCancelledAfterAccept = windowStats.cancelledAfterAccept;
  
  // Step 4: حساب المعدلات
  metrics.acceptanceRate = windowStats.total > 0 
    ? windowStats.accepted / windowStats.total 
    : 1.0;
  
  metrics.completionRate = windowStats.accepted > 0
    ? windowStats.completed / windowStats.accepted
    : 1.0;
  
  metrics.cancellationAfterAcceptRate = windowStats.accepted > 0
    ? windowStats.cancelledAfterAccept / windowStats.accepted
    : 0.0;
  
  // Step 5: الرفضات المتتالية
  if (responseStatus === 'accepted') {
    metrics.consecutiveRejections = 0;
  } else if (responseStatus === 'rejected' || responseStatus === 'expired') {
    metrics.consecutiveRejections = (metrics.consecutiveRejections || 0) + 1;
  }
  
  // Step 6: تحديث الأوقات
  metrics.lastOfferAt = offerData.sentAt;
  metrics.lastOrderIdInWindow = offerData.orderId;
  metrics.lastUpdatedAt = new Date().toISOString();
  
  // Step 7: حفظ
  await saveDriverMetrics(metrics);
  
  console.log(
    `✅ Metrics updated for ${driverId}: ` +
    `acceptance=${(metrics.acceptanceRate * 100).toFixed(1)}%, ` +
    `completion=${(metrics.completionRate * 100).toFixed(1)}%, ` +
    `consecutiveRejections=${metrics.consecutiveRejections}`
  );
  
  // Step 8: مزامنة Snapshot
  await syncSnapshotToLiveState(driverId, metrics);
}

// =====================================
// تحديث عند إكمال الطلب
// =====================================
async function updateMetricsOnCompletion(driverId, orderId) {
  
  let metrics = await getDriverMetrics(driverId);
  
  if (!metrics) {
    console.warn(`⚠️ No metrics found for ${driverId}`);
    return;
  }
  
  // تحديث العداد التراكمي
  metrics.totalCompletedOrdersLifetime = (metrics.totalCompletedOrdersLifetime || 0) + 1;
  
  // إعادة حساب النافذة
  const recentOffers = await getRecentOffers(driverId, WINDOW_SIZE);
  const windowStats = calculateWindowStats(recentOffers);
  
  metrics.windowCompleted = windowStats.completed;
  
  metrics.completionRate = windowStats.accepted > 0
    ? windowStats.completed / windowStats.accepted
    : 1.0;
  
  metrics.lastCompletedAt = new Date().toISOString();
  metrics.lastUpdatedAt = new Date().toISOString();
  
  await saveDriverMetrics(metrics);
  
  console.log(`✅ Completion metrics updated for ${driverId}`);
  
  await syncSnapshotToLiveState(driverId, metrics);
}

// =====================================
// تحديث عند إلغاء الطلب
// =====================================
async function updateMetricsOnCancellation(driverId, orderId) {
  
  let metrics = await getDriverMetrics(driverId);
  
  if (!metrics) {
    console.warn(`⚠️ No metrics found for ${driverId}`);
    return;
  }
  
  // تحديث العداد التراكمي
  metrics.totalCancelledAfterAcceptLifetime = (metrics.totalCancelledAfterAcceptLifetime || 0) + 1;
  
  // إعادة حساب النافذة
  const recentOffers = await getRecentOffers(driverId, WINDOW_SIZE);
  const windowStats = calculateWindowStats(recentOffers);
  
  metrics.windowCancelledAfterAccept = windowStats.cancelledAfterAccept;
  
  metrics.completionRate = windowStats.accepted > 0
    ? windowStats.completed / windowStats.accepted
    : 1.0;
  
  metrics.cancellationAfterAcceptRate = windowStats.accepted > 0
    ? windowStats.cancelledAfterAccept / windowStats.accepted
    : 0.0;
  
  metrics.lastUpdatedAt = new Date().toISOString();
  
  await saveDriverMetrics(metrics);
  
  console.log(`⚠️ Cancellation metrics updated for ${driverId}`);
  
  await syncSnapshotToLiveState(driverId, metrics);
}

// =====================================
// جلب Metrics
// =====================================
async function getDriverMetrics(driverId) {
  
  const result = await dynamodb.get({
    TableName: PERFORMANCE_METRICS_TABLE,
    Key: {
      PK: driverId,
      SK: 'METRICS'
    }
  }).promise();
  
  return result.Item || null;
}

// =====================================
// حفظ Metrics
// =====================================
async function saveDriverMetrics(metrics) {
  
  await driverFencedWrite(metrics.driverId, {Put: {
    TableName: PERFORMANCE_METRICS_TABLE,
    Item: {
      PK: metrics.driverId,
      SK: 'METRICS',
      ...metrics
    }
  }});
}

// =====================================
// إنشاء Metrics افتراضية
// =====================================
function createDefaultMetrics(driverId) {
  
  return {
    driverId: driverId,
    
    // عدادات تراكمية
    totalOffersLifetime: 0,
    totalAcceptedLifetime: 0,
    totalRejectedLifetime: 0,
    totalExpiredLifetime: 0,
    totalCompletedOrdersLifetime: 0,
    totalCancelledAfterAcceptLifetime: 0,
    
    // نافذة
    windowSize: WINDOW_SIZE,
    windowOffersCount: 0,
    windowAccepted: 0,
    windowRejected: 0,
    windowExpired: 0,
    windowCompleted: 0,
    windowCancelledAfterAccept: 0,
    
    // معدلات (قيم عالية للسائقين الجدد)
    acceptanceRate: 1.0,
    completionRate: 1.0,
    cancellationAfterAcceptRate: 0.0,
    consecutiveRejections: 0,
    
    // أوقات
    lastOrderIdInWindow: null,
    lastOfferAt: null,
    lastCompletedAt: null,
    lastUpdatedAt: new Date().toISOString()
  };
}

// =====================================
// جلب آخر N عرض
// =====================================
async function getRecentOffers(driverId, limit) {
  
  // نستخدم GSI للبحث بالسائق
  const result = await dynamodb.query({
    TableName: WAVE_OFFERS_TABLE,
    IndexName: 'driverId-sentAt-index',
    KeyConditionExpression: 'driverId = :driverId',
    ExpressionAttributeValues: {
      ':driverId': driverId
    },
    Limit: limit,
    ScanIndexForward: false // الأحدث أولاً
  }).promise();
  
  return result.Items || [];
}

// =====================================
// حساب إحصاءات النافذة
// =====================================
function calculateWindowStats(offers) {
  
  const stats = {
    total: offers.length,
    accepted: 0,
    rejected: 0,
    expired: 0,
    completed: 0,
    cancelledAfterAccept: 0
  };
  
  for (const offer of offers) {
    
    if (offer.responseStatus === 'accepted') {
      stats.accepted += 1;
      
      // نحتاج للتحقق من حالة الطلب
      // سنفترض وجود حقل orderFinalStatus في WaveOffer
      if (offer.orderFinalStatus === 'delivered') {
        stats.completed += 1;
      } else if (offer.orderFinalStatus === 'canceled_by_driver') {
        stats.cancelledAfterAccept += 1;
      }
      
    } else if (offer.responseStatus === 'rejected') {
      stats.rejected += 1;
      
    } else if (offer.responseStatus === 'expired') {
      stats.expired += 1;
    }
  }
  
  return stats;
}

// =====================================
// مزامنة Snapshot مع LiveState
// =====================================
async function syncSnapshotToLiveState(driverId, metrics) {
  
  try {
    await driverFencedWrite(driverId, {Update: {
      TableName: DRIVER_LIVE_STATE_TABLE,
      Key: { driverId: driverId },
      UpdateExpression: `
        SET metricsSnapshot_acceptanceRate = :acceptanceRate,
            metricsSnapshot_completionRate = :completionRate,
            metricsSnapshot_consecutiveRejections = :consecutiveRejections,
            metricsSnapshot_totalOffersWindow = :totalOffersWindow,
            updatedAt = :now
      `,
      ExpressionAttributeValues: {
        ':acceptanceRate': metrics.acceptanceRate,
        ':completionRate': metrics.completionRate,
        ':consecutiveRejections': metrics.consecutiveRejections,
        ':totalOffersWindow': metrics.windowOffersCount,
        ':now': new Date().toISOString()
      }
    }});
    
    console.log(`🔄 Synced snapshot to LiveState for ${driverId}`);
    
  } catch (error) {
    console.error(`❌ Error syncing snapshot for ${driverId}:`, error.message);
  }
}
