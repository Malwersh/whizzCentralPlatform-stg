'use strict';
// Offline review model only. No SDK, provider, API calls or publication.
const fs=require('node:fs'),crypto=require('node:crypto');
const pricing=require('../backend/staff-service/pricing-runtime/deliveryPricing');
const {parseIqd,readMoney,moneyFromMinor,formatIqd}=require('../backend/staff-service/pricing-runtime/money');
const {calculateOrderCommercialPricing}=require('../backend/wallet-service/dist/orderCommercialPricing');
const {allocateOrder}=require('../backend/wallet-service/dist/orderAllocation');
const m=n=>parseIqd(String(n));
function proposalRounding(value,quantumIqd){
 const minor=BigInt(readMoney(value).minorAmount),step=BigInt(quantumIqd)*1000n;
 if(minor<0n||step<=0n)throw Error('INVALID_PROPOSAL_ROUNDING');
 const result=(minor/step+(minor%step*2n>=step?1n:0n))*step;
 if(result>BigInt(Number.MAX_SAFE_INTEGER))throw Error('PROPOSAL_OVERFLOW');
 return moneyFromMinor(Number(result));
}
function prepare(){
 const at='2026-10-17T00:00:00.000Z',context={branchId:'REVIEW_BRANCH',merchantId:'REVIEW_MERCHANT',zoneId:'Rmhvcpnn3iy5f1',cityId:'REVIEW_CITY',governorateId:'REVIEW_GOV',vehicleType:'BIKE'};
 const common={version:1,scope:{type:'BRANCH',id:context.branchId},priority:1,status:'DRAFT',effectiveFrom:at,effectiveTo:null,rounding:'HALF_AWAY_FROM_ZERO',vehicleType:null,minimum:m(0),maximum:m(8000),fallbackPolicyId:null,longDistance:{afterMeters:10000,flat:m(0),perKm:m(0)},peaks:[]};
 const rules={deliveryRules:[{...common,id:'REVIEW_CUSTOMER',base:m(1000),perKm:m(500),tiers:[],minimum:m(2000),maximum:m(6000),coverage:{enabled:true,maxRoadMeters:10000,maxDurationSeconds:1800,supportedZoneIds:[context.zoneId]}}],driverRules:[{...common,id:'REVIEW_DRIVER',base:m(1000),pickupPerKm:m(250),pickupIncludedMeters:1000,deliveryPerKm:m(400),perMinute:m(0),minimum:m(1500)}]};
 pricing.validatePricingRules(rules);
 const published=list=>list.map(r=>({...r,status:'PUBLISHED'}));
 const leg=(distanceMeters,durationSeconds)=>({id:'OFFLINE_REVIEW',source:'ADMIN_SIMULATION',quality:'ROAD',fallbackPolicyId:null,distanceMeters,durationSeconds,measuredAt:at,expiresAt:'2026-10-17T00:02:00.000Z'});
 const rows=[[811,500,105],[2000,500,600],[3331,700,700],[5000,1000,900],[8000,2000,1200],[10000,1000,1800],[5000,5000,900]].map(([deliveryMeters,pickupMeters,seconds])=>{
  const deliveryRoute=leg(deliveryMeters,seconds),pickupRoute=leg(pickupMeters,300);
  const customer=pricing.calculateDeliveryFee({schemaVersion:1,at,context,rules:published(rules.deliveryRules),deliveryRoute,discount:null}).customerDeliveryFee;
  const driver=pricing.calculateDriverEarning({schemaVersion:1,at,context,rules:published(rules.driverRules),deliveryRoute,pickupRoute}).driverEarning;
  const fee=proposalRounding(customer,250),earning=proposalRounding(driver,250);
  return {deliveryMeters,pickupMeters,customerFeeRawIqd:formatIqd(customer),driverEarningRawIqd:formatIqd(driver),customerFeeProposedIqd:formatIqd(fee),driverEarningProposedIqd:formatIqd(earning),deliveryDifferenceIqd:formatIqd(moneyFromMinor(fee.minorAmount-earning.minorAmount))};
 });
 const none={kind:'NONE',basis:null,fixed:null,rate:null,rounding:'EXACT'};
 function example(id,percent,goods,fee,earning,tip,discount=false){
  const agreement={id:'REVIEW_AGREEMENT_'+id,version:1,status:'ACTIVE',merchantId:context.merchantId,branchId:context.branchId,effectiveFrom:at,effectiveTo:null,acceptedAt:at,approvedAt:at,commission:{kind:'PERCENT',basis:'AFTER_MERCHANT_DISCOUNT',fixed:null,rate:{numerator:percent,denominator:100},rounding:'HALF_AWAY_FROM_ZERO'},serviceFee:{...none,kind:'FIXED',fixed:m(500)}};
  const result=calculateOrderCommercialPricing({schemaVersion:1,at,branchId:context.branchId,merchantId:context.merchantId,goodsGross:m(goods),agreement,goodsDiscounts:discount?[{id:'REVIEW_PROMOTION',version:1,target:'GOODS',amount:m(1000),merchantShare:m(500),platformShare:m(500)}]:[],paymentMethod:'COD',customerDeliveryFee:m(fee),driverTip:m(tip),merchantOtherCharges:m(0),platformOtherCharges:m(0),thirdPartyOtherCharges:m(0)});
  const commission=proposalRounding(result.commission.amount,1),allocation=allocateOrder({...result.allocationInput,merchantCommission:commission,driverEarning:m(earning)});
  const fields=['customerTotal','merchantPayable','merchantCommission','driverEarningEntitlement','driverTipEntitlement','driverTotalEntitlement','driverWalletHold','driverCashRetained','driverWalletCreditTotal','deliverySubsidy','platformGoodsDiscountFunding','platformNetContribution'];
  return {id,commissionPercent:percent,goodsIqd:goods,customerDeliveryFeeIqd:fee,driverEarningIqd:earning,tipIqd:tip,discountIqd:discount?1000:0,rawCommissionIqd:formatIqd(result.commission.amount),...Object.fromEntries(fields.map(f=>[f+'Iqd',formatIqd(allocation[f])]))};
 }
 return {schemaVersion:1,part:58,environment:'Staging',status:'PROPOSAL_NOT_APPROVED',publishesPolicy:false,performsFinancialWrites:false,simulationOnly:true,usesLiveRoadRequests:false,
  rulesForReview:rules,proposedFinalRounding:{customerFeeQuantumIqd:250,driverEarningQuantumIqd:250,commissionQuantumIqd:1,mode:'HALF_AWAY_FROM_ZERO',implementedInRuntime:false,stage:'Before quote/offer/consent hashes, never at wallet commit or after acceptance'},
  merchantCommissionExamples:[{merchant:'A',percent:10},{merchant:'B',percent:7},{merchant:'C',percent:0,explicitExemption:true}],globalDefaultCommission:null,customerServiceFeeIqd:500,
  routeScenarios:rows,orderScenarios:[example('merchant-A',10,10000,2000,1750,1000),example('merchant-B',7,10000,2000,1750,1000),example('merchant-exempt',0,10000,2000,1750,1000),example('funded-discount',10,10000,2000,1750,0,true),example('far-pickup',10,10000,3500,4000,1000),example('fractional-commission',10,3499,2000,1500,0)],
  requiredBeforePublication:['User review of candidate values and cohort; no global merchant default','Implement and verify final whole-IQD rounding consistently in pricing, commercial calculation, simulation, quote, offer and settlement contracts','Authenticated independent pricing approval and real merchant agreement acceptance/approval','Funded-discount approval and verified budget source before enabling that scenario'],
  sourceSha256:Object.fromEntries(['backend/staff-service/pricing-runtime/deliveryPricing.js','backend/staff-service/pricing-runtime/money.js','backend/wallet-service/dist/orderCommercialPricing.js','backend/wallet-service/dist/orderAllocation.js','backend/wallet-service/dist/money.js','backend/wallet-service/src/orderCommercialPricing.ts','backend/wallet-service/src/orderAllocation.ts','backend/wallet-service/src/driverOffer.ts','backend/wallet-service/src/codCompletion.ts'].map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')]))};
}
module.exports={prepare,proposalRounding};
if(require.main===module){
 if(fs.existsSync('docs/finance-commercial-pricing-approval-59.json'))throw Error('APPROVED_BASELINE_FROZEN_CREATE_A_NEW_VERSION');
 fs.writeFileSync('docs/finance-commercial-pricing-proposal-58.json',JSON.stringify(prepare(),null,2)+'\n');
}
