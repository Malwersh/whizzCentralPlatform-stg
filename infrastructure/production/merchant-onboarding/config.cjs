'use strict';
const {validate,DEFAULTS}=require('../../../backend/staff-service/onboarding-policy');
// Prepare configuration only. Initialization never opens registration or approves terms.
function prepareInitialConfig({policyVersion,actorId,now}) {
 if(typeof policyVersion!=='string'||!/^[a-f0-9-]{36}$/i.test(policyVersion)||typeof actorId!=='string'||!actorId.trim()||!Number.isFinite(Date.parse(now)))throw Error('INVALID_CONFIG_IDENTITY');
 const values=validate({...DEFAULTS,termsVersion:'production-pending-1',partnershipReady:false});
 const current={pk:'OPERATIONAL_SETTINGS#MERCHANT_ONBOARDING',sk:'CURRENT',version:1,policyVersion,values,updatedBy:actorId,updatedAt:now,effectiveFor:'NEW_REQUESTS'};
 return {TransactItems:[current,{...current,sk:'VERSION#'+policyVersion}].map(Item=>({Put:{TableName:'wizz-production-PlatformStaff',Item,ConditionExpression:'attribute_not_exists(pk)'}}))};
}
module.exports={prepareInitialConfig};
