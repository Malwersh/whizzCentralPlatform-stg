import {strongGet,exactCheck} from './driverFinancialTransaction';
import {quoteHash} from './deliveryQuoteRecord';
export const RETURN_OPERATIONS_PK='OPERATIONAL_SETTINGS#RETURN_OPERATIONS';
export const RETURN_OPERATIONS_DEFAULTS={enabled:true,closingMarginSeconds:900,branchWaitSeconds:300};
export function validateReturnOperations(v:any){if(!v||Object.keys(v).sort().join(',')!=='branchWaitSeconds,closingMarginSeconds,enabled'||typeof v.enabled!=='boolean'||!Number.isSafeInteger(v.closingMarginSeconds)||v.closingMarginSeconds<300||v.closingMarginSeconds>3600||!Number.isSafeInteger(v.branchWaitSeconds)||v.branchWaitSeconds<60||v.branchWaitSeconds>1800)throw Object.assign(Error('INVALID_RETURN_OPERATIONS'),{code:'INVALID_RETURN_OPERATIONS',status:400});return {...v};}
export async function readReturnOperations(db:any){const key={pk:RETURN_OPERATIONS_PK,sk:'CURRENT'},row=await strongGet(db,'staging-PlatformStaff',key);if(!row||!Number.isSafeInteger(row.version)||row.version<1||typeof row.policyVersion!=='string')throw Object.assign(Error('RETURN_OPERATIONS_UNAVAILABLE'),{code:'RETURN_OPERATIONS_UNAVAILABLE'});const body={schemaVersion:1,version:row.version,policyVersion:row.policyVersion,values:validateReturnOperations(row.values)};return {snapshot:{...body,digest:quoteHash(body)},condition:exactCheck('staging-PlatformStaff',key,row)};}
/** Sunday=0, Baghdad local time. Missing/malformed/overlapping schedules never authorize. */
export function branchClosingAt(hours:any,at:number):number|null{
 if(!Array.isArray(hours)||hours.length!==7||new Set(hours.map(x=>Number(x.day))).size!==7)return null;
 const minute=(s:any)=>typeof s==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(s)?Number(s.slice(0,2))*60+Number(s.slice(3)):null;
 const local=new Date(at+10800000),midnight=Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate())-10800000,day=local.getUTCDay(),intervals:number[][]=[];
 for(const offset of [-1,0]){const h=hours.find(x=>Number(x.day)===(day+offset+7)%7);if(!h||typeof h.closed!=='boolean'||!Array.isArray(h.periods)||h.periods.length>4)return null;if(h.closed)continue;for(const p of h.periods){const a=minute(p.open),b=minute(p.close);if(a==null||b==null||a===b)return null;const start=midnight+offset*86400000+a*60000,end=midnight+offset*86400000+b*60000+(b<a?86400000:0);if(at>=start&&at<end)intervals.push([start,end]);}}
 return intervals.length===1?intervals[0][1]:null;
}
