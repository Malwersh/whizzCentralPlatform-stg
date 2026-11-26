const {test}=require('node:test'),assert=require('node:assert/strict');
const api=require('../dist/customerCashReview');
const at='2026-10-22T12:00:00.000Z',later='2026-10-22T12:01:00.000Z';
const id=n=>`${String(n).padStart(8,'0')}-1234-4123-8123-123456789abc`;
const staff={kind:'STAFF',subjectId:'staff1'},driver={kind:'DRIVER',subjectId:'driver1'},customer={kind:'CUSTOMER',subjectId:'customer1'};
const facts=(settledIqd=0)=>({orderId:'order1',customerId:'customer1',driverId:'driver1',expectedIqd:10000,collectedIqd:8000,settledIqd,collectionProofId:'proof1',collectionProofDigest:'a'.repeat(64),settlementProofDigest:'b'.repeat(64)});
const source={kind:'DRIVER_UNSETTLED',driverId:'driver1'},box={kind:'COMPANY_CASHBOX',code:'CASH-NJF-01',custodianId:'staff1'};
const request=(n=1,amountIqd=2000,s=source)=>({refundId:id(n),amountIqd,source:s,reason:'رد معتمد بموجب مراجعة الشكوى'});
const approve=(s=api.createCustomerCashReview('order1'),f=facts(),v=request())=>api.approveCustomerRefund(s,f,staff,v,at);
const execute=(s,f=facts(),a=driver)=>api.executeCustomerRefund(s,f,a,{refundId:id(1),confirmPhysicalExecution:true,sourceJournalId:'journal1',reference:'إثبات التسليم الفعلي للزبون'},later);
test('underpayment and excess remain unverified allegations and never become an automatic liability',()=>{
 const v=api.assessReportedCash(10000,8000);assert.equal(v.reportedShortfallIqd,2000);assert.equal(v.collectionVerified,false);assert.equal(v.financialPosting,false);assert.equal(v.liability,'NOT_ASSESSED');
 assert.equal(api.assessReportedCash(10000,11000).reportedExcessIqd,1000);assert.equal(api.assessReportedCash(10000,10000).status,'REVIEW_REQUIRED');
 for(const n of [-1,0.5,NaN,Infinity,Number.MAX_SAFE_INTEGER])assert.throws(()=>api.assessReportedCash(10000,n));
});
test('reserve approvals against all refunds for the order, including executed but unacknowledged cash',()=>{
 let s=approve(undefined,undefined,request(1,6000));assert.equal(api.cashRefundCapacity(s,facts()).remainingRefundableIqd,2000);
 assert.throws(()=>approve(s,facts(),request(2,2001)),/EXCEEDS_COLLECTED/);
 s=execute(s);assert.equal(api.cashRefundCapacity(s,facts()).remainingRefundableIqd,2000);
 assert.throws(()=>api.cancelCustomerRefund(s,staff,{refundId:id(1),reason:'الزبون لم يؤكد الاستلام بعد'},later),/STATE_CONFLICT/);
});
test('settled money cannot be refunded from driver custody even if banknotes are still with the driver',()=>{
 assert.throws(()=>approve(undefined,facts(8000)),/SOURCE_NOT_ELIGIBLE/);
 const s=approve(undefined,facts(8000),request(1,2000,box));assert.equal(s.refunds[0].source.kind,'COMPANY_CASHBOX');
 assert.throws(()=>execute(s,facts(8000),driver),/FORBIDDEN/);
 assert.equal(execute(s,facts(8000),staff).refunds[0].status,'EXECUTED');
});
test('partial settlement keeps company and driver source capacities separate',()=>{
 let s=approve(undefined,facts(5000),request(1,3000));s=approve(s,facts(5000),request(2,5000,box));
 assert.equal(api.cashRefundCapacity(s,facts(5000)).remainingRefundableIqd,0);
 assert.throws(()=>approve(undefined,facts(5000),request(1,3001)),/SOURCE_NOT_ELIGIBLE/);
 assert.throws(()=>approve(undefined,facts(5000),request(1,5001,box)),/SOURCE_NOT_ELIGIBLE/);
});
test('changed collection or settlement proof invalidates a pending execution',()=>{
 const s=approve();assert.throws(()=>execute(s,{...facts(),settledIqd:8000,settlementProofDigest:'c'.repeat(64)}),/SOURCE_PROOF_CHANGED/);
 assert.throws(()=>execute(s,{...facts(),collectionProofDigest:'d'.repeat(64)}),/SOURCE_PROOF_CHANGED/);
 assert.throws(()=>execute(s,{...facts(),collectedIqd:1000}),/COLLECTION_PROOF_CHANGED/);
});
test('customer acknowledgment is bound to the original customer and only follows execution',()=>{
 let s=approve();assert.throws(()=>api.acknowledgeCustomerRefund(s,facts(),customer,{refundId:id(1),confirmFullReceipt:true},later),/STATE_CONFLICT/);
 s=execute(s);const v={refundId:id(1),confirmFullReceipt:true};
 assert.throws(()=>api.acknowledgeCustomerRefund(s,facts(),{kind:'CUSTOMER',subjectId:'other'},v,later),/FORBIDDEN/);
 assert.throws(()=>api.acknowledgeCustomerRefund(s,facts(),staff,v,later),/FORBIDDEN/);
 assert.throws(()=>api.acknowledgeCustomerRefund(s,facts(),customer,{...v,confirmFullReceipt:false},later),/ACK_REQUIRED/);
 s=api.acknowledgeCustomerRefund(s,facts(),customer,v,later);assert.equal(s.refunds[0].status,'ACKNOWLEDGED');
 assert.throws(()=>api.reconcileCustomerRefund(s,staff,{refundId:id(1),verifiedSourceJournalId:'wrong',reference:'مطابقة قيد الصندوق'},later),/RECONCILIATION_REQUIRED/);
 s=api.reconcileCustomerRefund(s,staff,{refundId:id(1),verifiedSourceJournalId:'journal1',reference:'مطابقة قيد الصندوق'},later);
 assert.equal(s.refunds[0].status,'RECONCILED');assert.equal(api.cashRefundCapacity(s,facts()).executedRefundIqd,2000);
});
test('only designated custodian can execute and caller cannot inject role, amount or a voucher',()=>{
 const s=approve();assert.throws(()=>execute(s,facts(),{kind:'DRIVER',subjectId:'other'}),/CUSTODIAN_REQUIRED/);
 assert.throws(()=>approve(undefined,undefined,{...request(),actorId:'staff1'}),/INVALID/);
 assert.throws(()=>approve(undefined,undefined,{...request(),voucherNumber:'CUSTOM'}),/INVALID/);
 assert.throws(()=>api.executeCustomerRefund(s,facts(),driver,{refundId:id(1),confirmPhysicalExecution:true,sourceJournalId:'journal1',reference:'مرجع الاختبار',amountIqd:1},later),/PROOF_REQUIRED/);
});
test('server voucher is deterministic and different refunds get distinct references',()=>{
 const s=approve(),r=s.refunds[0];assert.match(r.voucherNumber,/^CRV-20261022-[A-F0-9]{20}$/);
 assert.equal(approve().refunds[0].voucherNumber,r.voucherNumber);
 assert.notEqual(approve(s,facts(),request(2)).refunds[1].voucherNumber,r.voucherNumber);
 assert.throws(()=>approve(s),/ALREADY_EXISTS/);
});
test('state tampering, wrong order proofs, fabricated sources and temporal reversals fail closed',()=>{
 const s=approve(),tampered=structuredClone(s);tampered.refunds[0].amountIqd=1;
 assert.throws(()=>execute(tampered),/CONFLICT/);
 assert.throws(()=>approve(undefined,{...facts(),orderId:'other'}),/CONFLICT/);
 assert.throws(()=>approve(undefined,undefined,request(1,2000,{kind:'PLATFORM_WALLET',code:'x'})),/SOURCE_INVALID/);
 assert.throws(()=>approve(undefined,undefined,request(1,2000,{...source,driverId:'other'})),/SOURCE_NOT_ELIGIBLE/);
 assert.throws(()=>api.executeCustomerRefund(s,facts(),driver,{refundId:id(1),confirmPhysicalExecution:true,sourceJournalId:'journal1',reference:'مرجع الاختبار'},'2026-10-21T12:00:00.000Z'),/CONFLICT/);
 assert.throws(()=>approve(undefined,{...facts(),settledIqd:9000}),/PROOF_REQUIRED/);
});
test('cancelling an unexecuted approval frees its reservation without erasing history',()=>{
 let s=approve(undefined,undefined,request(1,8000));s=api.cancelCustomerRefund(s,staff,{refundId:id(1),reason:'إلغاء قبل التنفيذ لتغيير المصدر'},later);
 assert.equal(s.refunds[0].status,'CANCELLED');assert.equal(api.cashRefundCapacity(s,facts()).remainingRefundableIqd,8000);
 assert.equal(approve(s,facts(),request(2,8000)).refunds.length,2);
});
