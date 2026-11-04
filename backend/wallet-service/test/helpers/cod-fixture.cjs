const {test}=require('node:test'),assert=require('node:assert/strict');
const {createStagingCodCompletion}=require('../../dist/codCompletion');
const {parseIqd}=require('../../dist/money');
const {setup}=require('./driver-financial-fixture.cjs');
async function ready(earning='3000',discount=0,commission=0){
 const f=setup(earning,source=>{
  source.order.allocation.platformGoodsDiscount=parseIqd(String(discount));
  source.order.allocation.merchantCommission=parseIqd(String(commission));
  source.order.confirmedCustomerTotal=parseIqd(String(14500-discount));
 });
 await f.run();await f.accept();
 const order=f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'});order.status='arrived_at_customer';
 order.commercialPricing={agreement:{id:'agreement1',version:1,termsHash:'a'.repeat(64)},funding:{amount:parseIqd(String(discount)),holdId:discount?'PROMO#order1':null,state:discount?'RESERVED_WITH_ORDER':'NOT_REQUIRED',policy:{id:'fund1',version:1}}};
 for(const [ownerType,ownerId,availableBalance,lockedBalance] of [['MERCHANT','branch1',100,10],['PLATFORM','PLATFORM',5000,discount]])
  f.put('staging-Wallets',{walletId:'WALLET#'+ownerType+(ownerType==='MERCHANT'?'#branch1':''),sk:'META',ownerType,ownerId,status:'ACTIVE',currency:'IQD',availableBalance,lockedBalance,version:1});
 if(discount)f.put('staging-Holds',{orderId:'order1',sk:'PROMOTION_FUNDING',holdId:'PROMO#order1',walletId:'WALLET#PLATFORM',amount:discount,status:'ACTIVE',purpose:'PLATFORM_GOODS_DISCOUNT',metadata:{agreementId:'agreement1',agreementVersion:1,fundingPolicy:{id:'fund1',version:1}}});
 f.complete=(extra={},actor={driverId:'driver1',subjectId:'driver1'})=>createStagingCodCompletion({db:f.db,now:()=>f.time,authenticateDriver:async()=>actor}).complete({orderId:'order1',cashCollected:true,...extra});
 return f;
}
const w=(f,id)=>f.get('staging-Wallets',{walletId:id,sk:'META'});

module.exports={ready,w};
