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
const physical='staging-cod25-verification-'+crypto.randomBytes(8).toString('hex');
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
async function scenario(scope){
 const a=adapter(scope),f=setup('3000',s=>{s.order.allocation.platformGoodsDiscount=parseIqd('1000');s.order.allocation.merchantCommission=parseIqd('500');s.order.confirmedCustomerTotal=parseIqd('13500');});
 for(const [k,row]of f.rows)await a.seed(k.split('|')[0],row);
 f.db.send=a.db.send;await f.run();const accepted=await f.accept();assert.equal((await f.accept()).replayed,true);
 const acceptanceId=codAcceptanceOperation('order1',accepted.offerId,1)+':EVENT';
 assert.equal((await a.rows('staging-WalletLifecycle')).filter(x=>x.kind==='COD_ACCEPTANCE_OUTBOX').length,1);
 assert.equal((await pendingCod({db:a.db,driverIds:['driver1']})).length,1);
 const o=await a.get('WizzOrders',{PK:'ORDER#order1',SK:'META'});o.status='arrived_at_customer';o.commercialPricing={agreement:{id:'agreement1',version:1,termsHash:'a'.repeat(64)},funding:{amount:parseIqd('1000'),holdId:'PROMO#order1',state:'RESERVED_WITH_ORDER',policy:{id:'fund1',version:1}}};
 await a.db.send(new TransactWriteCommand({TransactItems:[{Put:{TableName:'WizzOrders',Item:o,ConditionExpression:'#s=:s',ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':s':'assigned'}}}]}));
 for(const row of [{walletId:'WALLET#MERCHANT#branch1',sk:'META',ownerType:'MERCHANT',ownerId:'branch1',status:'ACTIVE',currency:'IQD',availableBalance:100,lockedBalance:10,version:1},{walletId:'WALLET#PLATFORM',sk:'META',ownerType:'PLATFORM',ownerId:'PLATFORM',status:'ACTIVE',currency:'IQD',availableBalance:5000,lockedBalance:1000,version:1}])await a.seed('staging-Wallets',row);
 await a.seed('staging-Holds',{orderId:'order1',sk:'PROMOTION_FUNDING',holdId:'PROMO#order1',walletId:'WALLET#PLATFORM',amount:1000,status:'ACTIVE',purpose:'PLATFORM_GOODS_DISCOUNT',metadata:{agreementId:'agreement1',agreementVersion:1,fundingPolicy:{id:'fund1',version:1}}});
 const completion=createStagingCodCompletion({db:a.db,now:()=>f.time,authenticateDriver:async()=>({driverId:'driver1',subjectId:'driver1'})});
 const results=await Promise.allSettled([completion.complete({orderId:'order1',cashCollected:true}),completion.complete({orderId:'order1',cashCollected:true})]);
 const receipt=results.find(x=>x.status==='fulfilled')?.value;assert(receipt);assert.equal((await completion.complete({orderId:'order1',cashCollected:true})).replayed,true);
 const integration=createStagingCodIntegration({db:a.db,now:()=>f.time});
 assert.equal((await integration.processEvent(receipt.operationId+':EVENT')).status,'PENDING_INTEGRATION');
 await Promise.all([integration.processEvent(acceptanceId),integration.processEvent(acceptanceId)]);f.time+=31000;
 const processed=await Promise.all([integration.processEvent(receipt.operationId+':EVENT'),integration.processEvent(receipt.operationId+':EVENT')]);assert(processed.some(r=>r.status==='INTEGRATED'));
 const m=await a.get('WizzDriverPerformanceMetrics_staging',{PK:'DRIVER#driver1',SK:'METRICS'});assert.equal(m.totalAccepted,1);assert.equal(m.totalCompleted,1);assert.equal(m.completionRate,1);
 const notices=await a.rows('staging-WalletNotifications');assert.equal(notices.length,1);assert.equal(notices[0].deliveryStatus,'HELD');assert.equal(notices[0].amount,undefined);
 const dw=await a.get('staging-Wallets',{walletId:'WALLET#DRIVER#driver1',sk:'META'}),mw=await a.get('staging-Wallets',{walletId:'WALLET#MERCHANT#branch1',sk:'META'}),pw=await a.get('staging-Wallets',{walletId:'WALLET#PLATFORM',sk:'META'});
 assert.deepEqual([dw.availableBalance,dw.lockedBalance,mw.availableBalance,mw.lockedBalance,pw.availableBalance,pw.lockedBalance],[10500,0,100,9510,6000,0]);
 const requestId=crypto.randomUUID(),r={pk:'REQUEST#'+requestId,sk:'META',requestId,subjectId:'driver1',actorType:'DRIVER',status:'PROCESSING',leaseOwner:'synthetic',leaseUntil:Math.floor(f.time/1000)+600,version:1};
 const job={requestId,subjectId:'driver1',financialYears:7,policyVersion:'SYNTHETIC_POLICY_NO_LIVE_CHANGE'};await a.seed('staging-AccountDeletion',r);
 const retention=()=>codRetention({db:a.db,clock:()=>new Date(f.time).toISOString()})(r,job,{actorType:'DRIVER',ids:['driver1']});
 // Real lease loss must stop archive and source redaction atomically.
 await a.db.send(new TransactWriteCommand({TransactItems:[{Update:{TableName:'staging-AccountDeletion',Key:{pk:r.pk,sk:r.sk},UpdateExpression:'SET leaseOwner=:v',ExpressionAttributeValues:{':v':'replacement'}}}]}));
 await assert.rejects(retention(),e=>e.name==='TransactionCanceledException');assert.equal((await a.rows('staging-AccountDeletionFinancialArchive')).length,0);
 await a.db.send(new TransactWriteCommand({TransactItems:[{Update:{TableName:'staging-AccountDeletion',Key:{pk:r.pk,sk:r.sk},UpdateExpression:'SET leaseOwner=:v',ExpressionAttributeValues:{':v':r.leaseOwner}}}]}));
 // A late documented hold must prevent the entire financial archive before any redaction.
 const savedOffer=await a.get('WaveOffers_staging',{orderId:'order1',SK:'FINANCIAL#driver1#WAVE#1'});
 await a.db.send(new TransactWriteCommand({TransactItems:[{Update:{TableName:'WaveOffers_staging',Key:{orderId:'order1',SK:savedOffer.SK},UpdateExpression:'SET retentionHold=:yes',ExpressionAttributeValues:{':yes':true}}}]}));
 await assert.rejects(retention(),/DOCUMENTED_RETENTION_HOLD/);assert.equal((await a.rows('staging-AccountDeletionFinancialArchive')).length,0);
 await a.db.send(new TransactWriteCommand({TransactItems:[{Update:{TableName:'WaveOffers_staging',Key:{orderId:'order1',SK:savedOffer.SK},UpdateExpression:'REMOVE retentionHold'}}]}));
 await retention();await retention();const {driverCleanup}=require('../backend/account-deletion/driver-cleanup');Object.assign(job,{pool:'us-east-1_RGTqUXF5C',profileIds:['driver1'],walletIds:['WALLET#DRIVER#driver1'],wallets:[]});
 const cleanup=driverCleanup({db:a.db,clock:()=>new Date(f.time).toISOString()});await cleanup.execute('financialArchive',r,job);await cleanup.execute('financialArchive',r,job);
 const archived=await a.rows('staging-AccountDeletionFinancialArchive');assert(archived.length>=10);assert(!JSON.stringify(archived).includes('latitude'));assert(!JSON.stringify(archived).includes('customerPoint'));assert.equal((await a.get('WaveOffers_staging',{orderId:'order1',SK:savedOffer.SK})).financialOffer,undefined);
 const purge=await financialPurge({db:a.db,clock:()=>Math.floor(Date.parse('2035-01-01')/1000),dryRun:false})();assert.equal(purge.removed,0,'unpaid merchant payable must retain all related COD proof');assert.equal(purge.blocked,archived.length);
 // Simulated settlement status in the disposable fixture only; no payout or live ledger mutation.
 await a.db.send(new TransactWriteCommand({TransactItems:[{Update:{TableName:'staging-Holds',Key:{orderId:'order1',sk:'MERCHANT_PAYABLE'},UpdateExpression:'SET #s=:s',ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':s':'PAID'}}}]}));
 const expired=await financialPurge({db:a.db,clock:()=>Math.floor(Date.parse('2035-01-01')/1000),dryRun:false})();assert.equal(expired.removed,archived.length);assert.equal(expired.archivesRemoved,archived.length);
 return {leaseLossBlocksArchive:true,resolvedExpiryAtomic:true,acceptanceOnce:true,completionOnce:true,metrics:m.totalAccepted+'/'+m.totalCompleted,notice:'HELD',nonzeroDiscountIqd:1000,commissionIqd:500,driverTipIqd:1000,archiveCount:archived.length,unpaidLiabilityBlocksPurge:true};
}

async function terminalScenario(mode){
 const a=adapter(mode),f=setup();for(const [k,row]of f.rows)await a.seed(k.split('|')[0],row);f.db.send=a.db.send;await f.run();const accepted=await f.accept();
 const order=await a.get('WizzOrders',{PK:'ORDER#order1',SK:'META'});order.status=mode==='return'?'picked_up':'arrived_at_store';
 await a.db.send(new TransactWriteCommand({TransactItems:[{Put:{TableName:'WizzOrders',Item:order,ConditionExpression:'#s=:s',ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':s':'assigned'}}}]}));
 const selectors={orderId:'order1',offerId:accepted.offerId,attempt:1,cashCollected:false};let receipt;
 if(mode==='return'){
  const service=actor=>createStagingCodReturn({db:a.db,now:()=>f.time,authenticate:async()=>actor});
  const driver=service({kind:'DRIVER',subjectId:'driver1'}),r=await driver.requestReturn({...selectors,reason:'CUSTOMER_REFUSED'});
  await driver.arriveReturn({orderId:'order1',offerId:accepted.offerId,attempt:1,returnId:r.returnId});
  receipt=await service({kind:'MERCHANT_OWNER',subjectId:'owner1'}).confirmReceipt({...selectors,branchId:'branch1',returnId:r.returnId,expectedVersion:2,allItemsReceived:true,condition:'INTACT',driverResponsibility:'NONE'});
 }else{
  const service=createStagingCodReassignment({db:a.db,now:()=>f.time,reassignmentWindowSeconds:120,authenticate:async()=>({kind:mode==='cancel'?'MERCHANT_OWNER':'DRIVER',subjectId:mode==='cancel'?'owner1':'driver1'})});
  const body=mode==='cancel'?{...selectors,branchId:'branch1',goodsRetainedByBranch:true}:{...selectors,reason:'VehicleIssue'};
  receipt=await (mode==='cancel'?service.cancelBeforePickup(body):service.unassign(body));
  assert.equal((await (mode==='cancel'?service.cancelBeforePickup(body):service.unassign(body))).replayed,true);
 }
 const worker=createStagingCodIntegration({db:a.db,now:()=>f.time});await worker.processEvent(codAcceptanceOperation('order1',accepted.offerId,1)+':EVENT');
 assert.equal((await worker.processEvent(receipt.operationId+':EVENT')).status,'INTEGRATED');assert.equal((await worker.processEvent(receipt.operationId+':EVENT')).replayed,true);
 const metric=await a.get('WizzDriverPerformanceMetrics_staging',{PK:'DRIVER#driver1',SK:'METRICS'});assert.equal(metric.totalAccepted,1);assert.equal(metric.totalCompleted,0);assert.equal(metric.completionRate,0);
 const wallet=await a.get('staging-Wallets',{walletId:'WALLET#DRIVER#driver1',sk:'META'});assert.equal(wallet.availableBalance,20000);assert.equal(wallet.lockedBalance,0);
 const notes=await a.rows('staging-WalletNotifications');assert.equal(notes.length,1);assert.equal(notes[0].deliveryStatus,'HELD');assert.equal((await pendingCod({db:a.db,driverIds:['driver1']})).length,0);
 return {mode,acceptedCount:1,completedCount:0,releasedOnce:true,notice:'HELD',...(mode==='return'?{compensation:receipt.driverCompensationStatus}:{})};
}

(async()=>{
 const who=await new STSClient({region:'us-east-1'}).send(new GetCallerIdentityCommand({}));assert.equal(who.Account,'699561669180');let created=false,cleaned=false,result;
 try{
  await low.send(new CreateTableCommand({TableName:physical,BillingMode:'PAY_PER_REQUEST',AttributeDefinitions:[{AttributeName:'_testPk',AttributeType:'S'},{AttributeName:'_testSk',AttributeType:'S'}],KeySchema:[{AttributeName:'_testPk',KeyType:'HASH'},{AttributeName:'_testSk',KeyType:'RANGE'}],Tags:[{Key:'Purpose',Value:'isolated-cod25-verification'},{Key:'Owner',Value:'codex-synthetic-test'}]}));created=true;
  await waitUntilTableExists({client:low,maxWaitTime:45,minDelay:1,maxDelay:3},{TableName:physical});
  const meta=await low.send(new DescribeTableCommand({TableName:physical}));assert(!meta.Table.StreamSpecification?.StreamEnabled);result={completion:await scenario('complete'),terminal:[]};for(const mode of ['cancel','unassign','return'])result.terminal.push(await terminalScenario(mode));
 }finally{if(created){await low.send(new DeleteTableCommand({TableName:physical}));await waitUntilTableNotExists({client:low,maxWaitTime:45,minDelay:1,maxDelay:3},{TableName:physical});cleaned=true;}fs.writeFileSync('/private/tmp/cod25-staging-result.json',JSON.stringify({at:new Date().toISOString(),account:who.Account,region:'us-east-1',physicalTable:physical,tableDeleted:cleaned,result,scope:'REAL_DYNAMODB_TRANSACTIONS_ISOLATED_TABLE_LOGICAL_TABLE_ADAPTER',excludes:['Gateway','Deployed Lambda runtime','IAM of production roles','Cognito authentication','FCM delivery','ByDue index/scheduler'],humanDataAccess:false,liveFeatureChanges:false},null,2)+'\n');}
 console.log(JSON.stringify({result,tableDeleted:cleaned}));
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
