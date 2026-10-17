#!/usr/bin/env node
'use strict';
// Synthetic initial-Legacy cancellation only. All logical tables live in one
// disposable stream-free table; Cognito is a fake, not a human-account operation.
const assert=require('node:assert/strict'),fs=require('node:fs');
const wr=require('node:module').createRequire(require.resolve('../backend/wallet-service/package.json'));
const {CreateTableCommand,DeleteTableCommand,waitUntilTableExists,waitUntilTableNotExists}=wr('@aws-sdk/client-dynamodb');
const {TransactWriteCommand}=wr('@aws-sdk/lib-dynamodb');
const {STSClient,GetCallerIdentityCommand}=require('@aws-sdk/client-sts');
const {physical,low,adapter}=require('./test-dispatch-cycle-staging.cjs');
const {fixture}=require('../backend/wallet-service/test/helpers/dispatch-review-executor-fixture.cjs');
const {createStagingDispatchReviewExecutor}=require('../backend/wallet-service/dist/dispatchReviewExecutor');
const {codRetention}=require('../backend/account-deletion/cod-retention');
(async()=>{
 assert.equal((await new STSClient({region:'us-east-1'}).send(new GetCallerIdentityCommand({}))).Account,'699561669180');let created=false;
 const report={scope:'REAL_DYNAMODB_ISOLATED_INITIAL_LEGACY_REVIEW_EXECUTOR',applicationTablesAccessed:false,published:false,realCognitoCalls:0,realNotifications:0,humanMoneyChanged:false};
 try{
  await low.send(new CreateTableCommand({TableName:physical,BillingMode:'PAY_PER_REQUEST',AttributeDefinitions:[{AttributeName:'_testPk',AttributeType:'S'},{AttributeName:'_testSk',AttributeType:'S'}],KeySchema:[{AttributeName:'_testPk',KeyType:'HASH'},{AttributeName:'_testSk',KeyType:'RANGE'}]}));created=true;await waitUntilTableExists({client:low,maxWaitTime:60,minDelay:1,maxDelay:2},{TableName:physical});
  async function scenario(scope,action){const f=await fixture(action),a=adapter(scope);for(const [key,row]of f.rows)await a.seed(key.split('|')[0],row);const worker=createStagingDispatchReviewExecutor({db:a.db,cognito:f.cognito,now:()=>f.time,mode:'SAFE_INITIAL_LEGACY'});return {f,a,run:()=>worker.process(f.decision().caseId)};}
  const x=await scenario('cancel'),wallets=await x.a.rows('staging-Wallets');const done=await Promise.all([x.run(),x.run()]);assert(done.every(r=>r.status==='EXECUTED'));assert.equal(done[0].executionId,done[1].executionId);assert.equal((await x.run()).replayed,true);assert.equal((await x.a.get('WizzOrders',{PK:'ORDER#order1',SK:'META'})).status,'cancelled');assert.equal((await x.a.rows('staging-PlatformStaff')).filter(r=>r.action==='DISPATCH_REVIEW_DECISION_EXECUTED').length,1);assert.deepEqual(await x.a.rows('staging-Wallets'),wallets);assert.equal((await x.a.rows('staging-LedgerEntries')).length,0);report.concurrentCancelOneReceiptAndAuditWithoutMoneyWrites=true;
  const requestId='33333333-3333-4333-8333-333333333333',r={pk:'REQUEST#'+requestId,sk:'META',requestId,subjectId:'owner1',scope:{kind:'BUSINESS',id:'branch1'},status:'PROCESSING',version:1,leaseOwner:'deletion-worker',leaseUntil:Math.floor(x.f.time/1000)+60};await x.a.seed('staging-AccountDeletion',r);
  await codRetention({db:x.a.db,clock:()=>new Date(x.f.time+1000).toISOString()})(r,{requestId,subjectId:'owner1',financialYears:7,policyVersion:1},{actorType:'MERCHANT',ids:['branch1']});
  const kept=await x.a.get('staging-PlatformStaff',{pk:x.f.decision().pk,sk:'DECISION'});assert.equal(kept.reason,undefined);assert.equal(kept.actorId,undefined);assert.equal(kept.receipt.caseId,x.f.decision().caseId);assert.equal(kept.financialArchiveConfirmed,true);const calls=x.f.providerCalls;assert.equal((await x.run()).replayed,true);assert.equal(x.f.providerCalls,calls);report.archivedOutcomeReplaysWithoutRestoringIdentityOrReason=true;
  const y=await scenario('race'),send=y.a.db.send;let changed=false;y.a.db.send=async c=>{if(!changed&&c instanceof TransactWriteCommand&&c.input.TransactItems.some(o=>o.Put?.Item.action==='DISPATCH_REVIEW_DECISION_EXECUTED')){changed=true;const order=await y.a.get('WizzOrders',{PK:'ORDER#order1',SK:'META'});await send(new TransactWriteCommand({TransactItems:[{Put:{TableName:'WizzOrders',Item:{...order,status:'assigned',driverId:'driver1'}}}]}));}return send(c);};await assert.rejects(y.run());assert.equal((await y.a.get('WizzDispatchJobs_staging',{orderId:'order1',SK:'METADATA'})).status,'no_driver_available');assert.equal((await y.a.get('staging-PlatformStaff',{pk:y.f.decision().pk,sk:'DECISION'})).status,'PENDING_EXECUTION');report.assignmentRaceRejectsCancellationAndDecisionCompletion=true;
  const z=await scenario('funding');await z.a.seed('staging-Holds',{orderId:'order1',sk:'PROMOTION_FUNDING',status:'ACTIVE'});assert.equal((await z.run()).status,'NEEDS_REVIEW');assert.equal((await z.a.get('WizzOrders',{PK:'ORDER#order1',SK:'META'})).status,'ready_for_pickup');report.fundingDoesNotFallBackToUnfundedCancel=true;
  const retry=await scenario('retry','RETRY_SEARCH'),before=await retry.a.get('WizzDispatchJobs_staging',{orderId:'order1',SK:'METADATA'});assert.equal((await retry.run()).resultCode,'RETRY_EXECUTION_DISABLED');assert.deepEqual(await retry.a.get('WizzDispatchJobs_staging',{orderId:'order1',SK:'METADATA'}),before);report.retryDoesNotOverwriteOldCycle=true;
 }finally{if(created){await low.send(new DeleteTableCommand({TableName:physical}));await waitUntilTableNotExists({client:low,maxWaitTime:60,minDelay:1,maxDelay:2},{TableName:physical});report.tableDeleted=true;}fs.writeFileSync('/private/tmp/dispatch44-executor-result.json',JSON.stringify(report,null,2)+'\n');}
 console.log(JSON.stringify(report));
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
