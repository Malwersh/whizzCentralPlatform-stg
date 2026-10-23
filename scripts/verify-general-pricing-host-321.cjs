'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const dir=process.argv[2];assert.ok(path.isAbsolute(dir));const active=JSON.parse(fs.readFileSync(path.join(dir,'policy-active.json'))),prior=JSON.parse(fs.readFileSync(path.join(dir,'policy-before.json'))),engine=require(path.join(dir,'staff-live/pricing-runtime/deliveryPricing.js'));
engine.validatePricingRules(active.values);
for(const kind of ['deliveryRules','driverRules'])assert.deepEqual(active.values[kind].slice(0,-1),prior.values[kind]);
const at=new Date().toISOString(),route={id:'read-only-proof',source:'OFFLINE_VERIFICATION',quality:'ROAD',fallbackPolicyId:null,distanceMeters:3000,durationSeconds:600,measuredAt:at,expiresAt:new Date(Date.parse(at)+120000).toISOString()};
const context={branchId:'business_1791634772438_p2hlg6w5qii',merchantId:'UNBOUND_MERCHANT',zoneId:'Rmhvcpnn3iy5f1',cityId:'UNBOUND_CITY',governorateId:'gov',vehicleType:'motorcycle'};
let checks=0;
for(const zoneId of active.values.deliveryRules.at(-1).coverage.supportedZoneIds)for(const branchId of [context.branchId,'FUTURE_BRANCH_WITH_OWN_GPS']){
 const ctx={...context,zoneId,branchId},f=engine.calculateDeliveryFee({schemaVersion:1,at,context:ctx,rules:active.values.deliveryRules,deliveryRoute:route,discount:null});
 assert.equal(f.rule.id,'APPROVED_BASELINE_GLOBAL_DELIVERY');assert.equal(f.customerDeliveryFee.minorAmount,2500000);
 const e=engine.calculateDriverEarning({schemaVersion:1,at,context:ctx,rules:active.values.driverRules,deliveryRoute:route,pickupRoute:{...route,distanceMeters:1000}});assert.equal(e.rule.id,'APPROVED_BASELINE_GLOBAL_DRIVER');assert.equal(e.driverEarning.minorAmount,2250000);checks+=2;
}
const fattoush={...context,branchId:'business_95ac73c9-feda-4207-9285-550aec61b94c'};
assert.equal(engine.calculateDeliveryFee({schemaVersion:1,at,context:fattoush,rules:active.values.deliveryRules,deliveryRoute:route,discount:null}).rule.id,'FATTOUSH_SAMPLE_DELIVERY');
assert.equal(engine.calculateDriverEarning({schemaVersion:1,at,context:fattoush,rules:active.values.driverRules,deliveryRoute:route,pickupRoute:{...route,distanceMeters:1000}}).rule.id,'FATTOUSH_SAMPLE_DRIVER');
assert.throws(()=>engine.calculateDeliveryFee({schemaVersion:1,at,context:{...context,zoneId:'UNAPPROVED_ZONE'},rules:active.values.deliveryRules,deliveryRoute:route,discount:null}),e=>e.code==='OUTSIDE_DELIVERY_RANGE');
const r={status:'PASS',verifiedGeneralFeeAndDriverCases:checks,approvedZoneCount:8,branchOverridesPreserved:true,unapprovedZoneRejected:true,livePolicyAndLiveEngine:true,routeInputs:'OFFLINE_VERIFICATION, not a provider request or customer quote',financialWrites:0};
fs.writeFileSync(path.join(dir,'host-verification.json'),JSON.stringify(r,null,2)+'\n');console.log(JSON.stringify(r));
