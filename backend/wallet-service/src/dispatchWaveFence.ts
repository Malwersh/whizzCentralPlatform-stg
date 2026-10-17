import {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';
import {validateDispatchCycle} from './dispatchCycle';
import {FinancialRow as Row,strongGet,exactCheck,equal} from './driverFinancialTransaction';
/** Extra acceptance/decline proof for a pinned cycle, composed with the existing
 * winner + hold transaction. Old financial assignments retain their existing contract.
 */
export async function pinnedFinancialWaveFence(db:Pick<DynamoDBDocumentClient,'send'>,assignment:Row,offer:Row,waveNumber:number,wave:Row|null,at:number) {
 if(!Object.prototype.hasOwnProperty.call(assignment,'dispatchCycle'))return [] as Row[];
 const fail=():never=>{throw Error('PINNED_WAVE_NOT_READY');},c=validateDispatchCycle(assignment.dispatchCycle),ref=assignment.dispatchTransition;
 if(c.engine!=='FINANCIAL'||c.assignmentId!==offer.assignmentId||c.orderId!==offer.orderId||!ref||ref.cycleId!==c.id||!Number.isSafeInteger(ref.sequence)||typeof ref.id!=='string')return fail();
 const profile=c.policy.values.dispatch!.profiles.FINANCIAL;
 const validDate=(v:any)=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(Date.parse(v)).toISOString()===v;
 const key={orderId:c.orderId,SK:'DISPATCH_TRANSITION#'+ref.id},intent=await strongGet(db,'WizzDispatchJobs_staging',key);
 if(!intent||intent.kind!=='DISPATCH_TRANSITION'||intent.action!=='START_WAVE'||intent.state!=='APPLIED'||intent.intentId!==ref.id||intent.sequence!==ref.sequence||intent.cycleId!==c.id||intent.cycleDigest!==c.digest||intent.assignmentId!==c.assignmentId||intent.policyVersion!==c.policy.version||intent.waveNumber!==waveNumber||!equal(intent.rule,profile.normalWaves[waveNumber-1])||intent.offerTtlSeconds!==profile.offerTtlSeconds||!validDate(intent.createdAt)||!validDate(intent.appliedAt)||!validDate(intent.waveDeadline)||!validDate(offer.expiresAt)||Date.parse(intent.waveDeadline)>Math.min(Date.parse(c.searchDeadline),Date.parse(intent.createdAt)+profile.waveDurationSeconds*1000)||Date.parse(intent.waveDeadline)<=at||Date.parse(c.searchDeadline)<=at||Date.parse(offer.expiresAt)>Date.parse(intent.waveDeadline)||!wave||wave.kind!=='FINANCIAL_WAVE'||wave.state!=='READY'||wave.waveNumber!==waveNumber||wave.cycleDigest!==c.digest||wave.transitionId!==intent.intentId||wave.assignmentId!==c.assignmentId||!wave.driverIds?.includes(offer.driverId))return fail();
 return [exactCheck('WizzDispatchJobs_staging',key,intent)];
}
