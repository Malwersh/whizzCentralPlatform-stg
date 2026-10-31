const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const ready=require('./helpers/full-cash-flow-fixture.cjs');
const {createCustomerCashCase}=require('../dist/customerCashCase');
const {createOrderExceptionPolicy}=require('../dist/orderExceptionPolicy');
const {CASE_POLICY_PK,CASE_POLICY_DEFAULTS}=require('../dist/exceptionCasePolicy');
const {exactCheck}=require('../dist/driverFinancialTransaction');
const {createFullCashCompletion}=require('../dist/fullCashCompletion');
const {seed}=require('./helpers/cashbox-accounting-251-seed.cjs');
const staffId='11111111-1111-4111-8111-111111111111';
async function fixture(){
 const f=await ready(),order=()=>f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'});
 Object.assign(order(),{userSub:'customer1',createdAt:'2026-10-21T08:00:00.000Z',paymentMethod:'cash',status:'picked_up',orderStatus:'picked_up'});
 order().exceptionPolicy=createOrderExceptionPolicy(order().createdAt);
 f.put('staging-PlatformStaff',{pk:CASE_POLICY_PK,sk:'CURRENT',version:1,policyVersion:'cases-1',values:CASE_POLICY_DEFAULTS});
 seed(f,'CASH-NJF-01',staffId,20000);
 const row=()=>f.get('staging-Holds',{orderId:'order1',sk:'CUSTOMER_CASH_REVIEW'});
 let current={kind:'CUSTOMER',subjectId:'customer1'},deny=false,lose=false;
 const db={send:async c=>{const result=await f.db.send(c);if(lose&&c.constructor.name==='TransactWriteCommand'){lose=false;throw Error('LOST_RESPONSE');}return result;}};
 const api=createCustomerCashCase({db,now:()=>f.time,authenticate:async()=>structuredClone(current),authorizeStaff:async(a,mode,n)=>{
  if(deny||a.kind!=='STAFF'||a.subjectId!==staffId||mode==='FINANCIAL'&&n>100000)throw Error('PERMISSION_REQUIRED');
  const key={pk:'EMPLOYEE#'+staffId,sk:'PROFILE'};return [exactCheck('staging-PlatformStaff',key,f.get('staging-PlatformStaff',key))];
 }});
 const as=kind=>{current={kind,subjectId:kind==='STAFF'?staffId:kind==='CUSTOMER'?'customer1':'driver1'};};
 const request=(action,extra={})=>({action,orderId:'order1',expectedVersion:row()?.version??0,idempotencyKey:randomUUID(),reason:'إجراء اختبار موثق لمراجعة النقد',...extra});
 const act=(kind,action,extra={})=>{as(kind);return api.execute(request(action,extra));};
 const report=(kind,n)=>act(kind,'REPORT_CASH_PAYMENT',{reportedPaidIqd:n,confirmActualPayment:true});
 const verify=async(n=10000)=>{await report('CUSTOMER',n);await report('DRIVER',n);const r=row().reports;return act('STAFF','VERIFY_CASH_COLLECTION',{customerReportId:r[0].reportId,driverReportId:r[1].reportId});};
 const complete=()=>createFullCashCompletion({db,enabled:true,authenticateDriver:async()=>({driverId:'driver1',subjectId:'driver1'}),now:()=>f.time}).complete({orderId:'order1',cashCollected:true});
 return {f,order,row,api,as,act,report,verify,request,complete,deny:()=>deny=true,lose:()=>lose=true};
}
test('two authenticated parties and staff review establish cash; a report alone does not post money',async()=>{
 const x=await fixture(),wallet=structuredClone(x.f.get('staging-Wallets',{walletId:'WALLET#DRIVER#driver1',sk:'META'}));
 await x.report('CUSTOMER',10000);assert.equal(x.row().collectionVerification,undefined);assert.equal(x.order().openPaymentClaimId,x.row().caseId);
 assert.equal(x.order().cashCollected,undefined);assert.deepEqual(x.f.get('staging-Wallets',{walletId:'WALLET#DRIVER#driver1',sk:'META'}),wallet);
 await assert.rejects(x.complete(),/FULL_CASH_COMPLETION_CONFLICT/);
 await x.report('DRIVER',9500);let r=x.row().reports;
 await assert.rejects(x.act('STAFF','VERIFY_CASH_COLLECTION',{customerReportId:r[0].reportId,driverReportId:r[1].reportId}),/MATCHING_REPORTS_REQUIRED/);
 await x.report('DRIVER',10000);r=x.row().reports;await x.act('STAFF','VERIFY_CASH_COLLECTION',{customerReportId:r[0].reportId,driverReportId:r[2].reportId});
 assert.equal(x.row().collectionVerification.collectedIqd,10000);
});
test('unsettled driver refund is once-only, acknowledged by original customer and matched to its custody journal',async()=>{
 const x=await fixture();await x.verify();const refundId=randomUUID();
 await x.act('STAFF','APPROVE_CUSTOMER_REFUND',{refundId,amountIqd:2000,sourceKind:'DRIVER_UNSETTLED',cashboxCode:null});
 x.as('DRIVER');const v=x.request('EXECUTE_CUSTOMER_REFUND',{refundId,confirmPhysicalExecution:true,reference:'تسليم مبلغ الرد للزبون'});x.lose();
 await assert.rejects(x.api.execute(v),/LOST_RESPONSE/);assert.equal((await x.api.execute(v)).replayed,true);
 assert.equal(x.row().refunds.refunds[0].status,'EXECUTED');
 await assert.rejects(x.act('STAFF','RECONCILE_CUSTOMER_REFUND',{refundId,reference:'محاولة مطابقة قبل الإقرار'}),/STATE_CONFLICT/);
 await x.act('CUSTOMER','ACKNOWLEDGE_CUSTOMER_REFUND',{refundId,confirmFullReceipt:true});
 await x.act('STAFF','RECONCILE_CUSTOMER_REFUND',{refundId,reference:'مطابقة إقرار الزبون والقيد'});
 assert.equal(x.row().refunds.refunds[0].status,'RECONCILED');
 assert.equal([...x.f.rows.values()].filter(r=>r.kind==='DRIVER_UNSETTLED_CASH_REFUND').length,1);
 assert.equal(x.order().financialOutcome,undefined);
});
test('posted delivery refund debits company cash once and retains the original delivered settlement',async()=>{
 const x=await fixture();await x.complete();const outcome=structuredClone(x.f.get('staging-Holds',{orderId:'order1',sk:'FINANCIAL_OUTCOME'}));
 await x.report('CUSTOMER',11950);const refundId=randomUUID();
 await assert.rejects(x.act('STAFF','APPROVE_CUSTOMER_REFUND',{refundId,amountIqd:2000,sourceKind:'DRIVER_UNSETTLED',cashboxCode:null}),/SOURCE_NOT_ELIGIBLE/);
 await x.act('STAFF','APPROVE_CUSTOMER_REFUND',{refundId,amountIqd:2000,sourceKind:'COMPANY_CASHBOX',cashboxCode:'CASH-NJF-01'});
 await x.act('STAFF','EXECUTE_CUSTOMER_REFUND',{refundId,confirmPhysicalExecution:true,reference:'تم تسليم الرد نقدًا من الصندوق'});
 const balance=x.f.get('staging-MerchantPlatform',{pk:'MERCHANT_CASHBOX#CASH-NJF-01',sk:'BALANCE'});assert.equal(balance.balanceIqd,18000);
 await x.act('CUSTOMER','ACKNOWLEDGE_CUSTOMER_REFUND',{refundId,confirmFullReceipt:true});
 await x.act('STAFF','RECONCILE_CUSTOMER_REFUND',{refundId,reference:'مطابقة سند الصرف وإقرار الزبون'});
 await x.act('STAFF','CLOSE_CUSTOMER_CASH_REVIEW',{confirmCompletedReview:true});assert.equal(x.row().state,'CLOSED');
 assert.deepEqual(x.f.get('staging-Holds',{orderId:'order1',sk:'FINANCIAL_OUTCOME'}),outcome);assert.equal(x.order().status,'delivered');
 const journal=[...x.f.rows.values()].find(r=>r.category==='CUSTOMER_REFUND');assert.equal(journal.lines.reduce((n,l)=>n+(l.side==='DEBIT'?l.amountIqd:-l.amountIqd),0),0);
 assert.equal(journal.lines.some(l=>l.account==='MERCHANT_DISBURSEMENT_CLEARING'),false);
});
test('case authorization, privacy and current employee revocation are enforced',async()=>{
 const x=await fixture();await x.verify();x.as('CUSTOMER');const read=await x.api.execute({action:'READ_CUSTOMER_CASH_CASE',orderId:'order1'});
 assert.equal(read.reports.length,1);assert.equal(read.shortfallDecision,null);
 await assert.rejects(x.act('CUSTOMER','APPROVE_CUSTOMER_REFUND',{refundId:randomUUID(),amountIqd:1,sourceKind:'DRIVER_UNSETTLED',cashboxCode:null}),/FORBIDDEN/);
 x.f.beforeCommit=()=>x.f.get('staging-PlatformStaff',{pk:'EMPLOYEE#'+staffId,sk:'PROFILE'}).version++;
 await assert.rejects(x.act('STAFF','APPROVE_CUSTOMER_REFUND',{refundId:randomUUID(),amountIqd:1,sourceKind:'DRIVER_UNSETTLED',cashboxCode:null}));
 assert.equal(x.row().refunds.refunds.length,0);x.f.beforeCommit=null;x.deny();await assert.rejects(x.act('STAFF','VERIFY_CASH_COLLECTION',{customerReportId:randomUUID(),driverReportId:randomUUID()}),/PERMISSION/);
});
test('concurrent refund approvals cannot oversubscribe the same order',async()=>{
 const x=await fixture();await x.verify();x.as('STAFF');const requests=[1,2].map(()=>x.request('APPROVE_CUSTOMER_REFUND',{refundId:randomUUID(),amountIqd:6000,sourceKind:'DRIVER_UNSETTLED',cashboxCode:null}));
 const results=await Promise.allSettled(requests.map(v=>x.api.execute(v)));assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(x.row().refunds.refunds.length,1);
});
test('same-millisecond newer reports cannot be hidden by selecting an older matching pair',async()=>{
 const x=await fixture();await x.verify();await x.report('CUSTOMER',9000);const r=x.row().reports;
 await assert.rejects(x.act('STAFF','VERIFY_CASH_COLLECTION',{customerReportId:r[0].reportId,driverReportId:r[1].reportId}),/MATCHING_REPORTS_REQUIRED/);
});
test('shortfall decision is a separate review, never a wallet charge or fictional collection',async()=>{
 const x=await fixture();await x.verify(8000);await x.act('STAFF','RECORD_CASH_SHORTFALL_DECISION',{outcome:'CUSTOMER_COLLECTION_REQUIRED',evidenceReferences:['مطابقة إفادتي الزبون والسائق']});
 assert.equal(x.row().shortfallDecision.shortfallIqd,3950);assert.equal(x.row().shortfallDecision.financialPosting,false);assert.equal(x.order().cashCollected,undefined);
});
test('verified recovery of the full amount unlocks ordinary settlement without changing the accepted price',async()=>{
 const x=await fixture();await x.verify(10000);await x.report('CUSTOMER',11950);await x.report('DRIVER',11950);
 const r=x.row().reports;await x.act('STAFF','VERIFY_CASH_COLLECTION',{customerReportId:r[2].reportId,driverReportId:r[3].reportId});
 await x.act('STAFF','RESOLVE_CASH_COLLECTION_REVIEW',{confirmNoFinancialAdjustment:true});
 assert.equal(x.order().openPaymentClaimId,null);assert.equal(x.row().state,'CLOSED');
 const {guardCashReviewReturnDb}=require('../dist/customerCashRuntime266'),{GetCommand}=require('@aws-sdk/lib-dynamodb');
 await assert.rejects(guardCashReviewReturnDb(x.f.db).send(new GetCommand({TableName:'WizzOrders',Key:{PK:'ORDER#order1',SK:'META'},ConsistentRead:true})),/COD_CASH_REVIEW_REQUIRED/);
 assert.equal(x.order().cashReviewVerifiedCollection.collectedIqd,11950);
 await x.complete();assert.equal(x.order().cashCollectedAmount,11950);assert.equal(x.order().status,'delivered');
});
test('unresolved shortfall or a refund cannot be disguised as a no-adjustment closure',async()=>{
 const x=await fixture();await x.verify(10000);
 await assert.rejects(x.act('STAFF','RESOLVE_CASH_COLLECTION_REVIEW',{confirmNoFinancialAdjustment:true}),/FINANCIAL_ADJUSTMENT_REQUIRED/);
 assert.ok(x.order().openPaymentClaimId);
});
test('a cash claim arriving after the completion read still blocks its entire financial transaction',async()=>{
 const x=await fixture();x.f.beforeCommit=()=>{x.order().openPaymentClaimId='OEX:concurrent-claim';};
 await assert.rejects(x.complete());assert.equal(x.f.get('staging-Holds',{orderId:'order1',sk:'FINANCIAL_OUTCOME'}),undefined);
 assert.equal(x.f.get('staging-MerchantPlatform',{pk:'FULL_CASH_JOURNAL#order1',sk:'META'}),undefined);
});
test('revoked approval cannot execute, but can be cancelled after a changed collection statement',async()=>{
 const x=await fixture();await x.verify();const refundId=randomUUID();
 await x.act('STAFF','APPROVE_CUSTOMER_REFUND',{refundId,amountIqd:2000,sourceKind:'DRIVER_UNSETTLED',cashboxCode:null});
 x.f.get('staging-PlatformStaff',{pk:'EMPLOYEE#'+staffId,sk:'PROFILE'}).version++;
 await assert.rejects(x.act('DRIVER','EXECUTE_CUSTOMER_REFUND',{refundId,confirmPhysicalExecution:true,reference:'يجب ألا يُسجل تسليم باعتماد ملغى'}));
 assert.equal(x.row().refunds.refunds[0].status,'APPROVED');
 await x.report('CUSTOMER',9000);
 await assert.rejects(x.act('DRIVER','EXECUTE_CUSTOMER_REFUND',{refundId,confirmPhysicalExecution:true,reference:'تغير إفادة التحصيل يستلزم مراجعة'}),/PROOF_REQUIRED/);
 await x.act('STAFF','CANCEL_CUSTOMER_REFUND',{refundId});assert.equal(x.row().refunds.refunds[0].status,'CANCELLED');
});
test('authenticated runtime uses one rollout transaction fence with the original customer, driver and MFA staff tokens',async()=>{
 const x=await fixture(),old={...process.env},runtime=require('../dist/customerCashRuntime266');
 try{
  Object.assign(process.env,require('./helpers/finance-rollout-fixture.cjs').scopeEnv({orders:[{orderId:'order1',branchId:'branch1',customerSubjectId:'customer1'}],drivers:[{driverId:'driver1',subjectId:'driver1'}]}));
  process.env.FINANCE_GENERAL_RELEASE_MODE='OFF';
  x.order().financeRollout=require('./helpers/finance-rollout-fixture.cjs').scopePin(process.env,'order1');
  const pools={CUSTOMER:'us-east-1_TpyyrVkEE',DRIVER:'us-east-1_RGTqUXF5C',STAFF:'us-east-1_wz7vwZZxz'};
  const call=async(kind,action,extra={})=>{const subjectId=kind==='STAFF'?staffId:kind==='DRIVER'?'driver1':'customer1',claims={iss:'https://cognito-idp.us-east-1.amazonaws.com/'+pools[kind],sub:subjectId,token_use:'access',auth_time:Math.floor(x.f.time/1000)},accessToken='x.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.x';
   const cognito={send:async c=>c.input.AccessToken?{Username:subjectId,UserAttributes:[{Name:'sub',Value:subjectId}]}:{Username:subjectId,Enabled:true,UserStatus:'CONFIRMED',UserAttributes:[{Name:'sub',Value:subjectId}],UserMFASettingList:['SOFTWARE_TOKEN_MFA']}};
   return runtime.createCustomerCashRuntime({db:x.f.db,cognito,accessToken,action:kind==='STAFF'?'staff_cash_case':kind==='DRIVER'?'driver_cash_case':'customer_cash_case',now:()=>x.f.time}).execute(x.request(action,extra));
  };
  await call('CUSTOMER','REPORT_CASH_PAYMENT',{reportedPaidIqd:10000,confirmActualPayment:true});
  await call('DRIVER','REPORT_CASH_PAYMENT',{reportedPaidIqd:10000,confirmActualPayment:true});const r=x.row().reports;
  await call('STAFF','VERIFY_CASH_COLLECTION',{customerReportId:r[0].reportId,driverReportId:r[1].reportId});
  const refundId=randomUUID();await call('STAFF','APPROVE_CUSTOMER_REFUND',{refundId,amountIqd:1000,sourceKind:'DRIVER_UNSETTLED',cashboxCode:null});
  await call('DRIVER','EXECUTE_CUSTOMER_REFUND',{refundId,confirmPhysicalExecution:true,reference:'سلمت المبلغ المعتمد فعليًا'});
  assert.equal(x.row().refunds.refunds[0].status,'EXECUTED');
 }finally{for(const key of Object.keys(process.env))if(!(key in old))delete process.env[key];Object.assign(process.env,old);}
});
