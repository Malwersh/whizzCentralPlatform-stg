const test=require('node:test'),assert=require('node:assert/strict');
const {reviewClosure}=require('../customer-funding-closure-review');
function fixture(rows=[],order={PK:'ORDER#o',SK:'META',orderId:'o',status:'delivered'}){const calls=[];return {calls,db:{send:async c=>{calls.push(c);if(c.constructor.name==='GetCommand')return {Item:order};assert.equal(c.constructor.name,'QueryCommand');return {Items:[{orderId:'o',sk:'FINANCIAL_OUTCOME',status:'COMPLETED'},...rows]};}},orderId:'o'};}
test('closed observations never grant deletion or financial mutation authority',async()=>{const f=fixture(),r=await reviewClosure(f);assert.equal(r.closureVerified,false);assert.equal(r.deleteEligible,false);assert.equal(r.complete,true);assert.ok(r.blockers.includes('CASE_INVENTORY_FENCE_REQUIRED'));assert.ok(r.blockers.includes('SETTLEMENT_JOURNAL_VERIFICATION_REQUIRED'));assert.ok(f.calls.every(c=>['GetCommand','QueryCommand'].includes(c.constructor.name)&&c.input.ConsistentRead===true));assert.ok(r.conditions.every(c=>c.ConditionCheck));});
for(const [name,row,reason] of [
 ['unpaid merchant',{sk:'MERCHANT_PAYABLE',amount:6000,status:'LOCKED_PENDING_SETTLEMENT'},'MERCHANT_PAYOUT_PENDING'],
 ['paid label requires journal',{sk:'MERCHANT_PAYABLE',amount:6000,status:'PAID',paidPayoutId:'p',paidAt:'2026-11-12'},'PAYOUT_JOURNAL_VERIFICATION_REQUIRED'],
 ['unsafe amount',{sk:'MERCHANT_PAYABLE',amount:NaN},'PAYABLE_AMOUNT_INVALID'],
 ['active guarantee',{sk:'HOLD',status:'ACTIVE'},'ACTIVE_FINANCIAL_HOLD'],
 ['pending compensation',{sk:'OTHER',receipt:{driverCompensationStatus:'PENDING_POLICY_REVIEW'}},'COMPENSATION_REVIEW_PENDING'],
 ['open cancellation',{sk:'CUSTOMER_CANCELLATION',kind:'CUSTOMER_CANCELLATION',state:'CANCELLED',settlementStatus:'REVIEW'},'CASE_NOT_CLOSED'],
 ['unknown case state',{sk:'RETURN#1',kind:'COD_RETURN_CASE'},'CASE_NOT_CLOSED'],
 ['case correction',{sk:'RETURN#1',kind:'COD_RETURN_CASE',exceptionResolution:{status:'RESOLVED'},correctionReview:{status:'PENDING'}},'CASE_NOT_CLOSED'],
 ['documented hold',{sk:'X',legalHold:true},'DOCUMENTED_HOLD']
])test('blocks '+name,async()=>{const r=await reviewClosure(fixture([{orderId:'o',...row}]));assert.ok(r.blockers.includes(reason));});
test('missing order blocks closure',async()=>assert.ok((await reviewClosure(fixture([],null))).blockers.includes('ORDER_EVIDENCE_MISSING')));
test('active order blocks closure',async()=>assert.ok((await reviewClosure(fixture([],{PK:'ORDER#o',SK:'META',orderId:'o',status:'preparing'}))).blockers.includes('ORDER_NOT_TERMINAL')));
test('incomplete pages fail closed',async()=>{const f=fixture();f.db.send=async c=>c.constructor.name==='GetCommand'?{Item:null}:{Items:[],LastEvaluatedKey:{orderId:'o',sk:'x'}};const r=await reviewClosure({...f,maxPages:1});assert.equal(r.complete,false);assert.ok(r.blockers.includes('CASE_INVENTORY_INCOMPLETE'));assert.ok(r.blockers.includes('FINANCIAL_OUTCOME_MISSING'));});
test('foreign partition row rejected',async()=>assert.rejects(reviewClosure(fixture([{orderId:'other',sk:'HOLD'}])),/SCOPE_INVALID/));
test('duplicate keys rejected',async()=>assert.rejects(reviewClosure(fixture([{orderId:'o',sk:'FINANCIAL_OUTCOME'}])),/SCOPE_INVALID/));
test('resolved return still requires independent journal and inventory fences',async()=>{const r=await reviewClosure(fixture([{orderId:'o',sk:'RETURN#1',kind:'COD_RETURN_CASE',exceptionResolution:{status:'RESOLVED'}}]));assert.equal(r.observed.cases,1);assert.ok(!r.blockers.includes('CASE_NOT_CLOSED'));assert.equal(r.closureVerified,false);});
