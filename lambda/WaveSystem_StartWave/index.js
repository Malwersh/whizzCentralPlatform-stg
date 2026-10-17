const { isDriverApproved } = require('./driver_eligibility');
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
const {createWaveOfferTransport} = require('./wave-offer-transport');
const dynamodb = new AWS.DynamoDB.DocumentClient();

function getOptionalEnv(name) {
  const value = process.env[name];
  return typeof value === 'string' ? value.trim() : '';
}

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

// Notifications service (Serverless) - used to send FCM/APNs push for background/terminated reliability
const NOTIFICATIONS_API_BASE = getOptionalEnv('NOTIFICATIONS_API_BASE'); // e.g. https://x066k4dftk.execute-api.us-east-1.amazonaws.com/staging
const NOTIFICATIONS_INTERNAL_KEY = getOptionalEnv('NOTIFICATIONS_INTERNAL_KEY');

async function sendWaveOfferPushNotification(payload) { return offerTransport.postPush(payload); }

const websocketManagementEndpoint = getWebsocketManagementEndpoint();
console.log(`🔗 WebSocket management endpoint: ${websocketManagementEndpoint}`);

const apigateway = new AWS.ApiGatewayManagementApi({
  endpoint: websocketManagementEndpoint
});
const offerTransport=createWaveOfferTransport({api:apigateway,notificationsBase:NOTIFICATIONS_API_BASE,internalKey:NOTIFICATIONS_INTERNAL_KEY});
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
    const dispatchJob = await getDispatchJob(dispatchJobId, event.orderId);
    
    if (!dispatchJob) {
      throw new Error(`DispatchJob not found: ${dispatchJobId}`);
    }

    if (Object.prototype.hasOwnProperty.call(dispatchJob,'dispatchCycle')) {
      if(process.env.DISPATCH_LEGACY_HOST_MODE==='REQUIRED'&&dispatchJob.dispatchCycle?.engine==='LEGACY'){if(event.cycleId!==dispatchJob.dispatchCycle.id)throw Error('DISPATCH_HOST_SOURCE_INVALID');const result=await require('./dispatch-cycle-runtime').runHostedLegacyWave({orderId:dispatchJob.orderId,assignmentId:dispatchJobId,cycleId:dispatchJob.dispatchCycle.id},apigateway,'start:'+require('crypto').randomUUID());return {statusCode:200,body:JSON.stringify(result)};}
      const plan=await require('./dispatch-cycle-runtime').coordinateUnifiedDispatch({orderId:dispatchJob.orderId,assignmentId:dispatchJobId,source:'START'});
      return {statusCode:200,body:JSON.stringify({planningOnly:true,...plan})};
    }

    if (dispatchJob.status === 'assigned') {
      console.log(`✅ Order ${dispatchJob.orderId} already assigned - skipping wave`);
      return { statusCode: 200, message: 'Order already assigned' };
    }

    const financialSource = await dynamodb.get({TableName:'WizzOrders',Key:{PK:`ORDER#${dispatchJob.orderId}`,SK:'META'},
      ConsistentRead:true,ProjectionExpression:'financialSnapshot'}).promise();
    if (financialSource.Item && Object.prototype.hasOwnProperty.call(financialSource.Item,'financialSnapshot')) dispatchJob.financialDispatch = true;
    if (dispatchJob.financialDispatch === true && process.env.FINANCIAL_DISPATCH_MODE !== 'REQUIRED') throw new Error('FINANCIAL_DISPATCH_DISABLED');
    if (dispatchJob.financialDispatch === true) {
      const existingWave = await dynamodb.get({TableName:DISPATCH_JOBS_TABLE,
        Key:{orderId:dispatchJob.orderId,SK:`FINANCIAL_WAVE#${waveNumber}`},ConsistentRead:true}).promise();
      if (existingWave.Item) return await runFinancialDispatch(dispatchJob,existingWave.Item.driverIds,waveNumber);
    }


    // Step 1.5: جلب العملة من WizzOrders
    const orderCurrency = await getOrderCurrency(dispatchJob.orderId);
    dispatchJob.currency = orderCurrency;
    console.log(`💱 Order currency: ${orderCurrency}`);

    // Step 2: البحث عن السائقين المؤهلين
    const waveThresholds = getWaveThresholds(waveNumber, isEmergencyWave);
    console.log(`📊 Wave ${waveNumber} thresholds:`, waveThresholds);
    let qualifiedDrivers = await getQualifiedDrivers(dispatchJob, excludeDriverIds, excludeDriverIds, rejectedDriverIds, isFinalWave, isEmergencyWave, waveNumber, waveThresholds);

    const approvedDrivers = [];
    for (const candidate of qualifiedDrivers) {
      const profile = await dynamodb.get({ TableName: requireNonEmptyEnv('DRIVERS_TABLE'),
        Key: { driverId: candidate.driverId }, ConsistentRead: true }).promise();
      if (isDriverApproved(profile.Item)) approvedDrivers.push(candidate);
    }
    qualifiedDrivers = approvedDrivers;

    if (qualifiedDrivers.length === 0 && dispatchJob.financialDispatch !== true) {
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

    if (dispatchJob.financialDispatch === true) {
      if (process.env.FINANCIAL_DISPATCH_MODE !== 'REQUIRED') throw new Error('FINANCIAL_DISPATCH_DISABLED');
      return await runFinancialDispatch(dispatchJob,qualifiedDrivers.slice(0,Math.min(25,WAVE_SIZE)).map(d=>d.driverId),waveNumber);
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
async function getDispatchJob(dispatchJobId, selectedOrderId) {
  console.log(`🔍 Fetching DispatchJob: ${dispatchJobId}`);

  // نستخرج orderId من dispatchJobId (format: DISPATCH_ORDER123_timestamp)
  const orderIdMatch = dispatchJobId.match(/DISPATCH_(.+?)_\d+$/);
  if (!orderIdMatch && !selectedOrderId) {
    throw new Error(`Invalid dispatchJobId format: ${dispatchJobId}`);
  }
  const orderId = selectedOrderId || orderIdMatch[1];

  const result = await dynamodb.get({
    TableName: DISPATCH_JOBS_TABLE,
    Key: {
      orderId: orderId,
      SK: 'METADATA'
    },
    ConsistentRead: true
  }).promise();

  if (!result.Item || result.Item.dispatchJobId !== dispatchJobId) {
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
async function getQualifiedDrivers(...args) {
  return require('./driver-selection').createDriverSelection({dynamodb,DRIVER_LIVE_STATE_TABLE,MAX_DISTANCE_KM}).getQualifiedDrivers(...args);
}

async function createWaveOffers(dispatchJob, selectedDrivers, waveNumber, isEmergencyWave = false) {
  console.log(`📝 Creating ${selectedDrivers.length} WaveOffers for wave ${waveNumber} (Emergency: ${isEmergencyWave})`);

  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + WAVE_TIMEOUT_SECONDS * 1000).toISOString();

  const offers = selectedDrivers.map(driver=>require('./legacy-offer-contract').buildLegacyOfferRow(dispatchJob,driver,waveNumber,{at:now,ttlSeconds:WAVE_TIMEOUT_SECONDS,isEmergencyWave}));

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
function calculateDriverPayout(...args) { return require('./legacy-offer-contract').calculateDriverPayout(...args); }

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
        holdRequiredAmount: dispatchJob.holdRequiredAmount || dispatchJob.orderTotal,
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

    // Push fallback (critical for iOS background/terminated where WebSocket is unreliable)
    // Include all required details so app can display full offer from push alone
    const pushPayload = {
      driverId: driver.driverId,
      orderId: dispatchJob.orderId,
      offerId,
      waveNumber,
      isEmergencyWave,
      
      // Restaurant Details
      restaurantName: dispatchJob.restaurantName,
      restaurantId: dispatchJob.restaurantId,
      restaurantImageUrl: dispatchJob.storeImage || null,
      restaurantLat: dispatchJob.restaurantLat,
      restaurantLng: dispatchJob.restaurantLng,
      
      // Customer Details
      customerName: dispatchJob.customerName || 'عميل',
      customerAddress: extractFullAddress(dispatchJob.deliveryAddress),
      customerLat: dispatchJob.deliveryLat,
      customerLng: dispatchJob.deliveryLng,
      
      // Financial Details
      deliveryFee: baseDeliveryFee,
      bonusAmount: bonusAmount,
      orderTotal: dispatchJob.orderTotal,
      holdRequiredAmount: dispatchJob.holdRequiredAmount || dispatchJob.orderTotal,
      estimatedEarnings: totalEarnings,
      currency: dispatchJob.currency || 'IQD',
      
      // Distance & Time
      distance: dispatchJob.distanceKm || driver.distance,
      estimatedMinutes: dispatchJob.estimatedMinutes || Math.ceil((dispatchJob.distanceKm || driver.distance) * 1.5),
      
      // Items
      itemsCount: dispatchJob.itemsCount || (dispatchJob.items ? dispatchJob.items.length : 0),
      
      // Timing
      expiresAt: message.offer?.expiresAt
    };

    try {
      // Send WS + push in parallel; WS for real-time in foreground, push for background reliability
      const [wsResult, pushResult] = await Promise.allSettled([
        sendWebSocketMessage(driver.connectionId, message),
        sendWaveOfferPushNotification(pushPayload)
      ]);

      if (pushResult.status === 'rejected') {
        console.warn(`⚠️ Push send failed for driver ${driver.driverId}:`, pushResult.reason?.message || String(pushResult.reason));
      }

      if (wsResult.status === 'rejected') {
        throw wsResult.reason;
      }

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
  
  await offerTransport.postSocket(connectionId,message);
  
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

async function runFinancialDispatch(dispatchJob,driverIds,waveNumber) {
  if (process.env.FINANCIAL_DISPATCH_MODE !== 'REQUIRED') throw new Error('FINANCIAL_DISPATCH_DISABLED');
  const {runFinancialWave} = require('./financial-runtime');
  const result = await runFinancialWave({orderId:dispatchJob.orderId,branchId:dispatchJob.restaurantId,waveNumber,driverIds},async(driverId,message)=>{
    const state = await dynamodb.get({TableName:DRIVER_LIVE_STATE_TABLE,Key:{driverId},ConsistentRead:true}).promise();
    if (!state.Item?.connectionId) throw new Error('FINANCIAL_DRIVER_CONNECTION_UNAVAILABLE');
    await sendWebSocketMessage(state.Item.connectionId,message);
  });
  // Persist the actual offer deadline; the existing periodic timeout worker consumes it.
  await dynamodb.update({TableName:DISPATCH_JOBS_TABLE,Key:{orderId:dispatchJob.orderId,SK:'METADATA'},
    UpdateExpression:'SET financialWaveDeadline=:deadline',ConditionExpression:'#s=:searching AND currentWaveNumber=:wave AND financialDispatch=:yes',
    ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':deadline':result.timeoutAt,':searching':'searching',':wave':waveNumber,':yes':true}}).promise();
  return {statusCode:200,...result};
}
