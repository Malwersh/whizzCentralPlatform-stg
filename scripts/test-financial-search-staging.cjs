#!/usr/bin/env node
'use strict';
// Real DynamoDB transactions in ONE disposable, stream-free table. Logical table/key adapter is test-only.
// No deployed functions, Cognito users, live wallets, OTP, routing provider, push or global policy mutations.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs');
const walletRequire=require('node:module').createRequire(require.resolve('../backend/wallet-service/dist/codIntegration'));
const {DynamoDBClient,CreateTableCommand,DeleteTableCommand,DescribeTableCommand,waitUntilTableExists,waitUntilTableNotExists}=walletRequire('@aws-sdk/client-dynamodb');
const {DynamoDBDocumentClient,GetCommand,PutCommand,ScanCommand,TransactWriteCommand}=walletRequire('@aws-sdk/lib-dynamodb');
const {STSClient,GetCallerIdentityCommand}=require('@aws-sdk/client-sts');
const {setup}=require('../backend/wallet-service/test/helpers/driver-financial-fixture.cjs');
const {createStagingCodCompletion}=require('../backend/wallet-service/dist/codCompletion');
const {createStagingCodIntegration}=require('../backend/wallet-service/dist/codIntegration');
const {createStagingCodReturn}=require('../backend/wallet-service/dist/codReturn');
const {createStagingCodReassignment}=require('../backend/wallet-service/dist/codReassignment');
const {codAcceptanceOperation}=require('../backend/wallet-service/dist/codIntegrationEvent');
const {parseIqd}=require('../backend/wallet-service/dist/money');
const {codRetention,pendingCod}=require('../backend/account-deletion/cod-retention');
const {financialPurge}=require('../backend/account-deletion/financial-purge');
const {quoteCanonical}=require('../backend/wallet-service/dist/deliveryQuoteRecord');
if(!process.argv.includes('--execute-synthetic')||process.env.AWS_PROFILE!=='Wizz_stg_UserApp'||process.env.AWS_REGION!=='us-east-1')throw Error('EXPLICIT_STAGING_PROFILE_REQUIRED');
const physical='staging-cod31-search-'+crypto.randomBytes(8).toString('hex');
const low=new DynamoDBClient({region:'us-east-1'}),real=DynamoDBDocumentClient.from(low,{marshallOptions:{removeUndefinedValues:true}});
const allowed=new Set(['WizzOrders','WizzDispatchJobs_staging','WaveOffers_staging','staging-Wallets','staging-LedgerEntries','staging-Holds','staging-WalletLifecycle','WhizzDrivers_staging','WhizzMerchants_Businesses','WizzDriverLiveState_staging','staging-PlatformStaff','staging-AccountDeletion','staging-AuditLog','staging-WalletNotifications','WizzDriverPerformanceMetrics_staging','staging-AccountDeletionFinancialArchive','staging-TopupRequests','staging-IdempotencyKeys','staging-SandboxPayments']);
function key(t,r){if(['WizzOrders','WizzDriverPerformanceMetrics_staging'].includes(t))return {PK:r.PK,SK:r.SK};if(['WizzDispatchJobs_staging','WaveOffers_staging'].includes(t))return {orderId:r.orderId,SK:r.SK};if(['staging-Wallets','staging-LedgerEntries'].includes(t))return {walletId:r.walletId,sk:r.sk};if(t==='staging-Holds')return {orderId:r.orderId,sk:r.sk};if(t==='staging-WalletLifecycle')return {operationId:r.operationId};if(['WhizzDrivers_staging','WizzDriverLiveState_staging'].includes(t))return {driverId:r.driverId};if(t==='WhizzMerchants_Businesses')return {businessId:r.businessId};if(t==='staging-WalletNotifications')return {eventId:r.eventId};if(t==='staging-AuditLog')return {datePartition:r.datePartition,sk:r.sk};return {pk:r.pk,sk:r.sk};}
function adapter(scope){
 function pkey(t,k){assert(allowed.has(t),'unreviewed logical table');assert(Object.values(k).every(v=>typeof v==='string'&&v));return {_testPk:scope+'|'+t+'|'+quoteCanonical(k),_testSk:'META'};}
 const strip=row=>row&&Object.fromEntries(Object.entries(row).filter(([k])=>!['_testPk','_testSk'].includes(k)));
 function translated(q,put=false){const t=q.TableName,result={...q,TableName:physical,...(put?{Item:{...q.Item,...pkey(t,key(t,q.Item))}}:{Key:pkey(t,q.Key)})};
  // DynamoDB creates the original key attributes on Update of a missing item.
  // The isolated-table adapter must reproduce that behavior for logical key columns too.
  if(q.UpdateExpression){const names={...q.ExpressionAttributeNames},values={...q.ExpressionAttributeValues};const sets=Object.entries(q.Key).map(([k,v],i)=>{names['#testKey'+i]=k;values[':testKey'+i]=v;return '#testKey'+i+'=:testKey'+i;});result.UpdateExpression=q.UpdateExpression.startsWith('SET ')?'SET '+sets.join(', ')+', '+q.UpdateExpression.slice(4):'SET '+sets.join(', ')+' '+q.UpdateExpression;result.ExpressionAttributeNames=names;result.ExpressionAttributeValues=values;}
  return result;}

 const db={async send(c){const name=c.constructor.name,q=c.input;
  if(name==='GetCommand'){const r=await real.send(new GetCommand(translated(q)));return {...r,Item:strip(r.Item)};}
  if(name==='ScanCommand'){
   assert(allowed.has(q.TableName),'unreviewed logical table '+q.TableName);const prefix=scope+'|'+q.TableName+'|';
   const r=await real.send(new ScanCommand({...q,TableName:physical,FilterExpression:'begins_with(#testPk,:testPrefix)'+(q.FilterExpression?' AND ('+q.FilterExpression+')':''),ExpressionAttributeNames:{...q.ExpressionAttributeNames,'#testPk':'_testPk'},ExpressionAttributeValues:{...q.ExpressionAttributeValues,':testPrefix':prefix}}));return {...r,Items:r.Items?.map(strip)};
  }
  assert.equal(name,'TransactWriteCommand','unexpected operation');
  const tx=q.TransactItems.map(op=>{const action=Object.keys(op)[0];assert(['Put','Update','Delete','ConditionCheck'].includes(action));return {[action]:translated(op[action],action==='Put')};});
  return real.send(new TransactWriteCommand({...q,TransactItems:tx,...(q.ClientRequestToken?{ClientRequestToken:crypto.createHash('sha256').update(physical+scope+q.ClientRequestToken).digest('hex').slice(0,36)}:{})})).catch(e=>{console.error('Synthetic transaction rejected:',e.name,e.message);throw e;});
 }};
 return {db,async seed(t,row){await real.send(new PutCommand({TableName:physical,Item:{...row,...pkey(t,key(t,row))},ConditionExpression:'attribute_not_exists(#testKey)',ExpressionAttributeNames:{'#testKey':'_testPk'}}));},get:async(t,k)=>(await db.send(new GetCommand({TableName:t,Key:k,ConsistentRead:true}))).Item,rows:async t=>{let all=[],cursor;do{const r=await db.send(new ScanCommand({TableName:t,ConsistentRead:true,ExclusiveStartKey:cursor}));all.push(...r.Items);cursor=r.LastEvaluatedKey;}while(cursor);return all;}};
}

const {createStagingFinancialSearch}=require('../backend/wallet-service/dist/financialSearch');
(async()=>{
 assert.equal((await new STSClient({region:'us-east-1'}).send(new GetCallerIdentityCommand({}))).Account,'699561669180');let created=false;const report={scope:'REAL_DYNAMODB_ISOLATED_SEARCH_EXHAUSTION',applicationTablesAccessed:false,financialActivation:'OFF'};
 try{
  await low.send(new CreateTableCommand({TableName:physical,BillingMode:'PAY_PER_REQUEST',AttributeDefinitions:[{AttributeName:'_testPk',AttributeType:'S'},{AttributeName:'_testSk',AttributeType:'S'}],KeySchema:[{AttributeName:'_testPk',KeyType:'HASH'},{AttributeName:'_testSk',KeyType:'RANGE'}]}));created=true;await waitUntilTableExists({client:low,maxWaitTime:60,minDelay:1,maxDelay:2},{TableName:physical});
  const a=adapter('expired'),f=setup();for(const [k,row]of f.rows)await a.seed(k.split('|')[0],row);f.db.send=a.db.send;await f.run();
  const orderKey={PK:'ORDER#order1',SK:'META'},jobKey={orderId:'order1',SK:'METADATA'},before=await a.get('WizzOrders',orderKey);
  await a.seed('staging-Holds',{orderId:'order1',sk:'PROMOTION_FUNDING',amount:500,status:'ACTIVE'});
  const wallets=await a.rows('staging-Wallets'),reservation=await a.get('staging-Holds',{orderId:'order1',sk:'PROMOTION_FUNDING'});
  f.time=Date.parse((await a.get('WizzDispatchJobs_staging',jobKey)).expiresAt);
  const svc=createStagingFinancialSearch({db:a.db,now:()=>f.time});await svc.exhaust('order1');assert.equal((await svc.exhaust('order1')).replayed,true);
  const after=await a.get('WizzOrders',orderKey);assert.equal(after.dispatchStatus,'no_driver_available');assert.equal(after.financialSearch.reviewStatus,'REQUIRED');assert.equal(after.status,before.status);assert.deepEqual(after.financialSnapshot,before.financialSnapshot);assert.equal(after.financialOutcome,undefined);
  assert.deepEqual(await a.rows('staging-Wallets'),wallets);assert.deepEqual(await a.get('staging-Holds',{orderId:'order1',sk:'PROMOTION_FUNDING'}),reservation);assert.equal((await a.rows('staging-LedgerEntries')).length,0);assert((await a.rows('WaveOffers_staging')).every(r=>r.responseStatus==='financial_expired'));
  report.reviewVisible=true;report.orderNotCancelled=true;report.fundsUnchanged=true;report.noLedgerWrites=true;report.replaySafe=true;
  const b=adapter('assignment-race'),g=setup();for(const [k,row]of g.rows)await b.seed(k.split('|')[0],row);g.db.send=b.db.send;await g.run();g.time=Date.parse((await b.get('WizzDispatchJobs_staging',jobKey)).expiresAt);
  let raced=false;const guarded={async send(c){if(c.constructor.name==='TransactWriteCommand'&&!raced){raced=true;await b.db.send(new TransactWriteCommand({TransactItems:[{Update:{TableName:'WizzDispatchJobs_staging',Key:jobKey,UpdateExpression:'SET #s=:s',ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':s':'assigned'}}}]}));}return b.db.send(c);}};
  await assert.rejects(createStagingFinancialSearch({db:guarded,now:()=>g.time}).exhaust('order1'),e=>e.name==='TransactionCanceledException');assert.equal((await b.get('WizzOrders',orderKey)).financialSearch,undefined);report.assignmentRaceProtected=true;
  const d=adapter('deletion'),h=setup();for(const [k,row]of h.rows)await d.seed(k.split('|')[0],row);h.db.send=d.db.send;await h.run();h.time=Date.parse((await d.get('WizzDispatchJobs_staging',jobKey)).expiresAt);await d.seed('staging-AccountDeletion',{pk:'BUSINESS_LIFECYCLE#MERCHANT#branch1',sk:'META'});await assert.rejects(createStagingFinancialSearch({db:d.db,now:()=>h.time}).exhaust('order1'),e=>e.name==='TransactionCanceledException');assert.equal((await d.get('WizzDispatchJobs_staging',jobKey)).status,'searching');assert.equal((await d.get('WizzOrders',orderKey)).financialSearch,undefined);report.deletionBarrierProtected=true;
 }finally{if(created){await low.send(new DeleteTableCommand({TableName:physical}));await waitUntilTableNotExists({client:low,maxWaitTime:60,minDelay:1,maxDelay:2},{TableName:physical});report.tableDeleted=true;}fs.writeFileSync('/private/tmp/cod31-search-result.json',JSON.stringify(report,null,2)+'\n');}
 console.log(JSON.stringify(report));
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
