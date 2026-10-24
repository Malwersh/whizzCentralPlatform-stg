const test=require('node:test'),assert=require('node:assert/strict'),{evidence,pending,supports}=require('../customer-cash-retention');
test('closed adjudication archives amount, finding digest and execution reference without raw claims/contact data',()=>{
 const row={kind:'CUSTOMER_CASH_REVIEW_CASE',state:'CLOSED',adjudication:{status:'EXECUTED',decisionId:'decision1',basis:'MISSING_DECLARATION',outcome:'COMPANY_COVERAGE',collectedIqd:8250,shortfallIqd:750,expectedIqd:9000,digest:'a'.repeat(64),reason:'private notes',approvedBy:'private-staff',execution:{at:'2026-10-22T12:00:00.000Z',actorId:'private-executor',operationId:'FCS:1'}},contactAttempts:[{note:'private contact'}],refunds:{digest:'b'.repeat(64),refunds:[]}};
 const r=evidence(row);assert.equal(r.adjudication.shortfallIqd,750);assert.equal(r.adjudication.execution.operationId,'FCS:1');assert(!JSON.stringify(r).includes('private'));assert.equal(pending(row),false);
});
test('customer receivable remains a deletion blocker rather than a paid or written-off debt',()=>{
 const r={kind:'CUSTOMER_CASH_RECEIVABLE',status:'OPEN',amountIqd:750};assert(supports(r));assert(pending(r));assert.throws(()=>evidence(r),/COD_INTEGRATION_PENDING/);
});
