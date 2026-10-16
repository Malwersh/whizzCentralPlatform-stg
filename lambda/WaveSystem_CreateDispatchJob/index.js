/**
 * CreateDispatchJob Lambda Function
 * 
 * الغرض: تُطلق تلقائياً عندما يتغير status في WizzOrders إلى ready_for_pickup
 * 
 * المهام:
 * 1. قراءة بيانات الطلب من DynamoDB Stream
 * 2. إنشاء DispatchJob في WizzDispatchJobs_dev
 * 3. تحديث WizzOrders بـ deliveryJobId
 * 4. استدعاء StartWave Lambda لبدء أول موجة
 * 
 * المدخلات: DynamoDB Stream من WizzOrders
 * المخرجات: DispatchJob جديد + استدعاء StartWave Lambda
 * 
 * ملاحظة مهمة: 
 * - جدول WizzOrders يستخدم businessId/businessName (الأساسي)
 * - مع دعم storeId/storeName للتوافقية
 * - موقع المطعم: businessLocation أو storeLocation
 * - منطقة المطعم: pickupRegionId (الاسم الفعلي في WizzOrders)
 * 
 * @see WAVE_SYSTEM_PLAN_PART_4_ORDER_FLOW.md
 * @see WAVE_SYSTEM_PLAN_PART_5_WAVE_MANAGEMENT.md
 */

const AWS = require('aws-sdk');
const dynamodb = new AWS.DynamoDB.DocumentClient();
const lambda = new AWS.Lambda();

function requireNonEmptyEnv(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value.trim();
}

function toNumber(value) {
  if (value === null || value === undefined) return 0;
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : 0;
}

// Some orders are stored in minor units (fils = IQD * 1000) while others are IQD.
// Normalize to IQD before sending to dispatch/wave/frontend.
function normalizeMoneyToIqd(rawAmount, referenceAmount = null) {
  const amount = toNumber(rawAmount);
  if (amount <= 0) return 0;

  const reference = toNumber(referenceAmount);
  if (reference > 0) {
    const ratio = amount / reference;
    // pricing.total (fils) vs total (IQD) => ratio around 1000
    if (ratio >= 900 && ratio <= 1100) {
      return amount / 1000;
    }
  }

  // Fallback heuristic for large, thousand-based minor-unit values.
  if (amount >= 100000 && amount % 1000 === 0) {
    return amount / 1000;
  }

  return amount;
}

// ============================================
// Constants
// ============================================
const DISPATCH_JOBS_TABLE = requireNonEmptyEnv('DISPATCH_JOBS_TABLE');
const ORDERS_TABLE = process.env.ORDERS_TABLE || 'WizzOrders';
const BUSINESSES_TABLE = process.env.BUSINESSES_TABLE || 'Businesses';
const START_WAVE_LAMBDA = process.env.START_WAVE_LAMBDA || 'WaveSystem_StartWave';

const MAX_WAVES = 4; // 3 موجات عادية + موجة نهائية
const WAVE_SIZE = 5; // حسب frontend OrderOffer: نرسل لـ 5 سائقين في كل موجة
const DISPATCH_TIMEOUT_MINUTES = 15;

// ============================================
// Main Lambda Handler
// ============================================
exports.handler = async (event) => {
  
  console.log('📥 CreateDispatchJob Lambda triggered');
  
  // ========================================
  // Check if this is a DIRECT INVOCATION (for driver unassignment)
  // ========================================
  if (event.orderId && !event.Records) {
    console.log('🔄 Direct invocation for order reassignment');
    console.log(`   Order ID: ${event.orderId}`);
    console.log(`   Reason: ${event.reason || 'driver_unassigned'}`);
    console.log(`   Excluded Drivers: ${(event.excludedDrivers || []).length}`);
    
    try {
      // Fetch order from database
      const fullOrder = await dynamodb.get({
        TableName: ORDERS_TABLE,
        Key: {
          PK: `ORDER#${event.orderId}`,
          SK: 'META'
        }
      }).promise();
      
      if (!fullOrder.Item) {
        throw new Error(`Order ${event.orderId} not found`);
      }
      
      // Create new DispatchJob with excludedDrivers
      await createDispatchJobForOrder(fullOrder.Item, event.excludedDrivers || []);
      
      return {
        statusCode: 200,
        message: 'DispatchJob created for reassignment',
        orderId: event.orderId
      };
    } catch (error) {
      console.error('❌ Error in direct invocation:', error);
      throw error;
    }
  }
  
  // ========================================
  // Otherwise, process DynamoDB Stream events (normal flow)
  // ========================================
  console.log(`📊 Received ${event.Records.length} records from DynamoDB Stream`);
  
  const results = {
    processed: 0,
    skipped: 0,
    errors: 0
  };
  
  for (const record of event.Records) {
    
    try {
      // ========================================
      // Step 1: فلترة - فقط MODIFY events
      // ========================================
      if (record.eventName !== 'MODIFY') {
        console.log(`⏭️ Skipping ${record.eventName} event`);
        results.skipped++;
        continue;
      }
      
      // تحويل DynamoDB format إلى JavaScript objects
      const oldImage = record.dynamodb.OldImage 
        ? AWS.DynamoDB.Converter.unmarshall(record.dynamodb.OldImage) 
        : {};
      const newImage = AWS.DynamoDB.Converter.unmarshall(record.dynamodb.NewImage);
      
      // ========================================
      // Step 2: فلترة - فقط ready_for_pickup أو reassigning
      // ========================================
      const oldStatus = oldImage.orderStatus || oldImage.status;
      const newStatus = newImage.orderStatus || newImage.status;
      
      // قبول ready_for_pickup (طلب جديد) أو reassigning (بعد unassignment)
      if (newStatus !== 'ready_for_pickup' && newStatus !== 'reassigning') {
        console.log(`⏭️ Status is "${newStatus}", not "ready_for_pickup" or "reassigning"`);
        results.skipped++;
        continue;
      }
      
      // التأكد من أن الطلب ليس مُسند بالفعل
      if (newImage.driverId) {
        console.log(`⏭️ Order ${newImage.orderId} already has driverId: ${newImage.driverId}`);
        results.skipped++;
        continue;
      }
      
      if (newImage.deliveryJobId) {
        console.log(`⏭️ Order ${newImage.orderId} already has deliveryJobId: ${newImage.deliveryJobId}`);
        results.skipped++;
        continue;
      }
      
      console.log(`✅ Processing order ${newImage.orderId}: "${oldStatus}" → "${newStatus}"`);
      
      // ========================================
      // Step 2.5: Early Idempotency Check - تخطي إذا كان deliveryJobId موجود بالفعل
      // ========================================
      if (newImage.deliveryJobId) {
        console.log(`⏭️ Skipping order ${newImage.orderId} - deliveryJobId already set: ${newImage.deliveryJobId}`);
        results.skipped++;
        continue;
      }
      
      // ========================================
      // Step 3: قراءة بيانات الطلب الكاملة من DynamoDB
      // ========================================
      const orderId = newImage.orderId || newImage.PK?.replace('ORDER#', '');
      
      if (!orderId) {
        console.error('❌ Cannot extract orderId from record');
        results.errors++;
        continue;
      }
      
      console.log(`📖 Fetching full order data for ${orderId}`);
      
      const fullOrder = await dynamodb.get({
        TableName: ORDERS_TABLE,
        Key: {
          PK: `ORDER#${orderId}`,
          SK: 'META'
        }
      }).promise();
      
      if (!fullOrder.Item) {
        console.error(`❌ Order ${orderId} not found in database`);
        results.errors++;
        continue;
      }
      
      const orderData = fullOrder.Item;
      console.log(`✅ Loaded full order data with businessId: ${orderData.businessId || orderData.storeId}`);
      
      // ========================================
      // Step 4: إنشاء DispatchJob
      // ========================================
      
      // إذا كان status = reassigning، استخدم excludedDrivers من الطلب
      const excludedDrivers = (newStatus === 'reassigning' && orderData.excludedDrivers) 
        ? orderData.excludedDrivers.map(ed => ed.driverId || ed) 
        : [];
      
      if (excludedDrivers.length > 0) {
        console.log(`🚫 Found ${excludedDrivers.length} excluded drivers from order: ${excludedDrivers.join(', ')}`);
      }
      
      await createDispatchJobForOrder(orderData, excludedDrivers);
      results.processed++;
      
    } catch (error) {
      console.error(`❌ Error processing record:`, error);
      console.error('Record:', JSON.stringify(record, null, 2));
      results.errors++;
      // لا نرمي الخطأ - نستمر في معالجة السجلات الأخرى
    }
  }
  
  console.log(`\n📊 Processing Summary:`);
  console.log(`   ✅ Processed: ${results.processed}`);
  console.log(`   ⏭️ Skipped: ${results.skipped}`);
  console.log(`   ❌ Errors: ${results.errors}`);
  
  return {
    statusCode: 200,
    body: JSON.stringify(results)
  };
};

// ============================================
// دالة إنشاء DispatchJob
// ============================================
async function createDispatchJobForOrder(order, excludedDrivers = []) {
  
  console.log(`\n📋 Creating DispatchJob for order ${order.orderId}`);
  if (excludedDrivers.length > 0) {
    console.log(`   🚫 Excluding ${excludedDrivers.length} drivers: ${excludedDrivers.join(', ')}`);
  }
  
  // ========================================
  // Step 0: Idempotency Check - التحقق من وجود DispatchJob نشط بالفعل
  // ========================================
  try {
    const existingJobsQuery = await dynamodb.query({
      TableName: DISPATCH_JOBS_TABLE,
      IndexName: 'orderId-index',
      KeyConditionExpression: 'orderId = :orderId',
      FilterExpression: '#status = :active',
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':orderId': order.orderId,
        ':active': 'active'
      },
      Limit: 1
    }).promise();
    
    if (existingJobsQuery.Items && existingJobsQuery.Items.length > 0) {
      const existingJob = existingJobsQuery.Items[0];
      console.log(`⏭️ Active DispatchJob already exists: ${existingJob.dispatchJobId}`);
      console.log(`   Status: ${existingJob.status}, Created: ${existingJob.createdAt}`);
      return { 
        success: true, 
        skipped: true, 
        reason: 'Active DispatchJob already exists',
        existingJobId: existingJob.dispatchJobId
      };
    }
  } catch (queryError) {
    console.warn(`⚠️ Error checking for existing DispatchJobs (continuing anyway):`, queryError.message);
    // نستمر في الإنشاء - الخطأ في Query لا يجب أن يوقف العملية
  }
  
  // ========================================
  // Step 1: التحقق من البيانات المطلوبة
  // ========================================
  
  // التحقق من معرف المطعم - دعم عدة أسماء للحقل
  const businessId = order.storeId || order.restaurantId || order.businessId;
  const businessName = order.storeName || order.restaurantName || order.businessName;
  
  if (!businessId) {
    throw new Error(`Missing storeId/restaurantId/businessId for order ${order.orderId}`);
  }
  
  console.log(`✅ Business ID: ${businessId}, Name: ${businessName}`);
  
  // التحقق من عنوان المطعم - دعم عدة أسماء
  const restaurantAddress = order.storeAddress || order.restaurantAddress || '';
  
  // التحقق من إحداثيات المطعم في الطلب نفسه أولاً
  let restaurantLat = order.restaurantLat || order.storeLat;
  let restaurantLng = order.restaurantLng || order.storeLng;
  
  if (restaurantLat && restaurantLng) {
    console.log(`✅ Using restaurant coordinates from order: (${restaurantLat}, ${restaurantLng})`);
  }
  
  // التحقق من deliveryAddress
  if (!order.deliveryAddress) {
    throw new Error(`Missing deliveryAddress for order ${order.orderId}`);
  }
  
  // WizzOrders: deliveryAddress هو object يحتوي على lat, lng
  if (!order.deliveryAddress || typeof order.deliveryAddress !== 'object') {
    throw new Error(`Missing deliveryAddress object for order ${order.orderId}`);
  }
  
  if (!order.deliveryAddress.lat || !order.deliveryAddress.lng) {
    throw new Error(`Missing lat/lng in deliveryAddress for order ${order.orderId}`);
  }
  
  // ملاحظة: pickupRegionId قد لا يكون موجوداً دائماً - سنتعامل معه لاحقاً
  const pickupRegionId = order.pickupRegionId || order.restaurantRegionId;
  if (!pickupRegionId) {
    console.warn(`⚠️ Order ${order.orderId} missing pickupRegionId/restaurantRegionId - will need to determine from coordinates`);
  }
  
  // ========================================
  // Step 2: جلب إحداثيات المطعم (إن لم تكن موجودة)
  // ========================================
  
  // إذا لم تكن الإحداثيات موجودة في الطلب، جلبها من جدول Businesses
  if (!restaurantLat || !restaurantLng) {
    try {
      console.log(`🔍 Fetching restaurant coordinates from Businesses table for: ${businessId}`);
      const businessData = await dynamodb.get({
        TableName: process.env.BUSINESSES_TABLE || 'WhizzMerchants_Businesses',
        Key: { businessId: businessId }
      }).promise();
      
      if (businessData.Item) {
        restaurantLat = businessData.Item.latitude || businessData.Item.lat;
        restaurantLng = businessData.Item.longitude || businessData.Item.lng;
        console.log(`✅ Found restaurant coordinates: (${restaurantLat}, ${restaurantLng})`);
      } else {
        console.warn(`⚠️ Restaurant not found in Businesses table: ${businessId}`);
      }
    } catch (error) {
      console.error(`❌ Error fetching restaurant data:`, error);
    }
  }
  
  // إذا لم نجد الإحداثيات، نستخدم قيمة افتراضية (النجف)
  if (!restaurantLat || !restaurantLng) {
    console.warn(`⚠️ Using default Najaf coordinates for restaurant`);
    restaurantLat = 31.9996;
    restaurantLng = 44.3254;
  }
  
  // ========================================
  // Step 3: حساب المسافة والوقت المقدر
  // ========================================
  const distanceKm = calculateDistance(
    restaurantLat,
    restaurantLng,
    order.deliveryAddress.lat,
    order.deliveryAddress.lng
  );
  
  const estimatedMinutes = Math.ceil(distanceKm * 5); // تقريباً 5 دقائق لكل كيلومتر
  
  console.log(`📏 Distance: ${distanceKm.toFixed(2)} km, Estimated time: ${estimatedMinutes} min`);
  
  // ========================================
  // Step 4: إنشاء DispatchJob ID
  // ========================================
  const timestamp = Date.now();
  const dispatchJobId = `DISPATCH_${order.orderId}_${timestamp}`;
  
  // ========================================
  // Step 5: بناء DispatchJob object
  // ========================================
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + DISPATCH_TIMEOUT_MINUTES * 60 * 1000).toISOString();
  
  const rawTotal = toNumber(order.total ?? order.totalAmount ?? 0);
  const verifiedMinorPricing = order.currency === 'IQD' && order.createdBy === 'wizzuser_app';
  const readPricing = (field, fallback) => order.pricing?.[field] != null
    ? (verifiedMinorPricing ? toNumber(order.pricing[field]) / 1000 : normalizeMoneyToIqd(order.pricing[field], rawTotal))
    : toNumber(fallback);
  const normalizedOrderTotal = readPricing('total', rawTotal);
  const normalizedHoldRequiredAmount = readPricing('goodsSubtotal', order.subtotal);
  const normalizedDeliveryFee = readPricing('deliveryFee', order.deliveryFee);

  const dispatchJob = {
    orderId: order.orderId,        // Primary Key (HASH) - matches table schema
    SK: 'METADATA',                 // Sort Key (RANGE) - matches table schema
    
    // معلومات أساسية
    dispatchJobId: dispatchJobId,
    financialDispatch: Object.prototype.hasOwnProperty.call(order, 'financialSnapshot'),
    orderNumber: order.orderNumber || null,
    
    // حالة البحث
    status: 'searching',
    currentWaveNumber: 0,
    maxWaves: MAX_WAVES,
    waveSize: WAVE_SIZE,
    
    // أوقات
    createdAt: now,
    updatedAt: now,
    expiresAt: expiresAt,
    
    // معلومات المطعم (من WizzOrders + Businesses table)
    restaurantId: businessId,
    restaurantName: businessName,
    restaurantAddress: restaurantAddress,
    restaurantRegionId: pickupRegionId || order.restaurantRegionId || null, // ✅ من pickupRegionId أو restaurantRegionId
    restaurantLat: restaurantLat,
    restaurantLng: restaurantLng,
    
    // معلومات التوصيل (من WizzOrders)
    deliveryRegionId: order.deliveryAddress.regionId || null,
    deliveryLat: order.deliveryAddress.lat,
    deliveryLng: order.deliveryAddress.lng,
    deliveryAddress: order.deliveryAddress.address || order.deliveryAddress.fullAddress || JSON.stringify(order.deliveryAddress),
    
    // معلومات مالية
    orderTotal: normalizedOrderTotal,
    holdRequiredAmount: normalizedHoldRequiredAmount,
    currency: order.currency || 'IQD',
    deliveryFee: normalizedDeliveryFee,
    
    // معلومات الزبون
    customerName: order.customerName || '',
    customerPhone: order.customerPhone || '',
    
    // معلومات محسوبة
    distanceKm: distanceKm,
    estimatedMinutes: estimatedMinutes,
    
    // الإسناد (فارغ في البداية)
    assignedDriverId: null,
    assignedAt: null,
    noDriverReason: null,
    
    // السائقون المستبعدون (للـ reassignment بعد unassign)
    excludedDrivers: excludedDrivers || [],
    
    // معلومات إضافية من الطلب (اختياري)
    items: order.items || [],
    itemsCount: order.items?.length || 0,
    deliveryInstructions: order.deliveryInstructions || null,
    notes: order.notes || null,
    storeImage: order.storeImage || null
  };
  
  console.log(`📝 DispatchJob created:`, {
    dispatchJobId,
    orderId: order.orderId,
    restaurantRegionId: pickupRegionId || order.restaurantRegionId,
    distanceKm,
    estimatedMinutes
  });
  
  // ========================================
  // Step 6: حفظ في DynamoDB
  // ========================================
  await dynamodb.put({
    TableName: DISPATCH_JOBS_TABLE,
    Item: dispatchJob
  }).promise();
  
  console.log(`✅ DispatchJob saved to ${DISPATCH_JOBS_TABLE}`);
  
  // ========================================
  // Step 7: تحديث WizzOrders بـ deliveryJobId
  // ========================================
  await dynamodb.update({
    TableName: ORDERS_TABLE,
    Key: {
      PK: `ORDER#${order.orderId}`,
      SK: 'META'
    },
    UpdateExpression: 'SET deliveryJobId = :jobId, updatedAt = :now',
    ExpressionAttributeValues: {
      ':jobId': dispatchJobId,
      ':now': now
    }
  }).promise();
  
  console.log(`✅ Order ${order.orderId} updated with deliveryJobId`);
  
  // ========================================
  // Step 8: استدعاء StartWave Lambda
  // ========================================
  await invokeStartWaveLambda(dispatchJob);
  
  console.log(`🌊 StartWave Lambda invoked for ${dispatchJobId}`);
  
  return dispatchJob;
}

// ============================================
// حساب المسافة بين نقطتين (Haversine formula)
// ============================================
function calculateDistance(lat1, lon1, lat2, lon2) {
  
  const R = 6371; // نصف قطر الأرض بالكيلومتر
  
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;
  
  return distance;
}

function toRad(degrees) {
  return degrees * (Math.PI / 180);
}

// ============================================
// استدعاء StartWave Lambda
// ============================================
async function invokeStartWaveLambda(dispatchJob) {
  
  const payload = {
    dispatchJobId: dispatchJob.dispatchJobId,
    orderId: dispatchJob.orderId,
    waveNumber: 1, // أول موجة
    restaurantRegionId: dispatchJob.restaurantRegionId, // محول من pickupRegionId
    restaurantLat: dispatchJob.restaurantLat,
    restaurantLng: dispatchJob.restaurantLng,
    excludeDriverIds: dispatchJob.excludedDrivers || [] // السائقون المستبعدون
  };
  
  console.log(`📤 Invoking ${START_WAVE_LAMBDA} with payload:`, payload);
  
  const params = {
    FunctionName: START_WAVE_LAMBDA,
    InvocationType: 'Event', // asynchronous invocation
    Payload: JSON.stringify(payload)
  };
  
  try {
    const result = await lambda.invoke(params).promise();
    console.log(`✅ StartWave Lambda invoked successfully:`, result.StatusCode);
  } catch (error) {
    console.error(`❌ Failed to invoke StartWave Lambda:`, error);
    throw error;
  }
}
