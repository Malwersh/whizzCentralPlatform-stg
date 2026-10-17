'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const baseline=require('../../docs/finance-commercial-pricing-approval-59.json'),review=require('../../docs/finance-commercial-pricing-proposal-58.json');
const {calculateDeliveryFee,calculateDriverEarning}=require('../../backend/staff-service/pricing-runtime/deliveryPricing');
const {parseIqd:m,formatIqd,toWholeIqdExact}=require('../../backend/staff-service/pricing-runtime/money');
const {calculateOrderCommercialPricing}=require('../../backend/wallet-service/dist/orderCommercialPricing');
const {allocateOrder}=require('../../backend/wallet-service/dist/orderAllocation');
const at='2026-10-17T00:00:00.000Z',context={branchId:'REVIEW_BRANCH',merchantId:'REVIEW_MERCHANT',zoneId:'Rmhvcpnn3iy5f1',cityId:'REVIEW_CITY',governorateId:'REVIEW_GOV',vehicleType:'BIKE'};
const leg=distanceMeters=>({id:'review',source:'ADMIN_SIMULATION',quality:'ROAD',fallbackPolicyId:null,distanceMeters,durationSeconds:300,measuredAt:at,expiresAt:'2026-10-17T00:02:00.000Z'});
test('the production calculation contract matches every approved route example with explicit centrally editable rounding',()=>{
 assert.equal(baseline.status,'USER_APPROVED_BASELINE');
 const deliveryRules=review.rulesForReview.deliveryRules.map(r=>({...r,status:'PUBLISHED',finalRounding:baseline.customerDelivery.finalRounding}));
 const driverRules=review.rulesForReview.driverRules.map(r=>({...r,status:'PUBLISHED',finalRounding:baseline.driverEarning.finalRounding}));
 for(const row of review.routeScenarios){
  const deliveryRoute=leg(row.deliveryMeters),pickupRoute=leg(row.pickupMeters);
  const fee=calculateDeliveryFee({schemaVersion:1,at,context,rules:deliveryRules,deliveryRoute,discount:null}).customerDeliveryFee;
  const earning=calculateDriverEarning({schemaVersion:1,at,context,rules:driverRules,deliveryRoute,pickupRoute}).driverEarning;
  assert.equal(formatIqd(fee),row.customerFeeProposedIqd);assert.equal(formatIqd(earning),row.driverEarningProposedIqd);toWholeIqdExact(fee);toWholeIqdExact(earning);
 }
});
test('approved merchant variants and COD examples come directly from the commercial engine, without post-consent rounding',()=>{
 for(const row of review.orderScenarios){
  const agreement={id:'REVIEW_'+row.id,version:1,status:'ACTIVE',merchantId:context.merchantId,branchId:context.branchId,effectiveFrom:at,effectiveTo:null,acceptedAt:at,approvedAt:at,
   commission:{kind:'PERCENT',basis:baseline.merchantCommission.basis,fixed:null,rate:{numerator:row.commissionPercent,denominator:100},rounding:'HALF_AWAY_FROM_ZERO',finalRounding:baseline.merchantCommission.finalRounding},serviceFee:{kind:'FIXED',basis:null,fixed:m(String(baseline.customerServiceFee.amountIqd)),rate:null,rounding:'EXACT',finalRounding:baseline.customerServiceFee.finalRounding}};
  const commercial=calculateOrderCommercialPricing({schemaVersion:1,at,branchId:context.branchId,merchantId:context.merchantId,goodsGross:m(String(row.goodsIqd)),agreement,goodsDiscounts:row.discountIqd?[{id:'REVIEW_PROMOTION',version:1,target:'GOODS',amount:m('1000'),merchantShare:m('500'),platformShare:m('500')}]:[],paymentMethod:'COD',customerDeliveryFee:m(String(row.customerDeliveryFeeIqd)),driverTip:m(String(row.tipIqd)),merchantOtherCharges:m('0'),platformOtherCharges:m('0'),thirdPartyOtherCharges:m('0')});
  const allocation=allocateOrder({...commercial.allocationInput,driverEarning:m(String(row.driverEarningIqd))});
  for(const field of ['customerTotal','merchantPayable','merchantCommission','driverWalletHold','driverTotalEntitlement','driverWalletCreditTotal','platformNetContribution']){assert.equal(formatIqd(allocation[field]),row[field+'Iqd']);toWholeIqdExact(allocation[field]);}
 }
 assert.equal(baseline.merchantCommission.globalDefaultRate,null);assert.deepEqual(baseline.merchantCommission.actualMerchantAssignments,[]);
});
