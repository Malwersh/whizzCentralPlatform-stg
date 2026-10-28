/**
 * WaveSystem_HandleDriverReject Lambda
 * 
 * Purpose: معالجة رفض السائق للطلب
 * 
 * Trigger: WebSocket message من تطبيق السائق
 * 
 * Flow:
 * 1. تحديث WaveOffer status → rejected
 * 2. تحديث WizzDriverLiveState (تنظيف currentWaveOfferId)
 * 3. تحديث WizzDriverPerformanceMetrics (زيادة totalRejected)
 * 4. تحديث WizzDispatchJobs_dev (إضافة السائق لقائمة الرافضين)
 * 5. التحقق: هل جميع السائقين في الموجة رفضوا؟
 *    - إذا نعم → بدء موجة جديدة
 *    - إذا لا → انتظار ردود السائقين الآخرين
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  UpdateCommand,
} = require('@aws-sdk/lib-dynamodb');
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');

const {driverRequestContext,driverLifecycleClient}=require('./driver-lifecycle');
const dynamodb = driverLifecycleClient(DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
}));
const lambda = new LambdaClient({});

function requireNonEmptyEnv(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value.trim();
}

const DISPATCH_JOBS_TABLE = requireNonEmptyEnv('DISPATCH_JOBS_TABLE');
const WAVE_OFFERS_TABLE = requireNonEmptyEnv('WAVE_OFFERS_TABLE');
const DRIVER_LIVE_STATE_TABLE = requireNonEmptyEnv('DRIVER_LIVE_STATE_TABLE');

function extractWaveNumberFromOfferId(offerId) {
  if (typeof offerId !== 'string') return null;
  // Expected format: OFFER_{orderId}_{driverId}_W{waveNumber}
  const parts = offerId.split('_');
  const last = parts[parts.length - 1];
  if (last && last.startsWith('W')) {
    const n = parseInt(last.substring(1), 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

exports.handler = event => driverRequestContext.run({}, () => handleRequest(event));
const handleRequest = async (event) => {
  console.log('Driver rejection request received');
  
  try {
    // استخراج البيانات من Event
    const { driverId, orderId, offerId, rejectionReason } = parseEvent(event);
    if (DRIVER_LIVE_STATE_TABLE !== 'WizzDriverLiveState_staging') throw new Error('STAGING_DRIVER_TABLE_REQUIRED');
    driverRequestContext.getStore().sub = driverId;
    
    if (!driverId || !orderId || !offerId) {
      throw new Error('Missing required parameters: driverId, orderId, or offerId');
    }
    
    console.log(`🚫 Driver ${driverId} rejected order ${orderId}. Reason: ${rejectionReason || 'none'}`);
    
    // Financial requests must use the authenticated financial decline transaction.
    const sourceOrder=await dynamodb.send(new GetCommand({TableName:'WizzOrders',Key:{PK:'ORDER#'+orderId,SK:'META'},ConsistentRead:true,ProjectionExpression:'financialSnapshot,commercialPricing,financialAcceptance,financialOutcome,codFinancialEvidence'}));
    if(!sourceOrder.Item||['financialSnapshot','commercialPricing','financialAcceptance','financialOutcome','codFinancialEvidence'].some(k=>Object.prototype.hasOwnProperty.call(sourceOrder.Item,k)))return {statusCode:409,body:JSON.stringify({success:false,code:'FINANCIAL_DECLINE_REQUIRED'})};
    // Pinned cycles must never enter legacy decline/metrics writes. The new
    // decline adapter is not enabled by the planning-only coordinator mode.
    const cycleJob=await dynamodb.send(new GetCommand({TableName:DISPATCH_JOBS_TABLE,Key:{orderId,SK:'METADATA'},ConsistentRead:true}));
    if(cycleJob.Item && Object.prototype.hasOwnProperty.call(cycleJob.Item,'dispatchCycle')) {
      if(process.env.DISPATCH_CYCLE_MODE==='LEGACY_RESPONSES'){
        const token=String(event.headers?.Authorization??event.headers?.authorization??'').replace(/^Bearer /i,'');
        const result=await require('./dispatch-cycle-runtime').respondPinnedLegacyOffer('DECLINE',{orderId,offerId,waveNumber:extractWaveNumberFromOfferId(offerId)},token);
        return {statusCode:200,body:JSON.stringify(result)};
      }
      return {statusCode:409,body:JSON.stringify({success:false,code:'UNIFIED_DECLINE_NOT_READY'})};
    }

    if(!cycleJob.Item)return {statusCode:409,body:JSON.stringify({success:false,code:'DISPATCH_JOB_REQUIRED'})};

    // Step 1: تحديث WaveOffer status → rejected
    const waveNumber = extractWaveNumberFromOfferId(offerId) || 1;
    await updateWaveOfferStatus(offerId, orderId, driverId, waveNumber, rejectionReason);
    
    // Step 2: تحديث WizzDriverLiveState (تنظيف offer)
    await cleanupDriverState(driverId);
    
    // Step 3: تحديث Performance Metrics
    await updateDriverPerformanceMetrics(driverId, rejectionReason);
    
    // Step 4: إضافة السائق لقائمة الرافضين في DispatchJob
    await addToRejectedDrivers(orderId, driverId);
    
    // Step 5: التحقق من حالة الموجة
    const waveStatus = await checkWaveStatus(orderId, offerId);
    
    if (waveStatus.allRejected) {
      console.log(`⚠️ All drivers in wave rejected order ${orderId} - triggering next wave`);
      await triggerNextWave(orderId);
    } else {
      console.log(`✅ Waiting for other drivers to respond (${waveStatus.pending} still pending)`);
    }
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Rejection processed successfully',
        orderId: orderId,
        driverId: driverId,
        nextAction: waveStatus.allRejected ? 'next_wave_triggered' : 'waiting_for_responses'
      })
    };
    
  } catch (error) {
    console.error('❌ Error in HandleDriverReject:', error);
    
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Failed to process rejection',
        message: error.message
      })
    };
  }
};

// =====================================
// استخراج البيانات من Event
// =====================================
function parseEvent(event) {
  // Support both direct invocation and WebSocket routing
  if (event.body) {
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    return {
      driverId: body.driverId || body.driver_id,
      orderId: body.orderId || body.order_id,
      offerId: body.offerId || body.offer_id,
      rejectionReason: body.rejectionReason || body.reason || 'not_specified'
    };
  }
  
  return {
    driverId: event.driverId,
    orderId: event.orderId,
    offerId: event.offerId,
    rejectionReason: event.rejectionReason || 'not_specified'
  };
}

// =====================================
// تحديث WaveOffer Status
// =====================================
async function updateWaveOfferStatus(offerId, orderId, driverId, waveNumber, reason) {
  console.log(`📝 Updating WaveOffer ${offerId} to rejected`);
  
  const now = new Date().toISOString();
  
  const normalizedWaveNumber = Number.isFinite(waveNumber) ? waveNumber : (extractWaveNumberFromOfferId(offerId) || 1);
  const offerSK = `${driverId}#WAVE#${normalizedWaveNumber}`;

  await dynamodb.send(
    new UpdateCommand({
      TableName: WAVE_OFFERS_TABLE,
      Key: {
        orderId: orderId,
        SK: offerSK,
      },
      UpdateExpression:
        'SET responseStatus = :status, responseAt = :now, rejectionReason = :reason, updatedAt = :now',
      ExpressionAttributeValues: {
        ':status': 'rejected',
        ':now': now,
        ':reason': reason,
      },
    })
  );
  
  console.log(`✅ WaveOffer status updated to rejected`);
}

// =====================================
// تنظيف حالة السائق
// =====================================
async function cleanupDriverState(driverId) {
  console.log(`🧹 Cleaning up driver ${driverId} state`);
  
  const now = new Date().toISOString();
  
  await dynamodb.send(
    new UpdateCommand({
      TableName: DRIVER_LIVE_STATE_TABLE,
      Key: { driverId: driverId },
      UpdateExpression:
        'SET currentWaveOfferId = :null, updatedAt = :now ADD metricsSnapshot.pendingOffers :decrement',
      ExpressionAttributeValues: {
        ':null': null,
        ':now': now,
        ':decrement': -1,
      },
    })
  );
  
  console.log(`✅ Driver state cleaned (currentWaveOfferId = null, pendingOffers decreased)`);
}

// =====================================
// تحديث Performance Metrics
// =====================================
async function updateDriverPerformanceMetrics(driverId, reason) {
  console.log(`📊 Updating performance metrics for driver ${driverId}`);
  
  const now = new Date().toISOString();
  
  try {
    // زيادة totalRejected وإعادة تعيين streak
    await dynamodb.send(
      new UpdateCommand({
        TableName:
          process.env.DRIVER_PERFORMANCE_METRICS_TABLE || 'WizzDriverPerformanceMetrics',
        Key: { driverId: driverId },
        UpdateExpression: `
        SET totalRejected = if_not_exists(totalRejected, :zero) + :one,
            lastRejectedAt = :now,
            currentStreak = :zero,
            updatedAt = :now
        ADD rejectionReasons.#reason :one
      `,
        ExpressionAttributeNames: {
          '#reason': reason,
        },
        ExpressionAttributeValues: {
          ':zero': 0,
          ':one': 1,
          ':now': now,
        },
      })
    );
    
    // حساب Acceptance Rate الجديد
    const metrics = await dynamodb.send(
      new GetCommand({
        TableName:
          process.env.DRIVER_PERFORMANCE_METRICS_TABLE || 'WizzDriverPerformanceMetrics',
        Key: { driverId: driverId },
      })
    );
    
    if (metrics.Item) {
      const totalAccepted = metrics.Item.totalAccepted || 0;
      const totalRejected = metrics.Item.totalRejected || 0;
      const totalOffersReceived = metrics.Item.totalOffersReceived || 0;
      
      const acceptanceRate = totalOffersReceived > 0 
        ? (totalAccepted / totalOffersReceived) * 100 
        : 0;
      
      await dynamodb.send(
        new UpdateCommand({
          TableName:
            process.env.DRIVER_PERFORMANCE_METRICS_TABLE ||
            'WizzDriverPerformanceMetrics',
          Key: { driverId: driverId },
          UpdateExpression: 'SET acceptanceRate = :rate',
          ExpressionAttributeValues: {
            ':rate': Math.round(acceptanceRate * 100) / 100,
          },
        })
      );
      
      console.log(`✅ Metrics updated: totalRejected=${totalRejected}, acceptanceRate=${acceptanceRate.toFixed(2)}%, streak reset`);
    }
  } catch (error) {
    console.error(`❌ Error updating metrics:`, error);
    // لا نفشل العملية الكاملة
  }
}

// =====================================
// إضافة السائق لقائمة الرافضين
// =====================================
async function addToRejectedDrivers(orderId, driverId) {
  console.log(`📋 Adding driver ${driverId} to rejected list for order ${orderId}`);
  
  await dynamodb.send(
    new UpdateCommand({
      TableName: DISPATCH_JOBS_TABLE,
      Key: {
        orderId: orderId,
        SK: 'METADATA',
      },
      UpdateExpression: 'ADD rejectedDrivers :driverSet SET updatedAt = :now',
      ExpressionAttributeValues: {
        ':driverSet': new Set([driverId]),
        ':now': new Date().toISOString(),
      },
    })
  );
  
  console.log(`✅ Driver added to rejected list`);
}

// =====================================
// التحقق من حالة الموجة
// =====================================
async function checkWaveStatus(orderId, offerId) {
  console.log(`🔍 Checking wave status for order ${orderId}`);
  
  // جلب معلومات الـ offer لمعرفة رقم الموجة
  const offerResult = await dynamodb.send(
    new QueryCommand({
      TableName: WAVE_OFFERS_TABLE,
      KeyConditionExpression: 'orderId = :orderId',
      FilterExpression: 'offerId = :offerId',
      ExpressionAttributeValues: {
        ':orderId': orderId,
        ':offerId': offerId,
      },
    })
  );
  
  if (!offerResult.Items || offerResult.Items.length === 0) {
    throw new Error(`Offer ${offerId} not found`);
  }
  
  const waveNumber = offerResult.Items[0].waveNumber;
  console.log(`📊 Wave number: ${waveNumber}`);
  
  // جلب جميع offers في نفس الموجة
  const allOffersResult = await dynamodb.send(
    new QueryCommand({
      TableName: WAVE_OFFERS_TABLE,
      KeyConditionExpression: 'orderId = :orderId',
      FilterExpression: 'waveNumber = :waveNumber',
      ExpressionAttributeValues: {
        ':orderId': orderId,
        ':waveNumber': waveNumber,
      },
    })
  );
  
  const offers = allOffersResult.Items || [];
  console.log(`📊 Total offers in wave: ${offers.length}`);
  
  // حساب الردود
  let accepted = 0;
  let rejected = 0;
  let pending = 0;
  
  offers.forEach(offer => {
    const status = offer.responseStatus;
    if (status === 'accepted') accepted++;
    else if (status === 'rejected') rejected++;
    else pending++;
  });
  
  console.log(`📊 Wave status: ${accepted} accepted, ${rejected} rejected, ${pending} pending`);
  
  return {
    waveNumber: waveNumber,
    totalOffers: offers.length,
    accepted: accepted,
    rejected: rejected,
    pending: pending,
    allRejected: rejected === offers.length && accepted === 0
  };
}

// =====================================
// بدء الموجة التالية
// =====================================
async function triggerNextWave(orderId) {
  console.log(`🌊 Triggering next wave for order ${orderId}`);
  
  // جلب DispatchJob لمعرفة الموجة الحالية
  const jobResult = await dynamodb.send(
    new GetCommand({
      TableName: DISPATCH_JOBS_TABLE,
      Key: {
        orderId: orderId,
        SK: 'METADATA',
      },
    })
  );
  
  if (!jobResult.Item) {
    throw new Error(`DispatchJob not found for order ${orderId}`);
  }
  
  if(Object.prototype.hasOwnProperty.call(jobResult.Item,'dispatchCycle')) {
    return require('./dispatch-cycle-runtime').coordinateUnifiedDispatch({orderId,assignmentId:jobResult.Item.dispatchJobId,source:'DECLINE'});
  }
  const currentWave = jobResult.Item.currentWaveNumber || 1;
  const maxWaves = jobResult.Item.maxWaves || 3;
  const nextWave = currentWave + 1;
  
  console.log(`📊 Current wave: ${currentWave}, Max waves: ${maxWaves}, Next: ${nextWave}`);
  
  if (nextWave > maxWaves) {
    console.log(`⚠️ Reached max waves (${maxWaves}) - marking order as no_driver_available`);
    await markOrderAsNoDriverAvailable(orderId);
    return;
  }
  
  // تحديث currentWaveNumber
  await dynamodb.send(
    new UpdateCommand({
      TableName: DISPATCH_JOBS_TABLE,
      Key: {
        orderId: orderId,
        SK: 'METADATA',
      },
      UpdateExpression: 'SET currentWaveNumber = :nextWave, updatedAt = :now',
      ExpressionAttributeValues: {
        ':nextWave': nextWave,
        ':now': new Date().toISOString(),
      },
    })
  );
  
  // استدعاء StartWave Lambda
  const startWavePayload = {
    dispatchJobId: jobResult.Item.dispatchJobId,
    waveNumber: nextWave
  };
  
  await lambda.send(
    new InvokeCommand({
      FunctionName: process.env.START_WAVE_FUNCTION || 'WaveSystem_StartWave',
      InvocationType: 'Event',
      Payload: Buffer.from(JSON.stringify(startWavePayload)),
    })
  );
  
  console.log(`✅ Next wave triggered successfully`);
}

// =====================================
// تحديث حالة الطلب: لا يوجد سائق متاح
// =====================================
async function markOrderAsNoDriverAvailable(orderId) {
  console.log(`❌ Marking order ${orderId} as no_driver_available`);
  
  const now = new Date().toISOString();
  
  // تحديث DispatchJob
  await dynamodb.send(
    new UpdateCommand({
      TableName: DISPATCH_JOBS_TABLE,
      Key: {
        orderId: orderId,
        SK: 'METADATA',
      },
      UpdateExpression:
        'SET #status = :status, failureReason = :reason, updatedAt = :now',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':status': 'no_driver_available',
        ':reason': 'all_waves_rejected',
        ':now': now,
      },
    })
  );
  
  // تحديث WizzOrders
  await dynamodb.send(
    new UpdateCommand({
      TableName: process.env.ORDERS_TABLE || 'WizzOrders',
      Key: {
        PK: `ORDER#${orderId}`,
        SK: 'META',
      },
      UpdateExpression:
        'SET #status = :status, driverSearchFailed = :true, driverSearchFailedAt = :now, updatedAt = :now',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':status': 'pending_driver',
        ':true': true,
        ':now': now,
      },
    })
  );
  
  console.log(`✅ Order marked as no_driver_available`);
  
  // TODO: إرسال إشعار للمطعم والعميل
}
