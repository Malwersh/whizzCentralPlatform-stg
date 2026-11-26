const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./helpers/delivery-funded-dispatch-fixture.cjs');
const {AdminGetUserCommand}=require('@aws-sdk/client-cognito-identity-provider');
const {createStagingPinnedFinancialRunner}=require('../dist/dispatchWaveExecutor');
const {route}=require('./helpers/driver-offer-fixture.cjs');
test('actual sender delegate converts both database and Cognito commands for the host clients',async()=>{
 const f=await fixture();await f.create();
 for(const id of ['driver1','driver2'])Object.assign(f.get('WizzDriverLiveState_staging',{driverId:id}),{current_work_region_id:'zone1',allowed_region_ids:['zone1'],allowed_region_ids_priority0:['zone1'],metricsSnapshot_totalTrips:0});
 let checks=0;const sent=[];
 const db={send:c=>{if(c.constructor.name==='ScanCommand')return Promise.resolve({Items:[{driverId:'driver1'},{driverId:'driver2'}]});return f.db.send(c);}};
 const runner=createStagingPinnedFinancialRunner({db,now:()=>f.time,enableDeliveryFunding:true,cognito:{async send(c){assert(c instanceof AdminGetUserCommand,'foreign Cognito SDK command reached host client');checks++;return {Enabled:true,Username:c.input.Username,UserStatus:'CONFIRMED',UserAttributes:[{Name:'sub',Value:c.input.Username}]};}},router:{getRoute:async(a,b)=>route('route',a,b)},sendOffer:async(id,message)=>sent.push({id,message})});
 await runner.run({orderId:'order1',assignmentId:'dispatch1',owner:'sdk-regression',leaseSeconds:10});assert(checks>=2);assert.equal(sent.length,2);
});
