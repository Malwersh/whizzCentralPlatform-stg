const {test}=require('node:test'),assert=require('node:assert/strict');
const {GetCommand,QueryCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {ready}=require('./helpers/cod-fixture.cjs');
const {codAcceptanceOperation}=require('../dist/codIntegrationEvent');
const {createStagingCodIntegration}=require('../dist/codIntegration');
const {createStagingCodReassignment}=require('../dist/codReassignment');
const {createStagingCodReturn}=require('../dist/codReturn');
const metricsKey={PK:'DRIVER#driver1',SK:'METRICS'},orderKey={PK:'ORDER#order1',SK:'META'};
const worker=f=>createStagingCodIntegration({db:f.db,now:()=>f.time});
const event=(f,result)=>f.get('staging-WalletLifecycle',{operationId:result.operationId+':EVENT'});
const metrics=f=>f.get('WizzDriverPerformanceMetrics_staging',metricsKey);
const notifications=f=>[...f.rows.entries()].filter(([k])=>k.startsWith('staging-WalletNotifications|')).map(([,v])=>v);
const acceptance=f=>[...f.rows.values()].find(r=>r.kind==='COD_ACCEPTANCE_OUTBOX');
async function completed(){const f=await ready();const r=await f.complete();f.put('WizzDriverPerformanceMetrics_staging',{...metricsKey,driverId:'driver1',totalAccepted:5,totalTrips:2,totalCompleted:2,completionRate:0.4});await worker(f).processEvent(acceptance(f).operationId);return {f,r};}
test('completion integration atomically counts once and queues one driver financial notice without touching money',async()=>{
 const {f,r}=await completed(),before=[...f.rows.entries()].filter(([k])=>/^(staging-Wallets|staging-LedgerEntries)\|/.test(k));
 assert.equal(event(f,r).queuePartition,'COD_INTEGRATION');
 assert.equal((await worker(f).processEvent(r.operationId+':EVENT')).status,'INTEGRATED');
 assert.equal(metrics(f).totalCompleted,3);assert.equal(metrics(f).totalTrips,3);assert.equal(metrics(f).totalAccepted,6);assert.equal(metrics(f).completionRate,0.5);assert.equal(metrics(f).completionRateStatus,'AVAILABLE');
 assert.equal(notifications(f).length,1);assert.equal(notifications(f)[0].driverId,'driver1');assert.equal(notifications(f)[0].amount,undefined);assert.equal(notifications(f)[0].deliveryStatus,'HELD');
 assert.equal(event(f,r).queuePartition,undefined);assert.equal(event(f,r).metricsResult,'COMPLETION_COUNTED');
 assert.equal((await worker(f).processEvent(r.operationId+':EVENT')).replayed,true);assert.equal(metrics(f).totalCompleted,3);
 assert.deepEqual([...f.rows.entries()].filter(([k])=>/^(staging-Wallets|staging-LedgerEntries)\|/.test(k)),before);
});
test('concurrent workers and a lost commit acknowledgement cannot count or enqueue twice',async()=>{
 for(const lost of [false,true]){
  const {f,r}=await completed();
  if(lost){const send=f.db.send;let once=false;f.db.send=async c=>{const result=await send(c);if(!once&&c instanceof TransactWriteCommand&&c.input.TransactItems.some(x=>x.Put?.TableName==='staging-WalletNotifications')){once=true;throw Error('reply lost');}return result;};}
  const key=r.operationId+':EVENT';await Promise.all([worker(f).processEvent(key),worker(f).processEvent(key)]);
  assert.equal(metrics(f).totalCompleted,3);assert.equal(notifications(f).length,1);
 }
});
test('metric races retry the whole integration and retain current counters',async()=>{
 const {f,r}=await completed();f.beforeCommit=()=>{metrics(f).totalCompleted=3;metrics(f).totalTrips=3;};
 assert.equal((await worker(f).processEvent(r.operationId+':EVENT')).status,'PENDING_INTEGRATION');assert.equal(notifications(f).length,0);assert.equal(metrics(f).totalCompleted,3);
 f.time+=31000;await worker(f).processEvent(r.operationId+':EVENT');assert.equal(metrics(f).totalCompleted,4);assert.equal(notifications(f).length,1);
});
test('audit failure cannot publish a notice or change counters and backoff is respected',async()=>{
 const {f,r}=await completed();const send=f.db.send;let blocked=true;
 f.db.send=async c=>{if(blocked&&c instanceof TransactWriteCommand&&c.input.TransactItems.some(x=>x.Put?.Item.action==='COD_EVENT_INTEGRATED'))throw Error('audit unavailable');return send(c);};
 await worker(f).processEvent(r.operationId+':EVENT');assert.equal(metrics(f).totalCompleted,2);assert.equal(notifications(f).length,0);assert.equal(event(f,r).integrationAttempts,1);
 assert.equal((await worker(f).processEvent(r.operationId+':EVENT')).deferred,true);blocked=false;f.time+=31000;await worker(f).processEvent(r.operationId+':EVENT');assert.equal(metrics(f).totalCompleted,3);
});
test('missing or foreign proof and changed identity enter review without implying settlement failure',async()=>{
 for(const kind of ['offer','subject','order']){
  const {f,r}=await completed();if(kind==='offer')f.get('staging-Holds',{orderId:'order1',sk:'FINANCIAL_OUTCOME'}).offerId='other';
  if(kind==='subject')f.get('WhizzDrivers_staging',{driverId:'driver1'}).cognitoSub='other';
  if(kind==='order')f.get('WizzOrders',orderKey).financialOutcome='other';
  assert.equal((await worker(f).processEvent(r.operationId+':EVENT')).status,'INTEGRATION_REVIEW_REQUIRED');assert.equal(notifications(f).length,0);assert.equal(metrics(f).totalCompleted,2);assert.equal(f.get('WizzOrders',orderKey).status,'delivered');
 }
});
test('deletion before processing suppresses delivery; deletion racing commit prevents all side effects',async()=>{
 for(const race of [false,true]){
  const {f,r}=await completed(),marker={pk:'ACCOUNT_LIFECYCLE#DRIVER#driver1',sk:'META',status:'DELETING'};
  if(race)f.beforeCommit=()=>f.put('staging-AccountDeletion',marker);else f.put('staging-AccountDeletion',marker);
  const result=await worker(f).processEvent(r.operationId+':EVENT');assert.equal(result.status,race?'PENDING_INTEGRATION':'SUPPRESSED_DELETION');assert.equal(notifications(f).length,0);assert.equal(metrics(f).totalCompleted,2);
  if(race){f.time+=31000;assert.equal((await worker(f).processEvent(r.operationId+':EVENT')).status,'SUPPRESSED_DELETION');}
 }
});
test('completion waits for its acceptance event and acceptance replay has no notification',async()=>{
 const f=await ready(),r=await f.complete(),a=acceptance(f);
 assert.equal((await worker(f).processEvent(r.operationId+':EVENT')).status,'PENDING_INTEGRATION');assert.equal(metrics(f),undefined);
 await Promise.all([worker(f).processEvent(a.operationId),worker(f).processEvent(a.operationId)]);
 assert.equal(metrics(f).totalAccepted,1);assert.equal(metrics(f).financialAcceptedCount,1);assert.equal(metrics(f).totalCompleted,0);assert.equal(notifications(f).length,0);assert.equal(a.notificationEventId,undefined);
 f.time+=31000;await worker(f).processEvent(r.operationId+':EVENT');
 assert.equal(metrics(f).completionRate,1);assert.equal(metrics(f).financialCompletedCount,1);assert.equal(notifications(f).length,1);
});
test('incomplete legacy counters never become a guessed completion rate',async()=>{
 for(const old of [{totalTrips:2,totalCompleted:2},{totalTrips:2,totalCompleted:2,totalAccepted:1},{totalTrips:2,totalCompleted:2,totalAccepted:5,completionRateStatus:'ACCEPTANCE_INTEGRATION_PENDING'}]){
  const f=await ready(),r=await f.complete();f.put('WizzDriverPerformanceMetrics_staging',{...metricsKey,...old});
  await worker(f).processEvent(acceptance(f).operationId);await worker(f).processEvent(r.operationId+':EVENT');
  assert.equal(metrics(f).completionRate,undefined);assert.equal(metrics(f).completionRateStatus,'LEGACY_METRICS_INCOMPLETE');assert.equal(metrics(f).financialAcceptedCount,1);assert.equal(metrics(f).financialCompletedCount,1);
 }
});
test('invalid counters require review and cannot overwrite stored metrics',async()=>{
 const {f,r}=await completed();metrics(f).totalTrips='invalid';await worker(f).processEvent(r.operationId+':EVENT');assert.equal(event(f,r).status,'INTEGRATION_REVIEW_REQUIRED');assert.equal(metrics(f).totalTrips,'invalid');assert.equal(notifications(f).length,0);
});
test('cancellation and old unassignment notices never count completion or disturb replacement live state',async()=>{
 for(const cancel of [true,false]){
  const f=await ready();f.get('WizzOrders',orderKey).status='arrived_at_store';const o=f.get('WizzOrders',orderKey);
  const service=createStagingCodReassignment({db:f.db,now:()=>f.time,reassignmentWindowSeconds:120,authenticate:async()=>({kind:cancel?'MERCHANT_OWNER':'DRIVER',subjectId:cancel?'owner1':'driver1'})});
  const base={orderId:'order1',offerId:o.financialAcceptance.offerId,attempt:1,cashCollected:false};
  const r=await (cancel?service.cancelBeforePickup({...base,branchId:'branch1',goodsRetainedByBranch:true}):service.unassign({...base,reason:'VehicleIssue'}));
  if(!cancel){f.get('WizzOrders',orderKey).driverId='driver2';f.get('WizzOrders',orderKey).assignmentAttemptCounter=2;f.get('WizzOrders',orderKey).status='assigned';}
  const oldOrder=structuredClone(f.get('WizzOrders',orderKey));await worker(f).processEvent(r.operationId+':EVENT');assert.equal(event(f,r).status,'INTEGRATED');assert.equal(metrics(f),undefined);assert.equal(notifications(f).length,1);assert.deepEqual(f.get('WizzOrders',orderKey),oldOrder);
 }
});
test('clean return queues the financial notice while preserving pending compensation and unchanged counters',async()=>{
 const f=await ready(),o=f.get('WizzOrders',orderKey),base={orderId:'order1',offerId:o.financialAcceptance.offerId,attempt:1};
 const service=actor=>createStagingCodReturn({db:f.db,now:()=>f.time,authenticate:async()=>actor}),driver={kind:'DRIVER',subjectId:'driver1'};
 const v=await service(driver).requestReturn({...base,reason:'CUSTOMER_REFUSED',cashCollected:false});await service(driver).arriveReturn({...base,returnId:v.returnId});
 const r=await service({kind:'MERCHANT_OWNER',subjectId:'owner1'}).confirmReceipt({...base,branchId:'branch1',returnId:v.returnId,expectedVersion:2,allItemsReceived:true,condition:'INTACT',driverResponsibility:'NONE',cashCollected:false});
 await worker(f).processEvent(r.operationId+':EVENT');assert.equal(event(f,r).status,'INTEGRATED');assert.equal(metrics(f),undefined);assert.equal(r.driverCompensationStatus,'PENDING_POLICY_REVIEW');assert.equal(notifications(f).length,1);
});
test('scheduled reader uses only its due partition, paginates empty pages and reports malformed entries',async()=>{
 const seen=[];let page=0;const db={async send(c){seen.push(c);if(c instanceof QueryCommand)return ++page===1?{Items:[],LastEvaluatedKey:{operationId:'page2'}}:{Items:[{operationId:'bad'}]};throw Error('unexpected');}};
 const result=await createStagingCodIntegration({db,now:()=>1000}).run();assert.deepEqual(result,{processed:1,failed:1,review:0});assert.equal(seen.length,2);assert.equal(seen[0].input.IndexName,'ByDue');assert.equal(seen[0].input.ExpressionAttributeValues[':queue'],'COD_INTEGRATION');assert.deepEqual(seen[1].input.ExclusiveStartKey,{operationId:'page2'});
});
test('runtime defaults closed and rejects non-scheduled or foreign environment invocations before DB access',async()=>{
 const {handler}=require('../dist/codIntegrationRuntime'),old={...process.env};try{delete process.env.FINANCIAL_COD_INTEGRATION_MODE;assert.deepEqual(await handler({}),{disabled:true,processed:0});process.env.FINANCIAL_COD_INTEGRATION_MODE='REQUIRED';process.env.STAGE='production';await assert.rejects(handler({}),/NOT_CONFIGURED/);process.env.STAGE='staging';process.env.AWS_REGION='us-east-1';process.env.FINANCIAL_COD_ACCOUNT_ID='699561669180';await assert.rejects(handler({operationId:'client-chosen'}),/INVALID_COD_INTEGRATION_TRIGGER/);}finally{process.env=old;}
});
test('legacy lifecycle worker ignores integration events before acquiring a lease or reading a hold',async()=>{
 const {processLifecycle}=require('../dist/walletLifecycle'),{docClient}=require('../dist/db');const send=docClient.send;
 try{docClient.send=async()=>{throw Error('legacy worker touched integration event');};await processLifecycle({operationId:'event',integrationSchemaVersion:1});await processLifecycle({operationId:'old-event',kind:'COD_COMPLETION_OUTBOX'});}finally{docClient.send=send;}
});
test('integration role cannot write wallets, ledger, holds, orders or driver assignments and defaults OFF',()=>{
 const {readTemplate}=require('../../../scripts/prepare-delivery-quote-release.cjs');
 const template=readTemplate(require('node:path').join(__dirname,'../cod-lifecycle.staging.json'));const f=template.Resources.CodIntegrationWorker;
 assert.equal(f.Condition,'IsSandboxStaging');assert.equal(f.Properties.Environment.Variables.FINANCIAL_COD_INTEGRATION_MODE,'OFF');assert.equal(f.Properties.Events.RetryIntegration.Properties.Enabled,false);assert.equal(f.Properties.Environment.Variables.DISPATCH_RESPONSE_INTEGRATION_MODE,'OFF');assert.equal(f.Properties.Environment.Variables.DISPATCH_RESPONSE_NOTICE_DELIVERY,'HELD');
 const statements=f.Properties.Policies[0].Statement;
 for(const policy of statements){const resources=JSON.stringify(policy.Resource),actions=[policy.Action].flat();assert(!actions.includes('dynamodb:DeleteItem'));assert(!resources.includes('LedgerEntries'));assert(!resources.includes('staging-Wallets'));
  if(/staging-Holds|WizzOrders|WhizzDrivers|AccountDeletion/.test(resources))assert(actions.every(a=>['dynamodb:GetItem','dynamodb:ConditionCheckItem'].includes(a)));
 }
 const ack=statements.find(s=>s.Sid==='PinnedDispatchResponseAck');assert.equal(ack.Action,'dynamodb:UpdateItem');assert(!ack.Condition['ForAllValues:StringEquals']['dynamodb:Attributes'].includes('assignedDriverId'));assert(!ack.Condition['ForAllValues:StringEquals']['dynamodb:Attributes'].includes('status'));
 const query=statements.find(s=>s.Sid==='IntegrationQueueOnly');assert.deepEqual(query.Condition['ForAllValues:StringEquals']['dynamodb:LeadingKeys'],['COD_INTEGRATION','DISPATCH_RESPONSE_INTEGRATION']);
});
test('exhausted integration retries enter explicit review without financial rollback, duplicate notices or automatic compensation',async()=>{
 const {f,r}=await completed();event(f,r).integrationAttempts=19;const send=f.db.send;
 f.db.send=async c=>{if(c instanceof TransactWriteCommand&&c.input.TransactItems.some(x=>x.Put?.TableName==='staging-WalletNotifications'))throw Error('unavailable');return send(c);};
 const result=await worker(f).processEvent(r.operationId+':EVENT');assert.equal(result.status,'INTEGRATION_REVIEW_REQUIRED');assert.equal(event(f,r).integrationAttempts,20);assert.equal(event(f,r).queuePartition,undefined);assert.equal(event(f,r).integrationError,'COD_INTEGRATION_ATTEMPTS_EXHAUSTED');assert.equal(notifications(f).length,0);assert.equal(metrics(f).totalCompleted,2);assert.equal(f.get('WizzOrders',orderKey).status,'delivered');
});
