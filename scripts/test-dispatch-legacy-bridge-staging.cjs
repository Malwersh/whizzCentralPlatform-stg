#!/usr/bin/env node
'use strict';
// Only a disposable isolated table; reserve is synthetic, never the live wallet API.
const assert=require('node:assert/strict'),fs=require('node:fs');
const wr=require('node:module').createRequire(require.resolve('../backend/wallet-service/package.json'));
const {CreateTableCommand,DeleteTableCommand,waitUntilTableExists,waitUntilTableNotExists}=wr('@aws-sdk/client-dynamodb');
const {TransactWriteCommand}=wr('@aws-sdk/lib-dynamodb');
const {STSClient,GetCallerIdentityCommand}=require('@aws-sdk/client-sts');
const {physical,low,adapter}=require('./test-dispatch-cycle-staging.cjs');
const {setup}=require('../backend/wallet-service/test/helpers/dispatch-legacy-fixture.cjs');
const {createStagingLegacyResponses}=require('../backend/wallet-service/dist/dispatchLegacy');
const {createStagingLegacyAcceptanceBridge}=require('../backend/wallet-service/dist/dispatchLegacyBridge');
(async()=>{
 assert.equal((await new STSClient({region:'us-east-1'}).send(new GetCallerIdentityCommand({}))).Account,'699561669180');let created=false;
 const report={scope:'REAL_DYNAMODB_ISOLATED_LEGACY_ACCEPTANCE_BRIDGE',applicationTablesAccessed:false,published:false,reservationService:'SYNTHETIC_ADAPTER_NOT_LIVE_WALLET_API',identity:'SYNTHETIC',humanFundsChanged:false};
 try{
 await low.send(new CreateTableCommand({TableName:physical,BillingMode:'PAY_PER_REQUEST',AttributeDefinitions:[{AttributeName:'_testPk',AttributeType:'S'},{AttributeName:'_testSk',AttributeType:'S'}],KeySchema:[{AttributeName:'_testPk',KeyType:'HASH'},{AttributeName:'_testSk',KeyType:'RANGE'}]}));created=true;await waitUntilTableExists({client:low,maxWaitTime:60,minDelay:1,maxDelay:2},{TableName:physical});
 async function scenario(scope){const f=await setup();await f.run();const a=adapter(scope);for(const[k,row]of f.rows)await a.seed(k.split('|')[0],row);let calls=0;const auth=async()=>({driverId:'driver1',subjectId:'driver1'}),input={orderId:'order1',offerId:f.offer('driver1').offerId,waveNumber:1};
 const reserve=async request=>{calls++;const existing=await a.get('staging-Holds',{orderId:'order1',sk:'HOLD'});if(existing)return;f.reserve();const hold=f.get('staging-Holds',{orderId:'order1',sk:'HOLD'});hold.metadata.pinnedDispatchAttemptId=request.attemptId;await a.db.send(new TransactWriteCommand({TransactItems:[{Put:{TableName:'staging-Holds',Item:hold,ConditionExpression:'attribute_not_exists(orderId)'}},{Put:{TableName:'staging-Wallets',Item:f.get('staging-Wallets',{walletId:'WALLET#DRIVER#driver1',sk:'META'})}}]}));};
 return {a,f,input,auth,reserve,calls:()=>calls,bridge:extra=>createStagingLegacyAcceptanceBridge({db:a.db,now:()=>f.time,authenticateDriver:auth,reserve,...extra}),marker:async()=> (await a.rows('WizzDispatchJobs_staging')).find(r=>r.kind==='LEGACY_ACCEPTANCE_ATTEMPT')};}
 const x=await scenario('reserve-ack');const won=await x.bridge({reserve:async r=>{await x.reserve(r);throw Error('lost reserve reply');}}).accept(x.input);assert.equal(won.success,true);assert.equal((await x.marker()).state,'ASSIGNED');assert.equal((await x.bridge().accept(x.input)).success,true);assert.equal(x.calls(),1);assert.equal((await x.a.rows('staging-LedgerEntries')).length,0);report.reservationLostReplyRecoveredWithoutSecondReservation=true;
 const y=await scenario('assignment-ack');const accepted=await y.bridge({assign:async(input,id)=>{await createStagingLegacyResponses({db:y.a.db,now:()=>y.f.time,authenticateDriver:y.auth,acceptanceAttemptId:id}).respond('ACCEPT',input);throw Error('lost assignment reply');}}).accept(y.input);assert.equal(accepted.success,true);assert.equal((await y.marker()).receipt.acceptanceAttemptId,accepted.acceptanceAttemptId);assert.equal((await y.a.get('WizzOrders',{PK:'ORDER#order1',SK:'META'})).driverId,'driver1');report.assignmentAndReceiptAtomicAfterLostReply=true;
 const z=await scenario('pending');const unknown=await z.bridge({reserve:async()=>{throw Error('no proof');}}).accept(z.input);assert.equal(unknown.pending,true);const next=await z.bridge().accept(z.input);assert.equal(next.success,true);assert.equal(next.acceptanceAttemptId,unknown.requestId);report.unknownReservationRetriesSameAttempt=true;
 const q=await scenario('review');const fake=await q.bridge({assign:async()=>({success:true})}).accept(q.input);assert.equal(fake.pending,true);q.f.time+=100000;const review=await q.bridge().accept(q.input);assert.equal(review.reviewRequired,true);assert.equal((await q.marker()).state,'REVIEW_REQUIRED');assert.equal((await q.a.get('staging-Holds',{orderId:'order1',sk:'HOLD'})).status,'ACTIVE');assert.equal((await q.a.get('WizzDispatchJobs_staging',{orderId:'order1',SK:'METADATA'})).status,'searching');report.falseEnvelopeRejectedAndExpiredReservationPreservedForReview=true;
 }finally{if(created){await low.send(new DeleteTableCommand({TableName:physical}));await waitUntilTableNotExists({client:low,maxWaitTime:60,minDelay:1,maxDelay:2},{TableName:physical});report.tableDeleted=true;}fs.writeFileSync('/private/tmp/dispatch38-bridge-result.json',JSON.stringify(report,null,2)+'\n');}
 console.log(JSON.stringify(report));
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
