import {validateDispatchCycle} from './dispatchCycle';
const {dispatchWaveSK}=require('../../src/utils/dispatch-cycle-keys');
/** Financial retries are allowed only before any offer was issued. Offer keys retain
 * their established settlement contract; wave plans are isolated by search cycle. */
export function financialWaveSK(job:any,waveNumber:number):string {
 if(!Number.isSafeInteger(waveNumber)||waveNumber<1||waveNumber>1000)throw Error('INVALID_FINANCIAL_WAVE');
 if(job?.dispatchCycle!==undefined){const cycle=validateDispatchCycle(job.dispatchCycle);if(cycle.engine!=='FINANCIAL'||cycle.assignmentId!==job.dispatchJobId)throw Error('FINANCIAL_CYCLE_REQUIRED');return dispatchWaveSK(cycle,waveNumber);}
 return 'FINANCIAL_WAVE#'+waveNumber;
}
