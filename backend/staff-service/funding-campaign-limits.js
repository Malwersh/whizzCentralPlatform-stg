'use strict';
const fail=code=>{throw Object.assign(Error(code),{status:409});};
function validate(campaign,source){
 if(campaign.benefit)return; // Benefits are bounded by the existing per-recipient entitlement contract.
 const total=source==='MERCHANT'?campaign.usage_limit??campaign.usageLimit:campaign.usageLimit??campaign.limit;
 if(!Number.isSafeInteger(total)||total<1)fail('FUNDING_TOTAL_USAGE_LIMIT_REQUIRED');
 const customer=campaign.singleUse?1:campaign.perCustomerLimit;
 if(customer!=null&&(!Number.isSafeInteger(customer)||customer<1))fail('FUNDING_CUSTOMER_USAGE_LIMIT_INVALID');
 const type=String(campaign.type??campaign.discountType??'').toLowerCase();
 const cap=['fixedamount','fixed_amount','fixed'].includes(type)?campaign.value??campaign.discountValue:campaign.maxDiscountAmount??campaign.maxDiscount;
 if(!Number.isSafeInteger(cap)||cap<1)fail('FUNDING_DISCOUNT_CAP_REQUIRED');
 return {totalUseLimit:total,perCustomerLimit:customer??null,maximumDiscountIqd:cap};
}
module.exports={validate};
