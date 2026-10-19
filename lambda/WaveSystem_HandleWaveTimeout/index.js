/**
 * WaveSystem_HandleWaveTimeout Lambda Function
 * 
 * Purpose: معالجة انتهاء مدة الموجة والانتقال للموجة التالية
 * 
 * Triggered by: EventBridge Schedule (every 30 seconds) or Direct Invocation
 * 
 * Flow:
 * 1. جلب جميع العروض المعلقة (pending) التي انتهت مدتها
 * 2. تحديث حالة العروض إلى expired
 * 3. إرسال إشعارات للسائقين
 * 4. جلب DispatchJobs للطلبات التي لم يتم إسنادها
 * 5. التحقق من إمكانية بدء موجة جديدة (Wave 2 أو 3)
 * 6. استبعاد السائقين من الموجات السابقة
 * 7. استدعاء StartWave للموجة الجديدة
 * 8. إذا وصلنا MAX_WAVES ولم يتم الإسناد → إشعار "no_driver_available"
 * 
 * Environment Variables:
 * - DISPATCH_JOBS_TABLE: WizzDispatchJobs_dev
 * - WAVE_OFFERS_TABLE: WaveOffers
 * - START_WAVE_LAMBDA: WaveSystem_StartWave
 * - WEBSOCKET_API_ENDPOINT: wss://lwk0wf6rpl.execute-api.us-east-1.amazonaws.com/production
 * - MAX_WAVES: 3
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
const WAVE_OFFERS_TABLE = requireNonEmptyEnv('WAVE_OFFERS_TABLE');
const START_WAVE_LAMBDA = process.env.START_WAVE_LAMBDA || 'WaveSystem_StartWave';

const apigateway = new AWS.ApiGatewayManagementApi({
  endpoint: getWebsocketManagementEndpoint()
});

const MAX_WAVES = parseInt(process.env.MAX_WAVES || '5'); // 4 موجات عادية + 1 موجة طوارئ
const EMERGENCY_WAVE_BONUS_PERCENTAGE = 0.25; // 25% بونص في الموجة الطارئة

// =====================================
// Main Handler
// =====================================
exports.handler = async (event, context) => {
  console.log('⏰ HandleWaveTimeout triggered:', JSON.stringify(event, null, 2));

  try {
    let hostSummary=null;
    if(process.env.DISPATCH_LEGACY_HOST_MODE==='REQUIRED')hostSummary=await require('./dispatch-cycle-runtime').runHostedLegacyTick(event,context,async selectors=>{
      const response=await lambda.invoke({FunctionName:START_WAVE_LAMBDA,InvocationType:'RequestResponse',Payload:JSON.stringify({orderId:selectors.orderId,dispatchJobId:selectors.assignmentId,cycleId:selectors.cycleId})}).promise();
      if(response.FunctionError)throw Error('DISPATCH_HOST_START_UNKNOWN');
      const result=JSON.parse(response.Payload||'{}');if(result.statusCode!==200)throw Error('DISPATCH_HOST_START_UNKNOWN');
      return result;
    });
    if(process.env.DISPATCH_FINANCIAL_HOST_MODE==='REQUIRED'){const financial=await require('./dispatch-cycle-runtime').runHostedFinancialTick(event,context,async selectors=>{const response=await lambda.invoke({FunctionName:START_WAVE_LAMBDA,InvocationType:'RequestResponse',Payload:JSON.stringify({orderId:selectors.orderId,dispatchJobId:selectors.assignmentId,cycleId:selectors.cycleId})}).promise();if(response.FunctionError)throw Error('DISPATCH_HOST_START_UNKNOWN');const result=JSON.parse(response.Payload||'{}');if(result.statusCode!==200)throw Error('DISPATCH_HOST_START_UNKNOWN');return result;});hostSummary={...(hostSummary?{legacy:hostSummary}:{}),financial};}
    const now = new Date().toISOString();
    
    // Step 1: جلب العروض المنتهية + الطلبات العالقة
    const expiredOffers = await getExpiredOffers();
    const stuckOrders = await getStuckOrders();
    
    console.log(`📋 Found ${expiredOffers.length} expired offer(s)`);
    console.log(`📋 Found ${stuckOrders.length} stuck order(s) (empty waves)`);
    
    if (expiredOffers.length === 0 && stuckOrders.length === 0) {
      console.log('✅ No expired offers found');
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'No expired offers to process',...(hostSummary?{host:hostSummary}:{}) })
      };
    }
    
    // Step 2: تجميع العروض حسب orderId
    const offersByOrder = groupOffersByOrder(expiredOffers);
    
    // Step 3: إضافة الطلبات العالقة (waves فارغة بدون offers)
    stuckOrders.forEach(order => {
      if (!offersByOrder[order.orderId]) {
        offersByOrder[order.orderId] = [];
      }
    });
    
    console.log(`📦 Processing ${Object.keys(offersByOrder).length} order(s)`);
    
    // Step 3: معالجة كل طلب
    const results = await Promise.all(
      Object.entries(offersByOrder).map(([orderId, offers]) => 
        processExpiredWave(orderId, offers, now)
      )
    );
    
    const summary = {
      ...(hostSummary?{host:hostSummary}:{}),
      totalOrders: results.length,
      offersExpired: results.reduce((sum, r) => sum + r.offersExpired, 0),
      nextWavesStarted: results.filter(r => r.nextWaveStarted).length,
      ordersCompleted: results.filter(r => r.noDriverAvailable).length
    };
    
    console.log('✅ Timeout processing complete:', summary);
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Wave timeouts processed successfully',
        summary
      })
    };
    
  } catch (error) {
    console.error('❌ Error in HandleWaveTimeout:', error);
    
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Internal server error',
        message: error.message
      })
    };
  }
};

// =====================================
// جلب العروض المنتهية
// =====================================
async function getExpiredOffers() {
  console.log('🔍 Scanning for expired pending offers...');
  
  const now = new Date().toISOString();
  
  // Scan WaveOffers للعروض المعلقة
  const result = await scanAll({
    TableName: WAVE_OFFERS_TABLE,
    FilterExpression: '(responseStatus = :pending OR responseStatus = :financial) AND expiresAt < :now',
    ExpressionAttributeValues: {
      ':pending': 'pending',
      ':financial': 'financial_pending',
      ':now': now
    }
  });
  
  return result.Items || [];
}

// =====================================
// جلب الطلبات العالقة (waves فارغة)
// =====================================
async function getStuckOrders() {
  console.log('🔍 Scanning for stuck orders (empty waves)...');
  
  const now = new Date();
  const cutoffTime = new Date(now.getTime() - 90000); // 90 ثانية
  
  // Scan DispatchJobs للطلبات في حالة searching
  const result = await scanAll({
    TableName: DISPATCH_JOBS_TABLE,
    FilterExpression: '#status = :searching AND #sk = :metadata AND (attribute_exists(dispatchCycle) OR (financialDispatch = :financial AND attribute_exists(financialRedispatch)) OR (financialDispatch = :financial AND (financialWaveDeadline <= :now OR expiresAt <= :now)) OR (updatedAt < :cutoff AND (currentWaveNumber < maxWaves OR financialDispatch = :financial)))',
    ExpressionAttributeNames: {
      '#status': 'status',
      '#sk': 'SK'
    },
    ExpressionAttributeValues: {
      ':searching': 'searching',
      ':metadata': 'METADATA',
      ':financial': true,
      ':cutoff': cutoffTime.toISOString(),
      ':now': now.toISOString()
    }
  });
  
  const orders = result.Items || [];
  
  // 🔥 تصفية الطلبات: استبعاد الطلبات التي لها offers معلقة بالفعل
  const filteredOrders = [];
  for (const order of orders) {
    if (Object.prototype.hasOwnProperty.call(order,'dispatchCycle') || order.financialDispatch === true) { filteredOrders.push(order); continue; }
    const hasActiveOffer = await checkActiveOffers(order.orderId);
    if (!hasActiveOffer) {
      filteredOrders.push(order);
    } else {
      console.log(`   ⏭️ Skipping order ${order.orderId} - already has active offers`);
    }
  }
  
  return filteredOrders;
}

// التحقق من وجود offers معلقة للطلب
async function checkActiveOffers(orderId) {
  try {
    const now = new Date().toISOString();
    
    const result = await dynamodb.query({
      TableName: WAVE_OFFERS_TABLE,
      KeyConditionExpression: 'orderId = :orderId',
      FilterExpression: 'responseStatus = :pending AND expiresAt > :now',
      ExpressionAttributeValues: {
        ':orderId': orderId,
        ':pending': 'pending',
        ':now': now
      }
    }).promise();
    
    const hasActive = result.Items && result.Items.length > 0;
    if (hasActive) {
      console.log(`   ✓ Order ${orderId} has ${result.Items.length} active offers (not expired yet)`);
    }
    return hasActive;
  } catch (error) {
    console.error(`   ❌ Error checking offers for ${orderId}:`, error.message);
    return false; // في حالة الخطأ، نفترض عدم وجود offers
  }
}

// =====================================
// جلب الطلبات العالقة (waves فارغة)
// =====================================
// =====================================
// تجميع العروض حسب الطلب
// =====================================
function groupOffersByOrder(offers) {
  const grouped = {};
  
  for (const offer of offers) {
    if (!grouped[offer.orderId]) {
      grouped[offer.orderId] = [];
    }
    grouped[offer.orderId].push(offer);
  }
  
  return grouped;
}

// =====================================
// معالجة موجة منتهية لطلب واحد
// =====================================
async function processExpiredWave(orderId, offers, now) {
  console.log(`\n🔄 Processing expired wave for order ${orderId}`);
  console.log(`   ${offers.length} offer(s) to expire`);
  
  const result = {
    orderId,
    offersExpired: 0,
    nextWaveStarted: false,
    noDriverAvailable: false
  };
  
  try {
    const financialJob = await getDispatchJob(orderId);
    if (financialJob && Object.prototype.hasOwnProperty.call(financialJob,'dispatchCycle')) {
      if((process.env.DISPATCH_FINANCIAL_HOST_MODE==='REQUIRED'&&financialJob.dispatchCycle?.engine==='FINANCIAL')||(process.env.DISPATCH_LEGACY_HOST_MODE==='REQUIRED'&&financialJob.dispatchCycle?.engine==='LEGACY')){result.dispatchAction='HOST_MANAGED';return result;}
      const plan=await require('./dispatch-cycle-runtime').coordinateUnifiedDispatch({orderId,assignmentId:financialJob.dispatchJobId,source:'TIMEOUT'});
      result.transitionClaimed=plan.claimed===true;
      result.dispatchAction=plan.action;
      return result;
    }
    if (financialJob?.financialDispatch === true) {
      const scopes=require('./finance-rollout').readFinanceRollout().scopes;
      if(!scopes.some(scope=>scope.orders.some(o=>o.orderId===orderId&&o.branchId===financialJob.restaurantId))){result.skipped='OUT_OF_FINANCIAL_SCOPE';return result;}
      const source=await dynamodb.get({TableName:'WizzOrders',Key:{PK:'ORDER#'+orderId,SK:'META'},ConsistentRead:true,ProjectionExpression:'orderId'}).promise();
      if(!source.Item){result.skipped='CANONICAL_ORDER_MISSING';return result;}

      const {exhaustFinancialSearch}=require('./financial-runtime');
      const search=await exhaustFinancialSearch(orderId);
      if(search.exhausted||search.assigned){result.noDriverAvailable=search.exhausted;return result;}
      // Durable redispatch intent belongs to the released assignment. READY clears it atomically.
      if(financialJob.financialRedispatch && financialJob.status==='searching') {
        const intent=financialJob.financialRedispatch;
        if(intent.waveNumber!==financialJob.currentWaveNumber+1||!Array.isArray(intent.excludeDriverIds))throw Error('INVALID_FINANCIAL_REDISPATCH');
        const started=await invokeStartWave(financialJob.dispatchJobId,orderId,intent.waveNumber,intent.excludeDriverIds,[],false,false);
        if(!started.success)throw Error('FINANCIAL_REDISPATCH_PENDING');
        result.nextWaveStarted=true;
        return result;
      }

      const {expireFinancialWave} = require('./financial-runtime');
      const wave = Math.max(financialJob.currentWaveNumber || 1, financialJob.financialPreparingWave || 1);
      const expired = await expireFinancialWave(orderId, wave);
      if (!expired.expired) return result;
      result.offersExpired = expired.driverIds.length;
      if (wave >= (financialJob.financialSearchMaxWave ?? financialJob.maxWaves ?? 4) || Date.parse(financialJob.expiresAt) <= Date.parse(now)) {
        const closed=await exhaustFinancialSearch(orderId);
        if(!closed.exhausted)throw Error('FINANCIAL_SEARCH_EXHAUSTION_PENDING');
        result.noDriverAvailable = true;
      } else {
        const policy=await require('./financial-wave-policy').createFinancialWavePolicy({db:dynamodb,jobsTable:DISPATCH_JOBS_TABLE}).read(financialJob,wave+1);
        const started=await invokeStartWave(financialJob.dispatchJobId,orderId,wave+1,policy.permanent,policy.previous,policy.isFinalWave,false);
        if(!started.success)throw Error('FINANCIAL_NEXT_WAVE_PENDING');
        result.nextWaveStarted = true;
      }
      return result;
    }
    // Step 1: تحديث جميع العروض المعلقة إلى expired
    await Promise.all(
      offers.map(offer => expireOffer(offer, now))
    );
    
    result.offersExpired = offers.length;
    console.log(`   ✅ Expired ${offers.length} offer(s)`);
    
    // Step 2: إرسال إشعارات للسائقين
    await Promise.all(
      offers.map(offer => sendOfferExpiredNotification(offer.driverId, orderId))
    );
    
    console.log(`   ✅ Sent expiration notifications`);
    
    // Step 3: جلب DispatchJob
    const dispatchJob = await getDispatchJob(orderId);
    
    if (!dispatchJob) {
      console.warn(`   ⚠️ DispatchJob not found for ${orderId}`);
      return result;
    }
    
    // إذا تم إسناد الطلب بالفعل، لا نفعل شيء
    if (dispatchJob.status === 'assigned') {
      console.log(`   ℹ️ Order already assigned - skipping`);
      return result;
    }
    
    // Step 4: التحقق من إمكانية بدء موجة جديدة
    const currentWave = dispatchJob.currentWaveNumber || 1;
    
    if (currentWave >= MAX_WAVES) {
      console.log(`   ⚠️ Reached MAX_WAVES (${MAX_WAVES}) - marking as no_driver_available`);
      
      // تحديث DispatchJob
      await updateDispatchJobNoDriver(orderId, now);
      
      // إشعار المطعم/العميل
      await notifyNoDriverAvailable(orderId);
      
      result.noDriverAvailable = true;
      return result;
    }
    
    // Step 5: بدء الموجة التالية
    const nextWave = currentWave + 1;
    const isFinalWave = (nextWave === 4); // الموجة 4: إعادة إرسال للسائقين السابقين
    const isEmergencyWave = (nextWave === 5); // الموجة 5: الطوارئ (بونص + مسافة أوسع)
    const isLastWave = isFinalWave || isEmergencyWave; // الموجة 4 أو 5 هي الأخيرة
    
    if (isEmergencyWave) {
      console.log(`   🚨 Starting EMERGENCY WAVE ${nextWave} (no criteria + 25% bonus)...`);
    } else if (isFinalWave) {
      console.log(`   🔥 Starting FINAL WAVE ${nextWave} (re-sending to previous drivers)...`);
    } else {
      console.log(`   🌊 Starting Wave ${nextWave}...`);
    }
    
    // جمع IDs السائقين من الموجات السابقة (رفضوا أو لم يردوا)
    const driverInfo = await getPreviousWaveDrivers(orderId);
    const tempExcludedDriverIds = driverInfo.rejectedOrNoResponse; // ⏳ استبعاد مؤقت (رفضوا أو لم يردوا)
    const permanentlyExcludedDriverIds = dispatchJob.excludedDrivers || []; // 🚫 استبعاد دائم (من unassign)
    
    if (isEmergencyWave) {
      console.log(`   🚨 EMERGENCY WAVE: Open to ALL drivers with 25% bonus`);
      console.log(`   🚫 Permanently excluded (unassign): ${permanentlyExcludedDriverIds.length} driver(s)`);
      console.log(`   🔄 Re-including temp excluded: ${tempExcludedDriverIds.length} driver(s) (SECOND CHANCE)`);
    } else if (isFinalWave) {
      console.log(`   🔥 FINAL WAVE: Re-sending to ${tempExcludedDriverIds.length} driver(s) from waves 1-3 (SECOND CHANCE)`);
      console.log(`   🚫 Permanently excluded (unassign): ${permanentlyExcludedDriverIds.length} driver(s)`);
    } else {
      console.log(`   ⏳ Temporarily excluding ${tempExcludedDriverIds.length} driver(s) (rejected/no-response)`);
      console.log(`   🚫 Permanently excluding ${permanentlyExcludedDriverIds.length} driver(s) (unassigned)`);
    }
    
    // استدعاء StartWave
    // في الموجات 1-3: نمرر tempExcludedDriverIds كـ rejectedDriverIds (استبعاد مؤقت)
    // في الموجات 4-5: نمرر قائمة فارغة (نعطيهم فرصة ثانية)
    const rejectedDriverIdsForWave = (nextWave >= 4) ? [] : tempExcludedDriverIds;
    
    const startWaveResult = await invokeStartWave(
      dispatchJob.dispatchJobId, 
      orderId, 
      nextWave, 
      permanentlyExcludedDriverIds, // دائماً نستبعدهم
      rejectedDriverIdsForWave,     // استبعاد مؤقت (فارغة في الموجة 4-5)
      isFinalWave, 
      isEmergencyWave
    );
    
    if (startWaveResult.success) {
      console.log(`   ✅ Wave ${nextWave} started successfully`);
      result.nextWaveStarted = true;
    } else {
      console.warn(`   ⚠️ Failed to start Wave ${nextWave}:`, startWaveResult.error);
      
      // إذا فشل بدء الموجة، نحاول مرة أخرى في الدورة التالية
      // أو نعتبر الطلب no_driver_available
      if (nextWave >= MAX_WAVES) {
        await updateDispatchJobNoDriver(orderId, now);
        await notifyNoDriverAvailable(orderId);
        result.noDriverAvailable = true;
      }
    }
    
    return result;
    
  } catch (error) {
    console.error(`❌ Error processing expired wave for ${orderId}:`, error);
    throw error;
  }
}

// =====================================
// تحديث عرض إلى expired
// =====================================
async function expireOffer(offer, now) {
  try {
    // Step 1: تحديث WaveOffer
    await dynamodb.update({
      TableName: WAVE_OFFERS_TABLE,
      Key: {
        orderId: offer.orderId,
        SK: offer.SK
      },
      UpdateExpression: 'SET responseStatus = :expired, responseAt = :now, updatedAt = :now',
      ExpressionAttributeValues: {
        ':expired': 'expired',
        ':now': now
      }
    }).promise();
    
    console.log(`   📝 Expired offer for driver ${offer.driverId}`);
    
    // Step 2: تنظيف WizzDriverLiveState
    await updateDriverStateOnTimeout(offer.driverId);
    
    // Step 3: تحديث Performance Metrics
    await updateDriverPerformanceMetricsOnTimeout(offer.driverId);
    
  } catch (error) {
    console.error(`   ❌ Failed to expire offer for driver ${offer.driverId}:`, error.message);
  }
}

// =====================================
// تحديث حالة السائق عند Timeout
// =====================================
async function updateDriverStateOnTimeout(driverId) {
  try {
    await dynamodb.update({
      TableName: process.env.DRIVER_LIVE_STATE_TABLE || 'WizzDriverLiveState',
      Key: { driverId: driverId },
      UpdateExpression: 'SET currentWaveOfferId = :null, updatedAt = :now ADD metricsSnapshot.pendingOffers :decrement',
      ExpressionAttributeValues: {
        ':null': null,
        ':now': new Date().toISOString(),
        ':decrement': -1
      }
    }).promise();
    
    console.log(`   🧹 Cleaned driver ${driverId} state (timeout)`);
  } catch (error) {
    console.error(`   ⚠️ Error updating driver state:`, error.message);
  }
}

// =====================================
// تحديث Performance Metrics عند Timeout
// =====================================
async function updateDriverPerformanceMetricsOnTimeout(driverId) {
  try {
    const now = new Date().toISOString();
    
    // زيادة totalTimeouts وإعادة تعيين streak
    await dynamodb.update({
      TableName: process.env.DRIVER_PERFORMANCE_METRICS_TABLE || 'WizzDriverPerformanceMetrics',
      Key: { driverId: driverId },
      UpdateExpression: `
        SET totalTimeouts = if_not_exists(totalTimeouts, :zero) + :one,
            lastTimeoutAt = :now,
            currentStreak = :zero,
            updatedAt = :now
      `,
      ExpressionAttributeValues: {
        ':zero': 0,
        ':one': 1,
        ':now': now
      }
    }).promise();
    
    // حساب Timeout Rate الجديد
    const metrics = await dynamodb.get({
      TableName: process.env.DRIVER_PERFORMANCE_METRICS_TABLE || 'WizzDriverPerformanceMetrics',
      Key: { driverId: driverId }
    }).promise();
    
    if (metrics.Item) {
      const totalTimeouts = metrics.Item.totalTimeouts || 0;
      const totalOffersReceived = metrics.Item.totalOffersReceived || 0;
      const timeoutRate = totalOffersReceived > 0 
        ? (totalTimeouts / totalOffersReceived) * 100 
        : 0;
      
      await dynamodb.update({
        TableName: process.env.DRIVER_PERFORMANCE_METRICS_TABLE || 'WizzDriverPerformanceMetrics',
        Key: { driverId: driverId },
        UpdateExpression: 'SET timeoutRate = :rate',
        ExpressionAttributeValues: {
          ':rate': Math.round(timeoutRate * 100) / 100
        }
      }).promise();
      
      console.log(`   📊 Updated metrics: totalTimeouts=${totalTimeouts}, timeoutRate=${timeoutRate.toFixed(2)}%`);
    }
  } catch (error) {
    console.error(`   ⚠️ Error updating performance metrics:`, error.message);
    // لا نفشل العملية الكاملة
  }
}

// =====================================
// إرسال إشعار انتهاء العرض
// =====================================
async function sendOfferExpiredNotification(driverId, orderId) {
  try {
    // جلب connectionId من WizzDriverLiveState
    const driver = await dynamodb.get({
      TableName: process.env.DRIVER_LIVE_STATE_TABLE || 'WizzDriverLiveState',
      Key: { driverId: driverId }
    }).promise();
    
    if (!driver.Item || !driver.Item.connectionId) {
      console.log(`   ⚠️ No connectionId for driver ${driverId}`);
      return;
    }
    
    const message = {
      type: 'offer_expired',
      action: 'timeout',
      orderId: orderId,
      reason: 'timeout',
      message: 'انتهت مدة العرض',
      timestamp: new Date().toISOString()
    };
    
    await apigateway.postToConnection({
      ConnectionId: driver.Item.connectionId,
      Data: JSON.stringify(message)
    }).promise();
    
    console.log(`   📲 Sent expiration notification to driver ${driverId}`);
    
  } catch (error) {
    if (error.statusCode === 410) {
      console.log(`   ⚠️ Connection for driver ${driverId} is stale`);
    } else {
      console.error(`   ❌ Error sending notification to ${driverId}:`, error.message);
    }
  }
}

// =====================================
// جلب DispatchJob
// =====================================
async function getDispatchJob(orderId) {
  const result = await dynamodb.get({
    TableName: DISPATCH_JOBS_TABLE,
    Key: {
      orderId: orderId,
      SK: 'METADATA'
    },
    ConsistentRead: true
  }).promise();
  
  return result.Item || null;
}

// =====================================
// جمع IDs السائقين من الموجات السابقة
// =====================================
async function getPreviousWaveDrivers(orderId) {
  const result = await dynamodb.query({
    TableName: WAVE_OFFERS_TABLE,
    KeyConditionExpression: 'orderId = :orderId',
    ExpressionAttributeValues: {
      ':orderId': orderId
    }
  }).promise();
  
  const rejectedDriverIds = new Set();
  const noResponseDriverIds = new Set();
  
  for (const offer of result.Items || []) {
    // السائقين الذين رفضوا صراحةً
    if (offer.responseStatus === 'rejected') {
      rejectedDriverIds.add(offer.driverId);
      console.log(`   🚫 Driver ${offer.driverId} rejected (wave ${offer.waveNumber})`);
    }
    // السائقين الذين لم يردوا (timeout/expired)
    else if (offer.responseStatus === 'expired' || offer.responseStatus === 'pending') {
      noResponseDriverIds.add(offer.driverId);
      console.log(`   ⏰ Driver ${offer.driverId} no response/expired (wave ${offer.waveNumber})`);
    }
    // السائق الذي قبل لن يكون في القوائم (تم إسناد الطلب له)
  }
  
  // دمج الرفض وعدم الرد في قائمة واحدة (استبعاد مؤقت)
  const rejectedOrNoResponse = Array.from(new Set([...rejectedDriverIds, ...noResponseDriverIds]));
  
  console.log(`   📊 Previous waves summary:`);
  console.log(`      - Rejected: ${rejectedDriverIds.size}`);
  console.log(`      - No response: ${noResponseDriverIds.size}`);
  console.log(`      - Total temp excluded: ${rejectedOrNoResponse.length}`);
  
  return {
    rejectedDriverIds: Array.from(rejectedDriverIds),
    noResponseDriverIds: Array.from(noResponseDriverIds),
    rejectedOrNoResponse: rejectedOrNoResponse // للاستبعاد المؤقت
  };
}

// =====================================
// استدعاء StartWave للموجة التالية
// =====================================
async function invokeStartWave(dispatchJobId, orderId, waveNumber, excludeDriverIds, rejectedDriverIds, isFinalWave = false, isEmergencyWave = false) {
  try {
    const payload = {
      dispatchJobId: dispatchJobId,
      orderId: orderId,
      waveNumber: waveNumber,
      excludeDriverIds: excludeDriverIds,
      rejectedDriverIds: rejectedDriverIds || [],
      isFinalWave: isFinalWave,
      isEmergencyWave: isEmergencyWave // ✅ علامة الموجة الطارئة
    };
    
    console.log(`   🚀 Invoking StartWave with payload:`, JSON.stringify(payload));
    
    const response = await lambda.invoke({
      FunctionName: START_WAVE_LAMBDA,
      InvocationType: 'RequestResponse',
      Payload: JSON.stringify(payload)
    }).promise();
    
    const result = JSON.parse(response.Payload);
    
    if (response.StatusCode === 200 && result.statusCode === 200) {
      return { success: true };
    } else {
      return { 
        success: false, 
        error: result.body || 'Unknown error' 
      };
    }
    
  } catch (error) {
    console.error(`   ❌ Error invoking StartWave:`, error);
    return { 
      success: false, 
      error: error.message 
    };
  }
}

// =====================================
// تحديث DispatchJob إلى no_driver_available
// =====================================
async function updateDispatchJobNoDriver(orderId, now) {
  try {
    await dynamodb.update({
      TableName: DISPATCH_JOBS_TABLE,
      Key: {
        orderId: orderId,
        SK: 'METADATA'
      },
      UpdateExpression: 'SET #status = :status, updatedAt = :now, noDriverReason = :reason',
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':status': 'no_driver_available',
        ':now': now,
        ':reason': 'max_waves_reached'
      }
    }).promise();
    
    console.log(`   ✅ Updated DispatchJob to no_driver_available`);
  } catch (error) {
    console.error(`   ❌ Error updating DispatchJob:`, error.message);
  }
}

// =====================================
// إشعار بعدم توفر سائق
// =====================================
async function notifyNoDriverAvailable(orderId) {
  try {
    // يمكن إضافة إشعار للمطعم/العميل هنا
    // مثلاً عبر SNS أو WebSocket للمطعم
    
    console.log(`   📢 Notifying no driver available for order ${orderId}`);
    
    // TODO: إضافة منطق إشعار المطعم/العميل
    // مثلاً: إرسال SNS notification، أو WebSocket للمطعم، أو تحديث WizzOrders
    
    // تحديث WizzOrders (اختياري)
    await dynamodb.update({
      TableName: process.env.ORDERS_TABLE || 'WizzOrders',
      Key: {
        PK: `ORDER#${orderId}`,
        SK: 'META'
      },
      UpdateExpression: 'SET dispatchStatus = :status, updatedAt = :now',
      ExpressionAttributeValues: {
        ':status': 'no_driver_available',
        ':now': new Date().toISOString()
      }
    }).promise();
    
  } catch (error) {
    console.error(`   ❌ Error notifying no driver available:`, error.message);
  }
}

async function scanAll(parameters) {
  const Items = []; let cursor;
  for (let page=0;page<50;page++) {
    const result = await dynamodb.scan({...parameters,ConsistentRead:true,Limit:100,ExclusiveStartKey:cursor}).promise();
    Items.push(...(result.Items || [])); cursor=result.LastEvaluatedKey;
    if (!cursor) return {Items};
  }
  throw new Error('WAVE_TIMEOUT_SCAN_INCOMPLETE');
}
