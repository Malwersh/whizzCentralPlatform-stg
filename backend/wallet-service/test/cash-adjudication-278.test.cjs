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

const contacts=async x=>{for(const party of ['CUSTOMER','DRIVER'])await x.act('STAFF','RECORD_CASH_CONTACT',{party,channel:'PHONE',result:'NO_RESPONSE'});};
const approval=(outcome='COMPANY_COVERAGE',reviewBasis='MISSING_DECLARATION',collectedIqd=8250)=>({outcome,reviewBasis,collectedIqd,confirmDelivered:true,evidenceReferences:['DELIVERY-PROOF-278','CASH-EVIDENCE-278']});
for(const outcome of ['COMPANY_COVERAGE','CUSTOMER_RECEIVABLE','DRIVER_RESPONSIBILITY','MERCHANT_ADJUSTMENT'])test('missing customer declaration: '+outcome+' posts once without forging a report',async()=>{
 const x=await fixture();await x.report('DRIVER',8250);await contacts(x);
 const before=structuredClone(x.row().reports),wallet=structuredClone(x.f.get('staging-Wallets',{walletId:'WALLET#DRIVER#driver1',sk:'META'}));
 await x.act('STAFF','APPROVE_CASH_ADJUDICATION',approval(outcome));assert.deepEqual(x.row().reports,before);
 assert.deepEqual(x.f.get('staging-Wallets',{walletId:wallet.walletId,sk:'META'}),wallet);
 const id=x.row().adjudication.decisionId;const request=x.request('EXECUTE_CASH_ADJUDICATION',{decisionId:id,confirmExecution:true});
 x.as('STAFF');await x.api.execute(request);assert.equal((await x.api.execute(request)).replayed,true);
 assert.deepEqual(x.row().reports,before);assert.equal(x.order().status,'delivered');assert.equal(x.order().cashCollectedAmount,8250);assert.equal(x.order().cashCollected,false);assert.equal(x.order().openPaymentClaimId,null);
 assert.equal(x.row().state,outcome==='CUSTOMER_RECEIVABLE'?'AWAITING_CUSTOMER_PAYMENT':'CLOSED');
 const adjusted=x.row().adjudication.execution.adjustment;assert.equal(adjusted.additionalDriverDebitIqd,0);
 const actual=x.f.get('staging-Wallets',{walletId:wallet.walletId,sk:'META'});assert.equal(actual.availableBalance-wallet.availableBalance,outcome==='DRIVER_RESPONSIBILITY'?0:3700);
 const journal=x.f.get('staging-Holds',{orderId:'order1',sk:'CASH_ADJUDICATION_JOURNAL'});
 assert.equal(journal.lines.reduce((sum,l)=>sum+(l.side==='DEBIT'?1:-1)*l.amount.minorAmount,0),0);
 assert.equal(x.row().adjudication.execution.actorId,staffId);
});
test('missing both declarations: staff opens case and can establish full payment through independent finding',async()=>{
 const x=await fixture();await x.act('STAFF','OPEN_CASH_REVIEW');await contacts(x);
 await x.act('STAFF','APPROVE_CASH_ADJUDICATION',approval('NO_SHORTFALL','MISSING_DECLARATION',11950));
 await x.act('STAFF','EXECUTE_CASH_ADJUDICATION',{decisionId:x.row().adjudication.decisionId,confirmExecution:true});
 assert.equal(x.row().reports.length,0);assert.equal(x.order().cashCollectedAmount,11950);assert.equal(x.row().collectionVerification,undefined);assert.equal(x.row().state,'CLOSED');
});
test('disputed amount is adjudicated without editing either declaration',async()=>{
 const x=await fixture();await x.report('CUSTOMER',10000);await x.report('DRIVER',8250);await contacts(x);
 await assert.rejects(x.act('STAFF','APPROVE_CASH_ADJUDICATION',approval()),/BASIS_CHANGED/);
 await x.act('STAFF','APPROVE_CASH_ADJUDICATION',approval('COMPANY_COVERAGE','DISPUTED_AMOUNT'));
 await x.act('STAFF','EXECUTE_CASH_ADJUDICATION',{decisionId:x.row().adjudication.decisionId,confirmExecution:true});
 assert.deepEqual(x.row().reports.map(x=>x.reportedPaidIqd),[10000,8250]);
});
test('contact proof, delivery confirmation, evidence and approval required',async()=>{
 const x=await fixture();await x.report('DRIVER',8250);
 await assert.rejects(x.act('STAFF','APPROVE_CASH_ADJUDICATION',approval()),/CONTACT_REQUIRED/);await contacts(x);
 for(const patch of [{confirmDelivered:false},{evidenceReferences:[]},{collectedIqd:11951},{collectedIqd:-1},{collectedIqd:1.5},{outcome:'NO_SHORTFALL'}])await assert.rejects(x.act('STAFF','APPROVE_CASH_ADJUDICATION',{...approval(),...patch}));
 await assert.rejects(x.act('STAFF','EXECUTE_CASH_ADJUDICATION',{decisionId:randomUUID(),confirmExecution:true}));
 await assert.rejects(x.act('DRIVER','APPROVE_CASH_ADJUDICATION',approval()),/FORBIDDEN/);
});
test('new declaration or employee revocation invalidates approved execution',async()=>{
 for(const change of ['report','revoke']){
 const x=await fixture();await x.report('DRIVER',8250);await contacts(x);await x.act('STAFF','APPROVE_CASH_ADJUDICATION',approval());
 const id=x.row().adjudication.decisionId;
 if(change==='report')await x.report('CUSTOMER',9000);else x.deny();
 await assert.rejects(x.act('STAFF','EXECUTE_CASH_ADJUDICATION',{decisionId:id,confirmExecution:true}));assert.equal(x.order().financialOutcome,undefined);
 }
});
test('normal full-cash completion cannot bypass a disputed case or invoke administrative preparation',async()=>{
 const x=await fixture();await x.report('DRIVER',8250);await contacts(x);await x.act('STAFF','APPROVE_CASH_ADJUDICATION',approval());
 await assert.rejects(x.complete(),/FULL_CASH_COMPLETION_CONFLICT/);
 const noStaff=createFullCashCompletion({db:x.f.db,enabled:true,authenticateDriver:async()=>({driverId:'driver1',subjectId:'driver1'}),now:()=>x.f.time});
 await assert.rejects(noStaff.prepareAdministrative('order1',x.row().adjudication.decisionId),/UNAUTHORIZED/);
});
test('lost execution response can only replay the same receipt, never post the decision twice',async()=>{
 const x=await fixture();await x.report('DRIVER',8250);await contacts(x);await x.act('STAFF','APPROVE_CASH_ADJUDICATION',approval());
 x.as('STAFF');const r=x.request('EXECUTE_CASH_ADJUDICATION',{decisionId:x.row().adjudication.decisionId,confirmExecution:true});x.lose();await assert.rejects(x.api.execute(r),/LOST_RESPONSE/);assert.equal((await x.api.execute(r)).replayed,true);
 assert.equal([...x.f.rows.values()].filter(v=>v.kind==='CASH_ADJUDICATION_ACCOUNTING_JOURNAL').length,1);
});
test('report and accepted terms races abort the entire settlement including custody and wallets',async()=>{
 for(const change of ['report','terms']){const x=await fixture();await x.report('DRIVER',8250);await contacts(x);await x.act('STAFF','APPROVE_CASH_ADJUDICATION',approval());
 const original=structuredClone(x.f.get('staging-Wallets',{walletId:'WALLET#DRIVER#driver1',sk:'META'}));
 if(change==='terms')x.order().financialAcceptance.ruleHash='changed-after-approval';
 else x.f.beforeCommit=()=>{x.row().version++;};
 await assert.rejects(x.act('STAFF','EXECUTE_CASH_ADJUDICATION',{decisionId:x.row().adjudication.decisionId,confirmExecution:true}));
 assert.equal(x.order().financialOutcome,undefined);assert.deepEqual(x.f.get('staging-Wallets',{walletId:original.walletId,sk:'META'}),original);
 }
});
test('a cancelled decision cannot execute, and original full-collection path stays available',async()=>{
 const x=await fixture();await x.report('DRIVER',8250);await contacts(x);await x.act('STAFF','APPROVE_CASH_ADJUDICATION',approval());const id=x.row().adjudication.decisionId;
 await x.act('STAFF','CANCEL_CASH_ADJUDICATION',{decisionId:id});await assert.rejects(x.act('STAFF','EXECUTE_CASH_ADJUDICATION',{decisionId:id,confirmExecution:true}));
 await x.report('CUSTOMER',11950);await x.report('DRIVER',11950);const r=x.row().reports;
 await x.act('STAFF','VERIFY_CASH_COLLECTION',{customerReportId:r[1].reportId,driverReportId:r[2].reportId});await x.act('STAFF','RESOLVE_CASH_COLLECTION_REVIEW',{confirmNoFinancialAdjustment:true});await x.complete();assert.equal(x.order().cashCollectedAmount,11950);
});
test('administrative actions reject client actor/amount injection and cannot settle an existing financial outcome',async()=>{
 const x=await fixture();await x.report('DRIVER',8250);await contacts(x);
 for(const extra of [{actorId:'other-staff'},{driverId:'other-driver'},{walletAmount:1}])await assert.rejects(x.act('STAFF','APPROVE_CASH_ADJUDICATION',{...approval(),...extra}),/INVALID_CASH_REVIEW/);
 await x.act('STAFF','APPROVE_CASH_ADJUDICATION',approval());x.order().financialOutcome='already-settled';await assert.rejects(x.act('STAFF','EXECUTE_CASH_ADJUDICATION',{decisionId:x.row().adjudication.decisionId,confirmExecution:true}));
});
test('administration can settle a suspended driver liability without reactivating the account or offers',async()=>{
 const x=await fixture();await x.report('CUSTOMER',10000);await contacts(x);await x.act('STAFF','APPROVE_CASH_ADJUDICATION',approval('COMPANY_COVERAGE'));
 x.f.get('WhizzDrivers_staging',{driverId:'driver1'}).isSuspended=true;
 await x.act('STAFF','EXECUTE_CASH_ADJUDICATION',{decisionId:x.row().adjudication.decisionId,confirmExecution:true});
 assert.equal(x.f.get('WhizzDrivers_staging',{driverId:'driver1'}).isSuspended,true);
 const live=x.f.get('WizzDriverLiveState_staging',{driverId:'driver1'});assert.equal(live.status,'offline');assert.equal(live.currentOrderId,null);assert.equal(live.isActive,false);
});
test('a separately verified matching shortfall can be funded without pretending the customer paid the difference',async()=>{
 const x=await fixture();await x.verify(8250);await contacts(x);
 await x.act('STAFF','APPROVE_CASH_ADJUDICATION',approval('COMPANY_COVERAGE','MATCHED_SHORTFALL'));
 await x.act('STAFF','EXECUTE_CASH_ADJUDICATION',{decisionId:x.row().adjudication.decisionId,confirmExecution:true});
 assert.equal(x.order().cashCollectedAmount,8250);assert.equal(x.order().cashCollected,false);assert.equal(x.row().state,'CLOSED');assert.equal(x.row().collectionVerification.collectedIqd,8250);
});
for(const outcome of ['COMPANY_COVERAGE','CUSTOMER_RECEIVABLE','DRIVER_RESPONSIBILITY','MERCHANT_ADJUSTMENT'])test('merchant payable and statement remain provable after administrative '+outcome,async()=>{
 const x=await fixture();await x.report('DRIVER',8250);await contacts(x);await x.act('STAFF','APPROVE_CASH_ADJUDICATION',approval(outcome));await x.act('STAFF','EXECUTE_CASH_ADJUDICATION',{decisionId:x.row().adjudication.decisionId,confirmExecution:true});
 const {readMerchantAccrualEvidence}=require('../dist/merchantSettlementPreview'),{summarizeMerchantAccruals}=require('../dist/merchantSettlementAccrual');
 const proof=await readMerchantAccrualEvidence(x.f.db,'branch1','order1');assert.equal(proof.accrual.schemaVersion,6);assert.equal(proof.accrual.amounts.merchantNet.minorAmount,proof.payable.amount*1000);assert.equal(proof.accrual.amounts.customerCashCollected.minorAmount,8250000);assert.equal(summarizeMerchantAccruals('branch1',[proof.accrual]).accrualCount,1);
 const ledger=[...x.f.rows.values()].filter(r=>r.category==='CASH_ADJUDICATION_SETTLED');assert(ledger.length>0);for(const r of ledger)assert.equal(require('../dist/ledgerEffects').ledgerEffect(r).status,'CLASSIFIED');
 const journal=x.f.get('staging-Holds',{orderId:'order1',sk:'CASH_ADJUDICATION_JOURNAL'});journal.actualCollectedIqd=9000;await assert.rejects(readMerchantAccrualEvidence(x.f.db,'branch1','order1'));
});
for(const outcome of ['COMPANY_COVERAGE','MERCHANT_ADJUSTMENT'])test('merchant settlement batch freezes the adjusted proof and fences its journal: '+outcome,async()=>{
 const x=await fixture();await x.report('DRIVER',8250);await contacts(x);await x.act('STAFF','APPROVE_CASH_ADJUDICATION',approval(outcome));await x.act('STAFF','EXECUTE_CASH_ADJUDICATION',{decisionId:x.row().adjudication.decisionId,confirmExecution:true});
 const schedule={schemaVersion:1,version:1,frequency:'WEEKLY',anchorLocalDate:new Date(x.f.time+10800000).toISOString().slice(0,10),timezone:'Asia/Baghdad'};
 const staffKey={pk:'EMPLOYEE#'+staffId,sk:'PROFILE'},employee=x.f.get('staging-PlatformStaff',staffKey),settingsKey={pk:'BRANCH#branch1',sk:'SETTLEMENT_SCHEDULE#CURRENT'};x.f.put('staging-MerchantPlatform',{...settingsKey,enabled:true,version:1,schedule});const settings=x.f.get('staging-MerchantPlatform',settingsKey);
 const authorizeBranch=async branchId=>({branchId,actorId:staffId,guards:[exactCheck('staging-PlatformStaff',staffKey,employee)]}),readSchedule=async()=>({schedule,guard:exactCheck('staging-MerchantPlatform',settingsKey,settings)});
 const at=new Date(x.f.time+86400000).toISOString(),{createMerchantSettlementPreviewReader}=require('../dist/merchantSettlementPreview'),{createMerchantSettlementBatchService}=require('../dist/merchantSettlementBatch');
 const preview=await createMerchantSettlementPreviewReader({db:x.f.db,authorizeBranch:async()=>{},readSchedule:async()=>schedule}).preview({branchId:'branch1',orderIds:['order1'],at});
 const service=createMerchantSettlementBatchService({db:x.f.db,authorizeBranch,readSchedule,now:()=>x.f.time+8*86400000});
 const created=await service.create({branchId:'branch1',requestId:randomUUID(),orderIds:['order1'],at,previewId:preview.previewId});assert.equal(created.header.status,'FROZEN_PENDING_REVIEW');
 assert.equal(created.header.summary.amounts.merchantNet.minorAmount,x.f.get('staging-Holds',{orderId:'order1',sk:'MERCHANT_PAYABLE'}).amount*1000);
 assert(x.f.calls.at(-1).input.TransactItems.some(op=>op.ConditionCheck?.Key?.sk==='CASH_ADJUDICATION_JOURNAL'));
});
