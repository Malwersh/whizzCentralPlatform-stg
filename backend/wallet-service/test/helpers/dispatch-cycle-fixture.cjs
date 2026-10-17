'use strict';
const {setup}=require('./driver-financial-fixture.cjs');
const {createStagingDispatchCycleStore}=require('../../dist/dispatchCycleStore');
function policy(){
 const waves=[{number:1,radiusMeters:5000,recipients:5,minimumAcceptancePercent:70,minimumCompletionPercent:85,maximumConsecutiveDeclines:2},
 {number:2,radiusMeters:10000,recipients:5,minimumAcceptancePercent:60,minimumCompletionPercent:75,maximumConsecutiveDeclines:3},
 {number:3,radiusMeters:15000,recipients:5,minimumAcceptancePercent:50,minimumCompletionPercent:60,maximumConsecutiveDeclines:5},
 {number:4,radiusMeters:20000,recipients:'ALL',minimumAcceptancePercent:0,minimumCompletionPercent:0,maximumConsecutiveDeclines:999}];
 const legacy={normalWaves:waves,offerTtlSeconds:90,waveDurationSeconds:90,totalDispatchSeconds:900,reassignmentWindowSeconds:900,positionMaxAgeSeconds:null,newDriverExemption:{belowCompletedTrips:5,missingHistory:'LEGACY_COMPAT'},repeatOffers:{reofferFromWave:4,excludeUnassignedDrivers:true,policy:'LEGACY_COMPAT'},recovery:{enabled:false,radiusMeters:null,boostBasisPoints:null,maximumPickupEtaSeconds:null,durationSeconds:null,budgetMinor:null,legacyReference:{radiusMeters:30000,boostBasisPoints:2500}}};
 const financial=structuredClone(legacy);Object.assign(financial,{offerTtlSeconds:60,waveDurationSeconds:60,reassignmentWindowSeconds:300,positionMaxAgeSeconds:120});financial.normalWaves[3].recipients=5;financial.recovery.legacyReference=null;
 return {quoteMaxPerCustomerPerMinute:5,driverOfferTtlSeconds:60,driverPositionMaxAgeSeconds:120,reassignmentWindowSeconds:300,maximumWaves:4,dispatch:{schemaVersion:2,performanceMode:'LEGACY_METRICS',profiles:{LEGACY:legacy,FINANCIAL:financial}}};
}
function fixture(engine='FINANCIAL'){
 const f=setup(),candidate=structuredClone(f.get('WizzDispatchJobs_staging',{orderId:'order1',SK:'METADATA'}));
 for(const [key,row]of f.rows)if(key.startsWith('WizzDispatchJobs_staging|')&&row.SK==='METADATA')f.rows.delete(key);
 if(engine==='LEGACY')delete f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'}).financialSnapshot;
 f.put('staging-PlatformStaff',{pk:'OPERATIONAL_SETTINGS#DELIVERY_OPERATIONS',sk:'CURRENT',version:2,values:policy()});
 f.input={requestId:'cycle-creation-1',job:candidate};f.store=createStagingDispatchCycleStore({db:f.db,now:()=>f.time});f.create=()=>f.store.create(f.input);f.job=()=>f.get('WizzDispatchJobs_staging',{orderId:'order1',SK:'METADATA'});return f;
}
module.exports={policy,fixture};
