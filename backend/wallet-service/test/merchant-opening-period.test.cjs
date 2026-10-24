'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{merchantOpeningPeriod:period}=require('../dist/merchantOpeningPeriod');
const schedule={schemaVersion:1,version:1,timezone:'Asia/Baghdad',frequency:'WEEKLY',anchorLocalDate:'2026-10-20'};
test('opening statement covers past days until approved anchor without creating a retroactive schedule',()=>{
 const original=structuredClone(schedule),p=period(schedule,'2026-10-01');assert.equal(p.fromUtc,'2026-09-30T21:00:00.000Z');assert.equal(p.untilExclusiveUtc,'2026-10-19T21:00:00.000Z');assert.equal(p.kind,'MERCHANT_OPENING_PERIOD');assert.deepEqual(schedule,original);
});
test('opening period rejects invalid, overlapping or future start dates',()=>{
 for(const date of ['2026-02-30','2026-10-20','2026-10-21','1999-12-31','bad'])assert.throws(()=>period(schedule,date));
});
test('opening cutoff uses first schedule activation rather than an earlier recurring calendar anchor',()=>{
 const p=period({...schedule,anchorLocalDate:'2026-10-01'},'2026-10-01','2026-10-21T21:00:00.000Z');
 assert.equal(p.endExclusiveLocalDate,'2026-10-22');assert.equal(p.untilExclusiveUtc,'2026-10-21T21:00:00.000Z');
 assert.throws(()=>period(schedule,'2026-10-01','2026-10-20T01:00:00.000Z'));
});
