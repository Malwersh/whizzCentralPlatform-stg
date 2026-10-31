const {test}=require('node:test');const assert=require('node:assert/strict');
const {buildDriverOffer:build,driverOfferView:view,prepareDriverOfferAcceptance:prepare}=require('../dist/driverOffer');
const {parseIqd:m,formatIqd}=require('../dist/money');
const {at,end,driverPoint,branch,customer,route,input}=require('./helpers/driver-offer-fixture.cjs');
function acceptance(offer){return {offer,offerId:offer.offerId,driverId:offer.driverId,subjectId:offer.driverSubjectId,assignmentId:offer.assignmentId,
 assignmentVersion:offer.assignmentVersion,order:structuredClone(offer.source.order),at:'2026-10-15T12:00:30.000Z',
 policy:{version:1,enabledRuleVersions:[{id:offer.calculation.rule.id,version:offer.calculation.rule.version,hash:offer.ruleHash}]}};}
const code=(fn,c)=>assert.throws(fn,e=>e.code===c);
for(const [earning,hold,credit] of [['3000','10500','0'],['4000','10500','1000'],['2500','11000','0']])
 test('COD confirmed total, hold, earning and subsidy for E='+earning,()=>{
  const offered=build(input(earning)),v=view(offered,'driver1','driver-sub',at),plan=prepare(acceptance(offered));
  assert.equal(formatIqd(v.driverEarning),earning);assert.equal(formatIqd(v.customerCashToCollect),'14500');assert.equal(formatIqd(v.driverWalletHold),hold);
  assert.equal(formatIqd(v.laterWalletEarningCredit),credit);assert.equal(formatIqd(v.driverTip),'1000');
  assert.equal(plan.legacyWalletAmounts.acceptanceHoldIqd,Number(hold));assert.equal(plan.performsWrites,false);assert.equal(plan.financialWriterAndFundingChecksRequired,true);
 });
test('PREPAID requires a matching verified payment reference; no cash or driver hold',()=>{
 const i=input('3000','PREPAID'),o=build(i),v=view(o,'driver1','driver-sub',at),p=prepare(acceptance(o));
 assert.equal(formatIqd(v.driverWalletHold),'0');assert.equal(formatIqd(v.customerCashToCollect),'0');assert.equal(formatIqd(v.laterWalletEarningCredit),'3000');
 assert.equal(formatIqd(v.laterWalletTipCredit),'1000');assert.equal(p.withdrawable,undefined);
 for(const payment of [null,{reference:'p',verifiedAt:at,amount:m('1')},{reference:'p',verifiedAt:'2026-10-16T00:00:00.000Z',amount:m('14500')}]){
 const x=input('3000','PREPAID');x.order.paymentEvidence=payment;code(()=>build(x),'INVALID_DRIVER_OFFER');}
});
test('free customer delivery does not zero driver earning or invent cash collection',()=>{
 const i=input('3000');i.order.allocation.customerDeliveryFee=m('0');i.order.confirmedCustomerTotal=m('11500');
 const v=view(build(i),'driver1','driver-sub',at);assert.equal(formatIqd(v.driverEarning),'3000');assert.equal(formatIqd(v.customerCashToCollect),'11500');
 assert.equal(formatIqd(v.laterWalletEarningCredit),'3000');assert.equal(formatIqd(v.driverCashRetained),'1000');
});
test('distance changes E, never the confirmed customer fee or total',()=>{
 const i=input('1000');i.policy.rules[0].pickupPerKm=m('500');const first=build(i);
 i.offerId='offer2';i.pickupRoute.route.distanceMeters=8000;const next=build(i);
 assert.notEqual(first.calculation.driverEarning.minorAmount,next.calculation.driverEarning.minorAmount);
 assert.deepEqual(first.allocation.customerTotal,next.allocation.customerTotal);assert.deepEqual(first.source.order.allocation.customerDeliveryFee,next.source.order.allocation.customerDeliveryFee);
 assert.equal(next.calculation.totalDistanceMeters,10000);
});
test('tips never reduce earning or increase the COD hold',()=>{
 const i=input(),a=build(i);i.order.allocation.driverTip=m('2000');i.order.confirmedCustomerTotal=m('15500');const b=build(i);
 assert.deepEqual(a.calculation.driverEarning,b.calculation.driverEarning);assert.deepEqual(a.allocation.driverWalletHold,b.allocation.driverWalletHold);
 assert.equal(b.allocation.driverTotalEntitlement.minorAmount-a.allocation.driverTotalEntitlement.minorAmount,1000000);
});
test('offer expiry is bounded by assignment, position, both route legs and selected rule',()=>{
 const mutators=[i=>i.assignment.expiresAt='2026-10-15T12:00:15.000Z',i=>i.driver.expiresAt='2026-10-15T12:00:15.000Z',
 i=>i.pickupRoute.route.expiresAt='2026-10-15T12:00:15.000Z',i=>i.deliveryRoute.route.expiresAt='2026-10-15T12:00:15.000Z',i=>i.policy.rules[0].effectiveTo='2026-10-15T12:00:15.000Z'];
 for(const mutate of mutators){const i=input();mutate(i);const o=build(i);assert.equal(o.expiresAt,'2026-10-15T12:00:15.000Z');
 const a=acceptance(o);a.at=o.expiresAt;code(()=>prepare(a),'DRIVER_OFFER_EXPIRED');}
 const o=build(input());code(()=>view(o,'driver1','driver-sub','2026-10-15T11:59:59.000Z'),'DRIVER_OFFER_EXPIRED');
});
test('routes are bound driver to branch and branch to customer, and must be ROAD evidence',()=>{
 const changes=[i=>i.pickupRoute.origin=customer,i=>i.pickupRoute.destination=customer,i=>i.deliveryRoute.origin=driverPoint,i=>i.deliveryRoute.destination=branch];
 for(const change of changes){const i=input();change(i);code(()=>build(i),'DRIVER_OFFER_SCOPE_MISMATCH');}
 for(const change of [i=>i.pickupRoute.route.quality='ESTIMATED',i=>i.deliveryRoute.route.source='CLIENT_GPS',i=>i.pickupRoute.schemaVersion=2]){
 const i=input();change(i);code(()=>build(i),'INVALID_DRIVER_OFFER');}
});
test('display is restricted to target driver and excludes internal financial data and subject',()=>{
 const o=build(input()),v=view(o,'driver1','driver-sub',at);
 for(const [driver,subject] of [['other','driver-sub'],['driver1','other']])code(()=>view(o,driver,subject,at),'DRIVER_OFFER_SCOPE_MISMATCH');
 for(const secret of ['driverSubjectId','merchantCommission','platformGoodsDiscount','source','policyVersion','ruleHash','allocation','paymentEvidence'])assert.equal(v[secret],undefined);
 assert.equal(formatIqd(v.earningComponents.base),'3000');assert.equal(v.earningComponents.rules,undefined);
 assert.equal(v.driverEarning.scale,1000);assert.equal(v.driverEarning.moneySchemaVersion,1);
});
test('saved proposal is detached and immutable; tampering or extra fields cannot reach display or acceptance',()=>{
 const i=input(),o=build(i),digest=o.digest;i.policy.rules[0].base=m('1');i.order.allocation.driverTip=m('5');
 assert.equal(o.digest,digest);assert.equal(formatIqd(o.calculation.driverEarning),'3000');assert.ok(Object.isFrozen(o.source.order.allocation));
 for(const mutate of [r=>r.calculation.driverEarning=m('1'),r=>r.source.policy.rules[0].base=m('1'),r=>r.extra='secret']){
 const bad=structuredClone(o);mutate(bad);code(()=>view(bad,'driver1','driver-sub',at),'INVALID_DRIVER_OFFER');code(()=>prepare(acceptance(bad)),'INVALID_DRIVER_OFFER');}
});
test('acceptance freezes the offered rule across later policy changes, while revocation blocks it',()=>{
 const o=build(input()),a=acceptance(o);a.policy.version=2;
 const p=prepare(a);assert.equal(formatIqd(p.acceptedTerms.driverEarning),'3000');assert.equal(p.expected.policyVersion,2);assert.equal(p.acceptedTerms.offeredPolicyVersion,1);
 a.policy.enabledRuleVersions=[];code(()=>prepare(a),'DRIVER_OFFER_RULE_DISABLED');
 a.policy.enabledRuleVersions=[{id:'rule1',version:1,hash:'a'.repeat(64)}];code(()=>prepare(a),'DRIVER_OFFER_RULE_DISABLED');
});
test('snapshot revision, payment or economics changes require a new offer, never silent repricing',()=>{
 for(const mutate of [a=>a.order.revision++,a=>a.order.snapshotId='other',a=>a.order.customerPoint.latitude++,a=>{a.order.allocation.merchantCommission=m('100');}]){
 const a=acceptance(build(input()));mutate(a);code(()=>prepare(a),'DRIVER_OFFER_SNAPSHOT_CHANGED');}
 const a=acceptance(build(input('3000','PREPAID')));a.order.paymentEvidence.reference='new';code(()=>prepare(a),'DRIVER_OFFER_SNAPSHOT_CHANGED');
});
test('assignment generation, offer ID and driver cannot cross an acceptance boundary',()=>{
 for(const mutate of [a=>a.assignmentVersion++,a=>a.assignmentId='other',a=>a.offerId='other',a=>a.driverId='other']){
 const a=acceptance(build(input()));mutate(a);code(()=>prepare(a),'DRIVER_OFFER_SCOPE_MISMATCH');}
});
test('fractional wallet amounts stay precise in proposal but cannot be rounded into the whole-IQD wallet',()=>{
 const o=build(input('4000.125'));assert.equal(formatIqd(o.allocation.driverWalletEarningCredit),'1000.125');code(()=>prepare(acceptance(o)),'DRIVER_OFFER_WALLET_PRECISION_UNSUPPORTED');
 const p=build(input('3000','PREPAID')),a=acceptance(p);a.order.allocation.driverTip=m('1000.125');a.order.confirmedCustomerTotal=m('14500.125');a.order.paymentEvidence.amount=m('14500.125');
 const changed=input('3000','PREPAID');changed.order=a.order;code(()=>prepare(acceptance(build(changed))),'DRIVER_OFFER_WALLET_PRECISION_UNSUPPORTED');
});
test('delivery-fee-only quote, client driver earning, bad TTL and inconsistent customer total are rejected',()=>{
 code(()=>build({schemaVersion:1,kind:'DELIVERY_FEE_ONLY'}),'INVALID_DRIVER_OFFER');
 for(const mutate of [i=>i.order.allocation.driverEarning=m('1'),i=>i.order.confirmedCustomerTotal=m('1'),i=>i.ttlSeconds=0,i=>i.ttlSeconds=901,i=>i.driver.positionVersion=0]){
 const i=input();mutate(i);code(()=>build(i),'INVALID_DRIVER_OFFER');}
});

test('acceptance rejects ambiguous allowed-rule identities, rollback policy and expired driver evidence',()=>{
 const o=build(input()),a=acceptance(o);a.policy.enabledRuleVersions.push({...a.policy.enabledRuleVersions[0]});code(()=>prepare(a),'INVALID_DRIVER_OFFER');
 const i=input();i.policy.version=2;const b=acceptance(build(i));b.policy.version=1;code(()=>prepare(b),'DRIVER_OFFER_RULE_DISABLED');
 const expired=input();expired.driver.expiresAt=at;code(()=>build(expired),'DRIVER_OFFER_EXPIRED');
});
test('prepaid downstream credit is explicitly a completion proposal, not a hold or immediate balance credit',()=>{
 const o=build(input('3000','PREPAID')),p=prepare(acceptance(o));assert.deepEqual(p.legacyWalletAmounts,{acceptanceHoldIqd:0,completionEarningCreditIqd:3000,completionTipCreditIqd:1000});
 assert.deepEqual(view(o,'driver1','driver-sub',at).pickupLocation,branch);assert.equal(view(o,'driver1','driver-sub',at).deliveryZoneId,'zone1');
 assert.equal(p.acceptedTerms.calculation.engineVersion,'DRIVER_COMPENSATION_V1');
});
