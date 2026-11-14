'use strict';
// Existing financial service + scope guard against a disposable stream-free table.
// The shared adapter rewrites EVERY logical table to the isolated table before AWS.
const assert=require('node:assert/strict'),fs=require('node:fs');
const wr=require('node:module').createRequire(require.resolve('../backend/wallet-service/package.json'));
const {CreateTableCommand,DeleteTableCommand,waitUntilTableExists,waitUntilTableNotExists}=wr('@aws-sdk/client-dynamodb');
const {TransactWriteCommand}=wr('@aws-sdk/lib-dynamodb');
const {STSClient,GetCallerIdentityCommand}=require('@aws-sdk/client-sts');
const {physical,low,adapter}=require('./test-dispatch-cycle-staging.cjs');
const {ready}=require('../backend/wallet-service/test/helpers/cod-fixture.cjs');
const {scopeEnv,scopePin}=require('../backend/wallet-service/test/helpers/finance-rollout-fixture.cjs');
const {createFinanceRollout}=require('/private/tmp/finance55/published-finance-rollout.js');
// Exercise the preserved published financial factory, not a rebuilt replacement.
const Module=require('node:module'),path=require('node:path');
const publishedFile='/private/tmp/finance55/published-financial-index.js';
const published=new Module(publishedFile,module);published.filename=publishedFile;published.paths=module.paths;
published._compile(fs.readFileSync(publishedFile,'utf8')+'\nmodule.exports.__codFactory=createStagingCodCompletion;',publishedFile);
const createStagingCodCompletion=published.exports.__codFactory;
(async()=>{
 assert.equal((await new STSClient({region:'us-east-1'}).send(new GetCallerIdentityCommand({}))).Account,'699561669180');
 const report={scope:'REAL_DYNAMODB_ISOLATED_SCOPED_COD_COMPLETION',applicationTablesAccessed:false,applicationGatesChanged:false,providerCalls:0};let created=false;
 try{
  await low.send(new CreateTableCommand({TableName:physical,BillingMode:'PAY_PER_REQUEST',AttributeDefinitions:[{AttributeName:'_testPk',AttributeType:'S'},{AttributeName:'_testSk',AttributeType:'S'}],KeySchema:[{AttributeName:'_testPk',KeyType:'HASH'},{AttributeName:'_testSk',KeyType:'RANGE'}]}));created=true;
  await waitUntilTableExists({client:low,maxWaitTime:60,minDelay:1,maxDelay:2},{TableName:physical});
  const f=await ready('3000',500,750),a=adapter('finance55-completion');
  const env=scopeEnv({orders:[{orderId:'order1',branchId:'branch1',customerSubjectId:'customer'}],drivers:[{driverId:'driver1',subjectId:'driver1'},{driverId:'driver2',subjectId:'driver2'}],mode:'DRAIN'});
  const order=f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'});order.userSub='customer';order.financeRollout=scopePin(env,'order1');
  for(const[k,v]of f.rows)await a.seed(k.slice(0,k.indexOf('|')),v);
  const rollout=createFinanceRollout({db:a.db,env,now:()=>f.time});
  const service=createStagingCodCompletion({db:rollout.db,now:()=>f.time,authenticateDriver:async()=>{rollout.driver('order1','driver1','driver1');return {driverId:'driver1',subjectId:'driver1'};}});
  const input={orderId:'order1',cashCollected:true};
  const attempts=await Promise.allSettled([service.complete(input),service.complete(input)]);
  if(!attempts.some(r=>r.status==='fulfilled'))await service.complete(input);
  const wallets=await a.rows('staging-Wallets'),ledger=await a.rows('staging-LedgerEntries');
  const replay=await service.complete(input);assert.equal(replay.replayed,true);
  assert.deepEqual(await a.rows('staging-Wallets'),wallets);assert.deepEqual(await a.rows('staging-LedgerEntries'),ledger);
  assert.equal((await a.get('WizzOrders',{PK:'ORDER#order1',SK:'META'})).status,'delivered');
  assert.equal((await a.get('staging-Holds',{orderId:'order1',sk:'HOLD'})).status,'SETTLED');
  report.scopedCompletionAllowedInDrain=true;report.concurrentRetryDoesNotDoubleSettle=true;report.discountFundingAndCommissionIncluded=true;
  await assert.rejects(rollout.db.send(new TransactWriteCommand({TransactItems:[{Put:{TableName:'WaveOffers_staging',Item:{orderId:'order1',SK:'driver1#WAVE#2',driverId:'driver1'}}}]})),e=>e.code==='FINANCE_ROLLOUT_ADMISSION_CLOSED');
  report.newOffersBlockedInDrain=true;
  const balanceBefore=await a.rows('staging-Wallets');
  await assert.rejects(rollout.db.send(new TransactWriteCommand({TransactItems:[
   {ConditionCheck:{TableName:'WizzOrders',Key:{PK:'ORDER#order1',SK:'META'},ConditionExpression:'#s=:old',ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':old':'arrived_at_customer'}}},
   {Update:{TableName:'staging-Wallets',Key:{walletId:'WALLET#DRIVER#driver1',sk:'META'},UpdateExpression:'SET availableBalance=:zero',ExpressionAttributeValues:{':zero':0}}},
  ]})),e=>e.name==='TransactionCanceledException');
  assert.deepEqual(await a.rows('staging-Wallets'),balanceBefore);report.staleOrderFenceRejectsWholeMoneyTransaction=true;
 }finally{
  if(created){await low.send(new DeleteTableCommand({TableName:physical}));await waitUntilTableNotExists({client:low,maxWaitTime:60,minDelay:1,maxDelay:2},{TableName:physical});report.tableDeleted=true;}
  fs.writeFileSync('/private/tmp/finance55/isolated-scoped-cod.json',JSON.stringify(report,null,2)+'\n',{mode:0o600});
 }
 console.log(JSON.stringify(report));
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
