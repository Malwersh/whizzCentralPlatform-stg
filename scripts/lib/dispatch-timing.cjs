'use strict';
// Offline planning aid, never called by a worker. Does not predict AWS scheduling latency.
function simulatePollingWaves({waveCount,offerTtlMs,workerIntervalMs,firstOfferAtMs=0,preparationMs=0,searchDeadlineMs=null,strictExpiry=false}){
 if(!Number.isSafeInteger(waveCount)||waveCount<1||waveCount>10||![offerTtlMs,workerIntervalMs].every(v=>Number.isSafeInteger(v)&&v>0)||![firstOfferAtMs,preparationMs].every(v=>Number.isSafeInteger(v)&&v>=0)||typeof strictExpiry!=='boolean'||searchDeadlineMs!==null&&(!Number.isSafeInteger(searchDeadlineMs)||searchDeadlineMs<=firstOfferAtMs))throw Error('INVALID_TIMING_SCENARIO');
 const waves=[];let offerAt=firstOfferAtMs;
 for(let wave=1;wave<=waveCount;wave++){
  if(searchDeadlineMs!==null&&offerAt>=searchDeadlineMs)break;
  const expiresAt=Math.min(offerAt+offerTtlMs,searchDeadlineMs??Infinity);
  const observedAt=(strictExpiry?Math.floor(expiresAt/workerIntervalMs)+1:Math.ceil(expiresAt/workerIntervalMs))*workerIntervalMs;
  if(![expiresAt,observedAt].every(Number.isSafeInteger))throw Error('INVALID_TIMING_SCENARIO');
  waves.push({wave,offerAtMs:offerAt,expiresAtMs:expiresAt,observedAtMs:observedAt,pollingDelayMs:observedAt-expiresAt});offerAt=observedAt+preparationMs;
 }
 return {kind:'OFFLINE_ILLUSTRATION_NOT_MEASURED',waves,completedWaves:waves.length,elapsedMs:waves.length?waves.at(-1).observedAtMs-firstOfferAtMs:0};
}
module.exports={simulatePollingWaves};
