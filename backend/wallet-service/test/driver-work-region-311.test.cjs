const test=require('node:test'),assert=require('node:assert/strict');
process.env.DRIVER_WORK_REGION_ENFORCE='true';
const {setup}=require('./helpers/driver-financial-fixture.cjs');
const T=require('../../shared/driver-work-region-311').TABLES;
function ready(){const f=setup('3000');
 for(const [regionId,parent_id,level]of [['country',null,0],['gov','country',1],['district','gov',2],['zone1','district',3],['work','district',3]]){
  f.put(T.base,{regionId,parent_id,level,is_active:true,version:1,...(level===3?{geometry:{type:'Polygon',coordinates:[[[43,30],[45,30],[45,32],[43,32],[43,30]]]}}:{})});
  f.put(T.derived,{regionId,effective_is_active:1,version:1,effective_config:{delivery:{}}});
 }
 for(const driverId of ['driver1','driver2']){
  f.get('WhizzDrivers_staging',{driverId}).work_region_id='zone1';
  f.get('WizzDriverLiveState_staging',{driverId}).current_work_region_id='zone1';
 }
 return f;
}
test('covered region permits prepare/save/accept with source fences and one hold',async()=>{const f=ready();await f.run(['driver1']);assert.equal(f.sent.length,1);await f.accept();assert.equal(f.get('staging-Holds',{orderId:'order1',sk:'HOLD'}).status,'ACTIVE');assert(f.calls.some(c=>c.input.TransactItems?.some(o=>o.ConditionCheck?.TableName===T.base)));});
test('closed work-region ancestry prevents an offer and any collateral',async()=>{const f=ready();f.get(T.base,{regionId:'gov'}).is_active=false;await assert.rejects(f.run(['driver1']));assert.equal(f.sent.length,0);assert.equal(f.get('staging-Holds',{orderId:'order1',sk:'HOLD'}),undefined);});
test('permission revoked after arrival of offer prevents acceptance without a hold',async()=>{const f=ready();f.get('WhizzDrivers_staging',{driverId:'driver1'}).work_region_id='work';f.put(T.neighbors,{neighbor_pair_id:'work#zone1',source_region_id:'work',target_region_id:'zone1',source_level:3,target_level:3,expansion_priority:0});await f.run(['driver1']);f.get(T.neighbors,{neighbor_pair_id:'work#zone1'}).expansion_priority=2;await assert.rejects(f.accept());assert.equal(f.get('staging-Holds',{orderId:'order1',sk:'HOLD'}),undefined);});
test('region closing during acceptance is rejected atomically',async()=>{const f=ready();await f.run(['driver1']);f.beforeCommit=()=>{f.get(T.derived,{regionId:'gov'}).effective_is_active=0;};await assert.rejects(f.accept(),/FINANCIAL_ACCEPTANCE_CONFLICT/);assert.equal(f.get('staging-Holds',{orderId:'order1',sk:'HOLD'}),undefined);assert.equal(f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'}).driverId,undefined);});
test('legacy allowed-region arrays cannot authorize a driver outside approved scope',async()=>{const f=ready();const p=f.get('WhizzDrivers_staging',{driverId:'driver1'});p.work_region_id='work';p.level='Gold';const live=f.get('WizzDriverLiveState_staging',{driverId:'driver1'});live.allowed_region_ids=['zone1'];live.allowed_region_ids_priority0=['zone1'];await assert.rejects(f.run(['driver1']));assert.equal(f.sent.length,0);});
