'use strict';
// Legacy pricing compatibility only, never the financial snapshot/routing writer.
function calculateDriverPayout(orderTotal, distanceKm) {
  // أجر أساسي + نسبة من الطلب + أجر المسافة
  const baseFee = 2000; // IQD
  const orderPercentage = orderTotal * 0.15; // 15% من قيمة الطلب
  const distanceFee = distanceKm * 500; // 500 IQD per km

  return Math.round(baseFee + orderPercentage + distanceFee);
}

function buildLegacyOfferRow(dispatchJob,driver,waveNumber,{at,ttlSeconds,isEmergencyWave=false,useExactDeliveryFee=false}){
 const now=at,expiresAt=new Date(Date.parse(at)+ttlSeconds*1000).toISOString();
    const offerId = `OFFER_${dispatchJob.orderId}_${driver.driverId}_W${waveNumber}`;

    // 🚨 حساب البونص في الموجة الطارئة
    if(useExactDeliveryFee&&(!Number.isSafeInteger(dispatchJob.deliveryFee)||dispatchJob.deliveryFee<0))throw Error('INVALID_EXACT_LEGACY_FEE');
    const baseDeliveryFee = useExactDeliveryFee ? dispatchJob.deliveryFee : dispatchJob.deliveryFee || calculateDriverPayout(dispatchJob.orderTotal, driver.distance);
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
      ttl: Math.floor(Date.parse(now) / 1000) + (7 * 24 * 60 * 60) // 7 days
    };
}
module.exports={buildLegacyOfferRow,calculateDriverPayout};
