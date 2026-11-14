'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {merchantSettlementPeriod:period}=require('../dist/merchantSettlementPeriod');
const schedule=(frequency,anchorLocalDate='2026-01-01')=>({schemaVersion:1,version:1,timezone:'Asia/Baghdad',frequency,anchorLocalDate});
test('Baghdad local midnight uses the prior UTC date, with an exclusive end',()=>{
 const s=schedule('WEEKLY');const before=period(s,'2026-01-07T20:59:59.999Z'),after=period(s,'2026-01-07T21:00:00.000Z');
 assert.equal(before.startLocalDate,'2026-01-01');assert.equal(before.fromUtc,'2025-12-31T21:00:00.000Z');
 assert.equal(before.untilExclusiveUtc,after.fromUtc);assert.equal(after.startLocalDate,'2026-01-08');assert.notEqual(before.periodId,after.periodId);
});
test('fortnightly is fourteen days across year end, not twice per calendar month',()=>{
 const s=schedule('FORTNIGHTLY','2025-12-25'),p=period(s,'2026-01-01T12:00:00.000Z');
 assert.equal(p.startLocalDate,'2025-12-25');assert.equal(p.endExclusiveLocalDate,'2026-01-08');
 assert.equal(Date.parse(p.untilExclusiveUtc)-Date.parse(p.fromUtc),14*86400000);
 assert.equal(period(s,p.untilExclusiveUtc).endExclusiveLocalDate,'2026-01-22');
});
test('monthly day31 clamps February while retaining day31 in March',()=>{
 const s=schedule('MONTHLY','2026-01-31');const jan=period(s,'2026-02-01T00:00:00.000Z');
 assert.equal(jan.startLocalDate,'2026-01-31');assert.equal(jan.endExclusiveLocalDate,'2026-02-28');
 const feb=period(s,jan.untilExclusiveUtc);assert.equal(feb.startLocalDate,'2026-02-28');assert.equal(feb.endExclusiveLocalDate,'2026-03-31');
});
test('leap February, calendar months and December rollover are correct',()=>{
 const leap=period(schedule('MONTHLY','2024-01-31'),'2024-02-01T12:00:00.000Z');assert.equal(leap.endExclusiveLocalDate,'2024-02-29');
 const dec=period(schedule('MONTHLY'),'2026-12-15T12:00:00.000Z');assert.equal(dec.startLocalDate,'2026-12-01');assert.equal(dec.endExclusiveLocalDate,'2027-01-01');
});
test('version and anchor changes have distinct identities without rewriting a previous period',()=>{
 const s=schedule('WEEKLY'),at='2026-01-05T00:00:00.000Z',first=period(s,at);
 assert.notEqual(period({...s,version:2},at).periodId,first.periodId);
 assert.notEqual(period({...s,anchorLocalDate:'2026-01-02'},at).periodId,first.periodId);
 assert.deepEqual(period(s,at),first);
});
test('ambiguous schedules, impossible dates and noncanonical timestamps are rejected',()=>{
 const s=schedule('WEEKLY');for(const changed of [{...s,timezone:'UTC'},{...s,frequency:'TWICE_MONTHLY'},{...s,anchorLocalDate:'2026-02-30'},{...s,version:0},{...s,unknown:1}])assert.throws(()=>period(changed,'2026-01-05T00:00:00.000Z'));
 assert.throws(()=>period(s,'2026-01-05T03:00:00+03:00'));assert.throws(()=>period(s,'not-a-date'));
});
