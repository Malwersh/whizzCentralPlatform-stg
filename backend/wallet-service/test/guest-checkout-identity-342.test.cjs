'use strict';
const test=require('node:test'), assert=require('node:assert/strict'), path=require('node:path');
// An extracted, read-only published runtime can be verified with the same cases.
const runtime=process.env.GUEST_AUDIT_RUNTIME || path.resolve(__dirname,'../dist');
const {createFinanceRollout}=require(path.join(runtime,'financeRollout'));
const {createStagingQuoteOrder}=require(path.join(runtime,'deliveryQuoteOrder'));
const {scopeEnv}=require('./helpers/finance-rollout-fixture.cjs');
const env={...scopeEnv(),FINANCE_GENERAL_RELEASE_MODE:'REQUIRED',FINANCIAL_SETTLEMENT_MODEL:'FULL_CASH_AT_DELIVERY_V1'};
const db={send:async()=>assert.fail('unverified identity must not reach database')};
test('general admission still requires a customer subject before database access',()=>{
 const rollout=createFinanceRollout({db,env});
 for(const sub of [null,undefined,'',{},'*']) assert.throws(()=>rollout.customer('branch',sub),/OUT_OF_SCOPE/);
 assert.doesNotThrow(()=>rollout.customer('branch','verified-subject'));
});
const request={quoteId:'abcdefab-1234-4123-8123-123456789abc',requestId:'bbbbbbbb-1234-4123-8123-123456789abc',branchId:'branch',addressId:'address',requestContent:{}};
for(const [label,identity] of Object.entries({missing:null,guest:{userId:'guest',subjectId:'subject'},missingSubject:{userId:'registered'},noProfileProof:{userId:'registered',subjectId:'subject'},guestToken:{userId:'registered',guestToken:'opaque-value'}})){
 test('quoted order rejects '+label+' identity before reads or writes',async()=>{
  const service=createStagingQuoteOrder({db,authenticateCustomer:async()=>identity});
  await assert.rejects(service.prepare(request),e=>e.code==='CUSTOMER_UNAVAILABLE');
 });
}
