'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {setup}=require('./helpers/driver-financial-fixture.cjs'),{policy}=require('./helpers/dispatch-cycle-fixture.cjs'),{route}=require('./helpers/driver-offer-fixture.cjs');
const {createStagingDispatchCycleStore}=require('../dist/dispatchCycleStore'),{createStagingDispatchCoordinator}=require('../dist/dispatchCoordinator'),{createStagingDispatchWaveExecutor}=require('../dist/dispatchWaveExecutor'),{createStagingDriverOfferContext}=require('../dist/driverOfferContext'),{createStagingDispatchReviewHost}=require('../dist/dispatchReviewHost'),{createStagingDispatchFinancialHost}=require('../dist/dispatchLegacyHost'),{exactCheck}=require('../dist/driverFinancialTransaction');
const {route:review,PATH,reviewAccess}=require('../../staff-service/dispatch-reviews'),{quoteCanonical}=require('../dist/deliveryQuoteRecord'),{parseIqd:m}=require('../dist/money');
async function fixture(subsidy=false,{priorRelease=false}={}){
 const funding=subsidy?{policyPin:{policyId:'delivery1',version:1,termsHash:'a'.repeat(64)},allocation:{schemaVersion:1,referenceFee:m('4000'),customerFee:m('3000'),subsidy:m('1000'),merchantShare:m('0'),platformShare:m('1000')}}:null;
 const f=setup('3000',()=>{},'order1',{enableFullCash:true,enableDeliveryFunding:true,deliveryFunding:funding});
 f.order=()=>f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'});f.order().financeRollout={schemaVersion:2,scopeId:'GENERAL_STAGING_FULL_CASH_V1',version:1,digest:'a'.repeat(64)};Object.assign(f.get('WhizzMerchants_Businesses',{businessId:'branch1'}),{regionId:'zone1',isActive:true});
 const oldJob=structuredClone(f.get('WizzDispatchJobs_staging',{orderId:'order1',SK:'METADATA'}));f.rows.delete('WizzDispatchJobs_staging|'+quoteCanonical({orderId:'order1',SK:'METADATA'}));f.put('staging-PlatformStaff',{pk:'OPERATIONAL_SETTINGS#DELIVERY_OPERATIONS',sk:'CURRENT',version:2,values:policy()});
 const send=f.db.send;f.db.send=async c=>{if(c.constructor.name==='QueryCommand'){const q=c.input;return {Items:[...f.rows.entries()].filter(([k,r])=>k.startsWith(q.TableName+'|')&&r.orderId===q.ExpressionAttributeValues[':id']&&(!q.ExpressionAttributeValues[':prefix']||r.SK?.startsWith(q.ExpressionAttributeValues[':prefix']))).map(([,r])=>structuredClone(r))};}if(c.constructor.name==='ScanCommand'){if(c.input.TableName==='staging-PlatformStaff')return {Items:f.decision&&['PENDING_EXECUTION','BLOCKED_DEPENDENCY'].includes(f.decision().status)?[{pk:f.decision().pk,sk:'DECISION'}]:[]};return {Items:[{orderId:'order1',SK:'METADATA'}]};}const sdk=require('@aws-sdk/lib-dynamodb');return send(new sdk[c.constructor.name](c.input));};
 await createStagingDispatchCycleStore({db:f.db,now:()=>f.time,enableDeliveryFunding:true,enableFullCash:true}).create({requestId:'general-creation',job:oldJob});f.job=()=>f.get('WizzDispatchJobs_staging',{orderId:'order1',SK:'METADATA'});
 const coordinator=createStagingDispatchCoordinator({db:f.db,now:()=>f.time,enableDeliveryFunding:true,enableFullCash:true});await coordinator.plan({orderId:'order1',assignmentId:'dispatch1',source:'START'});
 if(priorRelease){
  await createStagingDispatchWaveExecutor({db:f.db,now:()=>f.time,enableDeliveryFunding:true,enableFullCash:true,
   selectDrivers:async()=>['driver1'],context:p=>f.context,sendOffer:async(driverId,message)=>f.sent.push({driverId,message})})
   .run({orderId:'order1',assignmentId:'dispatch1',owner:'initial-worker',leaseSeconds:10});
  const {createStagingDriverOfferAcceptance}=require('../dist/driverOfferAcceptance');
  await createStagingDriverOfferAcceptance({
   db:f.db,context:f.context,now:()=>f.time,enableDeliveryFunding:true,enableFullCash:true,
   authenticateDriver:async()=>({driverId:'driver1',subjectId:'driver1'}),
  }).accept({orderId:'order1',waveNumber:1,offerId:f.sent.at(-1).message.offer.offerId});
  await require('../dist/codReassignment').createStagingCodReassignment({db:f.db,now:()=>f.time,
   enableDeliveryFunding:true,enableFullCash:true,reassignmentWindowSeconds:120,
   authenticate:async()=>({kind:'DRIVER',subjectId:'driver1'})}).unassign({
    orderId:'order1',offerId:f.order().financialAcceptance.offerId,attempt:1,cashCollected:false,reason:'Emergency',
   });
  for(const row of f.rows.values())if(['COD_ACCEPTANCE_OUTBOX','COD_UNASSIGN_OUTBOX'].includes(row.kind))row.status='INTEGRATED';
 }
 f.time+=61000;await coordinator.plan({orderId:'order1',assignmentId:'dispatch1',source:'TIMEOUT'});
 // Preparation retries now remain inside the original search budget.
 // Exercise recovery only after the real cycle deadline, not the first wave timeout.
 if(f.job().status!=='no_driver_available'){f.time=Date.parse(f.job().dispatchCycle.searchDeadline)+1;await coordinator.plan({orderId:'order1',assignmentId:'dispatch1',source:'TIMEOUT'});}
 assert.equal(f.job().status,'no_driver_available');
 const actor={pk:'EMPLOYEE#eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',sk:'PROFILE',employeeId:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',username:'staff',status:'ACTIVE',version:1,roles:['operations'],scope:{allRegions:false,regionIds:['zone1']}};f.put('staging-PlatformStaff',actor);
 f.cognito={send:async c=>({Enabled:true,Username:c.input.Username,UserStatus:'CONFIRMED',UserMFASettingList:['SOFTWARE_TOKEN_MFA'],UserAttributes:[{Name:'sub',Value:c.input.Username==='staff'?actor.employeeId:c.input.Username}]})};
 const ctx={...reviewAccess({db:f.db,rollout:{containsOrder:()=>false},env:{AWS_REGION:'us-east-1',STAGE:'staging',FINANCE_GENERAL_RELEASE_MODE:'REQUIRED',FINANCIAL_SETTLEMENT_MODEL:'FULL_CASH_AT_DELIVERY_V1'}}),table:'staging-PlatformStaff',mode:'REQUESTS_ONLY',employee:async()=>actor,guard:()=>exactCheck('staging-PlatformStaff',{pk:actor.pk,sk:actor.sk},actor),enrolled:true,recent:()=>{},claims:{},audit:(id,action,before,after,ref)=>({Put:{TableName:'staging-PlatformStaff',Item:{pk:'AUDIT',sk:ref,action},ConditionExpression:'attribute_not_exists(pk)'}})};
 const selector={orderId:'order1',source:'SEARCH'},{item}=await review({...ctx,query:selector},actor,'GET',PATH);await review(ctx,actor,'POST',PATH+'/decisions',{selector,action:'RETRY_SEARCH',baseDigest:item.baseDigest,requestId:'11111111-1111-4111-8111-111111111111',reason:'إعادة البحث العامة'});f.decision=()=>[...f.rows.values()].find(r=>r.kind==='DISPATCH_REVIEW_DECISION');f.decision().createdAt=new Date(f.time).toISOString();
 f.reviewHost=()=>createStagingDispatchReviewHost({db:f.db,cognito:f.cognito,now:()=>f.time,mode:'SAFE_FINANCIAL_INITIAL_RETRY',enableFullCash:true}).tick('review-worker');
 const executor=createStagingDispatchWaveExecutor({db:f.db,now:()=>f.time,enableDeliveryFunding:true,enableFullCash:true,selectDrivers:async()=>['driver1'],context:p=>createStagingDriverOfferContext({...p,cognito:f.cognito,router:{getRoute:async(a,b)=>{const r=route('route',a,b);r.route.measuredAt=new Date(f.time).toISOString();r.route.expiresAt=new Date(f.time+60000).toISOString();return r;}},now:()=>f.time}),sendOffer:async(id,msg)=>f.sent.push({id,msg})});
 f.start=()=>createStagingDispatchFinancialHost({db:f.db,now:()=>f.time,mode:'REQUIRED',enableDeliveryFunding:true,enableFullCash:true,start:async s=>{try{return await executor.run({orderId:s.orderId,assignmentId:s.assignmentId,owner:'restart-worker',leaseSeconds:10});}catch(e){f.startError=e;throw e;}}}).processOrder('order1');
 for(const id of ['driver1','driver2'])f.get('WizzDriverLiveState_staging',{driverId:id}).locationUpdatedAt=new Date(f.time).toISOString();return f;
}
const financial=f=>quoteCanonical([...f.rows].filter(([k])=>/^staging-(Wallets|Holds|LedgerEntries)\|/.test(k)));
test('scheduled review and financial host restart general full-cash orders with or without delivery subsidy, without money changes',async()=>{
 for(const subsidy of [false,true]){const f=await fixture(subsidy),before=financial(f),snapshot=structuredClone(f.order().financialSnapshot);assert.equal((await f.reviewHost()).failed,0);assert.equal(f.decision().resultCode,'SEARCH_RESTART_QUEUED');const started=await f.start();if(f.startError)throw f.startError;assert.equal(started.state,'STARTED');assert.equal(f.sent.length,1);assert.equal(financial(f),before);assert.deepEqual(f.order().financialSnapshot,snapshot);assert.equal((await f.start()).action,'WAIT');assert.equal(f.sent.length,1);}
});
test('revoked full-cash funding commitment blocks restart without sending or crediting drivers',async()=>{const f=await fixture();await f.reviewHost();f.get('staging-Holds',{orderId:'order1',sk:'FULL_CASH_FUNDING_COMMITMENT'}).status='REVOKED';const before=financial(f);await assert.rejects(f.start(),/FULL_CASH_BUDGET_COMMITMENT_REQUIRED/);assert.equal(f.sent.length,0);assert.equal(financial(f),before);});

async function productionFixture(t, options) {
 const f=await fixture(true,options);
 const staging=require('../dist/walletBindings').financialDispatchTables();
 const decision=f.decision();
 f.rows.delete(staging.staff+'|'+quoteCanonical({pk:decision.pk,sk:decision.sk}));
 const stack=require('../../../infrastructure/production/order-financial-runtime.template.json');
 const scalar=Object.fromEntries(Object.entries(stack.Resources.Function.Properties.Environment.Variables)
  .filter(([,value])=>typeof value==='string'));
 const {quoteHash}=require('../dist/deliveryQuoteRecord');
 const config={schemaVersion:1,accountId:'746727375268',region:'us-east-1',scopes:[]};
 const env={...scalar,STAGE:'production',AWS_REGION:'us-east-1',FINANCE_GENERAL_RELEASE_MODE:'REQUIRED',
  FINANCE_ROLLOUT_CONFIG:JSON.stringify(config),FINANCE_ROLLOUT_SHA256:quoteHash(config)};
 const previous=Object.fromEntries(Object.keys(env).map(key=>[key,process.env[key]]));
 Object.assign(process.env,env);
 t.after(()=>{
  for(const [key,value] of Object.entries(previous)){
   if(value===undefined)delete process.env[key];
   else process.env[key]=value;
  }
 });
 const tables=require('../dist/walletBindings').financialDispatchTables();
 const translation=new Map(Object.keys(tables).map(key=>[tables[key],staging[key]]));
 const commandLog=[];
 function operation(input) {
  assert.ok(translation.has(input.TableName),input.TableName);
  assert.match(input.TableName,/^wizz-production-/);
  return {...input,TableName:translation.get(input.TableName)};
 }
 const raw={send(command){
  commandLog.push(command);
  const input=command.input;
  const translated=input.TransactItems?{...input,TransactItems:input.TransactItems.map(row=>{
   const [kind,value]=Object.entries(row)[0];
   return {[kind]:operation(value)};
  })}:operation(input);
  if(translated.ProjectionExpression&&!translated.ExpressionAttributeNames){
   translated.ExpressionAttributeNames=Object.fromEntries(
    translated.ProjectionExpression.split(',').map(key=>[key.trim(),key.trim()]));
  }
  return f.db.send(new command.constructor(translated));
 }};
 const release='GENERAL_PRODUCTION_FULL_CASH_V1';
 Object.assign(f.order(),{userSub:'customer1',userId:'customer1',businessId:'branch1',paymentMethod:'COD',
  createdAt:new Date(f.time).toISOString(),financeRollout:{schemaVersion:2,scopeId:release,version:1,
   digest:quoteHash({release,version:1,orders:[{orderId:'order1',branchId:'branch1',customerSubjectId:'customer1'}]})}});
 const employee=[...f.rows.values()].find(row=>row.pk?.startsWith('EMPLOYEE#'));
 employee.scope={allRegions:true};
 const actor={kind:'STAFF',subjectId:employee.employeeId};
 const authority={
  authenticate:async()=>actor,
  read:async()=>({employee,guard:exactCheck(tables.staff,{pk:employee.pk,sk:'PROFILE'},employee)}),
  assign:async()=>{
   const {allowed}=require('../../staff-service/catalog');
   if(!allowed(employee,'orders.assign'))throw Error('PERMISSION_REQUIRED');
   return [(await authority.read()).guard];
  },
 };
 const {createFinanceRollout}=require('../dist/financeRollout');
 const {createProductionDispatchRestart}=require('../dist/productionDispatchRestart');
 const rollout=createFinanceRollout({db:raw,dispatch:true,now:()=>f.time});
 const api=createProductionDispatchRestart({db:rollout.db,authority,rollout,now:()=>f.time});
 const details=async()=> (await api({action:'READ',orderId:'order1'})).item;
 const request=async()=>{
  const item=await details();
  assert.equal(item.canRestart,true,item.blocker);
  return {action:'RETRY_SEARCH',orderId:'order1',caseId:item.caseId,baseDigest:item.baseDigest,
   reason:'إعادة البحث بعد استنفاد الموجات السابقة',requestId:'62345678-1111-4222-a123-123456789012'};
 };
 const driverPhone='+9647800000011';
 Object.assign(f.get(staging.driver,{driverId:'driver1'}),{isVerified:true,phoneNumber:driverPhone});
 const driverIdentity={send:async command=>{
  assert.equal(command.input.UserPoolId,env.DRIVER_USER_POOL_ID);
  assert.equal(command.input.Username,driverPhone);
  return {Enabled:true,Username:driverPhone,UserStatus:'CONFIRMED',UserAttributes:[
   {Name:'sub',Value:'driver1'},{Name:'phone_number',Value:driverPhone},{Name:'phone_number_verified',Value:'true'},
  ]};
 }};
 const executor=createStagingDispatchWaveExecutor({db:rollout.db,now:()=>f.time,enableDeliveryFunding:true,enableFullCash:true,
  selectDrivers:async()=>['driver1'],
  context:p=>createStagingDriverOfferContext({...p,cognito:driverIdentity,router:{getRoute:async(a,b)=>{
   const r=route('replacement-road',a,b);
   r.route.measuredAt=new Date(f.time).toISOString();
   r.route.expiresAt=new Date(f.time+60000).toISOString();
   return r;
  }},now:()=>f.time}),sendOffer:async(driverId,message)=>f.sent.push({driverId,message}),
 });
 const start=async()=>{
  let startFailure;
  const result=await createStagingDispatchFinancialHost({db:rollout.db,now:()=>f.time,mode:'REQUIRED',
   enableDeliveryFunding:true,enableFullCash:true,start:async({orderId,assignmentId})=>{
    try{return await executor.run({orderId,assignmentId,owner:'production-restart',leaseSeconds:10});}
    catch(error){startFailure=error;throw error;}
   },
  }).processOrder('order1');
  if(startFailure)throw startFailure;
  return result;
 };
 return {...f,api,request,details,start,employee,commandLog};
}

test('production staff queues one restart, preserves price and funding, and shows durable start evidence',async t=>{
 const f=await productionFixture(t);
 const before=financial(f), snapshot=structuredClone(f.order().financialSnapshot);
 const oldCycle=f.job().dispatchCycle.id;
 const request=await f.request();
 const [first,repeated]=await Promise.all([f.api(request),f.api(request)]);
 assert.equal(first.success,true);
 assert.equal(repeated.success,true);
 assert.equal([first,repeated].filter(result=>result.replayed).length,1);
 assert.notEqual(f.job().dispatchCycle.id,oldCycle);
 assert.equal(f.job().dispatchCycle.keyVersion,3);
 assert.equal(f.job().status,'searching');
 assert.equal(f.order().dispatchStatus,'searching');
 assert.equal(f.order().financialSearch,undefined);
 assert.equal((await f.details()).state,'QUEUED');
 assert.deepEqual(f.order().financialSnapshot,snapshot);
 assert.equal(financial(f),before);
 assert.equal([...f.rows.values()].filter(row=>row.kind==='DISPATCH_REVIEW_AUDIT').length,1);
 const commands=f.commandLog.filter(command=>command.input.TransactItems).flatMap(command=>command.input.TransactItems);
 assert.ok(commands.filter(command=>command.Put||command.Update).every(command=>
  ['wizz-production-Orders','wizz-production-DispatchJobs','wizz-production-PlatformStaff'].includes((command.Put??command.Update).TableName)));
 assert.equal((await f.start()).state,'STARTED');
 assert.equal((await f.details()).state,'STARTED');
 assert.equal(financial(f),before);
 assert.equal(f.sent.length,1);
});

test('production restart blocks a pending cash claim, a stale decision and an inactive branch',async t=>{
 const f=await productionFixture(t),request=await f.request();
 f.order().openPaymentClaimId='pending-claim';
 assert.equal((await f.details()).blocker,'ORDER_CASH_REVIEW_REQUIRED');
 await assert.rejects(f.api(request),/ORDER_CASH_REVIEW_REQUIRED/);
 delete f.order().openPaymentClaimId;
 await assert.rejects(f.api({...request,baseDigest:'0'.repeat(64)}),/RESTART_EVIDENCE_CHANGED/);
 const branch=f.get('WhizzMerchants_Businesses',{businessId:'branch1'});
 branch.isActive=false;
 assert.equal((await f.details()).blocker,'BRANCH_UNAVAILABLE_FOR_SEARCH');
 await assert.rejects(f.api(request),/BRANCH_UNAVAILABLE_FOR_SEARCH/);
 assert.equal(f.job().status,'no_driver_available');
});

test('production restart checks the release and integration of the previous assignment',async t=>{
 const f=await productionFixture(t,{priorRelease:true});
 const integration=[...f.rows.values()].find(row=>row.kind==='COD_UNASSIGN_OUTBOX');
 integration.status='PENDING_INTEGRATION';
 assert.equal((await f.details()).blocker,'PRIOR_FINANCIAL_INTEGRATION_PENDING');
 assert.equal(f.job().status,'no_driver_available');
 integration.status='INTEGRATED';
 const before=financial(f);
 assert.equal((await f.api(await f.request())).success,true);
 assert.equal(f.job().status,'searching');
 assert.equal(financial(f),before);
});
