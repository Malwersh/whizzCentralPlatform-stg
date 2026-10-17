#!/usr/bin/env node
'use strict';
// Shares the reviewed logical-to-isolated-table adapter; never accesses application tables.
const assert=require('node:assert/strict'),fs=require('node:fs');
const wr=require('node:module').createRequire(require.resolve('../backend/wallet-service/package.json'));
const {CreateTableCommand,DeleteTableCommand,waitUntilTableExists,waitUntilTableNotExists}=wr('@aws-sdk/client-dynamodb');
const {TransactWriteCommand}=wr('@aws-sdk/lib-dynamodb');
const {STSClient,GetCallerIdentityCommand}=require('@aws-sdk/client-sts');
const {physical,low,adapter}=require('./test-dispatch-cycle-staging.cjs');
const {fixture}=require('../backend/wallet-service/test/helpers/dispatch-cycle-fixture.cjs');
const {createStagingDispatchCycleStore}=require('../backend/wallet-service/dist/dispatchCycleStore');
const {createStagingDispatchCoordinator}=require('../backend/wallet-service/dist/dispatchCoordinator');
(async()=>{
 assert.equal((await new STSClient({region:'us-east-1'}).send(new GetCallerIdentityCommand({}))).Account,'699561669180');
 let created=false;const report={scope:'REAL_DYNAMODB_ISOLATED_DISPATCH_TRANSITIONS',applicationTablesAccessed:false,published:false,offersSent:0};
 try{
  await low.send(new CreateTableCommand({TableName:physical,BillingMode:'PAY_PER_REQUEST',AttributeDefinitions:[{AttributeName:'_testPk',AttributeType:'S'},{AttributeName:'_testSk',AttributeType:'S'}],KeySchema:[{AttributeName:'_testPk',KeyType:'HASH'},{AttributeName:'_testSk',KeyType:'RANGE'}]}));created=true;
  await waitUntilTableExists({client:low,maxWaitTime:60,minDelay:1,maxDelay:2},{TableName:physical});
  async function setup(scope){const a=adapter(scope),f=fixture('LEGACY');for(const [k,row]of f.rows)await a.seed(k.split('|')[0],row);await createStagingDispatchCycleStore({db:a.db,now:()=>f.time}).create(f.input);
   const c=createStagingDispatchCoordinator({db:a.db,now:()=>f.time}),base={orderId:'order1',assignmentId:'dispatch1'};
   const job=()=>a.get('WizzDispatchJobs_staging',{orderId:'order1',SK:'METADATA'});
   return {a,f,c,base,job,plan:source=>c.plan({...base,source}),intent:async()=>a.get('WizzDispatchJobs_staging',{orderId:'order1',SK:'DISPATCH_TRANSITION#'+(await job()).dispatchTransition.id})};}
  const x=await setup('claims');const r=await Promise.all([x.plan('TIMEOUT'),x.plan('DECLINE')]);assert.equal(r.filter(v=>v.claimed).length,1);assert.equal(r[0].intentId,r[1].intentId);report.competingTriggersOneIntent=true;
  const id=r[0].intentId;const lease=(owner)=>x.c.acquire({...x.base,intentId:id,owner,leaseSeconds:10});
  const l=await Promise.all([lease('worker1'),lease('worker2')]);assert(l.filter(v=>v.acquired).length<=1);
  // DynamoDB can reject both contenders with TransactionConflict; the caller retries.
  if(!l.some(v=>v.acquired)){l[0]=await lease('worker1');assert.equal(l[0].acquired,true);report.leaseRetriedAfterTransactionConflict=true;}
  const owner=l[0].acquired?'worker1':'worker2',other=owner==='worker1'?'worker2':'worker1';
  assert.equal((await lease(owner)).replayed,true);x.f.time+=10000;assert.equal((await lease(other)).leaseVersion,2);
  await assert.rejects(x.c.executionFence({...x.base,intentId:id,owner,leaseVersion:1}));await x.c.executionFence({...x.base,intentId:id,owner:other,leaseVersion:2});report.leaseExcludesOldWorker=true;
  const beforeFunds=await x.a.rows('staging-Wallets'),beforeHolds=await x.a.rows('staging-Holds');x.f.time=Date.parse((await x.intent()).waveDeadline);const review=await x.plan('TIMEOUT');assert.equal(review.action,'REVIEW');assert.equal((await x.a.get('WizzDispatchJobs_staging',{orderId:'order1',SK:'DISPATCH_TRANSITION#'+id})).state,'CANCELLED');
  assert.equal((await x.a.get('WizzOrders',{PK:'ORDER#order1',SK:'META'})).status,'ready_for_pickup');assert.equal((await x.plan('TIMEOUT')).intentId,review.intentId);report.preparationDeadlineReviewOnly=true;
  assert.deepEqual(await x.a.rows('staging-Wallets'),beforeFunds);assert.deepEqual(await x.a.rows('staging-Holds'),beforeHolds);assert.equal((await x.a.rows('staging-LedgerEntries')).length,0);report.moneyUnchanged=true;
  const y=await setup('offers');await y.plan('START');const intent=await y.intent(),job=await y.job();
  // Seed a future executor's durable acknowledgement; this script does not implement or invoke it.
  await y.a.db.send(new TransactWriteCommand({TransactItems:[{Put:{TableName:'WizzDispatchJobs_staging',Item:{...intent,state:'APPLIED',appliedAt:new Date(y.f.time).toISOString()}}},{Put:{TableName:'WizzDispatchJobs_staging',Item:{...job,currentWaveNumber:1}}}]}));
  await y.a.seed('WizzDispatchJobs_staging',{orderId:'order1',SK:'LEGACY_WAVE#1',kind:'DISPATCH_WAVE',state:'READY',assignmentId:'dispatch1',branchId:'branch1',cycleDigest:job.dispatchCycle.digest,driverIds:['driver1','driver2']});
  for(const driverId of ['driver1','driver2'])await y.a.seed('WaveOffers_staging',{orderId:'order1',SK:driverId+'#WAVE#1',driverId,waveNumber:1,dispatchJobId:'dispatch1',dispatchCycleId:job.dispatchCycle.id,responseStatus:'pending',expiresAt:intent.waveDeadline});
  assert.equal((await y.plan('TIMEOUT')).action,'WAIT');y.f.time=Date.parse(intent.waveDeadline);assert.equal((await y.plan('TIMEOUT')).waveNumber,2);assert((await y.a.rows('WaveOffers_staging')).every(v=>v.responseStatus==='expired'));report.actualDeadlinesAndOfferExpirationAtomic=true;
  const z=await setup('assignment-race'),send=z.a.db.send;let changed=false;
  z.a.db.send=async cmd=>{if(cmd instanceof TransactWriteCommand&&!changed){changed=true;const order=await z.a.get('WizzOrders',{PK:'ORDER#order1',SK:'META'});await send(new TransactWriteCommand({TransactItems:[{Put:{TableName:'WizzOrders',Item:{...order,driverId:'driver1'}}}]}));}return send(cmd);};
  const raced=await Promise.allSettled([z.plan('START')]);assert(raced[0].status==='rejected'||raced[0].value.action==='STOP');assert.equal((await z.job()).dispatchTransition,undefined);report.assignmentRaceBlocksTransition=true;
 }finally{
  if(created){await low.send(new DeleteTableCommand({TableName:physical}));await waitUntilTableNotExists({client:low,maxWaitTime:60,minDelay:1,maxDelay:2},{TableName:physical});report.tableDeleted=true;}
  fs.writeFileSync('/private/tmp/dispatch34-coordinator-result.json',JSON.stringify(report,null,2)+'\n');
 }
 console.log(JSON.stringify(report));
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
