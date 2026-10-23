'use strict';
// Build the additive policy consumed by publish-general-pricing-321.py. No financial writes.
const fs=require('node:fs'),assert=require('node:assert/strict');
const engine=require('../backend/wallet-service/dist/deliveryPricing');
const {parseIqd:m}=require('../backend/wallet-service/dist/money');
const {quoteHash}=require('../backend/wallet-service/dist/deliveryQuoteRecord');
function prepare(current,areas,approved){
 assert.equal(approved.status,'USER_APPROVED_BASELINE');
 assert.ok(Array.isArray(areas)&&areas.length&&areas.every(a=>a.hasIndex===true));
 assert.ok(![...current.values.deliveryRules,...current.values.driverRules].some(r=>r.id.startsWith('APPROVED_BASELINE_GLOBAL_')),'General baseline already exists; edit it through the platform');
 const zoneIds=[...new Set(areas.map(a=>a.regionId))].sort();
 const zero=m('0'),effectiveFrom='2026-10-23T00:00:00.000Z';
 const common={version:1,scope:{type:'GLOBAL',id:'GLOBAL'},priority:0,status:'PUBLISHED',effectiveFrom,effectiveTo:null,rounding:'HALF_AWAY_FROM_ZERO',vehicleType:null,fallbackPolicyId:null,longDistance:{afterMeters:10000,flat:zero,perKm:zero},peaks:[]};
 const d=approved.customerDelivery,e=approved.driverEarning;
 const customer={...common,id:'APPROVED_BASELINE_GLOBAL_DELIVERY',base:m(String(d.baseIqd)),perKm:m(String(d.perKmIqd)),tiers:[],minimum:m(String(d.minimumIqd)),maximum:m(String(d.maximumIqd)),finalRounding:d.finalRounding,coverage:{enabled:true,maxRoadMeters:d.maxRoadMeters,maxDurationSeconds:d.maxDurationSeconds,supportedZoneIds:zoneIds}};
 const driver={...common,id:'APPROVED_BASELINE_GLOBAL_DRIVER',base:m(String(e.baseIqd)),pickupPerKm:m(String(e.pickupPerKmIqd)),pickupIncludedMeters:e.pickupIncludedMeters,deliveryPerKm:m(String(e.deliveryPerKmIqd)),perMinute:m(String(e.perMinuteIqd)),minimum:m(String(e.minimumIqd)),maximum:m(String(e.maximumIqd)),finalRounding:e.finalRounding};
 const values=engine.validatePricingRules({deliveryRules:[...current.values.deliveryRules,customer],driverRules:[...current.values.driverRules,driver]});
 return {status:'APPROVED_GENERAL_PRICING',livePolicyVersion:current.version,livePolicyValuesHash:quoteHash(current.values),proposedPolicyVersion:current.version+1,effectiveFromRequiresRevalidationAtPublication:true,approvedAmountsSource:'docs/finance-commercial-pricing-approval-59.json',coverage:areas,values,activatesPolicy:true,performsFinancialWrites:false};
}
module.exports={prepare};
if(require.main===module){
 const [policyFile,areaFile,outputFile]=process.argv.slice(2);assert.ok(policyFile&&areaFile&&outputFile,'Supply policy, coverage and output paths');
 const policy=prepare(JSON.parse(fs.readFileSync(policyFile)),JSON.parse(fs.readFileSync(areaFile)),require('../docs/finance-commercial-pricing-approval-59.json'));
 fs.writeFileSync(outputFile,JSON.stringify(policy,null,2)+'\n');
 console.log('Validated additive general pricing; existing overrides preserved.');
}
