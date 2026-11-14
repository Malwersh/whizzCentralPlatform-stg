#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const wr=require('node:module').createRequire(require.resolve('../backend/wallet-service/package.json'));
const {CreateTableCommand,DeleteTableCommand,waitUntilTableExists,waitUntilTableNotExists}=wr('@aws-sdk/client-dynamodb');
const {marshall}=wr('@aws-sdk/util-dynamodb');
const {STSClient,GetCallerIdentityCommand}=require('@aws-sdk/client-sts');
const {physical,low,adapter}=require('./test-dispatch-cycle-staging.cjs');
const {fixture}=require('../backend/wallet-service/test/helpers/dispatch-cycle-fixture.cjs');
const {route}=require('../backend/wallet-service/test/helpers/driver-offer-fixture.cjs');
const {createStagingDispatchCreator}=require('../backend/wallet-service/dist/dispatchCreator');
const {createStagingPinnedFinancialRunner}=require('../backend/wallet-service/dist/dispatchWaveExecutor');
const {createStagingDriverOfferContext}=require('../backend/wallet-service/dist/driverOfferContext');
const {createStagingDriverOfferAcceptance}=require('../backend/wallet-service/dist/driverOfferAcceptance');
(async()=>{
 assert.equal((await new STSClient({region:'us-east-1'}).send(new GetCallerIdentityCommand({}))).Account,'699561669180');let created=false;
 const report={scope:'REAL_DYNAMODB_ISOLATED_CREATOR_AND_SHARED_SELECTION',applicationTablesAccessed:false,published:false,realOffersSent:0,identityRoutesAndInvoke:'SYNTHETIC',logicalIndexQueries:'EMULATED_BY_ISOLATED_TABLE_SCAN_NOT_LIVE_GSI'};
 try{
  await low.send(new CreateTableCommand({TableName:physical,BillingMode:'PAY_PER_REQUEST',AttributeDefinitions:[{AttributeName:'_testPk',AttributeType:'S'},{AttributeName:'_testSk',AttributeType:'S'}],KeySchema:[{AttributeName:'_testPk',KeyType:'HASH'},{AttributeName:'_testSk',KeyType:'RANGE'}]}));created=true;await waitUntilTableExists({client:low,maxWaitTime:60,minDelay:1,maxDelay:2},{TableName:physical});
  const f=fixture(),a=adapter('initial');for(const id of ['driver1','driver2'])Object.assign(f.get('WizzDriverLiveState_staging',{driverId:id}),{current_work_region_id:'zone1',allowed_region_ids:['zone1'],allowed_region_ids_priority0:['zone1'],metricsSnapshot_totalTrips:0});
  for(const [k,row]of f.rows)await a.seed(k.split('|')[0],row);
  const order=f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'}),record={eventName:'MODIFY',eventSource:'aws:dynamodb',eventSourceARN:'arn:aws:dynamodb:us-east-1:699561669180:table/WizzOrders/stream/2026-10-16T00:00:00.000',eventID:'synthetic-record-1',dynamodb:{SequenceNumber:'123',Keys:marshall({PK:order.PK,SK:'META'}),OldImage:marshall({...order,status:'preparing'}),NewImage:marshall(order)}};
  const calls=[];let lost=true;const creator=createStagingDispatchCreator({db:a.db,now:()=>f.time,invokeStart:async input=>{calls.push(input);if(lost){lost=false;throw Error('synthetic lost invocation response');}}});
  await assert.rejects(creator.process(record),/synthetic lost invocation response/);const saved=await a.get('WizzDispatchJobs_staging',{orderId:'order1',SK:'METADATA'});const replay=await creator.process(record);assert.equal(replay.replayed,true);assert.deepEqual(calls[0],calls[1]);assert.deepEqual(await a.get('WizzDispatchJobs_staging',{orderId:'order1',SK:'METADATA'}),saved);report.deterministicCreationResumesInvocation=true;
  const cognito={async send(c){return {Enabled:true,Username:c.input.Username,UserStatus:'CONFIRMED',UserAttributes:[{Name:'sub',Value:c.input.Username}]};}},router={async getRoute(origin,destination){return route('route',origin,destination);}},sent=[];
  const runner=createStagingPinnedFinancialRunner({db:a.db,now:()=>f.time,cognito,router,sendOffer:async(id,message)=>{sent.push({id,message});}}),input={orderId:'order1',assignmentId:saved.dispatchJobId,owner:'worker1',leaseSeconds:120};
  const ready=await runner.run(input);assert.equal(ready.offers,2);assert.equal(sent.length,2);assert.deepEqual(sent.map(r=>r.id),['driver1','driver2']);await runner.run(input);assert.equal(sent.length,2);report.sharedSelectionAndExecutorIntegrated=true;
  const context=createStagingDriverOfferContext({db:a.db,now:()=>f.time,cognito,router,positionMaxAgeSeconds:120,offerTtlSeconds:60});
  for(const driverId of ['driver1','driver2']){const offer=await a.get('WaveOffers_staging',{orderId:'order1',SK:'FINANCIAL#'+driverId+'#WAVE#1'});await createStagingDriverOfferAcceptance({db:a.db,now:()=>f.time,context,authenticateDriver:async()=>({driverId,subjectId:driverId})}).decline({orderId:'order1',waveNumber:1,offerId:offer.offerId});}
  const second=await runner.run({...input,owner:'worker2'});assert.equal(second.waveNumber,2);assert.equal(second.offers,0);assert.equal(sent.length,2);report.capturedRepeatPolicyExcludesPriorRecipients=true;
  assert.equal((await a.rows('staging-LedgerEntries')).length,0);assert.deepEqual((await a.rows('staging-Wallets')).sort((a,b)=>a.walletId.localeCompare(b.walletId)),[...f.rows].filter(([k])=>k.startsWith('staging-Wallets|')).map(([,v])=>v).sort((a,b)=>a.walletId.localeCompare(b.walletId)));report.noFinancialJournalWrites=true;
 }finally{if(created){await low.send(new DeleteTableCommand({TableName:physical}));await waitUntilTableNotExists({client:low,maxWaitTime:60,minDelay:1,maxDelay:2},{TableName:physical});report.tableDeleted=true;}fs.writeFileSync('/private/tmp/dispatch36-creation-selection-result.json',JSON.stringify(report,null,2)+'\n');}
 console.log(JSON.stringify(report));
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
