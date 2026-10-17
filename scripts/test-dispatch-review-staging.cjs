#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const wr=require('node:module').createRequire(require.resolve('../backend/wallet-service/package.json'));
const {CreateTableCommand,DeleteTableCommand,waitUntilTableExists,waitUntilTableNotExists}=wr('@aws-sdk/client-dynamodb');
const {TransactWriteCommand}=wr('@aws-sdk/lib-dynamodb');
const {STSClient,GetCallerIdentityCommand}=require('@aws-sdk/client-sts');
const {physical,low,adapter}=require('./test-dispatch-cycle-staging.cjs');
const {route,PATH}=require('../backend/staff-service/dispatch-reviews');
(async()=>{
 assert.equal((await new STSClient({region:'us-east-1'}).send(new GetCallerIdentityCommand({}))).Account,'699561669180');let created=false;
 const report={scope:'REAL_DYNAMODB_ISOLATED_REVIEW_REQUESTS_ONLY',applicationTablesAccessed:false,published:false,executedDecisions:0,humanFundsChanged:false};
 try{
  await low.send(new CreateTableCommand({TableName:physical,BillingMode:'PAY_PER_REQUEST',AttributeDefinitions:[{AttributeName:'_testPk',AttributeType:'S'},{AttributeName:'_testSk',AttributeType:'S'}],KeySchema:[{AttributeName:'_testPk',KeyType:'HASH'},{AttributeName:'_testSk',KeyType:'RANGE'}]}));created=true;await waitUntilTableExists({client:low,maxWaitTime:60,minDelay:1,maxDelay:2},{TableName:physical});
  async function scenario(scope){
   const a=adapter(scope),table='staging-PlatformStaff',actor={employeeId:'e',status:'ACTIVE',version:1,roles:['operations'],scope:{allRegions:false,regionIds:['r']}};
   const order={PK:'ORDER#o',SK:'META',orderId:'o',storeId:'b',status:'ready_for_pickup'},branch={businessId:'b',name:'تركيبي',regionId:'r',ownerId:'owner',cognitoUserId:'owner',status:'approved',isActive:true},job={orderId:'o',SK:'METADATA',restaurantId:'b',dispatchJobId:'job1',status:'no_driver_available',dispatchCycle:{id:'cycle1'},dispatchReview:{reviewStatus:'REQUIRED',reason:'SEARCH_WINDOW_EXPIRED'}};
   await a.seed('WizzOrders',order);await a.seed('WhizzMerchants_Businesses',branch);await a.seed('WizzDispatchJobs_staging',job);await a.seed(table,{pk:'EMPLOYEE#e',sk:'PROFILE',...actor});
   const ctx={db:a.db,table,mode:'REQUESTS_ONLY',enrolled:true,recent:()=>{},claims:{},employee:id=>a.get(table,{pk:'EMPLOYEE#'+id,sk:'PROFILE'}),guard:p=>({ConditionCheck:{TableName:table,Key:{pk:'EMPLOYEE#'+p.employeeId,sk:'PROFILE'},ConditionExpression:'#v=:v AND #s=:s',ExpressionAttributeNames:{'#v':'version','#s':'status'},ExpressionAttributeValues:{':v':p.version,':s':'ACTIVE'}}}),audit:(id,action,before,after,ref)=>({Put:{TableName:table,Item:{pk:'AUDIT',sk:ref,actorId:id,action,before,after},ConditionExpression:'attribute_not_exists(sk)'}})};
   const get=()=>route({...ctx,query:{orderId:'o',source:'SEARCH'}},actor,'GET',PATH),post=input=>route(ctx,actor,'POST',PATH+'/decisions',input);
   return {a,actor,ctx,order,get,post};
  }
  const x=await scenario('concurrent'),{item}=await x.get(),input={selector:{orderId:'o',source:'SEARCH'},baseDigest:item.baseDigest,requestId:'11111111-1111-4111-8111-111111111111',reason:'اختبار قرار تركيبي',action:'RETRY_SEARCH'};
  const results=await Promise.allSettled([x.post(input),x.post({...input,requestId:'22222222-2222-4222-8222-222222222222',action:'CANCEL_BEFORE_PICKUP'})]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);const rows=await x.a.rows('staging-PlatformStaff');assert.equal(rows.filter(x=>x.kind==='DISPATCH_REVIEW_DECISION').length,1);assert.equal(rows.filter(x=>x.pk==='AUDIT').length,1);assert.deepEqual(await x.a.get('WizzOrders',{PK:'ORDER#o',SK:'META'}),x.order);report.conflictingRequestsCommitOnceWithAuditAndNoOrderWrite=true;
  const saved=rows.find(x=>x.kind==='DISPATCH_REVIEW_DECISION'),replayInput={...input,action:saved.action,requestId:saved.requestId};assert.equal((await x.post(replayInput)).replayed,true);report.sameRequestReplays=true;
  const y=await scenario('race'),old=await y.get(),send=y.a.db.send;let changed=false;y.a.db.send=async c=>{if(!changed&&c.constructor.name==='TransactWriteCommand'){changed=true;await send(new TransactWriteCommand({TransactItems:[{Put:{TableName:'WizzOrders',Item:{...y.order,status:'assigned',driverId:'d'}}}]}));}return send(c);};await assert.rejects(y.post({...input,baseDigest:old.item.baseDigest}),/REVIEW_CHANGED/);assert.equal((await y.a.rows('staging-PlatformStaff')).filter(x=>x.kind==='DISPATCH_REVIEW_DECISION'||x.pk==='AUDIT').length,0);report.assignmentRaceRejectsBothIntentAndAudit=true;
  const z=await scenario('hold');await z.a.seed('staging-Holds',{orderId:'o',sk:'HOLD',status:'ACTIVE'});assert.equal((await z.get()).item.canRequestCancel,false);await assert.rejects(z.post({...input,baseDigest:(await z.get()).item.baseDigest,action:'CANCEL_BEFORE_PICKUP'}),/REVIEW_ACTION_NOT_ALLOWED/);report.activeHoldBlocksCancellationRequest=true;
 }finally{if(created){await low.send(new DeleteTableCommand({TableName:physical}));await waitUntilTableNotExists({client:low,maxWaitTime:60,minDelay:1,maxDelay:2},{TableName:physical});report.tableDeleted=true;}fs.writeFileSync('/private/tmp/dispatch43-review-result.json',JSON.stringify(report,null,2)+'\n');}
 console.log(JSON.stringify(report));
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
