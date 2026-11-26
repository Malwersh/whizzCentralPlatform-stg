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
const physical='staging-cod32-operations-'+crypto.randomBytes(8).toString('hex');
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


const service=require('../backend/staff-service/dispatch-settings'),{allowed:staffAllowed}=require('../backend/staff-service/catalog');
const {readDeliveryOperations}=require('../backend/wallet-service/dist/deliveryOperations');
const {createStagingDriverFinancialWave}=require('../backend/wallet-service/dist/driverFinancialWave');
(async()=>{assert.equal((await new STSClient({region:'us-east-1'}).send(new GetCallerIdentityCommand({}))).Account,'699561669180');let created=false;const report={scope:'REAL_DYNAMODB_ISOLATED_OPERATING_SETTINGS',applicationTablesAccessed:false,financialActivation:'OFF'};
try{
 await low.send(new CreateTableCommand({TableName:physical,BillingMode:'PAY_PER_REQUEST',AttributeDefinitions:[{AttributeName:'_testPk',AttributeType:'S'},{AttributeName:'_testSk',AttributeType:'S'}],KeySchema:[{AttributeName:'_testPk',KeyType:'HASH'},{AttributeName:'_testSk',KeyType:'RANGE'}]}));created=true;await waitUntilTableExists({client:low,maxWaitTime:60,minDelay:1,maxDelay:2},{TableName:physical});
 const a=adapter('settings'),values={quoteMaxPerCustomerPerMinute:5,driverOfferTtlSeconds:60,driverPositionMaxAgeSeconds:120,reassignmentWindowSeconds:300,maximumWaves:4};
 const editor={employeeId:'editor',roles:['settings_manager'],status:'ACTIVE',scope:{allRegions:true},version:1},approver={employeeId:'approver',roles:['settings_approver'],status:'ACTIVE',scope:{allRegions:true},version:1};
 const staffKey=id=>({pk:'EMPLOYEE#'+id,sk:'PROFILE'});for(const person of [editor,approver])await a.seed('staging-PlatformStaff',{...staffKey(person.employeeId),...person});await a.seed('staging-PlatformStaff',{pk:service.PK,sk:'CURRENT',version:1,values});
 const ctx={db:a.db,table:'staging-PlatformStaff',allowed:staffAllowed,enrolled:true,recent:()=>{},claims:{},employee:id=>a.get('staging-PlatformStaff',staffKey(id)),guard:person=>({ConditionCheck:{TableName:'staging-PlatformStaff',Key:staffKey(person.employeeId),ConditionExpression:'#v=:v AND #s=:s',ExpressionAttributeNames:{'#v':'version','#s':'status'},ExpressionAttributeValues:{':v':person.version,':s':'ACTIVE'}}}),audit:(actorId,action,before,after,id)=>({Put:{TableName:'staging-PlatformStaff',Item:{pk:'AUDIT',sk:action+'#'+id,actorId,action,before:before??null,after},ConditionExpression:'attribute_not_exists(sk)'}})};
 const requested=await service.route(ctx,editor,'POST',service.PATH+'/request',{baseVersion:1,values:{...values,quoteMaxPerCustomerPerMinute:6,maximumWaves:3},reason:'اختبار إعدادات تشغيل تركيبية'});assert.equal((await a.get('staging-PlatformStaff',{pk:service.PK,sk:'CURRENT'})).version,1);
 await service.route(ctx,approver,'POST',service.PATH+'/approve',{changeId:requested.changeId});const policy=await readDeliveryOperations(a.db,{DELIVERY_OPERATIONS_MODE:'CENTRAL'});assert.equal(policy.version,2);assert.equal(policy.values.maximumWaves,3);assert.equal(policy.values.quoteMaxPerCustomerPerMinute,6);report.independentApprovalAndRuntimeRead=true;
 const f=setup();for(const [k,row]of f.rows)await a.seed(k.split('|')[0],row);f.db.send=a.db.send;
 await createStagingDriverFinancialWave({db:a.db,context:f.context,sendOffer:async()=>{},now:()=>f.time,operating:policy}).run({orderId:'order1',branchId:'branch1',waveNumber:1,driverIds:[]});
 const key={orderId:'order1',SK:'FINANCIAL_WAVE#1'},saved=await a.get('WizzDispatchJobs_staging',key);assert.equal(saved.operatingLimits.version,2);assert.equal((await a.get('WizzDispatchJobs_staging',{orderId:'order1',SK:'METADATA'})).financialSearchMaxWave,3);
 const next={...await a.get('staging-PlatformStaff',{pk:service.PK,sk:'CURRENT'}),version:3,values:{...values,driverOfferTtlSeconds:30}};await a.db.send(new TransactWriteCommand({TransactItems:[{Put:{TableName:'staging-PlatformStaff',Item:next,ConditionExpression:'#v=:v',ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':v':2}}}]}));
 assert.deepEqual((await a.get('WizzDispatchJobs_staging',key)).operatingLimits,saved.operatingLimits);report.existingWaveSnapshotPreserved=true;
 await assert.rejects(service.route(ctx,editor,'POST',service.PATH+'/request',{baseVersion:1,values,reason:'محاولة إصدار قديم'}),/VERSION_OR_STATE_CONFLICT/);report.staleVersionRejected=true;assert.equal((await a.rows('staging-LedgerEntries')).length,0);report.noFinancialWrites=true;
}finally{if(created){await low.send(new DeleteTableCommand({TableName:physical}));await waitUntilTableNotExists({client:low,maxWaitTime:60,minDelay:1,maxDelay:2},{TableName:physical});report.tableDeleted=true;}fs.writeFileSync('/private/tmp/cod32-operations-result.json',JSON.stringify(report,null,2)+'\n');}console.log(JSON.stringify(report));
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
