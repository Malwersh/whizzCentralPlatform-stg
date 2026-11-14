#!/usr/bin/env node
'use strict';
// Actual transactions, one disposable table; route/identity/sender dependencies are synthetic.
const assert=require('node:assert/strict'),fs=require('node:fs');
const wr=require('node:module').createRequire(require.resolve('../backend/wallet-service/package.json'));
const {CreateTableCommand,DeleteTableCommand,waitUntilTableExists,waitUntilTableNotExists}=wr('@aws-sdk/client-dynamodb');
const {STSClient,GetCallerIdentityCommand}=require('@aws-sdk/client-sts');
const {physical,low,adapter}=require('./test-dispatch-cycle-staging.cjs');
const {fixture}=require('../backend/wallet-service/test/helpers/dispatch-cycle-fixture.cjs');
const {route}=require('../backend/wallet-service/test/helpers/driver-offer-fixture.cjs');
const {createStagingDispatchCycleStore}=require('../backend/wallet-service/dist/dispatchCycleStore');
const {createStagingDispatchWaveExecutor}=require('../backend/wallet-service/dist/dispatchWaveExecutor');
const {createStagingDriverOfferContext}=require('../backend/wallet-service/dist/driverOfferContext');
const {createStagingDriverOfferAcceptance}=require('../backend/wallet-service/dist/driverOfferAcceptance');
(async()=>{
 assert.equal((await new STSClient({region:'us-east-1'}).send(new GetCallerIdentityCommand({}))).Account,'699561669180');
 let created=false;const report={scope:'REAL_DYNAMODB_ISOLATED_PINNED_FINANCIAL_EXECUTOR',applicationTablesAccessed:false,published:false,realOffersSent:0,identityAndRoutes:'SYNTHETIC',financialWrites:'DISPOSABLE_TABLE_ONLY'};
 try{
  await low.send(new CreateTableCommand({TableName:physical,BillingMode:'PAY_PER_REQUEST',AttributeDefinitions:[{AttributeName:'_testPk',AttributeType:'S'},{AttributeName:'_testSk',AttributeType:'S'}],KeySchema:[{AttributeName:'_testPk',KeyType:'HASH'},{AttributeName:'_testSk',KeyType:'RANGE'}]}));created=true;
  await waitUntilTableExists({client:low,maxWaitTime:60,minDelay:1,maxDelay:2},{TableName:physical});
  async function setup(scope){const a=adapter(scope),f=fixture();for(const [k,row]of f.rows)await a.seed(k.split('|')[0],row);await createStagingDispatchCycleStore({db:a.db,now:()=>f.time}).create(f.input);
   const context=p=>createStagingDriverOfferContext({...p,now:()=>f.time,cognito:{async send(c){return {Enabled:true,Username:c.input.Username,UserStatus:'CONFIRMED',UserAttributes:[{Name:'sub',Value:c.input.Username}]};}},router:{async getRoute(a,b){return route('route',a,b);}}});
   const out=[];let selected=0,failSend=false;
   const executor=createStagingDispatchWaveExecutor({db:a.db,now:()=>f.time,context,selectDrivers:async()=>{selected++;return ['driver1','driver2'];},sendOffer:async(id,m)=>{out.push({id,m});if(failSend){failSend=false;throw Error('synthetic lost send acknowledgement');}}});
   return {a,f,out,selected:()=>selected,loseSend:()=>{failSend=true;},run:owner=>executor.run({orderId:'order1',assignmentId:'dispatch1',owner:owner??'worker1',leaseSeconds:10}),service:id=>createStagingDriverOfferAcceptance({db:a.db,context:context({db:a.db,offerTtlSeconds:60,positionMaxAgeSeconds:120}),now:()=>f.time,authenticateDriver:async()=>({driverId:id,subjectId:id})}),selector:async id=>({orderId:'order1',waveNumber:1,offerId:(await a.get('WaveOffers_staging',{orderId:'order1',SK:'FINANCIAL#'+id+'#WAVE#1'})).offerId})};}
  const x=await setup('delivery');x.loseSend();await assert.rejects(x.run(),/synthetic lost send acknowledgement/);
  const job=await x.a.get('WizzDispatchJobs_staging',{orderId:'order1',SK:'METADATA'}),intent=await x.a.get('WizzDispatchJobs_staging',{orderId:'order1',SK:'DISPATCH_TRANSITION#'+job.dispatchTransition.id});assert.equal(intent.state,'APPLIED');report.readyAndAppliedCommitted=true;
  x.f.time+=10000;await x.run('worker2');assert.equal(x.out.length,3);assert.equal(x.out[0].m.eventId,x.out[1].m.eventId);assert.equal(x.selected(),1);await x.run('worker2');assert.equal(x.out.length,3);report.resumeKeepsRecipientsAndEventIds=true;
  const before=await x.a.get('staging-Wallets',{walletId:'WALLET#DRIVER#driver1',sk:'META'}),selector=await x.selector('driver1');
  const accepted=await x.service('driver1').accept(selector);assert.equal(accepted.success,true);assert.equal((await x.service('driver1').accept(selector)).replayed,true);
  const after=await x.a.get('staging-Wallets',{walletId:'WALLET#DRIVER#driver1',sk:'META'});assert.equal(after.lockedBalance-before.lockedBalance,accepted.holdAmount);assert.equal(after.version,before.version+1);await x.run();assert.equal(x.out.length,3);report.pinnedAcceptanceSingleHoldAndStop=true;
  const y=await setup('declines');await y.run();const a=await y.service('driver1').decline(await y.selector('driver1'));assert.equal(a.transition.action,'WAIT');const b=await y.service('driver2').decline(await y.selector('driver2'));assert.equal(b.transition.waveNumber,2);const replay=await y.service('driver2').decline(await y.selector('driver2'));assert.equal(replay.transition.intentId,b.transition.intentId);assert.equal(replay.transition.claimed,false);report.lastDeclineOneNextIntent=true;
 }finally{if(created){await low.send(new DeleteTableCommand({TableName:physical}));await waitUntilTableNotExists({client:low,maxWaitTime:60,minDelay:1,maxDelay:2},{TableName:physical});report.tableDeleted=true;}fs.writeFileSync('/private/tmp/dispatch35-executor-result.json',JSON.stringify(report,null,2)+'\n');}
 console.log(JSON.stringify(report));
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
