'use strict';

const assert=require('node:assert/strict');
const {test}=require('node:test');
const {fixture}=require('./fixture.cjs');
const m=require('../model');
const T=require('../repository').TABLES;
const {createReferenceCheck}=require('../references');

test('deletion withdraws coverage, then removes the base, derived, cells, listings and both neighbor directions',async()=>{
 const f=fixture();
 f.put(T.index,{index_cell_id:'old-a-cell',regionId:'a',h3_cell:'a-cell'});
 f.put(T.listings,{regionId:'a',metadataType:'META',listingVersion:1});
 f.put(T.neighbors,{neighbor_pair_id:'a#b',source_region_id:'a',target_region_id:'b'});
 f.put(T.neighbors,{neighbor_pair_id:'b#a',source_region_id:'b',target_region_id:'a'});
 f.put(T.neighbors,{neighbor_pair_id:'b#c',source_region_id:'b',target_region_id:'c'});
 await f.saveDraft({regionId:'a'},'delete');
 assert.equal(f.get(T.base,{regionId:'a'}).is_active,true);
 const {job}=await f.publish(['a']);
 await f.worker.run(job.jobId);
 assert.equal(f.get(T.base,{regionId:'a'}).is_active,false);
 assert.equal(f.get(T.derived,{regionId:'a'}).effective_is_active,0);
 assert.equal(f.job(job.jobId).cleanupPending,true);
 assert.equal((await f.drain(job.jobId)).status,'PUBLISHED');
 assert.equal(f.get(T.base,{regionId:'a'}),undefined);
 assert.equal(f.get(T.derived,{regionId:'a'}),undefined);
 assert.equal(f.get(T.index,{index_cell_id:'old-a-cell'}),undefined);
 assert.equal(f.get(T.listings,{regionId:'a',metadataType:'META'}),undefined);
 assert.equal(f.get(T.neighbors,{neighbor_pair_id:'a#b'}),undefined);
 assert.equal(f.get(T.neighbors,{neighbor_pair_id:'b#a'}),undefined);
 assert(f.get(T.neighbors,{neighbor_pair_id:'b#c'}));
 assert.equal(f.get(T.audit,{audit_id:job.jobId+'#a'}).after,null);
});

test('children and later operational references prevent unsafe deletion',async()=>{
 const f=fixture();
 await f.saveDraft({regionId:'district'},'delete');
 await assert.rejects(f.publish(['district']),{code:'REGION_GEOMETRY_REVIEW_REQUIRED'});
 await f.saveDraft({regionId:'a'},'delete');
 f.setReferenceErrors([{code:'REGION_REFERENCES_EXIST',message:'linked address'}]);
 await assert.rejects(f.publish(['a']),{code:'REGION_REFERENCES_EXIST'});
 f.setReferenceErrors([]);
 const {job}=await f.publish(['a']);
 f.setReferenceErrors([{code:'REGION_REFERENCES_EXIST',message:'newly linked address'}]);
 assert.equal((await f.drain(job.jobId)).status,'FAILED');
 assert.equal(f.job(job.jobId).error,'REGION_REFERENCES_EXIST');
 assert.equal(f.get(T.base,{regionId:'a'}).is_active,true);
});

test('reclassifying a district without redrawing it generates delivery cells and changes derived ancestry',async()=>{
 const f=fixture();
 const district=f.region('mashkhab',2,'gov',f.square(44.02,31,0.01));
 f.put(T.base,district);
 f.put(T.derived,m.derive(district,[...f.rows.values()].filter(r=>r.geometry),{effective_pricing:{fee:3000},effective_limits:{min:15000}},new Date().toISOString()));
 f.put(T.derived,{...f.get(T.derived,{regionId:'district'}),effective_pricing:{fee:2000},effective_limits:{min:10000}});
 const next={...m.editable(district),level:3,parent_id:'district'};
 await assert.rejects(f.saveDraft(next),{code:'LEVEL_IMMUTABLE'});
 await f.saveDraft(next,'reclassify');
 const {job}=await f.publish(['mashkhab']);
 assert.equal((await f.drain(job.jobId)).status,'PUBLISHED');
 const stored=f.get(T.base,{regionId:'mashkhab'});
 assert.equal(stored.regionId,'mashkhab');
 assert.equal(stored.indexPublicationId,job.jobId);
 assert.equal(stored.level,3);
 assert.deepEqual(stored.geometry,district.geometry);
 assert.deepEqual(f.get(T.derived,{regionId:'mashkhab'}).inheritance_chain,['mashkhab','district','gov','country']);
 assert.deepEqual(f.get(T.derived,{regionId:'mashkhab'}).effective_pricing,{fee:2000});
 assert.deepEqual(f.get(T.derived,{regionId:'mashkhab'}).effective_limits,{min:10000});
 assert([...f.rows.values()].some(r=>r.regionId==='mashkhab'&&r.h3_cell));
});

test('moving a delivery area to district level removes leaf caches while keeping the record',async()=>{
 const f=fixture();
 const a=f.get(T.base,{regionId:'a'});
 f.put(T.index,{index_cell_id:'old-cell',regionId:a.regionId,h3_cell:'test-cell'});
 f.put(T.listings,{regionId:a.regionId,metadataType:'META',listingVersion:1});
 await f.saveDraft({...m.editable(a),level:2,parent_id:'gov',geometry:f.square(45.1,31)},'reclassify');
 const {job}=await f.publish(['a']);
 assert.equal((await f.drain(job.jobId)).status,'PUBLISHED');
 assert.equal(f.get(T.base,{regionId:'a'}).level,2);
 assert.deepEqual(f.get(T.derived,{regionId:'a'}).inheritance_chain,['a','gov','country']);
 assert.equal(f.get(T.index,{index_cell_id:'old-cell'}),undefined);
 assert.equal(f.get(T.listings,{regionId:'a',metadataType:'META'}),undefined);
});

test('source and destination permissions and the resulting hierarchy are checked',async()=>{
 const f=fixture();
 const old=f.get(T.base,{regionId:'a'});
 const other=f.region('other',2,'gov',f.square(42,30,3));
 f.put(T.base,other);
 const next={...m.editable(old),parent_id:'other'};
 const catalog=await f.route('get');
 const input={region:next,operation:'reclassify',catalogDigest:catalog.digest,expectedDraftVersion:0,reason:'تغيير الأب بعد المراجعة'};
 for(const id of ['district','other']){
  const scoped={...f.actor,scope:{allRegions:false,regionIds:[id]}};
  await assert.rejects(f.route('draft',input,scoped),{code:'REGION_FORBIDDEN'});
 }
});

test('operational references are checked across pages without reading records',async()=>{
 const tables={addresses:'addresses',merchants:'merchants',merchantPlatform:'drafts',drivers:'drivers',orders:'orders'};
 class ScanCommand{constructor(input){this.input=input;}}
 const cursor={addressId:'page-one'};
 const db={async send({input}){
  assert.equal(input.Select,'COUNT');
  assert.equal(input.ConsistentRead,true);
  assert.equal(input.ExpressionAttributeValues[':r0'],'region');
  if(input.TableName==='addresses'){
   if(!input.ExclusiveStartKey)return {Count:0,LastEvaluatedKey:cursor};
   assert.equal(input.ExclusiveStartKey,cursor);
   return {Count:1};
  }
  if(input.TableName==='drivers')assert(Object.values(input.ExpressionAttributeNames).includes('parent_district_id'));
  return {Count:0};
 }};
 const check=createReferenceCheck({db,sdk:{ScanCommand},tables});
 assert.deepEqual((await check(['region'])).map(({resource})=>resource),['addresses']);
 const unavailable=createReferenceCheck({db,sdk:{ScanCommand},tables:{...tables,orders:undefined}});
 await assert.rejects(unavailable(['region']),{code:'REGION_REFERENCE_CHECK_UNAVAILABLE'});
});
