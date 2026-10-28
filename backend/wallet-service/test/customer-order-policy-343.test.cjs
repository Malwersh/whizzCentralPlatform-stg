'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const p=require('../../shared/customer-order-policy-343');
const accepted={subjectId:'subject',createdAt:'2026-10-28T00:00:00.000Z',commercialDigest:'a'.repeat(64)};
test('policy has an explicit immutable version, no fabricated customer refund timer',()=>{
 const d=p.document();assert.equal(d.version,1);assert.equal(d.policyId,'CASH_ORDER_CUSTOMER');assert.equal(d.sections.length,6);
 assert.equal(d.sections.find(x=>x.id==='PAYMENT').body.includes('نقدي عند الاستلام'),true);
 d.sections[0].body='changed';assert.notEqual(p.document().sections[0].body,'changed');
});
test('missing legacy client acknowledgement is never recorded as acceptance',()=>{
 const r=p.record(undefined,accepted);assert.equal(r.status,'NOT_RECORDED_BY_CLIENT');assert.equal(r.subjectId,undefined);assert.equal(r.recordedAt,undefined);
});
test('confirmed customer policy records full text, subject, commercial consent and server timestamp',()=>{
 const r=p.record(p.pin(),accepted);assert.equal(r.status,'ACKNOWLEDGED');assert.equal(r.subjectId,'subject');assert.equal(r.commercialDigest,accepted.commercialDigest);assert.equal(r.recordedAt,accepted.createdAt);assert.deepEqual(r.document,p.document());
});
test('forged, stale and extra policy fields are rejected before order writes',()=>{
 for(const v of [null,{},[],{...p.pin(),version:2},{...p.pin(),digest:'0'.repeat(64)},{...p.pin(),policyId:'other'},{...p.pin(),acceptedAt:'client-time'}])assert.throws(()=>p.record(v,accepted),/CUSTOMER_POLICY_CHANGED/);
 for(const v of [{...accepted,subjectId:''},{...accepted,commercialDigest:'bad'},{...accepted,createdAt:'bad'}])assert.throws(()=>p.record(p.pin(),v),/CUSTOMER_POLICY_UNAVAILABLE/);
});
test('customer backend shared contract and generated Flutter fallback match authoritative central document',()=>{
 const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'../../..'),user=path.resolve(root,'../wizzuser-stg');
 const backend=require(path.join(user,'backend/src/functions/shared/customer-order-policy-343'));
 assert.deepEqual(backend.document(),p.document());
 const dart=fs.readFileSync(path.join(user,'frontend/lib/models/customer_order_policy_data_343.dart'),'utf8');
 assert.deepEqual(JSON.parse(dart.split("r'''")[1].split("'''")[0]),require('../../shared/customer-order-policy-343.json'));
 const index=fs.readFileSync(path.join(user,'backend/src/functions/create-order/index.js'),'utf8');
 assert.ok(index.includes("customerPolicy:require('../shared/customer-order-policy-343').document()"));
 assert.ok(index.includes("order.customerPolicyAcknowledgement=require('../shared/customer-order-policy-343').record"));
});
