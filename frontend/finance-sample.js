'use strict';
// Explicit preparation for review; this file never writes or publishes a policy.
window.loadApprovedFinanceSample = async function () {
 const response=await fetch('/finance-sample-64.json',{cache:'no-store'});
 if(!response.ok)throw Error('تعذر تحميل قيم العينة المعتمدة. أعد المحاولة.');
 const value=await response.json();
 if(value?.schemaVersion!==1||value.kind!=='APPROVED_STAGING_SAMPLE'||value.environment!=='Staging'||typeof value.businessId!=='string'||!value.businessId||value.requiresExplicitSave!==true||value.requiresOwnerConsent!==true||value.requiresIndependentApproval!==true||!Array.isArray(value.pricing?.deliveryRules)||!Array.isArray(value.pricing?.driverRules)||!value.agreement?.values)throw Error('ملف العينة غير صالح؛ أعد تحميل الصفحة.');
 return value;
};
