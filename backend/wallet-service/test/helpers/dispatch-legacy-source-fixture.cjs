'use strict';
const {fixture}=require('./dispatch-cycle-fixture.cjs');
const {createStagingLegacyWaveExecutor,createStagingLegacyResponses}=require('../../dist/dispatchLegacy');
const {createStagingLegacyOfferSource}=require('../../dist/dispatchLegacySource');
async function setup({goods=10000,fee=3000,tip=1500,keyVersion,mutate=()=>{}}={}){
 const f=fixture('LEGACY'),order=f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'});
 Object.assign(order,{currency:'IQD',createdBy:'wizzuser_app',paymentMethod:'cod',paymentChannel:'cod',paymentStatus:'pending',subtotal:goods,total:goods+fee+tip,pricing:{goodsSubtotal:goods*1000,serviceFee:0,packagingFee:0,deliveryFee:fee*1000,tax:0,tip:tip*1000,rounding:0,discount:0,total:(goods+fee+tip)*1000},items:[{itemId:'item1',name:'وجبة اختبار',unitPrice:goods*1000,quantity:1,modifiers:[]}],deliveryAddress:{fullAddress:'عنوان اختبار',lat:31.92,lng:44.46},customerPhone:'PRIVATE_PHONE',guestToken:'PRIVATE_TOKEN'});
 Object.assign(f.get('WhizzMerchants_Businesses',{businessId:'branch1'}),{name:'مطعم اختبار',address:{fullAddress:'عنوان المطعم'},latitude:31.91,longitude:44.45,regionId:'zone1'});
 mutate(f,order);await f.create();if(keyVersion!==undefined){const c=f.job().dispatchCycle;f.job().dispatchCycle=require('../../dist/dispatchCycle').createDispatchCycle({id:c.id,orderId:c.orderId,assignmentId:c.assignmentId,engine:c.engine,startedAt:c.startedAt,policy:c.policy,keyVersion});}f.source=createStagingLegacyOfferSource({db:f.db,now:()=>f.time});f.sent=[];
 f.executor=createStagingLegacyWaveExecutor({db:f.db,now:()=>f.time,selectDrivers:async()=>['driver1','driver2'],prepareOffer:f.source.prepare,message:f.source.message,sendOffer:async(id,message)=>f.sent.push({id,message})});
 f.run=(owner='worker1')=>f.executor.run({orderId:'order1',assignmentId:'dispatch1',owner,leaseSeconds:10});
 f.offer=(id='driver1')=>f.get('WaveOffers_staging',{orderId:'order1',SK:require('../../../src/utils/dispatch-cycle-keys').dispatchOfferSK(f.job().dispatchCycle,id,1)});
 f.respond=(id='driver1',action='ACCEPT')=>createStagingLegacyResponses({db:f.db,now:()=>f.time,authenticateDriver:async()=>({driverId:id,subjectId:id})}).respond(action,{orderId:'order1',offerId:f.offer(id).offerId,waveNumber:1});
 f.reserve=()=>{f.put('staging-Holds',{orderId:'order1',sk:'HOLD',holdId:'legacyhold1',walletId:'WALLET#DRIVER#driver1',amount:goods,status:'ACTIVE',metadata:{assignmentAttempt:1}});Object.assign(f.get('staging-Wallets',{walletId:'WALLET#DRIVER#driver1',sk:'META'}),{availableBalance:20000-goods,lockedBalance:goods,version:2});};
 return f;
}
module.exports={setup};
