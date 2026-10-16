const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMapboxRoadRouter, createCoveredDeliveryRouter, calculateCoveredRoadDeliveryFee } = require('../dist/roadRouting');
const { parseIqd: m } = require('../dist/money');
const origin = { latitude:31.925, longitude:44.457 }, destination = { latitude:32.01, longitude:44.51 };
const time = Date.parse('2026-10-15T12:00:00.000Z');
const ok = (distance=2100.1, duration=300.2) => new Response(JSON.stringify({ code:'Ok', routes:[{distance,duration}] }));
const make = (overrides={}) => createMapboxRoadRouter({getAccessToken:async()=>'secret-test-token', profile:'driving',ttlSeconds:120,timeoutMs:500,now:()=>time,fetchImpl:async()=>ok(),...overrides});
const rejectCode = (promise, code) => assert.rejects(promise, e => e.code === code && !e.message.includes('secret'));
const coverage = async() => ({ regionId:'z1', active:true, hierarchyActive:true, insidePolygon:true, referenceVersion:'v4' });
const covered = (overrides={}) => createCoveredDeliveryRouter({router:make(),resolveCoverage:coverage,...overrides});

test('fixed Mapbox host, longitude first, profile, no redirects and no route geometry', async()=>{
 let seen;
 const result = await make({profile:'driving-traffic',fetchImpl:async(url, options)=>{seen={url,options};return ok();}}).getRoute(origin,destination);
 assert.equal(seen.url.origin,'https://api.mapbox.com');
 assert.equal(seen.url.pathname,'/directions/v5/mapbox/driving-traffic/44.457,31.925;44.51,32.01');
 assert.equal(seen.url.searchParams.get('alternatives'),'false');
 assert.equal(seen.url.searchParams.get('overview'),'false');
 assert.equal(seen.options.redirect,'error');
 assert.equal(result.route.distanceMeters,2101); assert.equal(result.route.durationSeconds,301);
 assert.equal(result.route.quality,'ROAD'); assert.equal(result.route.fallbackPolicyId,null);
 assert.equal(result.route.expiresAt,'2026-10-15T12:02:00.000Z');
 assert.equal(result.profile,'driving-traffic');
 assert.deepEqual(result.origin,origin);
 assert.ok(Object.isFrozen(result) && Object.isFrozen(result.route) && Object.isFrozen(result.origin));
 assert.ok(!JSON.stringify(result).includes('secret'));
});
test('coordinates and option bounds rejected before credentials or provider', async()=>{
 let calls=0; const router=make({getAccessToken:async()=>{calls++;return 'secret';}});
 for (const p of [null,[],{latitude:91,longitude:1},{latitude:1,longitude:Infinity},{...origin, distanceMeters:0},{latitude:'31',longitude:44}]) {
  await rejectCode(router.getRoute(p,destination),'INVALID_ROUTE_INPUT');
 }
 assert.equal(calls,0);
 for (const option of [{ttlSeconds:0},{ttlSeconds:901},{timeoutMs:99},{profile:'walking'}]) {
  assert.throws(()=>make(option),e=>e.code==='INVALID_ROUTE_INPUT');
 }
 assert.equal((await router.getRoute({latitude:0,longitude:0},{latitude:0,longitude:0})).origin.latitude,0);
});
test('missing credentials and lookup errors are sanitized',async()=>{
 for (const getAccessToken of [async()=>'',async()=>{throw new Error('secret credential path');}]) {
  await rejectCode(make({getAccessToken}).getRoute(origin,destination),'ROUTING_NOT_CONFIGURED');
 }
});
test('NoRoute, empty/ambiguous routes, malformed metrics, JSON and HTTP failures never produce estimates',async()=>{
 const responses=[()=>new Response('{}',{status:429}),()=>new Response('broken'),()=>new Response(JSON.stringify({code:'NoRoute',routes:[]})),
  ()=>new Response(JSON.stringify({code:'Ok',routes:[]})),()=>new Response(JSON.stringify({code:'Ok',routes:[{distance:1,duration:1},{distance:2,duration:2}]})),
  ()=>ok(-1,1),()=>ok(1,-1),()=>ok('10',1),()=>ok(Number.MAX_SAFE_INTEGER+1,1)];
 for(const response of responses) await rejectCode(make({fetchImpl:async()=>response()}).getRoute(origin,destination),'ROUTE_UNAVAILABLE');
 await rejectCode(make({fetchImpl:async()=>{throw new Error('secret URL with token');}}).getRoute(origin,destination),'ROUTE_UNAVAILABLE');
});
test('response bodies are bounded',async()=>{
 await rejectCode(make({fetchImpl:async()=>new Response('x'.repeat(65537))}).getRoute(origin,destination),'ROUTE_UNAVAILABLE');
});
test('deadline includes credential lookup and stops a late credential from sending a request',async()=>{
 let calls=0, release;
 const token=new Promise(resolve=>{release=resolve;});
 await rejectCode(make({timeoutMs:100,getAccessToken:()=>token,fetchImpl:async()=>{calls++;return ok();}}).getRoute(origin,destination),'ROUTE_UNAVAILABLE');
 release('secret'); await new Promise(resolve=>setImmediate(resolve)); assert.equal(calls,0);
});
test('deadline covers a provider that ignores abort and a stalled response body',async()=>{
 for(const fetchImpl of [async()=>new Promise(()=>{}),async()=>new Response(new ReadableStream({start(){}}))]) {
  await rejectCode(make({timeoutMs:100,fetchImpl}).getRoute(origin,destination),'ROUTE_UNAVAILABLE');
 }
});
test('routes expired during lookup and backward clocks are rejected',async()=>{
 for (const end of [time+120000,time-1]) {
  let reads=0;
  await rejectCode(make({now:()=>reads++ ? end:time}).getRoute(origin,destination),'ROUTE_UNAVAILABLE');
 }
});
test('coverage verifies both endpoints before calling provider; nearest matches and disabled hierarchy rejected',async()=>{
 let calls=0;const router=make({fetchImpl:async()=>{calls++;return ok();}});
 for (const match of [null,{...await coverage(),insidePolygon:false},{...await coverage(),active:false},{...await coverage(),hierarchyActive:false},{...await coverage(),referenceVersion:''}]) {
  await rejectCode(covered({router,resolveCoverage:async p=>p.latitude===origin.latitude ? await coverage():match}).getDeliveryRoute(origin,destination),'OUTSIDE_COVERAGE');
 }
 assert.equal(calls,0);
});
test('binding snapshots coordinates before I/O and only retains allowed reference fields',async()=>{
 const mutable={...origin};
 const r=await covered({resolveCoverage:async()=>{mutable.latitude=10;return {...await coverage(),ownerPhone:'private'};}}).getDeliveryRoute(mutable,destination);
 assert.deepEqual(r.origin,origin); assert.equal(r.originCoverage.referenceVersion,'v4');
 assert.ok(!JSON.stringify(r).includes('private'));
});
const rule=()=>({id:'r1',version:1,scope:{type:'GLOBAL',id:'GLOBAL'},priority:1,status:'PUBLISHED',effectiveFrom:'2026-10-01T00:00:00.000Z',effectiveTo:null,rounding:'HALF_AWAY_FROM_ZERO',vehicleType:null,
 base:m('1000'),perKm:m('1000'),tiers:[],longDistance:{afterMeters:5000,flat:m('0'),perKm:m('0')},peaks:[],minimum:m('0'),maximum:m('10000'),coverage:{enabled:true,maxRoadMeters:10000,maxDurationSeconds:3600,supportedZoneIds:['z1']},fallbackPolicyId:null});
const input=()=>({origin,destination,context:{branchId:'b1',merchantId:'m1',zoneId:'z1',cityId:'c1',governorateId:'g1',vehicleType:'CAR'},rules:[rule()],discount:null});
test('same pricing engine consumes provider route and retains endpoints/region version evidence',async()=>{
 const result=await calculateCoveredRoadDeliveryFee(covered(),input(),()=>time);
 assert.equal(result.calculation.customerDeliveryFee.minorAmount,3101000);
 assert.equal(result.binding.destinationCoverage.regionId,'z1');
});
test('foreign zone, policy road limit, expiry and missing pricing rule block pricing',async()=>{
 const foreign=input();foreign.context.zoneId='other';
 await rejectCode(calculateCoveredRoadDeliveryFee(covered(),foreign,()=>time),'OUTSIDE_COVERAGE');
 const limited=input();limited.rules[0].coverage.maxRoadMeters=2000;
 await rejectCode(calculateCoveredRoadDeliveryFee(covered(),limited,()=>time),'OUTSIDE_DELIVERY_RANGE');
 await rejectCode(calculateCoveredRoadDeliveryFee(covered(),input(),()=>time+120000),'ROUTE_UNAVAILABLE');
 const empty=input();empty.rules=[];
 await rejectCode(calculateCoveredRoadDeliveryFee(covered(),empty,()=>time),'NO_PRICING_RULE');
});
test('coverage deactivation or revision while provider is running prevents route delivery',async()=>{
 for (const change of [{active:false},{referenceVersion:'v5'},{regionId:'z2'},{insidePolygon:false}]) {
  let reads=0;
  await rejectCode(covered({resolveCoverage:async()=>({...await coverage(),...(++reads > 2 ? change:{})})}).getDeliveryRoute(origin,destination),'OUTSIDE_COVERAGE');
 }
});
