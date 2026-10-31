'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{fixture}=require('./helpers/merchant-settlement-schedule-fixture.cjs');
const {createMerchantOpeningScheduleReader:create}=require('../dist/merchantOpeningScheduleReader');
const P='staging-MerchantPlatform',key={pk:'BRANCH#branch1',sk:'SETTLEMENT_SCHEDULE#CURRENT'};
test('opening reader pins first approved activation and current version without inventing owner consent',async()=>{
 const f=fixture();await f.publish();const before=f.writes.length,r=await create(f.db)('branch1');
 assert.equal(r.openingCutoff,'2026-10-21T21:00:00.000Z');assert.equal(r.schedule.version,1);assert.equal(r.guards[0].ConditionCheck.Key.sk,'SETTLEMENT_SCHEDULE#VERSION#1');assert.equal(f.writes.length,before);
});
test('disabled, changed ownership and corrupt first approval cannot authorize an opening statement',async()=>{
 for(const mode of ['disabled','owner','first']){
  const f=fixture();await f.publish();
  if(mode==='disabled'){const row=f.get(P,key);row.enabled=false;f.put(P,row);assert.equal(await create(f.db)('branch1'),null);continue;}
  if(mode==='owner'){const b=f.get('WhizzMerchants_Businesses',{businessId:'branch1'});b.ownerId='other';f.put('WhizzMerchants_Businesses',b);}
  else{const row=f.get(P,{pk:key.pk,sk:'SETTLEMENT_SCHEDULE#VERSION#1'});row.digest='wrong';f.put(P,row);}
  await assert.rejects(create(f.db)('branch1'));
 }
});
