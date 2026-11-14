'use strict';
// These are the exact aliases accepted by merchant onboarding, not a grouping
// by FOOD/RETAIL, merchant name or menu contents. Explicit IDs always win.
const aliases=Object.freeze({restaurant:'RESTAURANT',grocery:'MARKET',store:'STORE'});
function resolve(business,types){
 const explicit=business?.businessTypeId||business?.business_type_id;
 const value=explicit||aliases[String(business?.businessType||business?.business_type||'').trim().toLowerCase()]||null;
 return value&&(!types||types.some(t=>t.id===value))?value:null;
}
module.exports={resolve};
