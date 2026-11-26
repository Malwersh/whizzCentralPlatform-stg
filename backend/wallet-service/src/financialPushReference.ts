type Row=Record<string,any>;
const fail=():never=>{throw Error('FINANCIAL_PUSH_NOT_ALLOWED');};
export function readFinancialPushReference(value:Row):Row{
 const fields=['financialPushVersion','orderId','offerId','waveNumber','dispatchDriverId','driverId','cycleId','expiresAt','offerDigest'];
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==fields.sort().join(',')||![1,'1'].includes(value.financialPushVersion))return fail();
 const n=typeof value.waveNumber==='string'&&/^\d+$/.test(value.waveNumber)?Number(value.waveNumber):value.waveNumber;
 if(!Number.isSafeInteger(n)||n<1||n>1000||!['orderId','offerId','dispatchDriverId','driverId','cycleId'].every(k=>typeof value[k]==='string'&&/^[A-Za-z0-9][A-Za-z0-9_:#.-]{0,149}$/.test(value[k]))||!Number.isFinite(Date.parse(value.expiresAt))||new Date(Date.parse(value.expiresAt)).toISOString()!==value.expiresAt||!(/^[a-f0-9]{64}$/).test(value.offerDigest))return fail();
 return {...value,financialPushVersion:1,waveNumber:n};
}
