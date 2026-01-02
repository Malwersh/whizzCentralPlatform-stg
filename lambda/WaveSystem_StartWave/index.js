/**
 * WaveSystem_StartWave Lambda Function
 * 
 * Purpose: اختيار السائقين المؤهلين وإرسال عروض الموجة
 * 
 * Triggered by: CreateDispatchJob Lambda (async invocation)
 * 
 * Flow:
 * 1. استلام dispatchJobId من الاستدعاء
 * 2. جلب تفاصيل DispatchJob من WizzDispatchJobs_dev
 * 3. البحث عن السائقين المؤهلين من WizzDriverLiveState
 * 4. حساب المسافة والنقاط لكل سائق
 * 5. ترتيب السائقين حسب النقاط
 * 6. اختيار أفضل 5 سائقين
 * 7. إنشاء سجلات WaveOffers
 * 8. إرسال العروض عبر WebSocket API Gateway
 * 9. جدولة wave timeout عبر EventBridge
 * 
 * Environment Variables:
 * - DISPATCH_JOBS_TABLE: WizzDispatchJobs_dev
 * - DRIVER_LIVE_STATE_TABLE: WizzDriverLiveState
 * - WAVE_OFFERS_TABLE: WaveOffers
 * - WEBSOCKET_API_ENDPOINT: wss://lwk0wf6rpl.execute-api.us-east-1.amazonaws.com/production
 * - EVENTBRIDGE_RULE_ARN: arn for scheduling wave timeouts
 */

const AWS = require('aws-sdk');
const https = require('https');
const dynamodb = new AWS.DynamoDB.DocumentClient();

function requireNonEmptyEnv(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value.trim();
}

function getStage() {
  return String(process.env.STAGE || '').trim().toLowerCase();
}

function getWebsocketManagementEndpoint() {
  const raw = (process.env.WEBSOCKET_MANAGEMENT_ENDPOINT || process.env.WEBSOCKET_API_ENDPOINT || '').trim();
  if (!raw) {
    throw new Error('Missing WebSocket endpoint: set WEBSOCKET_MANAGEMENT_ENDPOINT (https) or WEBSOCKET_API_ENDPOINT (wss/https)');
  }

  const endpoint = raw.startsWith('wss://') ? raw.replace('wss://', 'https://') : raw;

  const stage = getStage();
  if (endpoint.includes('/dev') && stage !== 'dev') {
    throw new Error(`رفض endpoint يحتوي على /dev في بيئة غير dev: ${endpoint}`);
  }

  return endpoint;
}

const DISPATCH_JOBS_TABLE = requireNonEmptyEnv('DISPATCH_JOBS_TABLE');
const DRIVER_LIVE_STATE_TABLE = requireNonEmptyEnv('DRIVER_LIVE_STATE_TABLE');
const WAVE_OFFERS_TABLE = requireNonEmptyEnv('WAVE_OFFERS_TABLE');
const GOOGLE_MAPS_API_KEY = String(process.env.GOOGLE_MAPS_API_KEY || '').trim();

const websocketManagementEndpoint = getWebsocketManagementEndpoint();
console.log(`🔗 WebSocket management endpoint: ${websocketManagementEndpoint}`);

const apigateway = new AWS.ApiGatewayManagementApi({
  endpoint: websocketManagementEndpoint
});
const eventbridge = new AWS.EventBridge();

// =====================================
// Configuration Constants
// =====================================
const WAVE_SIZE = 5; // عدد السائقين في كل موجة
const WAVE_TIMEOUT_SECONDS = 90; // مدة انتظار الموجة (1:30 دقيقة)
const MAX_DISTANCE_KM = 20; // الحد الأقصى للمسافة
const MAX_WAVES = 4; // 3 موجات عادية + 1 موجة نهائية (إعادة إرسال للجميع)

// Performance Thresholds per Wave (تتوسع تدريجياً)
function getWaveThresholds(waveNumber, isEmergencyWave = false) {
  // الموجة الطارئة (Wave 5): بدون أي معايير + مسافة أوسع
  if (isEmergencyWave) {
    return {
      MIN_ACCEPTANCE_RATE: 0,
      MIN_COMPLETION_RATE: 0,
      MAX_CONSECUTIVE_REJECTIONS: 999,
      MAX_DISTANCE_KM: 30, // 30 كم في الموجة الطارئة
      REGION_PRIORITIES: [0, 1, 2, 3], // جميع المناطق
      EMERGENCY_BONUS_PERCENTAGE: 0.25 // 25% بونص
    };
  }
  
  switch(waveNumber) {
    case 1: // Wave 1: معايير صارمة جداً
      return {
        MIN_ACCEPTANCE_RATE: 0.7,
        MIN_COMPLETION_RATE: 0.85,
        MAX_CONSECUTIVE_REJECTIONS: 2,
        MAX_DISTANCE_KM: 5,
        REGION_PRIORITIES: [0] // أولوية 0 فقط
      };
    case 2: // Wave 2: معايير متوسطة
      return {
        MIN_ACCEPTANCE_RATE: 0.6,
        MIN_COMPLETION_RATE: 0.75,
        MAX_CONSECUTIVE_REJECTIONS: 3,
        MAX_DISTANCE_KM: 10,
        REGION_PRIORITIES: [0, 1] // أولوية 0 + 1
      };
    case 3: // Wave 3: معايير مرنة
      return {
        MIN_ACCEPTANCE_RATE: 0.5,
        MIN_COMPLETION_RATE: 0.6,
        MAX_CONSECUTIVE_REJECTIONS: 5,
        MAX_DISTANCE_KM: 15,
        REGION_PRIORITIES: [0, 1] // أولوية 0 + 1
      };
    case 4: // Wave 4 (Final): بدون معايير!
      return {
        MIN_ACCEPTANCE_RATE: 0,
        MIN_COMPLETION_RATE: 0,
        MAX_CONSECUTIVE_REJECTIONS: 999,
        MAX_DISTANCE_KM: 20,
        REGION_PRIORITIES: [0, 1] // كل المناطق المسموحة
      };
    default:
      return {
        MIN_ACCEPTANCE_RATE: 0.6,
        MIN_COMPLETION_RATE: 0.8,
        MAX_CONSECUTIVE_REJECTIONS: 3,
        MAX_DISTANCE_KM: 20,
        REGION_PRIORITIES: [0, 1]
      };
  }
}

// =====================================
// Main Handler
// =====================================
exports.handler = async (event) => {
  console.log('📥 StartWave Lambda triggered:', JSON.stringify(event, null, 2));

  try {
    // Extract dispatchJobId from event
    let dispatchJobId;
    let waveNumber = 1;
    let restaurantRegionId;
    let restaurantLat;
    let restaurantLng;
    let excludeDriverIds = []; // السائقون المستبعدون من الموجات السابقة
    let rejectedDriverIds = []; // ✅ السائقون الذين رفضوا الطلب (يجب استبعادهم دائماً)
    let isFinalWave = false; // الموجة الأخيرة (إعادة إرسال للجميع)
    let isEmergencyWave = false; // 🚨 الموجة الطارئة (بدون معايير + بونص)
    
    // 🔥 FIX: تحقق من الاستدعاء المباشر أولاً (من CreateDispatchJob أو HandleWaveTimeout)
    if (event.dispatchJobId && !event.Records) {
      // Direct invocation from CreateDispatchJob or HandleWaveTimeout
      dispatchJobId = event.dispatchJobId;
      waveNumber = event.waveNumber || 1;
      restaurantRegionId = event.restaurantRegionId;
      restaurantLat = event.restaurantLat;
      restaurantLng = event.restaurantLng;
      excludeDriverIds = event.excludeDriverIds || [];
      rejectedDriverIds = event.rejectedDriverIds || []; // ✅ استخراج السائقين المرفوضين
      isFinalWave = event.isFinalWave || false;
      isEmergencyWave = event.isEmergencyWave || false; // 🚨 استخراج علامة الطوارئ
      console.log(`📋 Direct invocation with dispatchJobId: ${dispatchJobId}`);
      console.log(`🌊 Wave ${waveNumber}, Exclude: ${excludeDriverIds.length} drivers, Rejected: ${rejectedDriverIds.length} drivers, Final: ${isFinalWave}, Emergency: ${isEmergencyWave}`);
    }
    // Check if this is a DynamoDB Stream event
    else if (event.Records && event.Records[0].dynamodb) {
      const record = event.Records[0];
      const eventName = record.eventName; // INSERT, MODIFY, or REMOVE
      
      console.log(`📋 DynamoDB Stream Event: ${eventName}`);
      
      // Skip REMOVE events (deleted orders)
      if (eventName === 'REMOVE') {
        console.log('⏭️ Skipping REMOVE event - order was deleted');
        return { statusCode: 200, message: 'REMOVE event ignored' };
      }
      
      const newImage = record.dynamodb.NewImage;
      
      // Ensure NewImage exists
      if (!newImage) {
        console.log('⏭️ Skipping - no NewImage in event');
        return { statusCode: 200, message: 'No NewImage' };
      }
      
      // Get deliveryJobId (which is the dispatchJobId)
      if (newImage.deliveryJobId && newImage.deliveryJobId.S) {
        dispatchJobId = newImage.deliveryJobId.S;
        console.log(`📋 Extracted dispatchJobId from DynamoDB Stream: ${dispatchJobId}`);
      }
      
      // Validate order status
      const oldStatus = record.dynamodb.OldImage?.orderStatus?.S || record.dynamodb.OldImage?.status?.S;
      const newStatus = newImage.orderStatus?.S || newImage.status?.S;
      
      console.log(`📊 Order status change: ${oldStatus} → ${newStatus}`);
      
      // Only process if status changed TO ready_for_pickup
      if (newStatus !== 'ready_for_pickup') {
        console.log(`⏭️ Skipping - order status is not ready_for_pickup (${newStatus})`);
        return { statusCode: 200, message: 'Order not ready for pickup' };
      }
      
      if (oldStatus === 'ready_for_pickup' && newStatus === 'ready_for_pickup') {
        console.log('⏭️ Skipping - order already was ready_for_pickup');
        return { statusCode: 200, message: 'Already processed' };
      }
    }

    if (!dispatchJobId) {
      throw new Error('Missing dispatchJobId in event');
    }

    console.log(`🌊 Starting Wave ${waveNumber} for DispatchJob: ${dispatchJobId}`);

    // Step 1: جلب تفاصيل DispatchJob
    const dispatchJob = await getDispatchJob(dispatchJobId);
    
    if (!dispatchJob) {
      throw new Error(`DispatchJob not found: ${dispatchJobId}`);
    }

    if (dispatchJob.status === 'assigned') {
      console.log(`✅ Order ${dispatchJob.orderId} already assigned - skipping wave`);
      return { statusCode: 200, message: 'Order already assigned' };
    }

    // Step 1.5: جلب العملة من WizzOrders
    const orderCurrency = await getOrderCurrency(dispatchJob.orderId);
    dispatchJob.currency = orderCurrency;
    console.log(`💱 Order currency: ${orderCurrency}`);

    // Step 2: البحث عن السائقين المؤهلين
    const waveThresholds = getWaveThresholds(waveNumber, isEmergencyWave);
    console.log(`📊 Wave ${waveNumber} thresholds:`, waveThresholds);
    const qualifiedDrivers = await getQualifiedDrivers(dispatchJob, excludeDriverIds, excludeDriverIds, rejectedDriverIds, isFinalWave, isEmergencyWave, waveNumber, waveThresholds);

    if (qualifiedDrivers.length === 0) {
      console.warn(`⚠️ No qualified drivers found for Wave ${waveNumber}`);
      
      // إذا كانت الموجة الطارئة (Wave 5)، نتوقف نهائياً
      if (isEmergencyWave) {
        console.error(`❌ EMERGENCY WAVE (${waveNumber}): No drivers available even with bonus, stopping dispatch`);
        await handleNoDriversAvailable(dispatchJob);
        return { statusCode: 200, message: 'No drivers available after emergency wave' };
      }
      
      // إذا كانت الموجة الأخيرة (Wave 4) ولا يوجد Wave 5 بعدها، نتوقف
      // ⚠️ لكن الآن لدينا Wave 5، لذلك Wave 4 لا تتوقف!
      if (isFinalWave && waveNumber >= 5) {
        console.error(`❌ FINAL WAVE (${waveNumber}): No drivers available, stopping dispatch`);
        await handleNoDriversAvailable(dispatchJob);
        return { statusCode: 200, message: 'No drivers available after final wave' };
      }
      
      // الموجات العادية (1,2,3,4): لا نتوقف! نترك HandleWaveTimeout يحاول الموجة التالية
      console.log(`⏭️ Wave ${waveNumber} empty, will try Wave ${waveNumber + 1} after timeout`);
      
      // نُحدث currentWaveNumber حتى HandleWaveTimeout يعرف أننا حاولنا هذه الموجة
      await dynamodb.update({
        TableName: DISPATCH_JOBS_TABLE,
        Key: { orderId: dispatchJob.orderId, SK: 'METADATA' },
        UpdateExpression: 'SET currentWaveNumber = :wave, updatedAt = :now',
        ExpressionAttributeValues: {
          ':wave': waveNumber,
          ':now': new Date().toISOString()
        }
      }).promise();
      
      return { statusCode: 200, message: `Wave ${waveNumber} skipped, no drivers available` };
    }

    // Step 3: اختيار السائقين حسب نوع الموجة
    let selectedDrivers;
    if (isEmergencyWave) {
      // الموجة الطارئة: إرسال لجميع السائقين المتاحين (بدون حد)
      selectedDrivers = qualifiedDrivers;
      console.log(`🚨 EMERGENCY WAVE: Selected ALL ${selectedDrivers.length} available drivers with bonus`);
    } else if (isFinalWave) {
      // الموجة الأخيرة: إرسال لجميع السائقين المؤهلين (بدون حد)
      selectedDrivers = qualifiedDrivers;
      console.log(`🔥 FINAL WAVE: Selected ALL ${selectedDrivers.length} qualified drivers`);
    } else {
      // الموجات العادية: أفضل WAVE_SIZE سائقين
      selectedDrivers = qualifiedDrivers.slice(0, WAVE_SIZE);
      console.log(`✅ Selected ${selectedDrivers.length} drivers for wave ${waveNumber}`);
    }

    // Step 3.5: حساب الوقت المقدر باستخدام Google Maps
    const estimatedMinutes = await calculateEstimatedDuration(
      dispatchJob.restaurantLat,
      dispatchJob.restaurantLng,
      dispatchJob.deliveryLat,
      dispatchJob.deliveryLng,
      dispatchJob.distanceKm || selectedDrivers[0].distance
    );
    dispatchJob.estimatedMinutes = estimatedMinutes;
    console.log(`⏱️ Estimated delivery time: ${estimatedMinutes} minutes`);

    // Step 4: إنشاء WaveOffers
    await createWaveOffers(dispatchJob, selectedDrivers, waveNumber, isEmergencyWave);

    // Step 5: إرسال العروض عبر WebSocket
    await sendWaveOffers(dispatchJob, selectedDrivers, waveNumber, isEmergencyWave);

    // Step 6: تحديث currentWaveNumber في DispatchJob (مهم جداً!)
    await dynamodb.update({
      TableName: DISPATCH_JOBS_TABLE,
      Key: { orderId: dispatchJob.orderId, SK: 'METADATA' },
      UpdateExpression: 'SET currentWaveNumber = :wave, updatedAt = :now',
      ExpressionAttributeValues: {
        ':wave': waveNumber,
        ':now': new Date().toISOString()
      }
    }).promise();
    console.log(`✅ Updated currentWaveNumber to ${waveNumber}`);

    // Step 7: جدولة Wave Timeout
    await scheduleWaveTimeout(dispatchJob, waveNumber);

    console.log(`✅ Wave ${waveNumber} completed successfully for order ${dispatchJob.orderId}`);

    return {
      statusCode: 200,
      message: 'Wave started successfully',
      waveNumber: waveNumber,
      driversCount: selectedDrivers.length
    };

  } catch (error) {
    console.error('❌ Error in StartWave Lambda:', error);
    throw error;
  }
};

// =====================================
// Step 1: جلب DispatchJob
// =====================================
async function getDispatchJob(dispatchJobId) {
  console.log(`🔍 Fetching DispatchJob: ${dispatchJobId}`);

  // نستخرج orderId من dispatchJobId (format: DISPATCH_ORDER123_timestamp)
  const orderIdMatch = dispatchJobId.match(/DISPATCH_(.+?)_\d+$/);
  if (!orderIdMatch) {
    throw new Error(`Invalid dispatchJobId format: ${dispatchJobId}`);
  }
  const orderId = orderIdMatch[1];

  const result = await dynamodb.get({
    TableName: DISPATCH_JOBS_TABLE,
    Key: {
      orderId: orderId,
      SK: 'METADATA'
    }
  }).promise();

  if (!result.Item) {
    return null;
  }

  console.log(`✅ Found DispatchJob for order ${orderId}`);
  return result.Item;
}

// =====================================
// جلب العملة من WizzOrders
// =====================================
async function getOrderCurrency(orderId) {
  console.log(`💱 Fetching currency for order: ${orderId}`);
  
  try {
    // WizzOrders uses PK/SK structure - try META first (real orders), then METADATA (test orders)
    let result = await dynamodb.get({
      TableName: 'WizzOrders',
      Key: { 
        PK: `ORDER#${orderId}`,
        SK: 'META'
      }
    }).promise();

    // إذا لم نجد في META، جرب METADATA
    if (!result.Item) {
      console.log(`🔄 Order not found in SK=META, trying SK=METADATA...`);
      result = await dynamodb.get({
        TableName: 'WizzOrders',
        Key: { 
          PK: `ORDER#${orderId}`,
          SK: 'METADATA'
        }
      }).promise();
    }

    if (result.Item && result.Item.currency) {
      console.log(`✅ Found currency: ${result.Item.currency}`);
      return result.Item.currency;
    }
    
    console.warn(`⚠️ No currency found in WizzOrders for ${orderId}, defaulting to د.ع`);
    return 'د.ع';
  } catch (error) {
    console.error(`❌ Error fetching order currency:`, error.message);
    return 'د.ع';
  }
}

// =====================================
// Step 2: البحث عن السائقين المؤهلين
// =====================================
async function getQualifiedDrivers(dispatchJob, excludeDriverIds = [], permanentlyExcludedDriverIds = [], rejectedDriverIds = [], isFinalWave = false, isEmergencyWave = false, waveNumber = 1, waveThresholds = {}) {
  console.log(`🔍 Searching for qualified drivers (Wave ${waveNumber})...`);
  console.log(`   Exclude: ${excludeDriverIds.length} drivers, Permanently Excluded: ${permanentlyExcludedDriverIds.length}, Rejected: ${rejectedDriverIds.length} drivers, Final Wave: ${isFinalWave}, Emergency Wave: ${isEmergencyWave}`);
  console.log(`   Thresholds:`, waveThresholds);

  // استخدام المعايير الممررة أو القيم الافتراضية
  const MIN_ACCEPTANCE_RATE = waveThresholds.MIN_ACCEPTANCE_RATE !== undefined ? waveThresholds.MIN_ACCEPTANCE_RATE : 0.6;
  const MIN_COMPLETION_RATE = waveThresholds.MIN_COMPLETION_RATE !== undefined ? waveThresholds.MIN_COMPLETION_RATE : 0.8;
  const MAX_CONSECUTIVE_REJECTIONS = waveThresholds.MAX_CONSECUTIVE_REJECTIONS !== undefined ? waveThresholds.MAX_CONSECUTIVE_REJECTIONS : 3;
  const WAVE_MAX_DISTANCE = waveThresholds.MAX_DISTANCE_KM !== undefined ? waveThresholds.MAX_DISTANCE_KM : 20;
  const REGION_PRIORITIES = waveThresholds.REGION_PRIORITIES !== undefined ? waveThresholds.REGION_PRIORITIES : [0, 1];

  const restaurantLat = dispatchJob.restaurantLat;
  const restaurantLng = dispatchJob.restaurantLng;
  const restaurantRegionId = dispatchJob.restaurantRegionId;

  // المرحلة 1: جلب السائقين من المنطقة باستخدام GSI
  console.log(`📍 Querying drivers in region: ${restaurantRegionId}`);
  
  let driversInRegion = await queryDriversByRegion(restaurantRegionId);
  console.log(`📊 Found ${driversInRegion.length} drivers with current_work_region_id = ${restaurantRegionId}`);

  // 🔄 Fallback: إذا لم نجد سائقين في current_work_region_id، ابحث في جميع السائقين available
  if (driversInRegion.length === 0) {
    console.log(`🔄 No drivers in current_work_region_id, searching all available drivers...`);
    driversInRegion = await queryAllAvailableDrivers();
    console.log(`📊 Found ${driversInRegion.length} total available drivers, will filter by allowed_region_ids`);
  }

  if (driversInRegion.length === 0) {
    console.warn(`⚠️ No available drivers found at all`);
    return [];
  }
  
  // المرحلة 2: فلترة السائقين المتصلين والمتاحين
  const availableDrivers = driversInRegion.filter(driver => {
    // 🚫 استبعاد دائم: السائقين الذين ألغوا الطلب بعد القبول (driver unassignment)
    // يُستبعدون من **جميع الموجات** دائماً (لا فرصة ثانية)
    if (Array.isArray(excludeDriverIds) && excludeDriverIds.includes(driver.driverId)) {
      console.log(`   🚫 Skipping driver ${driver.driverId} (⛔ PERMANENTLY EXCLUDED - unassigned after acceptance)`);
      return false;
    }
    
    // ⏳ استبعاد مؤقت: السائقين الذين رفضوا أو لم يردوا في موجات سابقة
    // الموجات 1-3: يُستبعدون (استبعاد مؤقت)
    // الموجات 4-5: يُعاد إرسال الطلب لهم (فرصة ثانية + بونص)
    if (!isEmergencyWave && waveNumber < 4 && Array.isArray(rejectedDriverIds) && rejectedDriverIds.includes(driver.driverId)) {
      console.log(`   ⏳ Skipping driver ${driver.driverId} temporarily (rejected/no-response in wave 1-${waveNumber-1}, will retry in wave 4+)`);
      return false;
    }
    
    // ✅ في الموجات 4-5: نُرسل للسائقين الذين رفضوا/لم يردوا مرة أخرى (فرصة ثانية)
    if ((waveNumber >= 4 || isEmergencyWave) && Array.isArray(rejectedDriverIds) && rejectedDriverIds.includes(driver.driverId)) {
      console.log(`   🔄 Re-including driver ${driver.driverId} (SECOND CHANCE in wave ${waveNumber}/${isEmergencyWave ? 'EMERGENCY' : 'FINAL'})`);
      // لا نستبعده - نعطيه فرصة ثانية
    }
    
    const isAvailable = driver.status === 'available';
    const isSearching = driver.isSearching === true;
    // ✅ إزالة isOnline - نعتمد على connectionStatus فقط
    const hasConnection = driver.connectionId && driver.connectionStatus === 'connected';
    
    // 🆕 فحص أولويات المناطق حسب الموجة
    let hasRegionWithPriority = false;
    
    // ⚡ الموجة الطارئة: تقبل جميع المناطق
    if (isEmergencyWave) {
      hasRegionWithPriority = true;
    } 
    // 🎯 Wave 1: فقط priority0 (الأقرب)
    else if (waveNumber === 1) {
      if (driver.allowed_region_ids_priority0 && driver.allowed_region_ids_priority0.includes(restaurantRegionId)) {
        hasRegionWithPriority = true;
      }
    }
    // 🌊 Wave 2-4: جميع المناطق المسموحة (priority0 + priority1)
    else {
      if (driver.allowed_region_ids && driver.allowed_region_ids.includes(restaurantRegionId)) {
        hasRegionWithPriority = true;
      }
    }

    return isAvailable && isSearching && hasConnection && hasRegionWithPriority;
  });

  console.log(`🔗 ${availableDrivers.length} drivers are available and connected`);

  if (availableDrivers.length === 0) {
    return [];
  }

  // المرحلة 3: حساب المسافة والفلترة (حسب معايير الموجة)
  const driversWithDistance = availableDrivers
    .map(driver => {
      // ✅ استخدام lat/lng بدلاً من gpsLatitude/gpsLongitude
      if (!driver.lat || !driver.lng) {
        console.log(`⚠️ Driver ${driver.driverId} missing location (lat: ${driver.lat}, lng: ${driver.lng})`);
        return null;
      }

      const distance = calculateDistance(
        restaurantLat, restaurantLng,
        driver.lat, driver.lng
      );

      console.log(`📏 Driver ${driver.driverId}: ${distance.toFixed(2)}km from restaurant`);
      return { ...driver, distance };
    })
    .filter(driver => driver !== null && driver.distance <= WAVE_MAX_DISTANCE);

  console.log(`📍 ${driversWithDistance.length} drivers within ${WAVE_MAX_DISTANCE}km (Wave ${waveNumber} limit)`);

  if (driversWithDistance.length === 0) {
    return [];
  }

  // المرحلة 4: فلترة الأداء (تُتخطى في الموجة الطارئة)
  let performanceFiltered = driversWithDistance;
  
  if (!isEmergencyWave) {
    performanceFiltered = driversWithDistance.filter(driver => {
      const acceptanceRate = driver.metricsSnapshot_acceptanceRate !== undefined && driver.metricsSnapshot_acceptanceRate !== null ? driver.metricsSnapshot_acceptanceRate : null;
      const completionRate = driver.metricsSnapshot_completionRate !== undefined && driver.metricsSnapshot_completionRate !== null ? driver.metricsSnapshot_completionRate : null;
      const consecutiveRejections = driver.metricsSnapshot_consecutiveRejections !== undefined && driver.metricsSnapshot_consecutiveRejections !== null ? driver.metricsSnapshot_consecutiveRejections : 0;
      const totalTrips = driver.metricsSnapshot_totalTrips !== undefined && driver.metricsSnapshot_totalTrips !== null ? driver.metricsSnapshot_totalTrips : 0;

      // ✅ السائق الجديد (totalTrips < 5): يُقبل تلقائياً
      if (totalTrips < 5) {
        console.log(`🆕 New driver ${driver.driverId}: ${totalTrips} trips - auto-accepted`);
        return true;
      }

      // ✅ السائق ذو الخبرة: يُفحص الأداء بالمعايير الديناميكية
      const meetsAcceptanceRate = acceptanceRate >= MIN_ACCEPTANCE_RATE;
      const meetsCompletionRate = completionRate >= MIN_COMPLETION_RATE;
      const meetsRejectionLimit = consecutiveRejections <= MAX_CONSECUTIVE_REJECTIONS;
      
      if (!meetsAcceptanceRate || !meetsCompletionRate || !meetsRejectionLimit) {
        console.log(`❌ Driver ${driver.driverId} excluded: acceptance=${acceptanceRate ? acceptanceRate.toFixed(2) : 'null'} (need ${MIN_ACCEPTANCE_RATE}), completion=${completionRate ? completionRate.toFixed(2) : 'null'} (need ${MIN_COMPLETION_RATE}), rejections=${consecutiveRejections} (max ${MAX_CONSECUTIVE_REJECTIONS})`);
        return false;
      }
      
      return true;
    });
  } else {
    // 🚨 الموجة الطارئة: تُقبل جميع السائقين بدون فحص الأداء
    console.log(`🚨 EMERGENCY WAVE: Skipping performance checks - accepting ALL drivers`);
  }

  console.log(`⭐ ${performanceFiltered.length} drivers meet ${isEmergencyWave ? 'emergency' : 'performance'} criteria`);

  if (performanceFiltered.length === 0) {
    return [];
  }  // المرحلة 5: حساب النقاط والترتيب
  const driversWithScores = performanceFiltered.map(driver => {
    const regionScore = calculateRegionScore(driver, restaurantRegionId);
    const distanceScore = calculateDistanceScore(driver.distance, MAX_DISTANCE_KM);
    const performanceScore = calculatePerformanceScore(driver);
    
    const totalScore = regionScore + distanceScore + performanceScore;

    return {
      ...driver,
      scores: {
        total: totalScore,
        region: regionScore,
        distance: distanceScore,
        performance: performanceScore
      }
    };
  });

  // الترتيب من الأعلى للأدنى
  driversWithScores.sort((a, b) => b.scores.total - a.scores.total);

  // طباعة أفضل 5 سائقين
  driversWithScores.slice(0, 5).forEach((driver, index) => {
    console.log(
      `🏆 #${index + 1} ${driver.driverId}: ${driver.scores.total.toFixed(1)} pts ` +
      `(region=${driver.scores.region}, distance=${driver.scores.distance.toFixed(1)}, ` +
      `performance=${driver.scores.performance.toFixed(1)}, ${driver.distance.toFixed(2)}km)`
    );
  });

  return driversWithScores;
}

// =====================================
// Query Drivers by Region (using GSI)
// =====================================
async function queryDriversByRegion(regionId) {
  try {
    const result = await dynamodb.query({
      TableName: DRIVER_LIVE_STATE_TABLE,
      IndexName: 'RegionStatusIndex',
      KeyConditionExpression: 'current_work_region_id = :regionId AND #status = :statusVal',
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':regionId': regionId,
        ':statusVal': 'available'
      }
    }).promise();

    return result.Items || [];
  } catch (error) {
    console.error('Error querying drivers by region:', error);
    return [];
  }
}

// =====================================
// Query All Available Drivers (fallback)
// =====================================
async function queryAllAvailableDrivers() {
  try {
    const result = await dynamodb.scan({
      TableName: DRIVER_LIVE_STATE_TABLE,
      FilterExpression: '#status = :statusVal',
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':statusVal': 'available'
      }
    }).promise();

    return result.Items || [];
  } catch (error) {
    console.error('Error scanning all available drivers:', error);
    return [];
  }
}

// =====================================
// حساب النقاط - المنطقة (0-25)
// =====================================
function calculateRegionScore(driver, restaurantRegionId) {
  // منطقة العمل الأساسية → 25 نقطة
  if (restaurantRegionId === driver.home_region_id) {
    return 25;
  }

  // Priority 0 (جيران مباشرون) → 20 نقطة
  if (driver.allowed_region_ids_priority0?.includes(restaurantRegionId)) {
    return 20;
  }

  // Priority 1 (جيران قريبون) → 10 نقاط
  if (driver.allowed_region_ids_priority1?.includes(restaurantRegionId)) {
    return 10;
  }

  // خارج النطاق → 0 نقطة
  return 0;
}

// =====================================
// حساب النقاط - المسافة (0-30)
// =====================================
function calculateDistanceScore(distance, maxDistance) {
  // 0 كم → 30 نقطة
  // maxDistance كم → 0 نقطة
  // خطي بينهما
  const score = 30 * (1 - (distance / maxDistance));
  return Math.max(0, score);
}

// =====================================
// حساب النقاط - الأداء (0-45 + responseRate bonus max 5)
// =====================================
function calculatePerformanceScore(driver) {
  const acceptanceRate = driver.metricsSnapshot_acceptanceRate ?? 1.0;
  const completionRate = driver.metricsSnapshot_completionRate ?? 1.0;
  const consecutiveRejections = driver.metricsSnapshot_consecutiveRejections ?? 0;
  const rating = driver.rating ?? 4.5;
  const responseRate = driver.metricsSnapshot_responseRate ?? 0; // ✨ NEW: Response rate

  // معدل القبول: 0-20 نقطة
  const acceptanceScore = acceptanceRate * 20;

  // معدل الإكمال: 0-20 نقطة
  const completionScore = completionRate * 20;

  // التقييم: 0-5 نقاط
  const ratingScore = Math.max(0, (rating - 4.0) * 5);

  // عقوبة الرفضات المتتالية: -10 لكل رفض
  const rejectionPenalty = consecutiveRejections * 10;

  // ✨ NEW: Response Rate Bonus (max +5 points)
  let responseBonus = 0;
  if (responseRate >= 0.80) {
    responseBonus = 5; // 80%+ → +5 نقاط 🌟
  } else if (responseRate >= 0.60) {
    responseBonus = 2; // 60-79% → +2 نقاط ⭐
  }
  // responseRate < 60% → 0 نقاط (لا شيء)

  const totalPerformance = acceptanceScore + completionScore + ratingScore + responseBonus - rejectionPenalty;

  console.log(
    `   📊 Driver ${driver.driverId} performance: ` +
    `acceptance=${acceptanceScore.toFixed(1)}, completion=${completionScore.toFixed(1)}, ` +
    `rating=${ratingScore.toFixed(1)}, responseBonus=${responseBonus}, ` +
    `rejectionPenalty=${rejectionPenalty} → total=${totalPerformance.toFixed(1)}`
  );

  return Math.max(0, totalPerformance);
}

// =====================================
// حساب المسافة (Haversine Formula)
// =====================================
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // نصف قطر الأرض بالكيلومتر
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;
  
  return distance;
}

// =====================================
// Step 4: إنشاء WaveOffers
// =====================================
async function createWaveOffers(dispatchJob, selectedDrivers, waveNumber, isEmergencyWave = false) {
  console.log(`📝 Creating ${selectedDrivers.length} WaveOffers for wave ${waveNumber} (Emergency: ${isEmergencyWave})`);

  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + WAVE_TIMEOUT_SECONDS * 1000).toISOString();

  const offers = selectedDrivers.map((driver, index) => {
    const offerId = `OFFER_${dispatchJob.orderId}_${driver.driverId}_W${waveNumber}`;

    // 🚨 حساب البونص في الموجة الطارئة
    const baseDeliveryFee = dispatchJob.deliveryFee || calculateDriverPayout(dispatchJob.orderTotal, driver.distance);
    const bonusAmount = isEmergencyWave ? (baseDeliveryFee * 0.25) : 0; // 25% bonus
    const totalDriverEarnings = baseDeliveryFee + bonusAmount;
    const whizzSubsidy = bonusAmount; // Whizz تدفع البونص كاملاً

    return {
      // Primary Key (PK: orderId, SK: driverId#waveNumber)
      orderId: dispatchJob.orderId,
      SK: `${driver.driverId}#WAVE#${waveNumber}`,
      
      // Basic Info
      offerId: offerId,
      driverId: driver.driverId,
      waveNumber: waveNumber,
      dispatchJobId: dispatchJob.dispatchJobId,
      
      // Timing
      sentAt: now,
      expiresAt: expiresAt,
      responseAt: null,
      
      // Status
      responseStatus: 'pending',
      responseReasonCode: null,
      isWinner: false,
      
      // Distance & Earnings (من المطعم إلى الزبون)
      distanceKmAtOffer: dispatchJob.distanceKm || driver.distance,
      estimatedEarningsAtOffer: totalDriverEarnings, // Total with bonus
      baseDeliveryFee: baseDeliveryFee,
      bonusAmount: bonusAmount,
      whizzSubsidy: whizzSubsidy,
      isEmergencyWave: isEmergencyWave,
      estimatedDurationMinutes: dispatchJob.estimatedMinutes || Math.ceil((dispatchJob.distanceKm || driver.distance) * 1.5),
      
      // Region Info
      restaurantRegionId: dispatchJob.restaurantRegionId,
      driverRegionAtOffer: driver.current_region_id || driver.current_work_region_id,
      restaurantId: dispatchJob.restaurantId,
      restaurantName: dispatchJob.restaurantName,
      
      // Metrics Snapshot
      driverMetricsSnapshot_acceptanceRate: driver.metricsSnapshot_acceptanceRate ?? 1.0,
      driverMetricsSnapshot_completionRate: driver.metricsSnapshot_completionRate ?? 1.0,
      driverMetricsSnapshot_consecutiveRejections: driver.metricsSnapshot_consecutiveRejections ?? 0,
      driverScoreAtOffer: driver.scores?.total || 0,
      
      // System
      createdAt: now,
      updatedAt: now,
      ttl: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60) // 7 days
    };
  });

  // حفظ جميع العروض
  const batchWriteParams = {
    RequestItems: {
      [WAVE_OFFERS_TABLE]: offers.map(offer => ({
        PutRequest: { Item: offer }
      }))
    }
  };

  await dynamodb.batchWrite(batchWriteParams).promise();
  console.log(`✅ Created ${offers.length} WaveOffers successfully`);
}

// =====================================
// حساب أجر السائق
// =====================================
function calculateDriverPayout(orderTotal, distanceKm) {
  // أجر أساسي + نسبة من الطلب + أجر المسافة
  const baseFee = 2000; // IQD
  const orderPercentage = orderTotal * 0.15; // 15% من قيمة الطلب
  const distanceFee = distanceKm * 500; // 500 IQD per km

  return Math.round(baseFee + orderPercentage + distanceFee);
}

// =====================================
// استخراج العنوان الكامل من Object
// =====================================
function extractFullAddress(addressObj) {
  if (typeof addressObj === 'string') {
    return addressObj;
  }
  
  if (addressObj && addressObj.fullAddress) {
    return addressObj.fullAddress;
  }
  
  if (addressObj && addressObj.additionalNotes) {
    return addressObj.additionalNotes;
  }
  
  // بناء العنوان من المكونات
  const parts = [];
  if (addressObj) {
    if (addressObj.city) parts.push(addressObj.city);
    if (addressObj.district) parts.push(addressObj.district);
    if (addressObj.governorate) parts.push(addressObj.governorate);
  }
  
  return parts.length > 0 ? parts.join('، ') : 'غير محدد';
}

// =====================================
// تحويل Items من DynamoDB إلى صيغة Flutter
// =====================================
function parseItems(itemsData) {
  if (!itemsData || !Array.isArray(itemsData)) {
    return [];
  }
  
  return itemsData.map(item => ({
    itemId: item.itemId || item.skuId || '',
    name: item.name || '',
    quantity: item.quantity || 1,
    price: item.unitPrice || 0,
    imageUrl: item.imageUrl || null,
    notes: item.notes || null
  }));
}

// =====================================
// Step 5: إرسال العروض عبر WebSocket
// =====================================
async function sendWaveOffers(dispatchJob, selectedDrivers, waveNumber, isEmergencyWave = false) {
  console.log(`📢 Sending wave ${waveNumber} offers via WebSocket (Emergency: ${isEmergencyWave})...`);

  const sendPromises = selectedDrivers.map(async (driver, index) => {
    const offerId = `OFFER_${dispatchJob.orderId}_${driver.driverId}_W${waveNumber}`;

    // 🚨 حساب البونص للموجة الطارئة
    const baseDeliveryFee = dispatchJob.deliveryFee || calculateDriverPayout(dispatchJob.orderTotal, driver.distance);
    const bonusAmount = isEmergencyWave ? (baseDeliveryFee * 0.25) : 0; // 25% bonus
    const totalEarnings = baseDeliveryFee + bonusAmount;

    const message = {
      type: 'new_wave_offer',
      action: 'wave_assignment',
      
      offerId: offerId,
      orderId: dispatchJob.orderId,
      waveNumber: waveNumber,
      isEmergencyWave: isEmergencyWave,
      
      offer: {
        offerId: offerId,
        orderId: dispatchJob.orderId,
        jobId: dispatchJob.dispatchJobId,
        waveNumber: waveNumber,
        isEmergencyWave: isEmergencyWave,
        
        // Restaurant Info
        restaurantId: dispatchJob.restaurantId,
        restaurantName: dispatchJob.restaurantName,
        restaurantAddress: extractFullAddress(dispatchJob.restaurantAddress),
        restaurantLat: dispatchJob.restaurantLat,
        restaurantLng: dispatchJob.restaurantLng,
        restaurantImageUrl: dispatchJob.storeImage || null,
        
        // Customer Info
        customerId: dispatchJob.userId || 'guest',
        customerName: dispatchJob.customerName || 'عميل',
        customerAddress: extractFullAddress(dispatchJob.deliveryAddress),
        customerLat: dispatchJob.deliveryLat,
        customerLng: dispatchJob.deliveryLng,
        customerPhone: dispatchJob.customerPhone || null,
        
        // Financial (from DispatchJob)
        orderTotal: dispatchJob.orderTotal,
        deliveryFee: baseDeliveryFee,
        bonusAmount: bonusAmount,
        estimatedEarnings: totalEarnings,
        currency: dispatchJob.currency || 'IQD',
        bonusMessage: isEmergencyWave ? '🚨 طلب عاجل - مكافأة إضافية +25%' : null,
        
        // Distance & Time (المسافة من المطعم إلى الزبون)
        distance: dispatchJob.distanceKm || driver.distance,
        estimatedMinutes: dispatchJob.estimatedMinutes || Math.ceil((dispatchJob.distanceKm || driver.distance) * 1.5),
        
        // Items
        items: parseItems(dispatchJob.items),
        itemsCount: dispatchJob.itemsCount || (dispatchJob.items ? dispatchJob.items.length : 0),
        
        // Timing
        sentAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + WAVE_TIMEOUT_SECONDS * 1000).toISOString(),
        
        // Wave Info (for display)
        rank: index + 1,
        score: driver.scores?.total || 0,
        
        // Notes
        specialInstructions: dispatchJob.deliveryInstructions || dispatchJob.notes || null
      },
      
      timestamp: new Date().toISOString()
    };

    try {
      await sendWebSocketMessage(driver.connectionId, message);
      console.log(`✅ Sent offer to driver ${driver.driverId} (${driver.distance.toFixed(2)}km)${isEmergencyWave ? ' [EMERGENCY +25%]' : ''}`);
    } catch (error) {
      console.error(`❌ Failed to send offer to driver ${driver.driverId}:`, error.message);
      
      // تحديث العرض كفاشل
      await updateWaveOfferStatus(dispatchJob.orderId, driver.driverId, waveNumber, {
        responseStatus: 'expired',
        responseReasonCode: 'failed_to_send',
        responseAt: new Date().toISOString()
      });
    }
  });

  await Promise.all(sendPromises);
  console.log(`✅ Completed sending ${selectedDrivers.length} offers${isEmergencyWave ? ' (EMERGENCY WAVE)' : ''}`);
}

// =====================================
// إرسال رسالة WebSocket
// =====================================
async function sendWebSocketMessage(connectionId, message) {
  console.log(`📤 Sending WebSocket message to ${connectionId}:`);
  console.log(`📋 Message type: ${message.type}`);
  console.log(`📦 Full message: ${JSON.stringify(message, null, 2)}`);
  
  await apigateway.postToConnection({
    ConnectionId: connectionId,
    Data: JSON.stringify(message)
  }).promise();
  
  console.log(`✅ Message sent successfully to ${connectionId}`);
}

// =====================================
// تحديث حالة WaveOffer
// =====================================
async function updateWaveOfferStatus(orderId, driverId, waveNumber, updates) {
  await dynamodb.update({
    TableName: WAVE_OFFERS_TABLE,
    Key: {
      orderId: orderId,
      SK: `${driverId}#WAVE#${waveNumber}`
    },
    UpdateExpression: 'SET ' + Object.keys(updates).map((key, i) => `#attr${i} = :val${i}`).join(', '),
    ExpressionAttributeNames: Object.keys(updates).reduce((acc, key, i) => {
      acc[`#attr${i}`] = key;
      return acc;
    }, {}),
    ExpressionAttributeValues: Object.keys(updates).reduce((acc, key, i) => {
      acc[`:val${i}`] = updates[key];
      return acc;
    }, {})
  }).promise();
}

// =====================================
// Step 6: جدولة Wave Timeout
// =====================================
async function scheduleWaveTimeout(dispatchJob, waveNumber) {
  console.log(`⏱️ Scheduling timeout for wave ${waveNumber}...`);

  const targetTime = new Date(Date.now() + WAVE_TIMEOUT_SECONDS * 1000);

  // استخدام EventBridge Scheduler
  const params = {
    Name: `wave-timeout-${dispatchJob.dispatchJobId}-wave-${waveNumber}`,
    ScheduleExpression: `at(${targetTime.toISOString().split('.')[0]})`,
    Target: {
      Arn: process.env.WAVE_TIMEOUT_LAMBDA_ARN,
      Input: JSON.stringify({
        dispatchJobId: dispatchJob.dispatchJobId,
        orderId: dispatchJob.orderId,
        waveNumber: waveNumber
      })
    },
    State: 'ENABLED'
  };

  // Note: EventBridge Scheduler requires different API - simplified for now
  // In production, use EventBridge Scheduler or Step Functions
  console.log(`⏰ Timeout scheduled for wave ${waveNumber} at ${targetTime.toISOString()}`);
  console.log(`   (EventBridge rule would be created here)`);
}

// =====================================
// معالجة عدم توفر سائقين
// =====================================
async function handleNoDriversAvailable(dispatchJob) {
  console.log(`⚠️ No drivers available for order ${dispatchJob.orderId}`);

  // تحديث DispatchJob
  await dynamodb.update({
    TableName: process.env.DISPATCH_JOBS_TABLE || 'WizzDispatchJobs_dev',
    Key: {
      orderId: dispatchJob.orderId,
      SK: 'METADATA'
    },
    UpdateExpression: 'SET #status = :status, noDriverReason = :reason, updatedAt = :now',
    ExpressionAttributeNames: {
      '#status': 'status'
    },
    ExpressionAttributeValues: {
      ':status': 'no_driver_available',
      ':reason': 'NO_QUALIFIED_DRIVERS',
      ':now': new Date().toISOString()
    }
  }).promise();

  console.log(`✅ Updated DispatchJob status to no_driver_available`);
}

// =====================================
// Google Maps Distance Matrix API
// =====================================
async function getAccurateDurationFromGoogleMaps(originLat, originLng, destLat, destLng) {
  return new Promise((resolve, reject) => {
    if (!GOOGLE_MAPS_API_KEY) {
      // No key configured - use fallback formula.
      return resolve(null);
    }
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${originLat},${originLng}&destinations=${destLat},${destLng}&mode=driving&departure_time=now&key=${GOOGLE_MAPS_API_KEY}`;
    
    https.get(url, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          
          if (response.status === 'OK' && response.rows[0]?.elements[0]?.status === 'OK') {
            const element = response.rows[0].elements[0];
            
            // الوقت بالثواني (مع الزحام المروري إذا متوفر)
            const durationSeconds = element.duration_in_traffic 
              ? element.duration_in_traffic.value 
              : element.duration.value;
            
            const durationMinutes = Math.ceil(durationSeconds / 60);
            
            console.log(`🗺️ Google Maps: ${durationMinutes} minutes (${(durationSeconds / 60).toFixed(1)}m)`);
            resolve(durationMinutes);
          } else {
            console.warn(`⚠️ Google Maps API error: ${response.status}`);
            resolve(null); // Return null to fallback to formula
          }
        } catch (error) {
          console.error('❌ Error parsing Google Maps response:', error);
          resolve(null);
        }
      });
    }).on('error', (error) => {
      console.error('❌ Error calling Google Maps API:', error);
      resolve(null);
    });
  });
}

// =====================================
// حساب الوقت المقدر (مع Google Maps أو Fallback)
// =====================================
async function calculateEstimatedDuration(originLat, originLng, destLat, destLng, distanceKm) {
  // محاولة استخدام Google Maps أولاً
  try {
    const googleDuration = await getAccurateDurationFromGoogleMaps(originLat, originLng, destLat, destLng);
    
    if (googleDuration !== null) {
      return googleDuration;
    }
  } catch (error) {
    console.warn('⚠️ Failed to get Google Maps duration, using fallback formula');
  }
  
  // Fallback: الصيغة المحسنة (1.5 دقيقة لكل كم = 40 كم/ساعة)
  const fallbackDuration = Math.ceil(distanceKm * 1.5);
  console.log(`📐 Fallback formula: ${fallbackDuration} minutes (${distanceKm}km * 1.5)`);
  return fallbackDuration;
}
