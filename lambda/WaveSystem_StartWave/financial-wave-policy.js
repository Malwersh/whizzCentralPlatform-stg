'use strict';
const {OPERATIONS_PK,validateOperationsValues,validateOperationsSnapshot}=require('../../backend/wallet-service/dist/deliveryOperationsPolicy');
function createFinancialWavePolicy({db,jobsTable}) {
  const get=async(orderId,n)=>(await db.get({TableName:jobsTable,Key:{orderId,SK:`FINANCIAL_WAVE#${n}`},ConsistentRead:true}).promise()).Item;
  return {async read(job,waveNumber){
    if(!Number.isSafeInteger(waveNumber)||waveNumber<1)throw Error('INVALID_FINANCIAL_WAVE_POLICY');
    const first=await get(job.orderId,1);let operating;
    if(first?.operatingLimits)operating=validateOperationsSnapshot(first.operatingLimits);
    else {
      const row=(await db.get({TableName:'staging-PlatformStaff',Key:{pk:OPERATIONS_PK,sk:'CURRENT'},ConsistentRead:true}).promise()).Item;
      if(!row||!Number.isSafeInteger(row.version)||row.version<1)throw Error('DELIVERY_OPERATIONS_UNAVAILABLE');
      operating={version:row.version,values:validateOperationsValues(row.values)};
    }
    const profile=operating.values.dispatch?.profiles.FINANCIAL;
    if(!profile)throw Error('FINANCIAL_WAVE_PROFILE_REQUIRED');
    const rule=profile.normalWaves[waveNumber-1];
    if(!rule||waveNumber>(job.financialSearchMaxWave??operating.values.maximumWaves))throw Error('FINANCIAL_WAVE_LIMIT');
    const permanent=new Set([...(job.excludedDrivers??[]),...(job.financialExcludedDriverIds??[])]),previous=new Set();
    for(let n=1;n<waveNumber;n++){
      const wave=await get(job.orderId,n);
      if(!wave||wave.assignmentId!==job.dispatchJobId||!Array.isArray(wave.driverIds)||wave.state!=='EXPIRED')throw Error('FINANCIAL_PREVIOUS_WAVE_NOT_EXPIRED');
      for(const id of wave.driverIds)previous.add(id);
    }
    return {operating,permanent:[...permanent],previous:[...previous],recipients:rule.recipients,
      isFinalWave:waveNumber>=(profile.repeatOffers.reofferFromWave??Number.MAX_SAFE_INTEGER),
      thresholds:{MIN_ACCEPTANCE_RATE:rule.minimumAcceptancePercent/100,MIN_COMPLETION_RATE:rule.minimumCompletionPercent/100,
        MAX_CONSECUTIVE_REJECTIONS:rule.maximumConsecutiveDeclines,MAX_DISTANCE_KM:rule.radiusMeters/1000,
        NEW_DRIVER_BELOW_TRIPS:profile.newDriverExemption.belowCompletedTrips,MISSING_HISTORY:profile.newDriverExemption.missingHistory,
        REOFFER_FROM_WAVE:profile.repeatOffers.reofferFromWave??Number.MAX_SAFE_INTEGER,STRICT_COORDINATES:true,DETERMINISTIC_TIES:true}};
  }};
}
module.exports={createFinancialWavePolicy};
