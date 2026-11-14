'use strict';
// Explicit isolated DynamoDB test. All logical tables share one disposable, stream-free table.
const assert=require('node:assert/strict'),fs=require('node:fs');
const wr=require('node:module').createRequire(require.resolve('../backend/wallet-service/package.json'));
const {CreateTableCommand,DeleteTableCommand,waitUntilTableExists,waitUntilTableNotExists}=wr('@aws-sdk/client-dynamodb');
const {STSClient,GetCallerIdentityCommand}=require('@aws-sdk/client-sts');
const {physical,low,adapter}=require('./test-dispatch-cycle-staging.cjs');
const {fixture}=require('../backend/wallet-service/test/helpers/dispatch-review-executor-fixture.cjs');
const {createStagingDispatchReviewHost}=require('../backend/wallet-service/dist/dispatchReviewHost');
const {createStagingDispatchRestartStart}=require('../backend/wallet-service/dist/dispatchRestartStart');
const {exactCheck}=require('../backend/wallet-service/dist/driverFinancialTransaction');
const {route,PATH}=require('../backend/staff-service/dispatch-settings');
const {allowed}=require('../backend/staff-service/catalog');
const {codRetention}=require('../backend/account-deletion/cod-retention');
(async()=>{
 assert.equal((await new STSClient({region:'us-east-1'}).send(new GetCallerIdentityCommand({}))).Account,'699561669180');let created=false;
 const report={scope:'REAL_ISOLATED_DYNAMODB_POLICY_REVIEW_HOST_RETENTION',liveApplicationTablesAccessed:false,realCognitoCalls:0,realNotifications:0,humanMoneyChanged:false,published:false};
 try{
  await low.send(new CreateTableCommand({TableName:physical,BillingMode:'PAY_PER_REQUEST',AttributeDefinitions:[{AttributeName:'_testPk',AttributeType:'S'},{AttributeName:'_testSk',AttributeType:'S'}],KeySchema:[{AttributeName:'_testPk',KeyType:'HASH'},{AttributeName:'_testSk',KeyType:'RANGE'}]}));created=true;await waitUntilTableExists({client:low,maxWaitTime:60,minDelay:1,maxDelay:2},{TableName:physical});
  async function scenario(scope,action){const f=await fixture(action),a=adapter(scope);for(const [k,row]of f.rows)await a.seed(k.split('|')[0],row);return {f,a,host:createStagingDispatchReviewHost({db:a.db,cognito:f.cognito,now:()=>f.time,mode:'SAFE_LEGACY_RETRY'})};}
  const x=await scenario('cancel','CANCEL_BEFORE_PICKUP');for(let i=0;i<40&&(await x.a.get('staging-PlatformStaff',{pk:x.f.decision().pk,sk:'DECISION'})).status==='PENDING_EXECUTION';i++)await x.host.tick('cancel-'+i);
  assert.equal((await x.a.get('WizzOrders',{PK:'ORDER#order1',SK:'META'})).status,'cancelled');assert.equal((await x.a.rows('staging-PlatformStaff')).filter(r=>r.action==='DISPATCH_REVIEW_DECISION_EXECUTED').length,1);report.discoveryExecutesOneAuthorizedCancellation=true;
  const requestId='33333333-3333-4333-8333-333333333333',r={pk:'REQUEST#'+requestId,sk:'META',requestId,subjectId:'owner1',scope:{kind:'BUSINESS',id:'branch1'},status:'PROCESSING',version:1,leaseOwner:'deletion-worker',leaseUntil:Math.floor(x.f.time/1000)+60};await x.a.seed('staging-AccountDeletion',r);
  await codRetention({db:x.a.db,clock:()=>new Date(x.f.time+1000).toISOString()})(r,{requestId,subjectId:'owner1',financialYears:7,policyVersion:1},{actorType:'MERCHANT',ids:['branch1']});const kept=await x.a.get('staging-PlatformStaff',{pk:x.f.decision().pk,sk:'DECISION'});assert.equal(kept.actorId,undefined);assert.equal(kept.reason,undefined);assert.equal(kept.financialArchiveConfirmed,true);assert(kept.receipt.caseId);report.deletionRetainsReceiptAndRedactsDecisionIdentity=true;
  const y=await scenario('retry','RETRY_SEARCH'),current=await y.a.get('staging-PlatformStaff',{pk:'OPERATIONAL_SETTINGS#DELIVERY_OPERATIONS',sk:'CURRENT'}),values=structuredClone(current.values);values.dispatch.profiles.LEGACY.normalWaves[0].radiusMeters=5500;
  const maker={pk:'EMPLOYEE#maker',sk:'PROFILE',employeeId:'maker',roles:['settings_manager'],scope:{allRegions:true},status:'ACTIVE',version:1},checker={...maker,pk:'EMPLOYEE#checker',employeeId:'checker',roles:['settings_approver']};await y.a.seed('staging-PlatformStaff',maker);await y.a.seed('staging-PlatformStaff',checker);
  const ctx={db:y.a.db,table:'staging-PlatformStaff',allowed,enrolled:true,claims:{},recent:()=>{},employee:async id=>y.a.get('staging-PlatformStaff',{pk:'EMPLOYEE#'+id,sk:'PROFILE'}),guard:a=>exactCheck('staging-PlatformStaff',{pk:a.pk,sk:a.sk},a),audit:(id,action,before,after,ref)=>({Put:{TableName:'staging-PlatformStaff',Item:{pk:'AUDIT',sk:action+'#'+ref,actorId:id,action,before,after}}})};
  const proposed=await route(ctx,maker,'POST',PATH+'/request',{baseVersion:current.version,values,reason:'اختبار سياسة موجات متكاملة'});assert.equal((await y.a.get('staging-PlatformStaff',{pk:current.pk,sk:'CURRENT'})).version,current.version);
  await assert.rejects(route(ctx,maker,'POST',PATH+'/approve',{changeId:proposed.changeId}));const approved=await route(ctx,checker,'POST',PATH+'/approve',{changeId:proposed.changeId});assert.equal(approved.current.version,current.version+1);assert.equal((await y.a.get('WizzDispatchJobs_staging',{orderId:'order1',SK:'METADATA'})).dispatchCycle.policy.version,current.version);report.independentApprovalDoesNotChangeExistingCycle=true;
  for(let i=0;i<50&&(await y.a.get('staging-PlatformStaff',{pk:y.f.decision().pk,sk:'DECISION'})).status==='PENDING_EXECUTION';i++)await y.host.tick('retry-'+i);
  const job=await y.a.get('WizzDispatchJobs_staging',{orderId:'order1',SK:'METADATA'});assert.equal(job.dispatchCycle.policy.version,approved.current.version);assert.equal(job.dispatchCycle.policy.values.dispatch.profiles.LEGACY.normalWaves[0].radiusMeters,5500);assert(job.dispatchRestart.restartId);report.discoveredRestartPinsApprovedPolicyAndDurableStart=true;
  await y.a.seed('staging-AccountDeletion',{pk:'BUSINESS_LIFECYCLE#MERCHANT#branch1',sk:'META'});let sends=0;const starter=createStagingDispatchRestartStart({db:y.a.db,now:()=>y.f.time,mode:'REQUIRED',start:async()=>{sends++;}});assert.equal((await starter.process('order1',job.dispatchRestart.restartId,'start-host')).state,'SUPPRESSED_DELETION');assert.equal(sends,0);report.deletionBlocksQueuedRestartWithoutSending=true;
  for(const a of [x.a,y.a]){assert.equal((await a.rows('staging-LedgerEntries')).length,0);assert.equal((await a.rows('staging-Holds')).length,0);}report.noLedgerOrHoldWrites=true;
 }finally{if(created){await low.send(new DeleteTableCommand({TableName:physical}));await waitUntilTableNotExists({client:low,maxWaitTime:60,minDelay:1,maxDelay:2},{TableName:physical});report.tableDeleted=true;}fs.writeFileSync('/private/tmp/dispatch50-coordinated-result.json',JSON.stringify(report,null,2)+'\n');}
 console.log(JSON.stringify(report));
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
