#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const wr=require('node:module').createRequire(require.resolve('../backend/wallet-service/package.json'));
const {CreateTableCommand,DeleteTableCommand,waitUntilTableExists,waitUntilTableNotExists}=wr('@aws-sdk/client-dynamodb');
const {TransactWriteCommand}=wr('@aws-sdk/lib-dynamodb');
const {STSClient,GetCallerIdentityCommand}=require('@aws-sdk/client-sts');
const {physical,low,adapter}=require('./test-dispatch-cycle-staging.cjs');
const {setup}=require('../backend/wallet-service/test/helpers/dispatch-legacy-fixture.cjs');
const {createStagingLegacyWaveExecutor,createStagingLegacyResponses}=require('../backend/wallet-service/dist/dispatchLegacy');
(async()=>{
 assert.equal((await new STSClient({region:'us-east-1'}).send(new GetCallerIdentityCommand({}))).Account,'699561669180');let created=false;
 const report={scope:'REAL_DYNAMODB_ISOLATED_LEGACY_WAVE_AND_RESPONSES',applicationTablesAccessed:false,published:false,realOffersSent:0,selectionIdentityPriceAndSender:'SYNTHETIC_SERVER_DEPENDENCIES',humanFundsChanged:false};
 try{
  await low.send(new CreateTableCommand({TableName:physical,BillingMode:'PAY_PER_REQUEST',AttributeDefinitions:[{AttributeName:'_testPk',AttributeType:'S'},{AttributeName:'_testSk',AttributeType:'S'}],KeySchema:[{AttributeName:'_testPk',KeyType:'HASH'},{AttributeName:'_testSk',KeyType:'RANGE'}]}));created=true;await waitUntilTableExists({client:low,maxWaitTime:60,minDelay:1,maxDelay:2},{TableName:physical});
  async function scenario(scope,reserved=false){const f=await setup(),a=adapter(scope);if(reserved)f.reserve();for(const [k,row]of f.rows)await a.seed(k.split('|')[0],row);
   const out=[];let fail=false,selected=0;const executor=createStagingLegacyWaveExecutor({db:a.db,now:()=>f.time,selectDrivers:async()=>{selected++;return ['driver1','driver2'];},prepareOffer:f.prepare,message:f.message,sendOffer:async(id,message)=>{out.push({id,message});if(fail){fail=false;throw Error('synthetic lost delivery ACK');}}});
   return {a,f,out,selected:()=>selected,loseSend:()=>{fail=true;},run:owner=>executor.run({orderId:'order1',assignmentId:'dispatch1',owner:owner??'worker1',leaseSeconds:10}),respond:async(id,action)=>{const row=await a.get('WaveOffers_staging',{orderId:'order1',SK:id+'#WAVE#1'});return createStagingLegacyResponses({db:a.db,now:()=>f.time,authenticateDriver:async()=>({driverId:id,subjectId:id})}).respond(action,{orderId:'order1',offerId:row.offerId,waveNumber:1});}};
  }
  const x=await scenario('send');x.loseSend();await assert.rejects(x.run(),/synthetic lost delivery ACK/);const job=await x.a.get('WizzDispatchJobs_staging',{orderId:'order1',SK:'METADATA'}),intent=await x.a.get('WizzDispatchJobs_staging',{orderId:'order1',SK:'DISPATCH_TRANSITION#'+job.dispatchTransition.id});assert.equal(intent.state,'APPLIED');assert.equal((await x.a.get('WizzDispatchJobs_staging',{orderId:'order1',SK:'LEGACY_WAVE#1'})).state,'READY');
  await x.respond('driver1','DECLINE');x.f.time+=10000;await x.run('worker2');assert.equal(x.out.length,2);assert.equal(x.out[1].id,'driver2');assert.equal(x.selected(),1);report.readyAndAppliedAtomicAndDeclinedRecipientResumed=true;
  const last=await x.respond('driver2','DECLINE');assert.equal(last.transition.waveNumber,2);assert.equal((await x.respond('driver2','DECLINE')).transition.intentId,last.transition.intentId);report.lastDeclineOneTransition=true;
  const y=await scenario('accept',true);await y.run();const before=await y.a.rows('staging-Wallets');const accepted=await y.respond('driver1','ACCEPT');assert.equal(accepted.holdId,'legacyhold1');assert.equal((await y.respond('driver1','ACCEPT')).replayed,true);assert.equal((await y.run()).action,'STOP');assert.deepEqual(await y.a.rows('staging-Wallets'),before);assert.equal((await y.a.rows('staging-LedgerEntries')).length,0);assert.equal((await y.a.get('WizzOrders',{PK:'ORDER#order1',SK:'META'})).driverId,'driver1');report.assignmentUsesExistingReservationWithoutMoneyWrites=true;
  const z=await scenario('release-race',true);await z.run();const send=z.a.db.send;let changed=false;z.a.db.send=async c=>{if(!changed&&c instanceof TransactWriteCommand&&c.input.TransactItems.some(o=>o.Put?.Item.eventType==='ACCEPTED')){changed=true;const hold=await z.a.get('staging-Holds',{orderId:'order1',sk:'HOLD'});await send(new TransactWriteCommand({TransactItems:[{Put:{TableName:'staging-Holds',Item:{...hold,status:'RELEASED'}}}]}));}return send(c);};await assert.rejects(z.respond('driver1','ACCEPT'));assert.equal((await z.a.get('WizzDispatchJobs_staging',{orderId:'order1',SK:'METADATA'})).status,'searching');assert.equal((await z.a.get('WaveOffers_staging',{orderId:'order1',SK:'driver1#WAVE#1'})).responseStatus,'pending');report.reservationReleaseRaceRollsBackAssignment=true;
 }finally{if(created){await low.send(new DeleteTableCommand({TableName:physical}));await waitUntilTableNotExists({client:low,maxWaitTime:60,minDelay:1,maxDelay:2},{TableName:physical});report.tableDeleted=true;}fs.writeFileSync('/private/tmp/dispatch37-legacy-result.json',JSON.stringify(report,null,2)+'\n');}
 console.log(JSON.stringify(report));
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
