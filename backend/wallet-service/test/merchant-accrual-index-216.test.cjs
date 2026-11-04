'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {proof}=require('./helpers/merchant-accrual-fixture.cjs');
const {prepareMerchantAccrualIndex,merchantAccrualIndexRow,readMerchantAccrualIndexPage}=require('../dist/merchantAccrualIndex');
const {TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const MP='staging-MerchantPlatform';
test('zero-net completed order has a strong branch source index without a fabricated wallet ledger credit',async()=>{
 const {f,input}=await proof({commission:10000});assert.equal(input.payable.amount,0);
 const index=[...f.rows.values()].find(r=>r.kind==='MERCHANT_ACCRUAL_INDEX_ENTRY');assert.equal(index.merchantNetIqd,0);assert.equal(index.orderId,'order1');assert.equal(index.operationId,input.outcome.operationId);assert.equal(index.deliveredAt,input.order.deliveredAt);
 assert.equal([...f.rows.entries()].filter(([k,r])=>k.startsWith('staging-LedgerEntries|')&&r.walletId==='WALLET#MERCHANT#branch1').length,0);
 assert.equal(f.get(MP,{pk:'MERCHANT_ACCRUAL#branch1',sk:'HEAD'}).revision,1);
 const tx=f.calls.find(c=>c.input.TransactItems?.some(o=>o.Put?.Item.kind==='MERCHANT_ACCRUAL_INDEX_ENTRY')).input.TransactItems;
 assert.ok(tx.some(o=>o.Put?.Item.sk==='MERCHANT_PAYABLE'));assert.ok(tx.some(o=>o.Put?.Item.kind==='MERCHANT_ACCRUAL_INDEX_HEAD'));assert.ok(tx.length<=100);
});
test('competing branch index appends cannot silently advance the same traversal revision or leave a partial entry',async()=>{
 const {f,input}=await proof(),v={branchId:'branch1',orderId:'other1',operationId:'COD:other1',deliveredAt:input.order.deliveredAt,merchantNetIqd:10,financialSchemaVersion:2};
 const [one,two]=await Promise.all([prepareMerchantAccrualIndex(f.db,v),prepareMerchantAccrualIndex(f.db,{...v,orderId:'other2',operationId:'COD:other2'})]);
 const result=await Promise.allSettled([f.db.send(new TransactWriteCommand({TransactItems:one})),f.db.send(new TransactWriteCommand({TransactItems:two}))]);assert.equal(result.filter(v=>v.status==='fulfilled').length,1);assert.equal(f.get(MP,{pk:'MERCHANT_ACCRUAL#branch1',sk:'HEAD'}).revision,2);assert.equal([...f.rows.values()].filter(r=>r.kind==='MERCHANT_ACCRUAL_INDEX_ENTRY').length,2);
});
test('index period discovery uses strong branch-only key bounds, validates digest and rejects foreign cursors',async()=>{
 const {f,input}=await proof(),entry=[...f.rows.values()].find(r=>r.kind==='MERCHANT_ACCRUAL_INDEX_ENTRY');let corrupt=false;
 const db={send:async c=>{assert.equal(c.constructor.name,'QueryCommand');const q=c.input;assert.equal(q.ConsistentRead,true);assert.equal(q.ExpressionAttributeValues[':pk'],'MERCHANT_ACCRUAL#branch1');assert.equal(q.KeyConditionExpression,'pk=:pk AND sk BETWEEN :from AND :until');return {Items:[{...entry,...(corrupt?{merchantNetIqd:999}:{})}]};}};
 const filter={branchId:'branch1',fromUtc:input.order.deliveredAt,untilExclusiveUtc:new Date(Date.parse(input.order.deliveredAt)+1).toISOString()};assert.equal((await readMerchantAccrualIndexPage(db,filter)).items.length,1);corrupt=true;await assert.rejects(readMerchantAccrualIndexPage(db,filter),/INDEX_INVALID/);await assert.rejects(readMerchantAccrualIndexPage(db,{...filter,key:{pk:'MERCHANT_ACCRUAL#foreign',sk:entry.sk}}),/CURSOR_INVALID/);
});
test('poisoned traversal head and unsupported financial schema are rejected before preparing a completion append',async()=>{
 const {f,input}=await proof(),v={branchId:'branch1',orderId:'other',operationId:'COD:other',deliveredAt:input.order.deliveredAt,merchantNetIqd:0,financialSchemaVersion:2};
 f.get(MP,{pk:'MERCHANT_ACCRUAL#branch1',sk:'HEAD'}).revision=Number.MAX_SAFE_INTEGER;await assert.rejects(prepareMerchantAccrualIndex(f.db,v),/INDEX_INVALID/);assert.throws(()=>merchantAccrualIndexRow({...v,financialSchemaVersion:99}),/INDEX_INVALID/);assert.throws(()=>merchantAccrualIndexRow({...v,merchantNetIqd:-1}),/INDEX_INVALID/);
});
