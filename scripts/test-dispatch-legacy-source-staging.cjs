#!/usr/bin/env node
'use strict';
// Disposable, stream-free synthetic DynamoDB test; no application table or real sender.
const assert=require('node:assert/strict'),fs=require('node:fs');
const wr=require('node:module').createRequire(require.resolve('../backend/wallet-service/package.json'));
const {CreateTableCommand,DeleteTableCommand,waitUntilTableExists,waitUntilTableNotExists}=wr('@aws-sdk/client-dynamodb');
const {TransactWriteCommand}=wr('@aws-sdk/lib-dynamodb');
const {STSClient,GetCallerIdentityCommand}=require('@aws-sdk/client-sts');
const {physical,low,adapter}=require('./test-dispatch-cycle-staging.cjs');
const {setup}=require('../backend/wallet-service/test/helpers/dispatch-legacy-source-fixture.cjs');
const {createStagingLegacyWaveExecutor,createStagingLegacyResponses}=require('../backend/wallet-service/dist/dispatchLegacy');
const {createStagingLegacyOfferSource,buildLegacySourcePush}=require('../backend/wallet-service/dist/dispatchLegacySource');
(async()=>{
 assert.equal((await new STSClient({region:'us-east-1'}).send(new GetCallerIdentityCommand({}))).Account,'699561669180');let created=false;
 const report={scope:'REAL_DYNAMODB_ISOLATED_LEGACY_SOURCE',applicationTablesAccessed:false,published:false,realOffersSent:0,humanFundsChanged:false,selection:'SYNTHETIC_FIXED_RECIPIENTS',source:'REAL_SOURCE_ADAPTER_WITH_SYNTHETIC_ROWS'};
 try{
  await low.send(new CreateTableCommand({TableName:physical,BillingMode:'PAY_PER_REQUEST',AttributeDefinitions:[{AttributeName:'_testPk',AttributeType:'S'},{AttributeName:'_testSk',AttributeType:'S'}],KeySchema:[{AttributeName:'_testPk',KeyType:'HASH'},{AttributeName:'_testSk',KeyType:'RANGE'}]}));created=true;
  await waitUntilTableExists({client:low,maxWaitTime:60,minDelay:1,maxDelay:2},{TableName:physical});
  async function scenario(scope,values={}){
   const f=await setup(values),a=adapter(scope),out=[];for(const [k,row]of f.rows)await a.seed(k.split('|')[0],row);
   const source=createStagingLegacyOfferSource({db:a.db,now:()=>f.time});let fail=false;
   const e=createStagingLegacyWaveExecutor({db:a.db,now:()=>f.time,selectDrivers:async()=>['driver1'],prepareOffer:source.prepare,message:source.message,sendOffer:async(id,message)=>{out.push({id,message});if(fail){fail=false;throw Error('lost ACK');}}});
   return {a,f,out,loseSend:()=>fail=true,run:(owner='one')=>e.run({orderId:'order1',assignmentId:'dispatch1',owner,leaseSeconds:10}),respond:async()=>{const offer=await a.get('WaveOffers_staging',{orderId:'order1',SK:'driver1#WAVE#1'});return createStagingLegacyResponses({db:a.db,now:()=>f.time,authenticateDriver:async()=>({driverId:'driver1',subjectId:'driver1'})}).respond('ACCEPT',{orderId:'order1',offerId:offer.offerId,waveNumber:1});}};
  }
  const x=await scenario('source');x.loseSend();await assert.rejects(x.run(),/lost ACK/);x.f.time+=10000;await x.run('two');assert.deepEqual(x.out[0].message,x.out[1].message);const m=x.out[0].message,p=buildLegacySourcePush(m);assert.equal(m.offer.holdRequiredAmount,10000);assert.equal(m.offer.tip,1500);assert.equal(m.offer.estimatedEarnings,4500);assert.equal(p.orderTotal,14500);assert.equal(p.moneyUnit,'IQD_WHOLE');assert(!JSON.stringify(m).includes('PRIVATE'));report.storedMessageReplayAndPushProjection=true;
  x.f.reserve();await x.a.seed('staging-Holds',x.f.get('staging-Holds',{orderId:'order1',sk:'HOLD'}));await x.a.db.send(new TransactWriteCommand({TransactItems:[{Put:{TableName:'staging-Wallets',Item:x.f.get('staging-Wallets',{walletId:'WALLET#DRIVER#driver1',sk:'META'})}}]}));const wallets=await x.a.rows('staging-Wallets');await x.respond();assert.equal((await x.respond()).replayed,true);assert.deepEqual(await x.a.rows('staging-Wallets'),wallets);assert.equal((await x.a.rows('staging-LedgerEntries')).length,0);report.goodsOnlyExistingHoldAndOneTipNoMoneyWrites=true;
  const zero=await scenario('zero',{fee:0,tip:0,goods:100000});await zero.run();assert.equal(zero.out[0].message.offer.deliveryFee,0);assert.equal(zero.out[0].message.offer.orderTotal,100000);report.zeroFeeAndLargeWholeIqdPreserved=true;
  const race=await scenario('race'),send=race.a.db.send;let changed=false;race.a.db.send=async c=>{if(!changed&&c instanceof TransactWriteCommand&&c.input.TransactItems.some(o=>o.Put?.TableName==='WaveOffers_staging')){changed=true;const branch=await race.a.get('WhizzMerchants_Businesses',{businessId:'branch1'});await send(new TransactWriteCommand({TransactItems:[{Put:{TableName:'WhizzMerchants_Businesses',Item:{...branch,address:'changed'}}}]}));}return send(c);};await assert.rejects(race.run());assert.equal(await race.a.get('WaveOffers_staging',{orderId:'order1',SK:'driver1#WAVE#1'}),undefined);assert.equal(race.out.length,0);report.sourceMutationRollsBackOffer=true;
  const stale=await scenario('stale',{goods:0});await stale.run();const branch=await stale.a.get('WhizzMerchants_Businesses',{businessId:'branch1'});await stale.a.db.send(new TransactWriteCommand({TransactItems:[{Put:{TableName:'WhizzMerchants_Businesses',Item:{...branch,latitude:33}}}]}));await assert.rejects(stale.respond(),/LEGACY_BRANCH_SOURCE_CHANGED/);assert.equal((await stale.a.get('WizzDispatchJobs_staging',{orderId:'order1',SK:'METADATA'})).status,'searching');report.changedPickupPreventsAcceptance=true;
 }finally{
  if(created){await low.send(new DeleteTableCommand({TableName:physical}));await waitUntilTableNotExists({client:low,maxWaitTime:60,minDelay:1,maxDelay:2},{TableName:physical});report.tableDeleted=true;}
  fs.writeFileSync('/private/tmp/dispatch41-source-result.json',JSON.stringify(report,null,2)+'\n');
 }
 console.log(JSON.stringify(report));
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
