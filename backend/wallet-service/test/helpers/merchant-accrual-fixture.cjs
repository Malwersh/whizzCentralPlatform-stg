const {createStagingCodCompletion}=require('../../dist/codCompletion');
const {parseIqd}=require('../../dist/money');
const {setup}=require('./driver-financial-fixture.cjs');
async function proof({merchant=0,platform=0,commission=1000,earning='3000',goods=10000,orderId='order1'}={}){
 const f=setup(earning,source=>{
  Object.assign(source.order.allocation,{goodsGross:parseIqd(String(goods)),merchantGoodsDiscount:parseIqd(String(merchant)),platformGoodsDiscount:parseIqd(String(platform)),merchantCommission:parseIqd(String(commission))});
  source.order.confirmedCustomerTotal=parseIqd(String(goods-merchant-platform+4500));
 },orderId);
 await f.run();await f.accept();
 const order=f.get('WizzOrders',{PK:'ORDER#'+orderId,SK:'META'});order.status='arrived_at_customer';
 order.commercialPricing={agreement:{id:'agreement1',version:1,termsHash:'a'.repeat(64)},funding:{amount:parseIqd(String(platform)),holdId:platform?'PROMO#'+orderId:null,state:platform?'RESERVED_WITH_ORDER':'NOT_REQUIRED',policy:{id:'fund1',version:1}}};
 for(const [ownerType,ownerId,availableBalance,lockedBalance] of [['MERCHANT','branch1',100,0],['PLATFORM','PLATFORM',100000,platform]])f.put('staging-Wallets',{walletId:'WALLET#'+ownerType+(ownerType==='MERCHANT'?'#branch1':''),sk:'META',ownerType,ownerId,status:'ACTIVE',currency:'IQD',availableBalance,lockedBalance,version:1});
 if(platform)f.put('staging-Holds',{orderId,sk:'PROMOTION_FUNDING',holdId:'PROMO#'+orderId,walletId:'WALLET#PLATFORM',amount:platform,status:'ACTIVE',purpose:'PLATFORM_GOODS_DISCOUNT',metadata:{agreementId:'agreement1',agreementVersion:1,fundingPolicy:{id:'fund1',version:1}}});
 const completion=createStagingCodCompletion({db:f.db,now:()=>f.time,authenticateDriver:async()=>({driverId:'driver1',subjectId:'driver1'})});
 await completion.complete({orderId,cashCollected:true});
 const acceptedOffer=f.get('WaveOffers_staging',{orderId,SK:'FINANCIAL#driver1#WAVE#1'});
 const outcome=f.get('staging-Holds',{orderId,sk:'FINANCIAL_OUTCOME'}),payable=f.get('staging-Holds',{orderId,sk:'MERCHANT_PAYABLE'});
 return {input:{branchId:'branch1',order:f.get('WizzOrders',{PK:'ORDER#'+orderId,SK:'META'}),acceptedOffer,outcome,payable},f};
}
module.exports={proof};
