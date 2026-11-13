const test = require('node:test'), assert = require('node:assert/strict');
const {inventory} = require('../customer-benefit-inventory');
const {QueryCommand} = require('@aws-sdk/lib-dynamodb');
const grant = {pk:'USER#c',sk:'BENEFIT#offer',version:1,grantedUses:2,usedUses:0,reservedUses:1,revoked:false};
const hold = {pk:'BENEFIT_ORDER#o',sk:'DELIVERY',target:'DELIVERY',sub:'c',orderId:'o',campaignId:'offer',amountMinor:500000,version:1,status:'RESERVED'};
function fixture(rows, extra = {}) {
  const calls = [];
  const db = {async send(cmd) {
    assert.ok(cmd instanceof QueryCommand, 'must not mutate or scan'); calls.push(cmd.input);
    return {Items:rows.filter(r=>r.pk===cmd.input.ExpressionAttributeValues[':pk']), ...extra};
  }};
  return {calls, run: opts=>inventory({db,subjectIds:['c'],orderIds:['o'],...opts})};
}
test('reads only exact user and order partitions and detects pending reservations', async()=>{
  const f=fixture([grant,hold,{...grant,pk:'USER#other'}]),r=await f.run();
  assert.equal(r.records,2); assert.ok(r.blockers.every(b=>b.code==='BENEFIT_RESERVATION_PENDING'));
  assert.ok(f.calls.every(c=>c.ConsistentRead && c.TableName==='staging-WizzOfferJourney'));
  assert.equal(JSON.stringify(r).includes('USER#'),false);
});
test('completed financial evidence and unused grants require review, not deletion', async()=>{
  for(const status of ['CAPTURED_USED','RELEASED','RELEASED_USED']) {
    const r=await fixture([{...grant,reservedUses:0},{...hold,status}]).run();
    assert.ok(r.blockers.every(b=>b.code==='BENEFIT_RETENTION_REVIEW'));
  }
});
test('compensation links, counters and unknown user records are retained for review',async()=>{
  const r=await fixture([{pk:'USER#c',sk:'CASE_COMPENSATION#case'},{pk:'USER#c',sk:'ORDERS'}]).run();
  assert.equal(r.blockers.length,2);
});
test('foreign reservation ownership and unknown reservation state fail closed',async()=>{
  await assert.rejects(fixture([{...hold,sub:'other'}]).run(),/OWNERSHIP_MISMATCH/);
  await assert.rejects(fixture([{...hold,status:'NEW_UNKNOWN'}]).run(),/STATE_UNKNOWN/);
});
test('invalid arithmetic is not mistaken for a settled grant',async()=>{
  await assert.rejects(fixture([{...grant,usedUses:3}]).run(),/RECORD_INVALID/);
});
test('pagination limit and denied reads never produce a complete empty inventory',async()=>{
  await assert.rejects(fixture([],{LastEvaluatedKey:{pk:'USER#c',sk:'next'}}).run({maxPages:1}),/INCOMPLETE/);
  await assert.rejects(inventory({db:{send:async()=>{throw Error('AccessDenied');}},subjectIds:['c']}),/AccessDenied/);
});
test('hold records block review and empty partitions remain complete',async()=>{
  assert.equal((await fixture([{...grant,legalHold:true}]).run()).blockers[0].code,'DOCUMENTED_RETENTION_HOLD');
  assert.equal((await fixture([]).run()).records,0);
});
