import {quoteHash} from './deliveryQuoteRecord';
export type CashboxRow=Record<string,any>;
export const cashboxDirectory='MERCHANT_CASHBOXES#GLOBAL';
export const cashboxKey=(code:string)=>({pk:cashboxDirectory,sk:'BOX#'+code});
export const cashboxCode=(v:any)=>typeof v==='string'&&/^[A-Z][A-Z0-9-]{2,39}$/.test(v);
export const cashVoucherNumber=(p:CashboxRow)=>'CPV-'+new Date(Date.parse(p.createdAt)+10800000).toISOString().slice(0,10).replace(/-/g,'')+'-'+quoteHash({payoutId:p.payoutId}).slice(0,24).toUpperCase();
export const cashMovementKey=(p:CashboxRow)=>({pk:'MERCHANT_CASHBOX#'+p.sourceAccount,sk:'VOUCHER#'+p.executionRecordedAt+'#'+p.payoutId});
export function validateCashbox(v:CashboxRow){
 if(!cashboxCode(v.code)||!['ACTIVE','INACTIVE'].includes(v.status)||['name','custodian','location'].some(k=>typeof v[k]!=='string'||v[k].trim().length<2||v[k].length>120)||typeof v.reason!=='string'||v.reason.trim().length<5||v.reason.length>500)throw Object.assign(Error('PAYOUT_CASHBOX_INVALID'),{code:'PAYOUT_CASHBOX_INVALID'});
}
