'use strict';
// Existing Legacy filter and ranking shared with the pinned-cycle adapter.
// Optional providers make new-cycle reads paginated/fail-closed; old callers retain their contract.
function createDriverSelection(options){
 const {dynamodb,DRIVER_LIVE_STATE_TABLE,MAX_DISTANCE_KM}=options;
 const console=options.console??globalThis.console;
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
  const filterStats = {
    total: driversInRegion.length,
    excludedPermanent: 0,
    excludedTemporary: 0,
    notAvailable: 0,
    notSearching: 0,
    missingConnectionId: 0,
    badConnectionStatus: 0,
    missingAllowedRegions: 0,
    passed: 0,
  };

  const availableDrivers = driversInRegion.filter(driver => {
    // 🚫 استبعاد دائم: السائقين الذين ألغوا الطلب بعد القبول (driver unassignment)
    // يُستبعدون من **جميع الموجات** دائماً (لا فرصة ثانية)
    if (Array.isArray(excludeDriverIds) && excludeDriverIds.includes(driver.driverId)) {
      console.log(`   🚫 Skipping driver ${driver.driverId} (⛔ PERMANENTLY EXCLUDED - unassigned after acceptance)`);
      filterStats.excludedPermanent++;
      return false;
    }

    // ⏳ استبعاد مؤقت: السائقين الذين رفضوا أو لم يردوا في موجات سابقة
    // الموجات 1-3: يُستبعدون (استبعاد مؤقت)
    // الموجات 4-5: يُعاد إرسال الطلب لهم (فرصة ثانية + بونص)
    if (!isEmergencyWave && waveNumber < (waveThresholds.REOFFER_FROM_WAVE ?? 4) && Array.isArray(rejectedDriverIds) && rejectedDriverIds.includes(driver.driverId)) {
      console.log(`   ⏳ Skipping driver ${driver.driverId} temporarily (rejected/no-response in wave 1-${waveNumber-1}, will retry in wave 4+)`);
      filterStats.excludedTemporary++;
      return false;
    }

    // ✅ في الموجات 4-5: نُرسل للسائقين الذين رفضوا/لم يردوا مرة أخرى (فرصة ثانية)
    if ((waveNumber >= (waveThresholds.REOFFER_FROM_WAVE ?? 4) || isEmergencyWave) && Array.isArray(rejectedDriverIds) && rejectedDriverIds.includes(driver.driverId)) {
      console.log(`   🔄 Re-including driver ${driver.driverId} (SECOND CHANCE in wave ${waveNumber}/${isEmergencyWave ? 'EMERGENCY' : 'FINAL'})`);
      // لا نستبعده - نعطيه فرصة ثانية
    }

    const isAvailable = driver.status === 'available';
    const isSearching = driver.isSearching === true;

    if (!isAvailable) {
      filterStats.notAvailable++;
    }
    if (!isSearching) {
      filterStats.notSearching++;
    }

    const hasConnectionId = Boolean(driver.connectionId);
    if (!hasConnectionId) {
      filterStats.missingConnectionId++;
    }

    // ✅ Compatibility: some environments use 'active' instead of 'connected'
    const connectionStatus = String(driver.connectionStatus || '').trim().toLowerCase();
    const hasGoodConnectionStatus = connectionStatus === 'connected' || connectionStatus === 'active' || connectionStatus === '';
    if (hasConnectionId && !hasGoodConnectionStatus) {
      filterStats.badConnectionStatus++;
    }

    const hasConnection = hasConnectionId && hasGoodConnectionStatus;

    // 🆕 فحص أولويات المناطق حسب الموجة
    let hasRegionWithPriority = false;

    // ⚡ الموجة الطارئة: تقبل جميع المناطق
    if (isEmergencyWave) {
      hasRegionWithPriority = true;
    }
    // 🎯 Wave 1: فقط priority0 (الأقرب)
    else if (waveNumber === 1) {
      if (Array.isArray(driver.allowed_region_ids_priority0) && driver.allowed_region_ids_priority0.includes(restaurantRegionId)) {
        hasRegionWithPriority = true;
      } else if (driver.current_work_region_id === restaurantRegionId) {
        // Fallback: if allowed_region_ids_priority0 missing, use current region match
        hasRegionWithPriority = true;
      }
    }
    // 🌊 Wave 2-4: جميع المناطق المسموحة (priority0 + priority1)
    else {
      if (Array.isArray(driver.allowed_region_ids) && driver.allowed_region_ids.includes(restaurantRegionId)) {
        hasRegionWithPriority = true;
      } else if (driver.current_work_region_id === restaurantRegionId) {
        // Fallback: if allowed_region_ids missing, use current region match
        hasRegionWithPriority = true;
      }
    }

    if (!hasRegionWithPriority) {
      filterStats.missingAllowedRegions++;
    }

    const passed = isAvailable && isSearching && hasConnection && hasRegionWithPriority;
    if (passed) {
      filterStats.passed++;
    }

    return passed;
  });

  console.log(`🔗 ${availableDrivers.length} drivers are available and connected`);
  console.log(`📊 Driver filter diagnostics (wave ${waveNumber}):`, filterStats);

  if (availableDrivers.length === 0) {
    return [];
  }

  // المرحلة 3: حساب المسافة والفلترة (حسب معايير الموجة)
  const driversWithDistance = availableDrivers
    .map(driver => {
      // ✅ استخدام lat/lng بدلاً من gpsLatitude/gpsLongitude
      if (waveThresholds.STRICT_COORDINATES ? (!Number.isFinite(driver.lat) || Math.abs(driver.lat)>90 || !Number.isFinite(driver.lng) || Math.abs(driver.lng)>180) : (!driver.lat || !driver.lng)) {
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
      if ((waveThresholds.MISSING_HISTORY !== 'NOT_EXEMPT' || driver.metricsSnapshot_totalTrips != null) && totalTrips < (waveThresholds.NEW_DRIVER_BELOW_TRIPS ?? 5)) {
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
  driversWithScores.sort((a, b) => b.scores.total - a.scores.total || (waveThresholds.DETERMINISTIC_TIES ? (a.driverId<b.driverId?-1:a.driverId>b.driverId?1:0) : 0));

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
  if(options.queryDriversByRegion)return options.queryDriversByRegion(regionId);
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
  if(options.queryAllAvailableDrivers)return options.queryAllAvailableDrivers();
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

return {getQualifiedDrivers,calculateRegionScore,calculateDistanceScore,calculatePerformanceScore,calculateDistance};
}
module.exports={createDriverSelection};
