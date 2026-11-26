// Synthetic verified V2 accepted-order fixture; not a production migration.
const {ready,w}=require('./cod-fixture.cjs');
const {buildDeliveryFundedOffer:build,prepareDeliveryFundedOfferAcceptance:accept}=require('../../dist/deliveryFundedOffer');
const {preparePlatformPromotionFunding:cash}=require('../../dist/platformPromotionFunding');
const {deliveryCampaignBudgetInitialization:init,createStagingDeliveryCampaignBudget:budget}=require('../../dist/deliveryCampaignBudget');
const {calculatePolicyDeliveryFunding:funding}=require('../../dist/deliveryFundingPolicy');
const {createStagingCodCompletion:create}=require('../../dist/codCompletion');
const {parseIqd:m}=require('../../dist/money');
const {TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
async function fixture(split='SHARED',goods=0){
 const f=await ready('4000',goods,1000),order=f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'}),saved=f.get('WaveOffers_staging',{orderId:'order1',SK:'FINANCIAL#driver1#WAVE#1'}),base=saved.financialOffer;
 const policy={schemaVersion:1,id:'delivery',version:1,merchantId:'merchant1',branchId:'branch1',origin:split,effectiveFrom:'2026-10-01T00:00:00.000Z',effectiveTo:'2026-11-01T00:00:00.000Z',customerRule:{kind:'CAPPED_PRICE',amount:m('3000')},funding:split==='SHARED'?{kind:'SHARED_RATIO',merchantNumerator:1,denominator:2,merchantCap:m('1000'),platformCap:m('1000')}:{kind:split},eligibility:{regionIds:['zone1'],maximumRoadMeters:5000,minimumGoods:m('0'),minimumGoodsBasis:'GOODS_GROSS',audience:'ALL',goodsDiscountStacking:'ALLOW'},limits:{merchantPerOrder:m('1000'),platformPerOrder:m('1000'),merchantBudget:m('10000'),platformBudget:m('10000'),perCustomerUses:2},onUnavailable:'NORMAL_TARIFF'};
 if(split==='MERCHANT'){policy.limits.platformBudget=m('0');policy.limits.platformPerOrder=m('0');}if(split==='PLATFORM'){policy.limits.merchantBudget=m('0');policy.limits.merchantPerOrder=m('0');}
 const support=funding(policy,m('4000'),m('3000')),o=build({schemaVersion:2,base:base.source,deliveryFunding:support}),b=o.baseOffer;
 const accepted=accept({offer:o,offerId:b.offerId,driverId:b.driverId,subjectId:b.driverSubjectId,assignmentId:b.assignmentId,assignmentVersion:b.assignmentVersion,order:b.source.order,deliveryFunding:support,at:order.financialAcceptance.acceptedAt,policy:{version:b.policyVersion,enabledRuleVersions:[{id:b.calculation.rule.id,version:b.calculation.rule.version,hash:b.ruleHash}]}});
 Object.assign(saved,{financialOffer:o,acceptedTerms:accepted.acceptedTerms});Object.assign(order,{financialAcceptance:accepted.acceptedTerms,financialSnapshot:o.financialSnapshot});
 const driverHold=f.get('staging-Holds',{orderId:'order1',sk:'HOLD'});driverHold.metadata.offerDigest=o.digest;
 const pw=w(f,'WALLET#PLATFORM');Object.assign(pw,{availableBalance:10000,lockedBalance:0});
 const components=[];if(goods)components.push({kind:'GOODS',amount:m(String(goods)),metadata:{agreementId:'agreement1',agreementVersion:1,fundingPolicy:order.commercialPricing.funding.policy}});
 if(support.allocation.platformShare.minorAmount)components.push({kind:'DELIVERY',amount:support.allocation.platformShare,metadata:{policyPin:support.policyPin}});
 if(components.length){const p=cash({orderId:'order1',at:new Date(f.time).toISOString(),wallet:pw,components});for(const op of p.operations){if(op.Put)f.put(op.Put.TableName,op.Put.Item);if(op.Update){pw.availableBalance=op.Update.ExpressionAttributeValues[':available'];pw.lockedBalance=op.Update.ExpressionAttributeValues[':locked'];pw.version++;}}}
 const genesis=init(policy);f.put(genesis.Put.TableName,genesis.Put.Item);const reserve=await budget({db:f.db,now:()=>f.time}).reserve({orderId:'order1',customerId:'customer',policy,referenceFee:m('4000'),customerFee:m('3000')});for(const {Put:p}of reserve.operations)f.put(p.TableName,p.Item);
 f.completeV2=()=>create({db:f.db,now:()=>f.time,enableDeliveryFunding:true,authenticateDriver:async()=>({driverId:'driver1',subjectId:'driver1'})}).complete({orderId:'order1',cashCollected:true});
 f.support=support;return f;
}
module.exports={fixture};
