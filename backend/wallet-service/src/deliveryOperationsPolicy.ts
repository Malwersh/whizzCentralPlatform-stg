import {DispatchPolicy,validateDispatchPolicy} from './dispatchPolicy';
export const OPERATIONS_PK='OPERATIONAL_SETTINGS#DELIVERY_OPERATIONS';
export const OPERATIONS_LIMITS={quoteMaxPerCustomerPerMinute:[1,120],driverOfferTtlSeconds:[1,900],driverPositionMaxAgeSeconds:[1,900],reassignmentWindowSeconds:[30,900],maximumWaves:[1,10]} as const;
export type DeliveryOperationsValues={quoteMaxPerCustomerPerMinute:number;driverOfferTtlSeconds:number;driverPositionMaxAgeSeconds:number;reassignmentWindowSeconds:number;maximumWaves:number;dispatch?:DispatchPolicy};
export function validateOperationsValues(input:unknown):DeliveryOperationsValues {
 const bad=(code='INVALID_DISPATCH_SETTINGS'):never=>{throw Object.assign(Error(code),{code,status:400});};
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).filter(k=>k!=='dispatch').sort().join(',')!==Object.keys(OPERATIONS_LIMITS).sort().join(','))return bad();
 const v=input as DeliveryOperationsValues;
 for(const k of Object.keys(OPERATIONS_LIMITS) as (keyof typeof OPERATIONS_LIMITS)[]){const [min,max]=OPERATIONS_LIMITS[k];if(!Number.isSafeInteger(v[k])||v[k]<min||v[k]>max)return bad();}
 if(v.driverPositionMaxAgeSeconds<v.driverOfferTtlSeconds)return bad('POSITION_WINDOW_TOO_SHORT');
 if(Object.prototype.hasOwnProperty.call(v,'dispatch')){
  const dispatch=validateDispatchPolicy(v.dispatch),p=dispatch.profiles.FINANCIAL;
  if(p.offerTtlSeconds!==v.driverOfferTtlSeconds||p.positionMaxAgeSeconds!==v.driverPositionMaxAgeSeconds||p.reassignmentWindowSeconds!==v.reassignmentWindowSeconds||p.normalWaves.length!==v.maximumWaves)return bad('DISPATCH_LIMITS_CONFLICT');
  return {...v,dispatch};
 }
 return {...v};
}

export function validateOperationsSnapshot(input:any){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).sort().join(',')!=='values,version'||!Number.isSafeInteger(input.version)||input.version<0)throw Error('DELIVERY_OPERATIONS_UNAVAILABLE');
 return {version:input.version,values:validateOperationsValues(input.values)};
}
