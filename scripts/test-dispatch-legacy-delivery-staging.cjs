#!/usr/bin/env node
'use strict';
// One disposable stream-free table; provider transports are fakes. No application
// tables, notification endpoints, Firebase tokens or human money are accessed.
const assert=require('node:assert/strict'),fs=require('node:fs');
const wr=require('node:module').createRequire(require.resolve('../backend/wallet-service/package.json'));
const {CreateTableCommand,DeleteTableCommand,waitUntilTableExists,waitUntilTableNotExists}=wr('@aws-sdk/client-dynamodb');
const {TransactWriteCommand}=wr('@aws-sdk/lib-dynamodb');
const {STSClient,GetCallerIdentityCommand}=require('@aws-sdk/client-sts');
const {physical,low,adapter}=require('./test-dispatch-cycle-staging.cjs');
const {setup}=require('../backend/wallet-service/test/helpers/dispatch-legacy-source-fixture.cjs');
const {createStagingLegacyWaveExecutor}=require('../backend/wallet-service/dist/dispatchLegacy');
const {createStagingLegacyOfferSource}=require('../backend/wallet-service/dist/dispatchLegacySource');
const {createStagingLegacyOfferDelivery}=require('../backend/wallet-service/dist/dispatchLegacyDelivery');
(async()=>{
 assert.equal((await new STSClient({region:'us-east-1'}).send(new GetCallerIdentityCommand({}))).Account,'699561669180');let created=false;
 const report={scope:'REAL_DYNAMODB_ISOLATED_CHANNEL_ACKS',applicationTablesAccessed:false,published:false,realNotificationsSent:0,humanFundsChanged:false,providers:'FAKE_SOCKET_AND_FAKE_PUSH_HTTP_ACK'};
 try{
  await low.send(new CreateTableCommand({TableName:physical,BillingMode:'PAY_PER_REQUEST',AttributeDefinitions:[{AttributeName:'_testPk',AttributeType:'S'},{AttributeName:'_testSk',AttributeType:'S'}],KeySchema:[{AttributeName:'_testPk',KeyType:'HASH'},{AttributeName:'_testSk',KeyType:'RANGE'}]}));created=true;await waitUntilTableExists({client:low,maxWaitTime:60,minDelay:1,maxDelay:2},{TableName:physical});
  async function scenario(scope,ids=['driver1']){
   const f=await setup(),a=adapter(scope),out={ws:[],push:[]};for(const [k,row]of f.rows)await a.seed(k.split('|')[0],row);
   const s={f,a,out},source=createStagingLegacyOfferSource({db:a.db,now:()=>f.time});s.ws=async(id,message)=>out.ws.push({id,message});s.push=async p=>{out.push.push(p);return {statusCode:200,body:JSON.stringify({success:true,successCount:1,driverId:p.driverId,offerId:p.offerId,eventId:p.eventId,cycleId:p.cycleId})};};
   const delivery=createStagingLegacyOfferDelivery({db:a.db,now:()=>f.time,postSocket:(...args)=>s.ws(...args),postPush:p=>s.push(p)});
   const e=createStagingLegacyWaveExecutor({db:a.db,now:()=>f.time,selectDrivers:async()=>ids,prepareOffer:source.prepare,message:source.message,sendOffer:delivery});
   return Object.assign(s,{run:(owner='one')=>e.run({orderId:'order1',assignmentId:'dispatch1',owner,leaseSeconds:10}),offer:()=>a.get('WaveOffers_staging',{orderId:'order1',SK:'driver1#WAVE#1'})});
  }
  const x=await scenario('partial',['driver1','driver2']),normal=x.push;let failed=false;x.push=async p=>{if(p.driverId==='driver1'&&!failed){failed=true;return {statusCode:500,body:'{}'};}return normal(p);};await assert.rejects(x.run(),/LEGACY_DELIVERY_RETRY_REQUIRED/);assert.equal(x.out.ws.length,2);assert.equal((await x.offer()).deliveryAck.pushAccepted,false);x.f.time+=10000;await x.run('two');assert.equal(x.out.ws.length,2);assert.equal(x.out.push.length,2);assert.equal((await x.offer()).deliveryAck.pushAccepted,true);assert.equal((await x.a.rows('staging-LedgerEntries')).length,0);report.partialFailureResumesOnlyMissingChannelAndOtherRecipientContinues=true;
  const y=await scenario('lost-db-ack'),send=y.a.db.send;let lost=false;y.a.db.send=async c=>{const r=await send(c);if(!lost&&c instanceof TransactWriteCommand&&c.input.TransactItems.some(o=>Object.values(o.Update?.ExpressionAttributeValues??{}).some(v=>v?.websocketAccepted===true))){lost=true;throw Error('ACK lost');}return r;};await y.run();assert.equal(y.out.ws.length,1);assert.equal(y.out.push.length,1);report.lostDatabaseAcknowledgementRecoveredWithoutDuplicateNetworkSend=true;
  const z=await scenario('pickup-race'),ws=z.ws;z.ws=async(...args)=>{await ws(...args);const branch=await z.a.get('WhizzMerchants_Businesses',{businessId:'branch1'});await z.a.db.send(new TransactWriteCommand({TransactItems:[{Put:{TableName:'WhizzMerchants_Businesses',Item:{...branch,latitude:33}}}]}));};await assert.rejects(z.run(),/LEGACY_BRANCH_SOURCE_CHANGED/);assert.equal(z.out.push.length,0);assert.equal((await z.offer()).deliveryAck.websocketAccepted,false);report.pickupChangeAfterSocketPreventsAckAndPush=true;
  const gone=await scenario('gone');gone.ws=async()=>{throw Object.assign(Error('gone'),{statusCode:410});};await gone.run();assert.equal((await gone.offer()).deliveryAck.websocketUnavailable,true);assert.equal((await gone.offer()).deliveryAck.pushAccepted,true);report.goneConnectionUsesPushWithoutExpiringOffer=true;
 }finally{if(created){await low.send(new DeleteTableCommand({TableName:physical}));await waitUntilTableNotExists({client:low,maxWaitTime:60,minDelay:1,maxDelay:2},{TableName:physical});report.tableDeleted=true;}fs.writeFileSync('/private/tmp/dispatch42-delivery-result.json',JSON.stringify(report,null,2)+'\n');}
 console.log(JSON.stringify(report));
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
