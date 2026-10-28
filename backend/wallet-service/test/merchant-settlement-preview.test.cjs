'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createMerchantSettlementPreviewReader:create,exportMerchantSettlementPreview:csv}=require('../dist/merchantSettlementPreview');
const {proof}=require('./helpers/merchant-accrual-fixture.cjs');
const schedule={schemaVersion:1,version:1,frequency:'WEEKLY',anchorLocalDate:'2026-10-01',timezone:'Asia/Baghdad'};
function reader(f,overrides={}){let checks=0;const service=create({db:f.db,authorizeBranch:async branch=>{assert.equal(branch,'branch1');checks++;},readSchedule:async branch=>{assert.equal(branch,'branch1');return schedule;},...overrides});return {...service,checks:()=>checks};}
const request={branchId:'branch1',orderIds:['order1'],at:'2026-10-15T12:00:00.000Z'};
test('preview reads selected evidence consistently, checks authorization twice and does not mutate accounts',async()=>{
 const {f}=await proof({platform:1000}),r=reader(f),before=JSON.stringify([...f.rows]),calls=f.calls.length;
 const p=await r.preview(request);assert.equal(r.checks(),2);assert.equal(p.summary.amounts.merchantNet.minorAmount,9000000);
 assert.equal(p.coverage,'EXPLICIT_ORDER_SELECTION_ONLY');assert.equal(p.canPay,false);assert.equal(p.canReserve,false);
 assert.equal(JSON.stringify([...f.rows]),before);assert.equal(f.calls.length-calls,5);
 assert.ok(f.calls.slice(calls).every(c=>c.constructor.name==='GetCommand'&&c.input.ConsistentRead===true));
 assert.deepEqual(await r.preview(request),p);
});
test('authorization denial precedes any database evidence read',async()=>{
 const {f}=await proof(),calls=f.calls.length,r=reader(f,{authorizeBranch:async()=>{throw Error('FORBIDDEN');}});
 await assert.rejects(r.preview(request),/FORBIDDEN/);assert.equal(f.calls.length,calls);
});
test('revocation during reads prevents returning a completed preview',async()=>{
 const {f}=await proof();let checks=0;const r=reader(f,{authorizeBranch:async()=>{if(++checks===2)throw Error('REVOKED');}});
 await assert.rejects(r.preview(request),/REVOKED/);assert.equal(checks,2);
});
test('missing configured schedule is not replaced by a guessed weekly cycle',async()=>{
 const {f}=await proof(),calls=f.calls.length;await assert.rejects(reader(f,{readSchedule:async()=>null}).preview(request),/SCHEDULE_REQUIRED/);assert.equal(f.calls.length,calls);
});
test('foreign branch alias or incomplete evidence does not produce a partial preview',async()=>{
 for(const kind of ['foreign','missing','changed']){
  const {f,input}=await proof();
  if(kind==='foreign')input.order.businessId='other';
  if(kind==='missing')f.rows.delete('staging-Holds|'+require('../dist/deliveryQuoteRecord').quoteCanonical({orderId:'order1',sk:'MERCHANT_PAYABLE'}));
  if(kind==='changed')input.payable.amount++;
  await assert.rejects(reader(f).preview(request));
 }
});
test('membership is determined by delivery time, not original order creation time',async()=>{
 const {f,input}=await proof();input.order.createdAt='2026-01-01T00:00:00.000Z';assert.equal((await reader(f).preview(request)).accruals.length,1);
 await assert.rejects(reader(f).preview({...request,at:'2026-10-22T12:00:00.000Z'}),/OUTSIDE_PERIOD/);
});
test('duplicate, oversized, empty or client-supplied pricing selections are rejected before authorization',async()=>{
 const {f}=await proof(),r=reader(f);
 for(const invalid of [{...request,orderIds:[]},{...request,orderIds:['order1','order1']},{...request,orderIds:Array.from({length:51},(_,i)=>'order'+i)},{...request,amount:100},{...request,schedule},{...request,branchId:'../foreign'}])await assert.rejects(r.preview(invalid),/INVALID_MERCHANT_SETTLEMENT_SELECTION/);
 assert.equal(r.checks(),0);
});
test('CSV uses exact dinars, preserves totals and states that it is a preview, without customer fields',async()=>{
 const {f,input}=await proof({merchant:400,platform:600,earning:'9000'});input.order.customerName='PRIVATE_CUSTOMER';
 const p=await reader(f).preview(request),out=csv(p);
 assert.equal(out.paymentAuthorized,false);assert.match(out.csv,/MERCHANT_SETTLEMENT_SELECTION_PREVIEW/);assert.match(out.csv,/EXPLICIT_ORDER_SELECTION_ONLY/);
 assert.match(out.csv,/'?"merchantNet","8600"/);assert.match(out.csv,/"platformNetContribution","-5100"/);assert.equal(out.csv.includes('PRIVATE_CUSTOMER'),false);
 const changed=structuredClone(p);changed.summary.amounts.merchantNet.minorAmount++;assert.throws(()=>csv(changed));
});
