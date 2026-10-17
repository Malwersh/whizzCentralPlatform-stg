'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {prepare,proposalRounding}=require('../prepare-commercial-pricing-proposal-58.cjs');
const {parseIqd,toWholeIqdExact}=require('../../backend/staff-service/pricing-runtime/money');
test('the review model exposes the existing whole-IQD wallet incompatibility instead of hiding it',()=>{
 const p=prepare(),r=p.routeScenarios.find(x=>x.deliveryMeters===3331);
 assert.throws(()=>toWholeIqdExact(parseIqd(r.customerFeeRawIqd)));assert.throws(()=>toWholeIqdExact(parseIqd(r.driverEarningRawIqd)));
 for(const x of p.routeScenarios){toWholeIqdExact(parseIqd(x.customerFeeProposedIqd));toWholeIqdExact(parseIqd(x.driverEarningProposedIqd));}
 assert.equal(p.proposedFinalRounding.implementedInRuntime,false);assert.equal(p.publishesPolicy,false);
});
test('merchant-specific commissions change merchant/platform allocation without changing customer or driver price',()=>{
 const [a,b,c]=prepare().orderScenarios;
 assert.equal(a.customerTotalIqd,b.customerTotalIqd);assert.equal(b.customerTotalIqd,c.customerTotalIqd);assert.equal(a.driverTotalEntitlementIqd,b.driverTotalEntitlementIqd);
 assert.equal(Number(b.merchantPayableIqd)-Number(a.merchantPayableIqd),Number(a.platformNetContributionIqd)-Number(b.platformNetContributionIqd));assert.equal(c.merchantCommissionIqd,'0');
});
test('COD review examples conserve funds, add tip once and expose platform funding separately',()=>{
 for(const r of prepare().orderScenarios){
  assert.equal(Number(r.customerTotalIqd),Number(r.driverWalletHoldIqd)+Number(r.driverCashRetainedIqd));
  assert.equal(Number(r.driverTotalEntitlementIqd),Number(r.driverCashRetainedIqd)+Number(r.driverWalletCreditTotalIqd));
  assert.equal(Number(r.driverTotalEntitlementIqd),Number(r.driverEarningEntitlementIqd)+Number(r.driverTipEntitlementIqd));
  assert.equal(Number(r.customerTotalIqd),Number(r.merchantPayableIqd)+Number(r.driverTotalEntitlementIqd)+Number(r.platformNetContributionIqd));
 }
 const p=prepare();assert.equal(p.orderScenarios.find(x=>x.id==='far-pickup').deliverySubsidyIqd,'500');assert.equal(p.orderScenarios.find(x=>x.id==='funded-discount').platformGoodsDiscountFundingIqd,'500');
});
test('proposed rounding is explicit at half quantum and refuses negative amounts',()=>{
 assert.equal(toWholeIqdExact(proposalRounding(parseIqd('2125'),250)),2250);assert.equal(toWholeIqdExact(proposalRounding(parseIqd('2124.999'),250)),2000);assert.throws(()=>proposalRounding(parseIqd('-1'),250));
});
