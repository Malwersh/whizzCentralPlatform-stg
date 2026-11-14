const {setup}=require('./driver-financial-fixture.cjs');
const {parseIqd:m}=require('../../dist/money');
const {calculatePolicyDeliveryFunding:calculate}=require('../../dist/deliveryFundingPolicy');
const {deliveryCampaignBudgetInitialization:init,createStagingDeliveryCampaignBudget:budget}=require('../../dist/deliveryCampaignBudget');
const {preparePlatformPromotionFunding:cash}=require('../../dist/platformPromotionFunding');
const {TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
async function fixture(enabled=true,split='SHARED',goods=0){
 const policy={schemaVersion:1,id:'delivery',version:1,merchantId:'merchant1',branchId:'branch1',origin:'SHARED',effectiveFrom:'2026-10-01T00:00:00.000Z',effectiveTo:'2026-11-01T00:00:00.000Z',customerRule:{kind:'CAPPED_PRICE',amount:m('3000')},funding:{kind:'SHARED_RATIO',merchantNumerator:1,denominator:2,merchantCap:m('1000'),platformCap:m('1000')},eligibility:{regionIds:['zone1'],maximumRoadMeters:5000,minimumGoods:m('0'),minimumGoodsBasis:'GOODS_GROSS',audience:'ALL',goodsDiscountStacking:'ALLOW'},limits:{merchantPerOrder:m('1000'),platformPerOrder:m('1000'),merchantBudget:m('10000'),platformBudget:m('10000'),perCustomerUses:2},onUnavailable:'NORMAL_TARIFF'};
 if(split!=='SHARED'){policy.origin=split;policy.funding={kind:split};if(split==='MERCHANT'){policy.limits.platformBudget=m('0');policy.limits.platformPerOrder=m('0');}else{policy.limits.merchantBudget=m('0');policy.limits.merchantPerOrder=m('0');}}
 const support=calculate(policy,m('4000'),m('3000')),f=setup('4000',source=>{if(goods){source.order.allocation.platformGoodsDiscount=m(String(goods));source.order.confirmedCustomerTotal={...source.order.confirmedCustomerTotal,minorAmount:source.order.confirmedCustomerTotal.minorAmount-goods*1000};}},'order1',{deliveryFunding:support,enableDeliveryFunding:enabled});
 const order=f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'});order.commercialPricing={agreement:{id:'agreement',version:1,termsHash:'a'.repeat(64)},funding:{amount:m(String(goods)),state:goods?'RESERVED_WITH_ORDER':'NOT_REQUIRED',holdId:goods?'PROMO#order1':null,policy:null}};
 for(const [type,id,available,locked]of [['MERCHANT','branch1',100,0],['PLATFORM','platform',10000,0]])f.put('staging-Wallets',{walletId:'WALLET#'+type+(type==='MERCHANT'?'#branch1':''),sk:'META',ownerType:type,ownerId:id,status:'ACTIVE',currency:'IQD',availableBalance:available,lockedBalance:locked,version:1});
 const wallet=f.get('staging-Wallets',{walletId:'WALLET#PLATFORM',sk:'META'}),components=[];
 if(goods)components.push({kind:'GOODS',amount:m(String(goods)),metadata:{agreementId:'agreement',agreementVersion:1,fundingPolicy:null}});
 if(support.allocation.platformShare.minorAmount)components.push({kind:'DELIVERY',amount:support.allocation.platformShare,metadata:{policyPin:support.policyPin}});
 const reserve=components.length?cash({orderId:'order1',at:new Date(f.time).toISOString(),wallet,components}):{operations:[]};
 for(const op of reserve.operations){if(op.Put)f.put(op.Put.TableName,op.Put.Item);else if(op.Update){wallet.availableBalance=op.Update.ExpressionAttributeValues[':available'];wallet.lockedBalance=op.Update.ExpressionAttributeValues[':locked'];wallet.version++;}}
 const genesis=init(policy);f.put(genesis.Put.TableName,genesis.Put.Item);const plan=await budget({db:f.db,now:()=>f.time}).reserve({orderId:'order1',customerId:'customer',policy,referenceFee:m('4000'),customerFee:m('3000')});await f.db.send(new TransactWriteCommand({TransactItems:plan.operations}));return f;
}
module.exports={fixture};
