const {fixture}=require('./dispatch-cycle-fixture.cjs');
const {createStagingLegacyWaveExecutor,createStagingLegacyResponses}=require('../../dist/dispatchLegacy');
const {buildLegacyOfferRow}=require('../../../../lambda/WaveSystem_StartWave/legacy-offer-contract');
async function setup(amount=10000,engine='LEGACY',keyVersion){
 const f=fixture(engine);Object.assign(f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'}),{currency:'IQD',subtotal:amount,total:14500,deliveryFee:3000});await f.create();if(keyVersion!==undefined){const c=f.job().dispatchCycle;f.job().dispatchCycle=require('../../dist/dispatchCycle').createDispatchCycle({id:c.id,orderId:c.orderId,assignmentId:c.assignmentId,engine:c.engine,startedAt:c.startedAt,policy:c.policy,keyVersion});}f.sent=[];f.selected=0;f.fail=false;
 f.send=async(id,message)=>{f.sent.push({id,message});if(f.fail){f.fail=false;throw Error('lost send ACK');}};
 f.prepare=async({job,intent,order,driverId})=>({...buildLegacyOfferRow({...job,deliveryFee:order.deliveryFee,orderTotal:order.total},{driverId,distance:1},intent.waveNumber,{at:new Date(f.time).toISOString(),ttlSeconds:intent.offerTtlSeconds}),currency:'IQD',holdRequiredAmount:order.subtotal});
 f.message=async({offer})=>({type:'new_wave_offer',offer:{offerId:offer.offerId,orderId:offer.orderId,jobId:offer.dispatchJobId,holdRequiredAmount:offer.holdRequiredAmount,deliveryFee:offer.baseDeliveryFee,estimatedEarnings:offer.estimatedEarningsAtOffer,currency:offer.currency,expiresAt:offer.expiresAt}});
 f.executor=createStagingLegacyWaveExecutor({db:f.db,now:()=>f.time,selectDrivers:async()=>{f.selected++;return ['driver1','driver2'];},prepareOffer:p=>f.prepare(p),message:p=>f.message(p),sendOffer:(...a)=>f.send(...a)});
 f.run=(owner='worker1')=>f.executor.run({orderId:'order1',assignmentId:'dispatch1',owner,leaseSeconds:10});
 f.wave=()=>f.get('WizzDispatchJobs_staging',{orderId:'order1',SK:require('../../../src/utils/dispatch-cycle-keys').dispatchWaveSK(f.job().dispatchCycle,1)});f.intent=()=>f.get('WizzDispatchJobs_staging',{orderId:'order1',SK:'DISPATCH_TRANSITION#'+f.job().dispatchTransition.id});
 f.offer=id=>f.get('WaveOffers_staging',{orderId:'order1',SK:require('../../../src/utils/dispatch-cycle-keys').dispatchOfferSK(f.job().dispatchCycle,id,1)});
 f.respond=(id,action)=>createStagingLegacyResponses({db:f.db,now:()=>f.time,authenticateDriver:async()=>({driverId:id,subjectId:id})}).respond(action,{orderId:'order1',offerId:f.offer(id).offerId,waveNumber:1});
 f.reserve=(id='driver1')=>{f.put('staging-Holds',{orderId:'order1',sk:'HOLD',holdId:'legacyhold1',walletId:'WALLET#DRIVER#'+id,amount,status:'ACTIVE',metadata:{assignmentAttempt:1}});Object.assign(f.get('staging-Wallets',{walletId:'WALLET#DRIVER#'+id,sk:'META'}),{availableBalance:20000-amount,lockedBalance:amount,version:2});};
 return f;
}
module.exports={setup};
