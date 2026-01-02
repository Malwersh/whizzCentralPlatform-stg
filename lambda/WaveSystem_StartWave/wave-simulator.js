/**
 * Wave System Simulator
 * 
 * محاكاة شاملة لنظام الموجات مع سائقين متعددين في مواقع ومناطق مختلفة
 * لاختبار جميع معايير الاختيار والترتيب
 */

const AWS = require('aws-sdk');
const dynamodb = new AWS.DynamoDB.DocumentClient();

// =====================================
// المعايير من StartWave
// =====================================
const WAVE_SIZE = 5;
const MAX_DISTANCE_KM = 20;
const MIN_ACCEPTANCE_RATE = 0.6;
const MIN_COMPLETION_RATE = 0.8;
const MAX_CONSECUTIVE_REJECTIONS = 3;

// =====================================
// المناطق الحقيقية من النظام
// =====================================
const REGIONS = {
  najaf_abuskheer: 'Rmhvcpnn3iy5f1',      // أبو صخير - النجف
  najaf_center: 'Rmhveqa2vrrj13',         // مركز النجف
  najaf_district: 'Rmhvc7snfyul1f',       // حي في النجف
  najaf_governorate: 'Rmhv8s11vr0sxq'    // محافظة النجف
};

// =====================================
// سيناريوهات السائقين للاختبار
// =====================================
const DRIVER_SCENARIOS = [
  // ===== السيناريو 1: السائق المثالي =====
  {
    driverId: 'TEST_DRIVER_PERFECT_001',
    name: 'سائق مثالي - نفس المنطقة',
    status: 'available',
    isSearching: true,
    connectionStatus: 'connected',
    connectionId: 'MOCK_CONNECTION_001',
    
    // الموقع: قريب جداً من المطعم (0.5 كم)
    lat: 31.915,
    lng: 44.476,
    
    // المناطق
    home_region_id: REGIONS.najaf_abuskheer,
    current_work_region_id: REGIONS.najaf_abuskheer,
    parent_district_id: REGIONS.najaf_district,
    governorate_id: REGIONS.najaf_governorate,
    allowed_region_ids: [REGIONS.najaf_abuskheer, REGIONS.najaf_center],
    allowed_region_ids_priority0: [REGIONS.najaf_abuskheer, REGIONS.najaf_center],
    allowed_region_ids_priority1: [],
    
    // الأداء: ممتاز
    metricsSnapshot_acceptanceRate: 0.95,
    metricsSnapshot_completionRate: 0.98,
    metricsSnapshot_consecutiveRejections: 0,
    metricsSnapshot_totalTrips: 150,
    metricsSnapshot_totalOffersWindow: 200,
    rating: 4.8,
    
    activeOrdersCount: 0,
    currentOrderId: null,
    currentWaveOfferId: null,
    isActive: true,
    region_mode: 'home'
  },

  // ===== السيناريو 2: سائق جديد =====
  {
    driverId: 'TEST_DRIVER_NEWBIE_002',
    name: 'سائق جديد - بدون تاريخ',
    status: 'available',
    isSearching: true,
    connectionStatus: 'connected',
    connectionId: 'MOCK_CONNECTION_002',
    
    // الموقع: قريب (1 كم)
    lat: 31.916,
    lng: 44.478,
    
    // المناطق
    home_region_id: REGIONS.najaf_abuskheer,
    current_work_region_id: REGIONS.najaf_abuskheer,
    parent_district_id: REGIONS.najaf_district,
    governorate_id: REGIONS.najaf_governorate,
    allowed_region_ids: [REGIONS.najaf_abuskheer],
    allowed_region_ids_priority0: [REGIONS.najaf_abuskheer],
    allowed_region_ids_priority1: [],
    
    // الأداء: جديد (< 5 رحلات) - يُقبل تلقائياً
    metricsSnapshot_acceptanceRate: 0,
    metricsSnapshot_completionRate: 0,
    metricsSnapshot_consecutiveRejections: 0,
    metricsSnapshot_totalTrips: 2,
    metricsSnapshot_totalOffersWindow: 3,
    rating: 0,
    
    activeOrdersCount: 0,
    currentOrderId: null,
    currentWaveOfferId: null,
    isActive: true,
    region_mode: 'home'
  },

  // ===== السيناريو 3: سائق بعيد لكن أداء ممتاز =====
  {
    driverId: 'TEST_DRIVER_FAR_EXCELLENT_003',
    name: 'سائق بعيد - أداء ممتاز',
    status: 'available',
    isSearching: true,
    connectionStatus: 'connected',
    connectionId: 'MOCK_CONNECTION_003',
    
    // الموقع: بعيد (15 كم)
    lat: 32.000,
    lng: 44.600,
    
    // المناطق
    home_region_id: REGIONS.najaf_center,
    current_work_region_id: REGIONS.najaf_abuskheer, // يعمل خارج منطقته
    parent_district_id: REGIONS.najaf_district,
    governorate_id: REGIONS.najaf_governorate,
    allowed_region_ids: [REGIONS.najaf_center, REGIONS.najaf_abuskheer],
    allowed_region_ids_priority0: [REGIONS.najaf_center],
    allowed_region_ids_priority1: [REGIONS.najaf_abuskheer],
    
    // الأداء: ممتاز رغم البعد
    metricsSnapshot_acceptanceRate: 0.92,
    metricsSnapshot_completionRate: 0.96,
    metricsSnapshot_consecutiveRejections: 0,
    metricsSnapshot_totalTrips: 200,
    metricsSnapshot_totalOffersWindow: 220,
    rating: 4.9,
    
    activeOrdersCount: 0,
    currentOrderId: null,
    currentWaveOfferId: null,
    isActive: true,
    region_mode: 'working'
  },

  // ===== السيناريو 4: سائق قريب لكن أداء ضعيف =====
  {
    driverId: 'TEST_DRIVER_NEAR_POOR_004',
    name: 'سائق قريب - أداء ضعيف',
    status: 'available',
    isSearching: true,
    connectionStatus: 'connected',
    connectionId: 'MOCK_CONNECTION_004',
    
    // الموقع: قريب (2 كم)
    lat: 31.920,
    lng: 44.480,
    
    // المناطق
    home_region_id: REGIONS.najaf_abuskheer,
    current_work_region_id: REGIONS.najaf_abuskheer,
    parent_district_id: REGIONS.najaf_district,
    governorate_id: REGIONS.najaf_governorate,
    allowed_region_ids: [REGIONS.najaf_abuskheer],
    allowed_region_ids_priority0: [REGIONS.najaf_abuskheer],
    allowed_region_ids_priority1: [],
    
    // الأداء: ضعيف - يُرفض
    metricsSnapshot_acceptanceRate: 0.45, // < 0.6
    metricsSnapshot_completionRate: 0.70, // < 0.8
    metricsSnapshot_consecutiveRejections: 5, // > 3
    metricsSnapshot_totalTrips: 80,
    metricsSnapshot_totalOffersWindow: 120,
    rating: 3.2,
    
    activeOrdersCount: 0,
    currentOrderId: null,
    currentWaveOfferId: null,
    isActive: true,
    region_mode: 'home'
  },

  // ===== السيناريو 5: سائق غير متصل =====
  {
    driverId: 'TEST_DRIVER_OFFLINE_005',
    name: 'سائق غير متصل',
    status: 'available',
    isSearching: true,
    connectionStatus: 'disconnected', // ❌ غير متصل
    connectionId: null,
    
    // الموقع: قريب
    lat: 31.917,
    lng: 44.477,
    
    // المناطق
    home_region_id: REGIONS.najaf_abuskheer,
    current_work_region_id: REGIONS.najaf_abuskheer,
    parent_district_id: REGIONS.najaf_district,
    governorate_id: REGIONS.najaf_governorate,
    allowed_region_ids: [REGIONS.najaf_abuskheer],
    allowed_region_ids_priority0: [REGIONS.najaf_abuskheer],
    allowed_region_ids_priority1: [],
    
    // الأداء: جيد لكن غير متصل
    metricsSnapshot_acceptanceRate: 0.88,
    metricsSnapshot_completionRate: 0.92,
    metricsSnapshot_consecutiveRejections: 0,
    metricsSnapshot_totalTrips: 100,
    metricsSnapshot_totalOffersWindow: 115,
    rating: 4.5,
    
    activeOrdersCount: 0,
    currentOrderId: null,
    currentWaveOfferId: null,
    isActive: false, // غير نشط
    region_mode: 'home'
  },

  // ===== السيناريو 6: سائق مشغول =====
  {
    driverId: 'TEST_DRIVER_BUSY_006',
    name: 'سائق مشغول - لديه طلب حالي',
    status: 'busy', // ❌ مشغول
    isSearching: false,
    connectionStatus: 'connected',
    connectionId: 'MOCK_CONNECTION_006',
    
    // الموقع: قريب
    lat: 31.918,
    lng: 44.479,
    
    // المناطق
    home_region_id: REGIONS.najaf_abuskheer,
    current_work_region_id: REGIONS.najaf_abuskheer,
    parent_district_id: REGIONS.najaf_district,
    governorate_id: REGIONS.najaf_governorate,
    allowed_region_ids: [REGIONS.najaf_abuskheer],
    allowed_region_ids_priority0: [REGIONS.najaf_abuskheer],
    allowed_region_ids_priority1: [],
    
    // الأداء: ممتاز
    metricsSnapshot_acceptanceRate: 0.90,
    metricsSnapshot_completionRate: 0.94,
    metricsSnapshot_consecutiveRejections: 0,
    metricsSnapshot_totalTrips: 120,
    metricsSnapshot_totalOffersWindow: 135,
    rating: 4.7,
    
    activeOrdersCount: 1,
    currentOrderId: 'MOCK_ORDER_123',
    currentWaveOfferId: null,
    isActive: true,
    region_mode: 'home'
  },

  // ===== السيناريو 7: سائق خارج النطاق =====
  {
    driverId: 'TEST_DRIVER_OUT_OF_RANGE_007',
    name: 'سائق بعيد جداً - خارج النطاق',
    status: 'available',
    isSearching: true,
    connectionStatus: 'connected',
    connectionId: 'MOCK_CONNECTION_007',
    
    // الموقع: بعيد جداً (> 20 كم)
    lat: 32.200,
    lng: 45.000,
    
    // المناطق
    home_region_id: REGIONS.najaf_center,
    current_work_region_id: REGIONS.najaf_center,
    parent_district_id: REGIONS.najaf_district,
    governorate_id: REGIONS.najaf_governorate,
    allowed_region_ids: [REGIONS.najaf_center],
    allowed_region_ids_priority0: [REGIONS.najaf_center],
    allowed_region_ids_priority1: [],
    
    // الأداء: جيد لكن بعيد جداً
    metricsSnapshot_acceptanceRate: 0.85,
    metricsSnapshot_completionRate: 0.90,
    metricsSnapshot_consecutiveRejections: 0,
    metricsSnapshot_totalTrips: 90,
    metricsSnapshot_totalOffersWindow: 105,
    rating: 4.4,
    
    activeOrdersCount: 0,
    currentOrderId: null,
    currentWaveOfferId: null,
    isActive: true,
    region_mode: 'home'
  },

  // ===== السيناريو 8: سائق Priority 1 =====
  {
    driverId: 'TEST_DRIVER_PRIORITY1_008',
    name: 'سائق Priority 1 - منطقة مجاورة',
    status: 'available',
    isSearching: true,
    connectionStatus: 'connected',
    connectionId: 'MOCK_CONNECTION_008',
    
    // الموقع: قريب (3 كم)
    lat: 31.922,
    lng: 44.485,
    
    // المناطق
    home_region_id: REGIONS.najaf_center,
    current_work_region_id: REGIONS.najaf_center,
    parent_district_id: REGIONS.najaf_district,
    governorate_id: REGIONS.najaf_governorate,
    allowed_region_ids: [REGIONS.najaf_center, REGIONS.najaf_abuskheer],
    allowed_region_ids_priority0: [REGIONS.najaf_center],
    allowed_region_ids_priority1: [REGIONS.najaf_abuskheer], // Priority 1 للمنطقة
    
    // الأداء: جيد جداً
    metricsSnapshot_acceptanceRate: 0.87,
    metricsSnapshot_completionRate: 0.91,
    metricsSnapshot_consecutiveRejections: 0,
    metricsSnapshot_totalTrips: 110,
    metricsSnapshot_totalOffersWindow: 125,
    rating: 4.6,
    
    activeOrdersCount: 0,
    currentOrderId: null,
    currentWaveOfferId: null,
    isActive: true,
    region_mode: 'working'
  }
];

// =====================================
// معلومات الطلب التجريبي
// =====================================
const MOCK_ORDER = {
  orderId: 'TEST_ORDER_' + Date.now(),
  restaurantId: 'business_1756336745961_ywix4oy9aa',
  restaurantName: 'ماكدونالد أبوصخير',
  restaurantRegionId: REGIONS.najaf_abuskheer,
  restaurantLat: 31.914931, // موقع المطعم الفعلي
  restaurantLng: 44.476529,
  deliveryLat: 31.904650,
  deliveryLng: 44.489596,
  distanceKm: 2.28,
  orderTotal: 26010000, // 26,010 IQD
  deliveryFee: 10000, // 10,000 IQD
  currency: 'IQD'
};

// =====================================
// دوال حساب النقاط (نفس StartWave)
// =====================================
function calculateRegionScore(driver, restaurantRegionId) {
  if (restaurantRegionId === driver.home_region_id) {
    return 25;
  }
  if (driver.allowed_region_ids_priority0?.includes(restaurantRegionId)) {
    return 20;
  }
  if (driver.allowed_region_ids_priority1?.includes(restaurantRegionId)) {
    return 10;
  }
  return 0;
}

function calculateDistanceScore(distance, maxDistance) {
  const score = 30 * (1 - (distance / maxDistance));
  return Math.max(0, score);
}

function calculatePerformanceScore(driver) {
  const acceptanceRate = driver.metricsSnapshot_acceptanceRate ?? 1.0;
  const completionRate = driver.metricsSnapshot_completionRate ?? 1.0;
  const consecutiveRejections = driver.metricsSnapshot_consecutiveRejections ?? 0;
  const rating = driver.rating ?? 4.5;

  const acceptanceScore = acceptanceRate * 20;
  const completionScore = completionRate * 20;
  const ratingScore = Math.max(0, (rating - 4.0) * 5);
  const rejectionPenalty = consecutiveRejections * 10;

  const totalPerformance = acceptanceScore + completionScore + ratingScore - rejectionPenalty;
  return Math.max(0, totalPerformance);
}

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// =====================================
// المحاكاة الرئيسية
// =====================================
function simulateWaveSystem() {
  console.log('\n' + '='.repeat(80));
  console.log('🌊 WAVE SYSTEM SIMULATOR - اختبار شامل');
  console.log('='.repeat(80));
  
  console.log('\n📋 معلومات الطلب:');
  console.log(`   Order ID: ${MOCK_ORDER.orderId}`);
  console.log(`   المطعم: ${MOCK_ORDER.restaurantName}`);
  console.log(`   المنطقة: ${MOCK_ORDER.restaurantRegionId}`);
  console.log(`   الموقع: (${MOCK_ORDER.restaurantLat}, ${MOCK_ORDER.restaurantLng})`);
  console.log(`   المسافة: ${MOCK_ORDER.distanceKm} كم`);
  console.log(`   قيمة التوصيل: ${MOCK_ORDER.deliveryFee} IQD`);
  
  console.log(`\n👥 عدد السائقين المتاحين للاختبار: ${DRIVER_SCENARIOS.length}`);
  console.log('─'.repeat(80));

  // المرحلة 1: فلترة السائقين المتصلين والمتاحين
  console.log('\n🔍 المرحلة 1: فلترة السائقين المتصلين والمتاحين');
  const availableDrivers = DRIVER_SCENARIOS.filter(driver => {
    const isAvailable = driver.status === 'available';
    const isSearching = driver.isSearching === true;
    const hasConnection = driver.connectionId && driver.connectionStatus === 'connected';
    const hasRegion = (
      (driver.allowed_region_ids && driver.allowed_region_ids.includes(MOCK_ORDER.restaurantRegionId)) ||
      (driver.allowed_region_ids_priority0 && driver.allowed_region_ids_priority0.includes(MOCK_ORDER.restaurantRegionId)) ||
      (driver.allowed_region_ids_priority1 && driver.allowed_region_ids_priority1.includes(MOCK_ORDER.restaurantRegionId))
    );

    const passed = isAvailable && isSearching && hasConnection && hasRegion;
    
    console.log(`   ${passed ? '✅' : '❌'} ${driver.name} (${driver.driverId})`);
    if (!passed) {
      const reasons = [];
      if (!isAvailable) reasons.push('status != available');
      if (!isSearching) reasons.push('!isSearching');
      if (!hasConnection) reasons.push('!connected');
      if (!hasRegion) reasons.push('!in_region');
      console.log(`      ⚠️  أسباب الرفض: ${reasons.join(', ')}`);
    }
    
    return passed;
  });

  console.log(`\n📊 النتيجة: ${availableDrivers.length} سائق متاح ومتصل`);
  
  if (availableDrivers.length === 0) {
    console.log('\n❌ لا يوجد سائقين متاحين للمتابعة');
    return;
  }

  // المرحلة 2: حساب المسافة والفلترة
  console.log('\n🔍 المرحلة 2: حساب المسافة والفلترة (MAX: 20 كم)');
  const driversWithDistance = availableDrivers
    .map(driver => {
      if (!driver.lat || !driver.lng) {
        console.log(`   ⚠️  ${driver.name}: موقع مفقود`);
        return null;
      }

      const distance = calculateDistance(
        MOCK_ORDER.restaurantLat, MOCK_ORDER.restaurantLng,
        driver.lat, driver.lng
      );

      const passed = distance <= MAX_DISTANCE_KM;
      console.log(`   ${passed ? '✅' : '❌'} ${driver.name}: ${distance.toFixed(2)} كم`);
      
      return { ...driver, distance };
    })
    .filter(driver => driver !== null && driver.distance <= MAX_DISTANCE_KM);

  console.log(`\n📊 النتيجة: ${driversWithDistance.length} سائق ضمن النطاق`);
  
  if (driversWithDistance.length === 0) {
    console.log('\n❌ لا يوجد سائقين ضمن النطاق');
    return;
  }

  // المرحلة 3: فلترة الأداء
  console.log('\n🔍 المرحلة 3: فلترة الأداء');
  console.log(`   المعايير: Acceptance ≥ ${MIN_ACCEPTANCE_RATE}, Completion ≥ ${MIN_COMPLETION_RATE}, Rejections ≤ ${MAX_CONSECUTIVE_REJECTIONS}`);
  
  const performanceFiltered = driversWithDistance.filter(driver => {
    const acceptanceRate = driver.metricsSnapshot_acceptanceRate ?? null;
    const completionRate = driver.metricsSnapshot_completionRate ?? null;
    const consecutiveRejections = driver.metricsSnapshot_consecutiveRejections ?? 0;
    const totalTrips = driver.metricsSnapshot_totalTrips ?? 0;

    // سائق جديد: يُقبل تلقائياً
    if (totalTrips < 5) {
      console.log(`   ✅ ${driver.name}: سائق جديد (${totalTrips} رحلات) - قُبل تلقائياً`);
      return true;
    }

    // سائق ذو خبرة: فحص الأداء
    const acceptancePass = acceptanceRate >= MIN_ACCEPTANCE_RATE;
    const completionPass = completionRate >= MIN_COMPLETION_RATE;
    const rejectionsPass = consecutiveRejections <= MAX_CONSECUTIVE_REJECTIONS;
    const passed = acceptancePass && completionPass && rejectionsPass;
    
    console.log(`   ${passed ? '✅' : '❌'} ${driver.name}:`);
    console.log(`      Acceptance: ${(acceptanceRate * 100).toFixed(0)}% ${acceptancePass ? '✅' : '❌'}`);
    console.log(`      Completion: ${(completionRate * 100).toFixed(0)}% ${completionPass ? '✅' : '❌'}`);
    console.log(`      Rejections: ${consecutiveRejections} ${rejectionsPass ? '✅' : '❌'}`);
    
    return passed;
  });

  console.log(`\n📊 النتيجة: ${performanceFiltered.length} سائق يحقق معايير الأداء`);
  
  if (performanceFiltered.length === 0) {
    console.log('\n❌ لا يوجد سائقين يحققون معايير الأداء');
    return;
  }

  // المرحلة 4: حساب النقاط والترتيب
  console.log('\n🔍 المرحلة 4: حساب النقاط والترتيب');
  console.log('   معادلة النقاط: Region (0-25) + Distance (0-30) + Performance (0-45) = Total (0-100)');
  
  const driversWithScores = performanceFiltered.map(driver => {
    const regionScore = calculateRegionScore(driver, MOCK_ORDER.restaurantRegionId);
    const distanceScore = calculateDistanceScore(driver.distance, MAX_DISTANCE_KM);
    const performanceScore = calculatePerformanceScore(driver);
    
    const totalScore = regionScore + distanceScore + performanceScore;

    console.log(`\n   📊 ${driver.name}:`);
    console.log(`      Region: ${regionScore.toFixed(1)} | Distance: ${distanceScore.toFixed(1)} | Performance: ${performanceScore.toFixed(1)}`);
    console.log(`      Total: ${totalScore.toFixed(1)} نقطة | المسافة: ${driver.distance.toFixed(2)} كم`);

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

  // المرحلة 5: اختيار أفضل 5 سائقين
  const selectedDrivers = driversWithScores.slice(0, WAVE_SIZE);
  
  console.log('\n' + '='.repeat(80));
  console.log('🏆 النتيجة النهائية - أفضل 5 سائقين تم اختيارهم للموجة:');
  console.log('='.repeat(80));
  
  selectedDrivers.forEach((driver, index) => {
    console.log(`\n🥇 المركز #${index + 1}: ${driver.name}`);
    console.log(`   Driver ID: ${driver.driverId}`);
    console.log(`   المسافة: ${driver.distance.toFixed(2)} كم`);
    console.log(`   النقاط الكلية: ${driver.scores.total.toFixed(1)}`);
    console.log(`   ├─ Region: ${driver.scores.region} (${driver.home_region_id === MOCK_ORDER.restaurantRegionId ? 'Home' : 'Priority'})`);
    console.log(`   ├─ Distance: ${driver.scores.distance.toFixed(1)}`);
    console.log(`   └─ Performance: ${driver.scores.performance.toFixed(1)}`);
    console.log(`   الأداء: Accept ${(driver.metricsSnapshot_acceptanceRate * 100).toFixed(0)}% | Complete ${(driver.metricsSnapshot_completionRate * 100).toFixed(0)}% | Rating ${driver.rating}`);
  });

  console.log('\n' + '='.repeat(80));
  console.log('✅ انتهت المحاكاة بنجاح');
  console.log('='.repeat(80) + '\n');
}

// =====================================
// دالة إضافة السائقين للنظام الحقيقي
// =====================================
async function addTestDriversToSystem() {
  console.log('\n🚀 إضافة السائقين التجريبيين إلى WizzDriverLiveState...\n');
  
  for (const driver of DRIVER_SCENARIOS) {
    try {
      await dynamodb.put({
        TableName: 'WizzDriverLiveState',
        Item: {
          ...driver,
          lastUpdated: new Date().toISOString(),
          locationUpdatedAt: new Date().toISOString(),
          lastConnected: new Date().toISOString(),
          lastOnlineAt: new Date().toISOString(),
          searchStartedAt: new Date().toISOString(),
          shiftStartTime: new Date().toISOString()
        }
      }).promise();
      
      console.log(`✅ تمت إضافة: ${driver.name}`);
    } catch (error) {
      console.error(`❌ خطأ في إضافة ${driver.name}:`, error.message);
    }
  }
  
  console.log('\n✅ تمت إضافة جميع السائقين التجريبيين\n');
}

// =====================================
// دالة حذف السائقين التجريبيين
// =====================================
async function removeTestDriversFromSystem() {
  console.log('\n🗑️  حذف السائقين التجريبيين من WizzDriverLiveState...\n');
  
  for (const driver of DRIVER_SCENARIOS) {
    try {
      await dynamodb.delete({
        TableName: 'WizzDriverLiveState',
        Key: {
          driverId: driver.driverId
        }
      }).promise();
      
      console.log(`✅ تم حذف: ${driver.name}`);
    } catch (error) {
      console.error(`❌ خطأ في حذف ${driver.name}:`, error.message);
    }
  }
  
  console.log('\n✅ تم حذف جميع السائقين التجريبيين\n');
}

// =====================================
// تشغيل المحاكاة
// =====================================
const args = process.argv.slice(2);
const command = args[0];

if (command === 'add') {
  addTestDriversToSystem();
} else if (command === 'remove') {
  removeTestDriversFromSystem();
} else if (command === 'simulate') {
  simulateWaveSystem();
} else if (command === 'test') {
  // اختبار مع طلب حقيقي
  console.log('\n🧪 وضع الاختبار مع النظام الحقيقي\n');
  console.log('الخطوات:');
  console.log('1. تأكد من إضافة السائقين: node wave-simulator.js add');
  console.log('2. أنشئ طلب جديد من التطبيق');
  console.log('3. غيّر حالة الطلب إلى ready_for_pickup');
  console.log('4. راقب السجلات:');
  console.log('   aws logs tail /aws/lambda/WaveSystem_StartWave --profile Wizz_dev_UserApp --follow\n');
} else {
  console.log('\n📖 الاستخدام:');
  console.log('   node wave-simulator.js simulate  - تشغيل المحاكاة المحلية');
  console.log('   node wave-simulator.js add       - إضافة السائقين التجريبيين للنظام');
  console.log('   node wave-simulator.js remove    - حذف السائقين التجريبيين من النظام');
  console.log('   node wave-simulator.js test      - إرشادات الاختبار مع النظام الحقيقي\n');
}

// Export for testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DRIVER_SCENARIOS,
    MOCK_ORDER,
    REGIONS,
    calculateRegionScore,
    calculateDistanceScore,
    calculatePerformanceScore,
    calculateDistance
  };
}
