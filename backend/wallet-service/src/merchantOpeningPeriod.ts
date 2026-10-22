import {merchantOffCyclePeriod} from './merchantOffCyclePeriod';
import {merchantSettlementPeriod,MerchantSettlementSchedule} from './merchantSettlementPeriod';
import {quoteHash} from './deliveryQuoteRecord';
/** Independent opening statement. Never shifts the approved recurring anchor. */
export function merchantOpeningPeriod(schedule:MerchantSettlementSchedule,fromLocalDate:string,cutoffUtc?:string){
 const cutoff=cutoffUtc??new Date(Date.parse(schedule.anchorLocalDate+'T00:00:00.000Z')-10800000).toISOString();
 const anchor=merchantSettlementPeriod(schedule,cutoff);
 if(anchor.fromUtc!==cutoff)throw Error('INVALID_MERCHANT_OPENING_PERIOD');
 if(typeof fromLocalDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(fromLocalDate)||fromLocalDate< '2000-01-01'||fromLocalDate>=anchor.startLocalDate)throw Error('INVALID_MERCHANT_OPENING_PERIOD');
 const probe=merchantSettlementPeriod({...schedule,anchorLocalDate:fromLocalDate,frequency:'WEEKLY'},new Date(Date.parse(fromLocalDate+'T00:00:00.000Z')-10800000).toISOString());
 if(probe.startLocalDate!==fromLocalDate)throw Error('INVALID_MERCHANT_OPENING_PERIOD');
 const content={schemaVersion:1 as const,kind:'MERCHANT_OPENING_PERIOD' as const,scheduleVersion:schedule.version,scheduleDigest:quoteHash(schedule),schedule,timezone:'Asia/Baghdad' as const,startLocalDate:fromLocalDate,endExclusiveLocalDate:anchor.startLocalDate,fromUtc:probe.fromUtc,untilExclusiveUtc:anchor.fromUtc,boundaryRule:'START_INCLUSIVE_END_EXCLUSIVE'};
 return {...content,periodId:'MOP:'+quoteHash(content).slice(0,48)};
}
export type MerchantStatementPeriod=ReturnType<typeof merchantOpeningPeriod>|ReturnType<typeof merchantSettlementPeriod>|ReturnType<typeof merchantOffCyclePeriod>;
