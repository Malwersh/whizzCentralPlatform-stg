import {DispatchEngine,validateDispatchPolicy} from './dispatchPolicy';
import {validateOperationsSnapshot} from './deliveryOperationsPolicy';
import {quoteHash,quoteEntityIdValid} from './deliveryQuoteRecord';
import {detach} from './driverFinancialTransaction';
export type DispatchCycle = ReturnType<typeof createDispatchCycle>;
const bad = (): never => { throw Object.assign(Error('DISPATCH_CYCLE_CONFLICT'), {code:'DISPATCH_CYCLE_CONFLICT'}); };
const date = (value: any) => {
  if(typeof value!=='string'||!Number.isFinite(Date.parse(value))||new Date(Date.parse(value)).toISOString()!==value)return bad();
  return Date.parse(value);
};
/** Captured only when a new search is created. Never backfill a live legacy job. */
export function createDispatchCycle(input:{id:string;orderId:string;assignmentId:string;engine:DispatchEngine;startedAt:string;policy:unknown;keyVersion?:2}) {
  if(!input||Object.keys(input).filter(k=>k!=='keyVersion').sort().join(',')!=='assignmentId,engine,id,orderId,policy,startedAt'||Object.prototype.hasOwnProperty.call(input,'keyVersion')&&input.keyVersion!==2||![input.id,input.orderId,input.assignmentId].every(quoteEntityIdValid)||!['LEGACY','FINANCIAL'].includes(input.engine))return bad();
  const snapshot=validateOperationsSnapshot(input.policy);
  if(snapshot.version<1||!snapshot.values.dispatch)return bad();
  const dispatch=validateDispatchPolicy(snapshot.values.dispatch),profile=dispatch.profiles[input.engine],start=date(input.startedAt);
  const deadline=start+profile.totalDispatchSeconds*1000;
  if(!Number.isSafeInteger(deadline))return bad();
  const body={schemaVersion:1 as const,...(input.keyVersion===2?{keyVersion:2 as const}:{}),id:input.id,orderId:input.orderId,assignmentId:input.assignmentId,engine:input.engine,startedAt:input.startedAt,searchDeadline:new Date(deadline).toISOString(),policy:snapshot};
  return {...detach(body),digest:quoteHash(body)};
}
export function validateDispatchCycle(value:any):DispatchCycle {
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).filter(k=>k!=='keyVersion').sort().join(',')!=='assignmentId,digest,engine,id,orderId,policy,schemaVersion,searchDeadline,startedAt'||Object.prototype.hasOwnProperty.call(value,'keyVersion')&&value.keyVersion!==2||value.schemaVersion!==1)return bad();
  const rebuilt=createDispatchCycle({id:value.id,orderId:value.orderId,assignmentId:value.assignmentId,engine:value.engine,startedAt:value.startedAt,policy:value.policy,...(value.keyVersion!==undefined?{keyVersion:value.keyVersion}:{})});
  if(rebuilt.digest!==value.digest||rebuilt.searchDeadline!==value.searchDeadline)return bad();
  return rebuilt;
}
export interface DispatchProgress {
  currentWave: number;
  assigned: boolean;
  terminal: boolean;
  waveState: 'NONE'|'PREPARING'|'OPEN'|'EXPIRED'|'EMPTY'|'ALL_DECLINED';
  waveDeadline: string | null;
}
/** Shared decision only. The caller must read progress from the server and fence
 * it with the order, job and wave in its transaction. No Invoke, offers or money.
 */
export function decideDispatchTransition(value:unknown,progress:DispatchProgress,at:string) {
  const c=validateDispatchCycle(value),now=date(at),p=c.policy.values.dispatch!.profiles[c.engine];
  if(!progress||Object.keys(progress).sort().join(',')!=='assigned,currentWave,terminal,waveDeadline,waveState'||!Number.isSafeInteger(progress.currentWave)||progress.currentWave<0||progress.currentWave>p.normalWaves.length||typeof progress.assigned!=='boolean'||typeof progress.terminal!=='boolean'||!['NONE','PREPARING','OPEN','EXPIRED','EMPTY','ALL_DECLINED'].includes(progress.waveState))return bad();
  if(progress.waveDeadline!==null)date(progress.waveDeadline);
  if(progress.assigned)return {action:'STOP' as const,reason:'ASSIGNED' as const};
  if(progress.terminal)return {action:'STOP' as const,reason:'ORDER_TERMINAL' as const};
  if(now<date(c.startedAt))return bad();
  if(now>=date(c.searchDeadline))return {action:'REVIEW' as const,reason:'SEARCH_DEADLINE' as const};
  if(progress.currentWave===0){
    if(progress.waveState!=='NONE'||progress.waveDeadline!==null)return bad();
  }else{
    if(progress.waveState==='NONE'||progress.waveDeadline===null||date(progress.waveDeadline)<date(c.startedAt)||date(progress.waveDeadline)>date(c.searchDeadline))return bad();
    if(progress.waveState==='PREPARING')return date(progress.waveDeadline)>now?{action:'RESUME' as const,waveNumber:progress.currentWave}:{action:'REVIEW' as const,reason:'PREPARATION_DEADLINE' as const};
    if(progress.waveState==='OPEN'&&date(progress.waveDeadline)>now)return {action:'WAIT' as const,until:progress.waveDeadline};
    if(progress.waveState==='EXPIRED'&&date(progress.waveDeadline)>now)return bad();
  }
  if(progress.currentWave>=p.normalWaves.length)return {action:'REVIEW' as const,reason:'NORMAL_WAVES_EXHAUSTED' as const};
  const number=progress.currentWave+1,deadline=Math.min(now+p.waveDurationSeconds*1000,date(c.searchDeadline));
  return {action:'START_WAVE' as const,waveNumber:number,rule:detach(p.normalWaves[number-1]),deadline:new Date(deadline).toISOString(),offerTtlSeconds:p.offerTtlSeconds,remainingSeconds:Math.floor((date(c.searchDeadline)-now)/1000)};
}
