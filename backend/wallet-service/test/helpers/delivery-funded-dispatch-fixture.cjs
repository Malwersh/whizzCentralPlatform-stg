const {fixture:funded}=require('./delivery-funded-driver-fixture.cjs');
const {policy}=require('./dispatch-cycle-fixture.cjs');
const {route}=require('./driver-offer-fixture.cjs');
const {createStagingDispatchCycleStore:store}=require('../../dist/dispatchCycleStore');
const {createStagingDispatchCoordinator:coordinator}=require('../../dist/dispatchCoordinator');
const {createStagingDispatchWaveExecutor:executor}=require('../../dist/dispatchWaveExecutor');
const {createStagingDriverOfferContext:context}=require('../../dist/driverOfferContext');
const {createStagingDriverOfferAcceptance:acceptance}=require('../../dist/driverOfferAcceptance');
const {createStagingDispatchCandidates:candidates}=require('../../dist/dispatchCandidates');
const {quoteCanonical}=require('../../dist/deliveryQuoteRecord');
const jobKey={orderId:'order1',SK:'METADATA'},orderKey={PK:'ORDER#order1',SK:'META'};
async function fixture(enabled=true){
 const f=await funded(),job=structuredClone(f.get('WizzDispatchJobs_staging',jobKey));f.rows.delete('WizzDispatchJobs_staging|'+quoteCanonical(jobKey));
 f.put('staging-PlatformStaff',{pk:'OPERATIONAL_SETTINGS#DELIVERY_OPERATIONS',sk:'CURRENT',version:2,values:policy()});
 f.store=store({db:f.db,now:()=>f.time,enableDeliveryFunding:enabled});f.create=()=>f.store.create({requestId:'cycle-funded',job});
 f.coordinator=coordinator({db:f.db,now:()=>f.time,enableDeliveryFunding:enabled});f.job=()=>f.get('WizzDispatchJobs_staging',jobKey);f.order=()=>f.get('WizzOrders',orderKey);
 const cog={async send(c){return {Enabled:true,Username:c.input.Username,UserStatus:'CONFIRMED',UserAttributes:[{Name:'sub',Value:c.input.Username}]};}};
 f.contextFactory=p=>context({...p,cognito:cog,router:{getRoute:async(a,b)=>{const r=route('route',a,b);r.route.measuredAt=new Date(f.time).toISOString();r.route.expiresAt=new Date(f.time+60000).toISOString();return r;}},now:()=>f.time});
 f.out=[];f.executor=executor({db:f.db,now:()=>f.time,enableDeliveryFunding:enabled,selectDrivers:async()=>['driver1','driver2'],context:f.contextFactory,sendOffer:async(id,message)=>f.out.push({id,message})});
 f.execute=()=>f.executor.run({orderId:'order1',assignmentId:'dispatch1',owner:'worker',leaseSeconds:10});
 f.selector=id=>({orderId:'order1',waveNumber:f.job().currentWaveNumber,offerId:f.get('WaveOffers_staging',{orderId:'order1',SK:'FINANCIAL#'+id+'#WAVE#'+f.job().currentWaveNumber}).offerId});
 f.service=id=>acceptance({db:f.db,now:()=>f.time,enableDeliveryFunding:enabled,context:f.context,authenticateDriver:async()=>({driverId:id,subjectId:id})});
 f.funding=()=>JSON.stringify([...f.rows].filter(([k])=>/^(staging-Holds|staging-PlatformStaff|staging-LedgerEntries)\|/.test(k)||k.startsWith('staging-Wallets|')&&!k.includes('DRIVER')));
 return f;
}

module.exports={fixture};
