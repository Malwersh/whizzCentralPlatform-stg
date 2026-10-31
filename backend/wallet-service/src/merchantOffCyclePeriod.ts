import {merchantSettlementPeriod,MerchantSettlementSchedule} from './merchantSettlementPeriod';
import {quoteHash} from './deliveryQuoteRecord';
const fail=():never=>{throw Object.assign(Error('SETTLEMENT_OFF_CYCLE_INVALID'),{code:'SETTLEMENT_OFF_CYCLE_INVALID'});};
/** Explicit off-cycle scope. Cutoff is issued by the server; dates choose membership,
 * never change original accrual/payment dates or the approved recurring schedule. */
export function merchantOffCyclePeriod(schedule:MerchantSettlementSchedule,fromLocalDate:string,throughLocalDate:string,cutoffUtc:string,reason:string){
 if(typeof cutoffUtc!=='string'||!Number.isFinite(Date.parse(cutoffUtc))||new Date(cutoffUtc).toISOString()!==cutoffUtc||typeof reason!=='string'||reason.trim().length<10||reason.length>1000)return fail();
 const day=(v:string)=>{if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v+'T00:00:00.000Z'))||new Date(v+'T00:00:00.000Z').toISOString().slice(0,10)!==v||v<'2000-01-01')return fail();return Date.parse(v+'T00:00:00.000Z');};
 const from=day(fromLocalDate),through=day(throughLocalDate),today=new Date(Date.parse(cutoffUtc)+10800000).toISOString().slice(0,10);if(from>through||through-from>365*86400000||throughLocalDate>today)return fail();
 merchantSettlementPeriod(schedule,cutoffUtc); // Strict approved schedule shape.
 const fromUtc=new Date(from-10800000).toISOString(),requestedUntilUtc=new Date(through+86400000-10800000).toISOString(),untilExclusiveUtc=requestedUntilUtc<cutoffUtc?requestedUntilUtc:cutoffUtc;if(fromUtc>=untilExclusiveUtc)return fail();
 const content={schemaVersion:1 as const,kind:'MERCHANT_OFF_CYCLE_PERIOD' as const,scheduleVersion:schedule.version,scheduleDigest:quoteHash(schedule),schedule,timezone:'Asia/Baghdad' as const,startLocalDate:fromLocalDate,throughLocalDate,endExclusiveLocalDate:new Date(through+86400000).toISOString().slice(0,10),fromUtc,untilExclusiveUtc,cutoffUtc,requestedUntilUtc,reason:reason.trim(),boundaryRule:'START_INCLUSIVE_END_EXCLUSIVE',cutoffRule:'SERVER_SNAPSHOT_NO_FUTURE_ACCRUALS',recurringScheduleChanged:false};
 return {...content,periodId:'MOF:'+quoteHash(content).slice(0,48)};
}
