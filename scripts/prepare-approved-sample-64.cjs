'use strict';
// Prepare human-reviewable forms only. No AWS client, staff identity or consent write.
const fs=require('node:fs'),assert=require('node:assert/strict');
const approved=require('../docs/finance-commercial-pricing-approval-59.json'),proposal=require('../docs/finance-commercial-pricing-proposal-58.json');
const branch=JSON.parse(fs.readFileSync('/private/tmp/finance64/branch.private.json'));
assert.equal(branch.businessId,'business_95ac73c9-feda-4207-9285-550aec61b94c');assert(branch.organizationId&&branch.status==='approved');
const values=structuredClone(proposal.rulesForReview);
for(const [kind,id,rounding]of [['deliveryRules','FATTOUSH_SAMPLE_DELIVERY',approved.customerDelivery.finalRounding],['driverRules','FATTOUSH_SAMPLE_DRIVER',approved.driverEarning.finalRounding]]){
 assert.equal(values[kind].length,1);Object.assign(values[kind][0],{id,scope:{type:'BRANCH',id:branch.businessId},finalRounding:rounding});
 if(kind==='deliveryRules')values[kind][0].coverage.supportedZoneIds=[branch.regionId];
}
require('../backend/wallet-service/dist/deliveryPricing').validatePricingRules(values);
const m=x=>({currency:'IQD',scale:1000,moneySchemaVersion:1,minorAmount:x*1000});
const agreementValues={scope:'BRANCH',effectiveFrom:'2026-10-17T00:00:00.000Z',effectiveTo:null,
 commission:{kind:'PERCENT',basis:approved.merchantCommission.basis,fixed:null,rate:{numerator:1000,denominator:10000},rounding:'HALF_AWAY_FROM_ZERO',finalRounding:approved.merchantCommission.finalRounding},
 serviceFee:{kind:'FIXED',basis:null,fixed:m(approved.customerServiceFee.amountIqd),rate:null,rounding:'EXACT',finalRounding:approved.customerServiceFee.finalRounding},allowedFundingPolicyIds:[]};
require('../backend/staff-service/commercial-management').agreementValues(agreementValues);
const out={schemaVersion:1,kind:'APPROVED_STAGING_SAMPLE',environment:'Staging',businessId:branch.businessId,businessName:branch.businessName,
 pricing:values,agreement:{id:'FATTOUSH_COD_SAMPLE',values:agreementValues},reason:'تجهيز عينة فتوش المعتمدة لاختبار COD',firstOrderDiscount:'NONE',requiresExplicitSave:true,requiresOwnerConsent:true,requiresIndependentApproval:true};
fs.writeFileSync('frontend/finance-sample-64.json',JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify({samplePrepared:true,branch:branch.businessName,commissionPercent:10,serviceFeeIqd:500,persistentDraftSaved:false,approvalWritten:false}));
