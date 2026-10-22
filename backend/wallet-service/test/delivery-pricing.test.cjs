const { test } = require('node:test');
const assert = require('node:assert/strict');
const { calculateDeliveryFee: fee, calculateDriverEarning: earning } = require('../dist/deliveryPricing');
const { parseIqd: m } = require('../dist/money');
const { allocateOrder } = require('../dist/orderAllocation');
const at = '2026-10-15T12:00:00.000Z';
const context = { branchId:'b1', merchantId:'m1', zoneId:'z1', cityId:'c1', governorateId:'g1', vehicleType:'BIKE' };
const leg = (distanceMeters = 2000, durationSeconds = 300) => ({ id:'route-1', source:'TEST_ROAD_PROVIDER', quality:'ROAD', fallbackPolicyId:null, distanceMeters, durationSeconds, measuredAt:'2026-10-15T11:59:00.000Z', expiresAt:'2026-10-15T12:10:00.000Z' });
const common = () => ({ id:'r1', version:1, scope:{type:'GLOBAL',id:'GLOBAL'}, priority:1, status:'PUBLISHED', effectiveFrom:'2026-10-01T00:00:00.000Z', effectiveTo:null, rounding:'HALF_AWAY_FROM_ZERO', vehicleType:null });
const longDistance = () => ({ afterMeters:5000, flat:m('500'), perKm:m('200') });
const delivery = () => ({ ...common(), base:m('1000'), perKm:m('250'), tiers:[], longDistance:longDistance(), peaks:[], minimum:m('1000'), maximum:m('10000'), coverage:{enabled:true, maxRoadMeters:20000, maxDurationSeconds:3600, supportedZoneIds:['z1']}, fallbackPolicyId:null });
const driver = () => ({ ...common(), base:m('500'), pickupPerKm:m('200'), pickupIncludedMeters:1000, deliveryPerKm:m('300'), perMinute:m('100'), longDistance:longDistance(), peaks:[], minimum:m('1000'), maximum:m('20000'), fallbackPolicyId:null });
const fi = () => ({ schemaVersion:1, at, context:{...context}, rules:[delivery()], deliveryRoute:leg(), discount:null });
const ei = () => ({ schemaVersion:1, at, context:{...context}, rules:[driver()], pickupRoute:leg(5000,600), deliveryRoute:leg(8000,900) });
const minor = value => value.minorAmount;
const expectCode = (fn, code) => assert.throws(fn, e => e.code === code);

test('base + exact road km and independent pickup/delivery/time breakdown', () => {
  assert.equal(minor(fee(fi()).customerDeliveryFee),1500000);
  const e = earning(ei());
  assert.equal(minor(e.components.pickup),800000);
  assert.equal(minor(e.components.delivery),2400000);
  assert.equal(minor(e.components.time),2500000);
  assert.equal(minor(e.components.longDistance),1100000);
  assert.equal(minor(e.driverEarning),7300000);
  assert.equal(e.totalDistanceMeters,13000);
});
test('tier upper boundary inclusive, next meter belongs to next tier; no double km', () => {
  const i=fi(); i.rules[0].perKm=m('0');
  i.rules[0].tiers=[{upToMeters:2000,fee:m('500')},{upToMeters:4000,fee:m('1000')},{upToMeters:null,fee:m('2000')}];
  for (const [meters,expected] of [[0,1500000],[2000,1500000],[2001,2000000],[4000,2000000],[4001,3000000]]) {
    i.deliveryRoute=leg(meters); assert.equal(minor(fee(i).customerDeliveryFee),expected);
  }
  i.rules[0].perKm=m('1'); expectCode(()=>fee(i),'INVALID_PRICING');
});
test('long surcharge once strictly beyond threshold, partial km proportional', () => {
  const i=fi(); i.deliveryRoute=leg(5000); assert.equal(minor(fee(i).components.longDistance),0);
  i.deliveryRoute=leg(5500); assert.equal(minor(fee(i).components.longDistance),600000);
});
test('specific scope beats priority; deterministic ambiguity rejection, no summing', () => {
  const i=fi();
  i.rules= ['GLOBAL','GOVERNORATE','CITY','ZONE','MERCHANT','BRANCH'].map((type,n)=>({...delivery(),id:`rule${n}`,scope:{type,id:['GLOBAL','g1','c1','z1','m1','b1'][n]},priority:100-n}));
  assert.equal(fee(i).rule.scope.type,'BRANCH');
  assert.equal(minor(fee(i).customerDeliveryFee),1500000);
  i.rules.push({...i.rules[5],id:'conflict'}); expectCode(()=>fee(i),'AMBIGUOUS_PRICING_RULE');
  i.rules[6].priority=1; assert.equal(fee(i).rule.id,'rule5');
});
test('draft/archived/future/expired cannot apply; no implicit default', () => {
  for (const patch of [{status:'DRAFT'},{status:'ARCHIVED'},{effectiveFrom:'2026-11-01T00:00:00.000Z'},{effectiveTo:at},{scope:{type:'BRANCH',id:'foreign'}}]) {
    const i=fi(); Object.assign(i.rules[0],patch); expectCode(()=>fee(i),'NO_PRICING_RULE');
  }
  const i=fi(); i.rules=[]; expectCode(()=>fee(i),'NO_PRICING_RULE');
});
test('scope/vehicle selection does not let a different vehicle rule apply', () => {
  const i=ei(); i.rules[0].vehicleType='CAR'; expectCode(()=>earning(i),'NO_PRICING_RULE');
  i.context.vehicleType='CAR'; assert.equal(earning(i).rule.id,'r1');
});
test('branch change reselects policy, never uses another branch override', () => {
  const i=fi(); i.rules.push({...delivery(),id:'branch',scope:{type:'BRANCH',id:'b1'},base:m('2000')});
  assert.equal(minor(fee(i).customerDeliveryFee),2500000);
  i.context.branchId='b2'; assert.equal(minor(fee(i).customerDeliveryFee),1500000);
});
test('missing, expired or future route rejects; estimates require exact fallback policy', () => {
  const i=fi(); i.deliveryRoute=null; expectCode(()=>fee(i),'INVALID_PRICING');
  i.deliveryRoute=leg(); i.deliveryRoute.expiresAt=at; expectCode(()=>fee(i),'ROUTE_UNAVAILABLE');
  i.deliveryRoute=leg(); i.deliveryRoute.measuredAt='2026-10-15T12:01:00.000Z'; expectCode(()=>fee(i),'ROUTE_UNAVAILABLE');
  i.deliveryRoute={...leg(),quality:'ESTIMATED',fallbackPolicyId:'fallback-v1'}; expectCode(()=>fee(i),'ROUTE_UNAVAILABLE');
  i.rules[0].fallbackPolicyId='fallback-v1'; assert.equal(fee(i).deliveryRoute.quality,'ESTIMATED');
  i.deliveryRoute.fallbackPolicyId='other'; expectCode(()=>fee(i),'ROUTE_UNAVAILABLE');
});
test('disabled, foreign zone, over distance/time, uncovered final tier reject', () => {
  for (const patch of [{enabled:false},{supportedZoneIds:['other']},{maxRoadMeters:1999},{maxDurationSeconds:299}]) {
    const i=fi(); Object.assign(i.rules[0].coverage,patch); expectCode(()=>fee(i),'OUTSIDE_DELIVERY_RANGE');
  }
  const i=fi(); i.rules[0].perKm=m('0'); i.rules[0].tiers=[{upToMeters:1999,fee:m('1')}]; expectCode(()=>fee(i),'OUTSIDE_DELIVERY_RANGE');
});
test('peak windows start inclusive/end exclusive; overlap/duplicate peak invalid', () => {
  const i=fi(); const peak={id:'p1',from:at,to:'2026-10-15T13:00:00.000Z',amount:m('500')};
  i.rules[0].peaks=[peak]; assert.equal(minor(fee(i).components.peak),500000);
  i.rules[0].peaks=[{...peak,to:at,from:'2026-10-15T11:00:00.000Z'}]; assert.equal(minor(fee(i).components.peak),0);
  i.rules[0].peaks=[peak,{...peak,id:'p2'}]; expectCode(()=>fee(i),'INVALID_PRICING');
});
test('limits before funded discount, free delivery preserves driver earning', () => {
  const i=fi(); i.rules[0].maximum=m('1200');
  i.discount={id:'campaign-1',fundingParty:'PLATFORM',amount:m('9999')};
  const f=fee(i); assert.equal(minor(f.customerDeliveryFee),0); assert.equal(minor(f.discountFundingAmount),1200000);
  assert.equal(minor(f.components.limitAdjustment),-300000);
  assert.equal(minor(earning(ei()).driverEarning),7300000);
  i.discount.fundingParty='UNKNOWN'; expectCode(()=>fee(i),'INVALID_PRICING');
});
test('driver farther away changes E only; no tip or customer-price inputs accepted', () => {
  const i=ei(), f=fee(fi()); const old=earning(i);
  i.pickupRoute=leg(7000,900); assert.ok(minor(earning(i).driverEarning)>minor(old.driverEarning));
  assert.equal(minor(fee(fi()).customerDeliveryFee),minor(f.customerDeliveryFee));
  i.driverTip=m('1000'); expectCode(()=>earning(i),'INVALID_PRICING');
  const customer=fi(); customer.pickupRoute=leg(); expectCode(()=>fee(customer),'INVALID_PRICING');
});
test('component disabling uses explicit zero; minimum/top cap adjustments explicit', () => {
  const i=ei(); for(const key of ['base','pickupPerKm','deliveryPerKm','perMinute']) i.rules[0][key]=m('0');
  i.rules[0].longDistance={afterMeters:0,flat:m('0'),perKm:m('0')};
  assert.equal(minor(earning(i).driverEarning),1000000);
  i.rules[0].minimum=m('0'); assert.equal(minor(earning(i).driverEarning),0);
  i.rules[0].base=m('30000'); assert.equal(minor(earning(i).driverEarning),20000000);
});
test('invalid schemas, money, ranges, duplicate rules, tiers and dates rejected', () => {
  const edits=[i=>i.schemaVersion=2,i=>i.at='2026-02-30T00:00:00.000Z',i=>i.rules[0].base=m('-1'),i=>i.rules[0].minimum=m('20000'),i=>i.deliveryRoute.distanceMeters=1.5,i=>i.rules[0].priority=NaN,i=>i.rules.push({...i.rules[0]}),i=>i.rules[0].tiers=[{upToMeters:2,fee:m('1')},{upToMeters:1,fee:m('1')}],i=>i.rules[0].scope={type:'BOGUS',id:'GLOBAL'},i=>delete i.discount];
  for (const edit of edits) {const i=fi();edit(i);expectCode(()=>fee(i),'INVALID_PRICING');}
  const i=fi(); i.rules[0].base={minorAmount:1000}; expectCode(()=>fee(i),'UNSUPPORTED_MONEY_SCHEMA');
});
test('rational rounding explicit; safe-integer overflow never silently clamps', () => {
  const i=fi(); i.rules[0].base=m('0'); i.rules[0].minimum=m('0');i.rules[0].perKm=m('0.001');i.deliveryRoute=leg(500);
  assert.equal(minor(fee(i).customerDeliveryFee),1);
  i.rules[0].rounding='TOWARD_ZERO';assert.equal(minor(fee(i).customerDeliveryFee),0);
  i.rules[0].rounding='EXACT';expectCode(()=>fee(i),'PRECISION_LOSS');
  i.rules[0].rounding='HALF_AWAY_FROM_ZERO';i.rules[0].perKm={...m('0'),minorAmount:Number.MAX_SAFE_INTEGER};i.deliveryRoute=leg(2000);
  expectCode(()=>fee(i),'MONEY_OVERFLOW');
});
test('results immutable and detached; changing later rules cannot reprice returned result', () => {
  const i=fi(), before=JSON.stringify(i), result=fee(i);
  assert.equal(JSON.stringify(i),before); assert.ok(Object.isFrozen(result));assert.ok(Object.isFrozen(result.components));assert.ok(Object.isFrozen(result.rule.scope));
  i.rules[0].base=m('9999');i.deliveryRoute.distanceMeters=9000;
  assert.equal(minor(result.customerDeliveryFee),1500000);assert.equal(result.deliveryRoute.distanceMeters,2000);
  assert.deepEqual(fee(fi()),result);
});
test('engine results feed allocation with balanced COD and prepaid obligations', () => {
  const customerDeliveryFee=fee(fi()).customerDeliveryFee, driverEarning=earning(ei()).driverEarning;
  for (const paymentMethod of ['COD','PREPAID']) {
    const a=allocateOrder({allocationSchemaVersion:1,paymentMethod,goodsGross:m('10000'),merchantGoodsDiscount:m('0'),platformGoodsDiscount:m('0'),merchantCommission:m('1000'),serviceFee:m('500'),customerDeliveryFee,driverEarning,driverTip:m('1000'),merchantOtherCharges:m('0'),platformOtherCharges:m('0'),thirdPartyOtherCharges:m('0')});
    assert.equal(minor(a.customerTotal),13000000);
    assert.equal(minor(a.driverCashRetained)+minor(a.driverWalletCreditTotal),8300000);
    assert.equal(minor(a.customerTotal),minor(a.merchantPayable)+minor(a.driverTotalEntitlement)+minor(a.platformNetContribution));
  }
});

test('customer fee ceiling uses 250 IQD and leaves driver earnings unchanged',()=>{
 const rule={...delivery(),base:m('1100'),perKm:m('0'),finalRounding:{incrementIqd:250,mode:'CEILING'}};
 const original=earning(ei());
 const result=fee({...fi(),rules:[rule]});
 assert.deepEqual(result.customerDeliveryFee,m('1250'));
 assert.deepEqual(result.components.finalRoundingAdjustment,m('150'));
 assert.deepEqual(fee({...fi(),rules:[{...rule,base:m('1250')}]}).customerDeliveryFee,m('1250'));
 assert.deepEqual(earning(ei()),original);
 assert.deepEqual(rule.base,m('1100'));
});
