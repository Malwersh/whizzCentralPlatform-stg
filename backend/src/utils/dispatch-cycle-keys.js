'use strict';
// Frozen cycle key contract. No lookup fallback to another cycle or old key.
const crypto=require('node:crypto');
const fail=()=>{throw Error('DISPATCH_KEY_SCOPE_REQUIRED');};
function scope(c){
 if(!c||!['LEGACY','FINANCIAL'].includes(c.engine)||typeof c.id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_:#.-]{0,149}$/.test(c.id))return fail();
 if(c.keyVersion===undefined)return '';
 if(![2,3].includes(c.keyVersion)||c.keyVersion===3&&c.engine!=='FINANCIAL')return fail();
 return 'CYCLE#'+crypto.createHash('sha256').update(c.id).digest('hex')+'#';
}
function number(n){if(!Number.isSafeInteger(n)||n<1||n>1000)return fail();return n;}
function dispatchWaveSK(c,n){return scope(c)+(c.engine==='FINANCIAL'?'FINANCIAL_WAVE#':'LEGACY_WAVE#')+number(n);}
function dispatchOfferSK(c,driver,n){if(typeof driver!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_:#.-]{0,149}$/.test(driver))return fail();const prefix=scope(c);return (c.engine==='FINANCIAL'?(c.keyVersion===3?prefix:'')+'FINANCIAL#':prefix)+driver+'#WAVE#'+number(n);}
module.exports={dispatchWaveSK,dispatchOfferSK};
