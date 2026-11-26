const test=require('node:test'),assert=require('node:assert/strict');
const {docClient}=require('../dist/db');
const {statementPeriod,walletStatement,csvCell}=require('../dist/walletStatement');
const id='WALLET#MERCHANT#b',p=()=>statementPeriod('2026-01-01','2026-01-02');
const row=(suffix='a')=>({walletId:id,sk:'ts#2026-01-02T23:59:59.999Z#'+suffix,amount:-250,type:'DEBIT',category:'TRANSFER'});
test('period uses inclusive calendar dates UTC, rejects rollover/future/reversed/long intervals',()=>{
 assert.equal(p().endExclusive,'2026-01-03T00:00:00.000Z');
 for(const dates of [['2026-02-30','2026-03-01'],['2026-01-02','2026-01-01'],['2026-01-01','2026-02-01'],['2999-01-01','2999-01-02'],['2026-1-1','2026-01-02']])assert.throws(()=>statementPeriod(...dates));
});
test('statement consumes every page including empty pages and returns only whitelisted fields',async()=>{
 const calls=[];docClient.send=async c=>{calls.push(c.input);return calls.length===1?{Items:[],LastEvaluatedKey:{walletId:id,sk:'ts#2026-01-01T00:00:00.000Z#x'}}:{Items:[{...row(),metadata:{secret:'secret'}}]};};
 const r=await walletStatement(id,p(),true);assert.equal(calls.length,2);assert.equal(r.rowCount,1);assert.equal(r.complete,true);assert.equal(r.countsByCategory.TRANSFER,1);assert.equal(r.entries[0].metadata,undefined);assert.equal(r.entries[0].amount,-250);assert.ok(r.csv.startsWith('\ufeff'));assert.equal(r.openingBalance,undefined);assert.equal(r.net,undefined);assert.equal(calls[1].ExclusiveStartKey.sk,'ts#2026-01-01T00:00:00.000Z#x');
});
test('foreign, out-of-range, noninteger and oversized statements never return partial success',async()=>{
 for(const items of [[{...row(),walletId:'foreign'}],[{...row(),sk:'ts#2026-01-03T00:00:00.000Z#x'}],[{...row(),amount:1.5}],Array.from({length:501},(_,i)=>row(''+i))]){
  docClient.send=async()=>({Items:items});await assert.rejects(walletStatement(id,p(),false));
 }
});
test('CSV neutralizes spreadsheet text formulas and escapes commas, quotes and line breaks',()=>{
 for(const value of ['=1',' +1','\t@SUM(A1)','-1'])assert.ok(csvCell(value).startsWith('"\''));
 assert.equal(csvCell(-250),'"-250"');assert.equal(csvCell('مطعم, "أ"\nب'),'"مطعم, ""أ""\nب"');
});
test('statement CSV and JSON use identical classified bucket totals without exposing metadata',async()=>{
 const rows=[{...row('1'),balanceBefore:1000,balanceAfter:750},{...row('2'),type:'CREDIT',amount:100,balanceBefore:750,balanceAfter:850}];
 docClient.send=async()=>({Items:rows});
 const r=await walletStatement(id,p(),true);
 assert.equal(r.effectSummary.status,'AVAILABLE');assert.equal(r.effectSummary.totals.AVAILABLE.net,-150);assert.equal(r.entries[0].ledgerEffect.delta,-250);assert.ok(r.csv.includes('"AVAILABLE_decreases","250"'));assert.ok(r.csv.includes('"effectDelta"'));assert.ok(!r.csv.includes('[object Object]'));
});
test('unclassified statement preserves rows but omits all monetary aggregates in JSON and CSV',async()=>{
 docClient.send=async()=>({Items:[row()]});
 const r=await walletStatement(id,p(),true);assert.equal(r.effectSummary.status,'UNAVAILABLE');assert.equal(r.effectSummary.totals,undefined);assert.equal(r.rowCount,1);assert.ok(r.csv.includes('"summary_status","UNAVAILABLE"'));assert.ok(!r.csv.includes('AVAILABLE_net'));
});
test('duplicate ledger keys cannot inflate statement totals',async()=>{
 docClient.send=async()=>({Items:[row(),row()]});await assert.rejects(walletStatement(id,p(),false),e=>e.code==='STATEMENT_DATA_UNAVAILABLE');
});
