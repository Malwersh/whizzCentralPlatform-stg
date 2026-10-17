const test=require('node:test'),assert=require('node:assert/strict');
const {ledgerEffect,summarizeLedger,EFFECT_RULE_VERSION}=require('../dist/ledgerEffects');
const pair=(type,category,amount,before,after)=>({type,category,amount,balanceBefore:before,balanceAfter:after});
const known=(row,bucket,delta)=>assert.deepEqual(ledgerEffect(row),{status:'CLASSIFIED',bucket,delta});
test('signed transfers and positive debit fees have the same negative available effect',()=>{
 known(pair('DEBIT','TRANSFER',-300,1000,700),'AVAILABLE',-300);
 known(pair('CREDIT','TRANSFER',300,1000,1300),'AVAILABLE',300);
 known(pair('DEBIT','PLATFORM_FEE',300,1000,700),'AVAILABLE',-300);
 known(pair('CREDIT','PLATFORM_FEE',300,1000,1300),'AVAILABLE',300);
});
test('hold creation pairs separate available from locked instead of inventing a deposit',()=>{
 const debit={...pair('DEBIT','HOLD_CREATED',-300,1000,700),relatedEntityType:'HOLD',transactionId:'txn',sk:'ts#2026-01-01T00:00:00.000Z#HOLD_DEBIT#txn'};
 const credit={...pair('CREDIT','HOLD_CREATED',300,0,300),relatedEntityType:'HOLD',transactionId:'txn',sk:'ts#2026-01-01T00:00:00.000Z#HOLD_CREDIT#txn'};
 known(debit,'AVAILABLE',-300);known(credit,'LOCKED',300);
 const {summary}=summarizeLedger([debit,credit]);
 assert.equal(summary.status,'AVAILABLE');assert.deepEqual(summary.totals,{AVAILABLE:{increases:0,decreases:300,net:-300},LOCKED:{increases:300,decreases:0,net:300}});
});
test('legacy hold release, capture and partial release use explicit entry types and amount direction',()=>{
 known({type:'HOLD_RELEASED',relatedEntityType:'HOLD',amount:-300,balance:0},'LOCKED',-300);
 known({type:'HOLD_RELEASED',relatedEntityType:'HOLD',amount:300,balance:1000},'AVAILABLE',300);
 known({type:'HOLD_CAPTURED',relatedEntityType:'HOLD',amount:-300,balance:0},'LOCKED',-300);
 known({type:'HOLD_PARTIAL_RELEASE',relatedEntityType:'HOLD',amount:50,balance:750},'AVAILABLE',50);
 known({type:'TOPUP',relatedEntityType:'TOPUP',amount:300,balance:1000},'AVAILABLE',300);
});
test('unknown categories, incomplete balance proofs and contradictory signs cannot yield totals',()=>{
 for(const row of [pair('DEBIT','NEW_UNKNOWN',-300,1000,700),pair('DEBIT','TRANSFER',300,1000,700),pair('DEBIT','PLATFORM_FEE',-300,1000,700),pair('CREDIT','TRANSFER',300,1000,1200),{type:'CREDIT',category:'TRANSFER',amount:300,balanceAfter:1300},{...pair('CREDIT','TRANSFER',300,1000,1300),balance:1500},{type:'HOLD_CAPTURED',relatedEntityType:'HOLD',amount:300,balance:0},{type:'TOPUP',relatedEntityType:'TOPUP',amount:300}]){
  const r=summarizeLedger([pair('CREDIT','TRANSFER',500,0,500),row]);assert.equal(r.summary.status,'UNAVAILABLE');assert.equal(r.summary.unclassifiedCount,1);assert.equal(r.summary.totals,undefined);assert.equal(r.entries.length,2);
 }
});
test('unsafe aggregate and empty period are explicit and do not mutate the source',()=>{
 const row=pair('CREDIT','TRANSFER',Number.MAX_SAFE_INTEGER,0,Number.MAX_SAFE_INTEGER),copy=structuredClone(row);
 const result=summarizeLedger([row,row]);assert.equal(result.summary.status,'UNAVAILABLE');assert.equal(result.summary.reason,'UNSAFE_TOTAL');assert.equal(result.summary.totals,undefined);assert.deepEqual(row,copy);
 const empty=summarizeLedger([]);assert.equal(empty.summary.status,'AVAILABLE');assert.equal(empty.summary.rowCount,0);assert.equal(empty.summary.totals.AVAILABLE.net,0);assert.equal(empty.summary.ruleVersion,EFFECT_RULE_VERSION);
});
