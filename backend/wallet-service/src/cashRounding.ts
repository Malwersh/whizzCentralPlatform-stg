import {Money, readMoney, addMoney, subtractMoney, fromWholeIqd, quantizeWholeIqd, toWholeIqdExact} from './money';
import {quoteHash, quoteCanonical} from './deliveryQuoteRecord';
const fail=():never=>{throw Object.assign(Error('INVALID_CASH_ROUNDING'),{code:'INVALID_CASH_ROUNDING'});};
export const CASH_ROUNDING_PK='OPERATIONAL_SETTINGS#CASH_ROUNDING';
export type CashRoundingPolicy={schemaVersion:1;enabled:boolean;incrementIqd:number;mode:'UP'|'DOWN'|'NEAREST';minimumServiceFeeIqd:number;minimumConflict:'NEXT_COLLECTIBLE_TOTAL';};
export function validateCashRoundingPolicy(value:unknown):CashRoundingPolicy{
 if(!value||typeof value!=='object'||Array.isArray(value))return fail();
 const r=value as CashRoundingPolicy;
 if(Object.keys(r).sort().join(',')!=='enabled,incrementIqd,minimumConflict,minimumServiceFeeIqd,mode,schemaVersion'||r.schemaVersion!==1||typeof r.enabled!=='boolean'||!['UP','DOWN','NEAREST'].includes(r.mode)||!Number.isSafeInteger(r.incrementIqd)||r.incrementIqd<1||r.incrementIqd>10000||!Number.isSafeInteger(r.minimumServiceFeeIqd)||r.minimumServiceFeeIqd<250||r.minimumServiceFeeIqd>10000||r.minimumConflict!=='NEXT_COLLECTIBLE_TOTAL')return fail();
 return {...r};
}
/** Whole invoice, once, after every benefit and tip; the signed difference belongs solely to service revenue. */
export function calculateCashRounding(input:{policy:unknown;version:number;paymentMethod:'COD'|'PREPAID';customerTotal:Money;baseServiceFee:Money}){
 const policy=validateCashRoundingPolicy(input.policy);
 if(!Number.isSafeInteger(input.version)||input.version<1||!['COD','PREPAID'].includes(input.paymentMethod))return fail();
 const before=readMoney(input.customerTotal),base=readMoney(input.baseServiceFee);
 toWholeIqdExact(before);toWholeIqdExact(base);
 if(base.minorAmount<0||before.minorAmount<base.minorAmount)return fail();
 const applied=policy.enabled&&input.paymentMethod==='COD';
 let requested=before,final=before,minimumOverride=false;
 if(applied){
  requested=quantizeWholeIqd(before,{incrementIqd:policy.incrementIqd,mode:policy.mode==='UP'?'CEILING':policy.mode==='DOWN'?'TOWARD_ZERO':'HALF_AWAY_FROM_ZERO'});
  const threshold=addMoney(subtractMoney(before,base),fromWholeIqd(policy.minimumServiceFeeIqd));
  final=requested;
  if(final.minorAmount<threshold.minorAmount){final=quantizeWholeIqd(threshold,{incrementIqd:policy.incrementIqd,mode:'CEILING'});minimumOverride=true;}
 }
 const adjustment=subtractMoney(final,before),serviceFee=addMoney(base,adjustment);
 const body={schemaVersion:1,kind:'CASH_ROUNDING_EVIDENCE',policy:{version:input.version,digest:quoteHash(policy),values:policy},paymentMethod:input.paymentMethod,applied,baseServiceFee:base,requestedCustomerTotal:requested,customerTotalBefore:before,adjustment,serviceFee,customerTotal:final,minimumOverride,minimumOverrideReason:minimumOverride?'MINIMUM_SERVICE_FEE_REQUIRES_NEXT_COLLECTIBLE_TOTAL':null,beneficiary:adjustment.minorAmount>0?'PLATFORM':adjustment.minorAmount<0?'CUSTOMER':'NONE'};
 return {...body,digest:quoteHash(body)};
}
export function verifyCashRoundingEvidence(value:unknown){
 if(!value||typeof value!=='object')return fail();
 const r=value as ReturnType<typeof calculateCashRounding>;
 const rebuilt=calculateCashRounding({policy:r.policy?.values,version:r.policy?.version,paymentMethod:r.paymentMethod,customerTotal:r.customerTotalBefore,baseServiceFee:r.baseServiceFee});
 if(quoteCanonical(rebuilt)!==quoteCanonical(value))return fail();
 return rebuilt;
}
