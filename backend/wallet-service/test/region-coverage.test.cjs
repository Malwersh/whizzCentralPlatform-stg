const {test}=require('node:test');
const assert=require('node:assert/strict');
const h3=require('h3-js');
const {createDynamoRegionCoverage,createStagingDeliveryRouting}=require('../dist/regionCoverage');
const p={latitude:31.925,longitude:44.457};
const cell=h3.latLngToCell(p.latitude,p.longitude,9);
const polygon={type:'Polygon',coordinates:[[[44.4,31.9],[44.5,31.9],[44.5,32],[44.4,32],[44.4,31.9]]]};
function fixture(){
 const base=new Map(['country','governorate','district','zone'].map((regionId,level)=>[regionId,{regionId,level,parent_id:level ? ['country','governorate','district'][level-1]:'ROOT',is_active:1,version:1,...(level===3?{geometry:structuredClone(polygon)}:{})}]));
 const derived=new Map([...base.keys()].map(regionId=>[regionId,{regionId,effective_is_active:1,version:1}]));
 const index=new Map([[cell,[{h3_cell:cell,regionId:'zone'}]]]);
 const calls=[];
 const db={send:async cmd=>{
  const q=cmd.input;calls.push(q);
  if(cmd.constructor.name==='QueryCommand') return {Items:index.get(q.ExpressionAttributeValues[':cell'])??[]};
  return {Item:structuredClone((q.TableName==='regions'?base:derived).get(q.Key.regionId))};
 }};
 return {base,derived,index,calls,db,resolve:createDynamoRegionCoverage({db,tables:{regions:'regions',derived:'derived',index:'index'}})};
}
const code=(promise,c)=>assert.rejects(promise,e=>e.code===c);
test('resolves existing h3 index to four live reference levels with immutable evidence',async()=>{
 const f=fixture(),m=await f.resolve(p);
 assert.equal(m.regionId,'zone');assert.deepEqual(m.regionPath,['country','governorate','district','zone']);assert.equal(m.cellId,cell);
 assert.match(m.referenceVersion,/^[a-f0-9]{64}$/);assert.ok(Object.isFrozen(m.regionPath));
 const queries=f.calls.filter(q=>q.IndexName);assert.equal(queries.length,10);
 assert.ok(queries.every(q=>q.IndexName==='h3-index' && !q.ConsistentRead && q.ProjectionExpression==='#cell, #region'));
 assert.ok(f.calls.filter(q=>q.Key).every(q=>q.ConsistentRead===true));
});
test('neighbor candidate works at a polyfill edge but is still checked against polygon',async()=>{
 const f=fixture();f.index.clear();const neighbor=h3.gridDisk(cell,1).find(c=>c!==cell);
 f.index.set(neighbor,[{h3_cell:neighbor,regionId:'zone'}]);assert.equal((await f.resolve(p)).regionId,'zone');
 f.base.get('zone').geometry={type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,1],[0,0]]]};
 assert.equal(await f.resolve(p),null);
});
test('coarser cell supplies candidates, never nearest-region coverage',async()=>{
 const f=fixture();f.index.clear();const parent=h3.cellToParent(cell,7);
 f.index.set(parent,[{h3_cell:parent,regionId:'zone'}]);assert.equal((await f.resolve(p)).regionId,'zone');
 f.index.clear();assert.equal(await f.resolve(p),null);
});
test('a country or district candidate alone cannot open coverage',async()=>{
 const f=fixture();f.index.set(cell,[{h3_cell:cell,regionId:'district'}]);assert.equal(await f.resolve(p),null);
});
test('holes, multipolygons and conservative boundary handling',async()=>{
 const f=fixture();f.base.get('zone').geometry.coordinates.push([[44.44,31.92],[44.47,31.92],[44.47,31.94],[44.44,31.94],[44.44,31.92]]);
 assert.equal(await f.resolve(p),null);
 f.base.get('zone').geometry={type:'MultiPolygon',coordinates:[polygon.coordinates]};assert.equal((await f.resolve(p)).regionId,'zone');
 assert.equal(await f.resolve({latitude:31.9,longitude:44.457}),null);
});
test('inactive source or derived ancestor and absent derived reference cannot authorize',async()=>{
 for(const target of ['country','governorate','district','zone']){
  for(const kind of ['source','derived']){
   const f=fixture();if(kind==='source')f.base.get(target).is_active=false;else f.derived.get(target).effective_is_active=0;
   assert.equal(await f.resolve(p),null);
  }
 }
 const f=fixture();f.derived.delete('country');await code(f.resolve(p),'REGION_REFERENCE_UNAVAILABLE');
});
test('cyclic, incorrect level, dangling and nonroot hierarchies fail closed',async()=>{
 for(const update of [{parent_id:'zone'},{parent_id:'missing'}]){
  const f=fixture();Object.assign(f.base.get('zone'),update);await code(f.resolve(p),'REGION_REFERENCE_UNAVAILABLE');
 }
 const f=fixture();f.base.get('district').level=1;await code(f.resolve(p),'REGION_REFERENCE_UNAVAILABLE');
 const g=fixture();g.base.get('country').parent_id='foreign';await code(g.resolve(p),'REGION_REFERENCE_UNAVAILABLE');
});
test('overlapping active service leaves are rejected, duplicate index hits deduplicated',async()=>{
 const f=fixture();f.index.get(cell).push({h3_cell:cell,regionId:'zone'});assert.equal((await f.resolve(p)).regionId,'zone');
 f.base.set('zone2',{...structuredClone(f.base.get('zone')),regionId:'zone2'});f.derived.set('zone2',{regionId:'zone2',effective_is_active:1});
 f.index.get(cell).push({h3_cell:cell,regionId:'zone2'});await code(f.resolve(p),'AMBIGUOUS_COVERAGE');
});
test('fingerprint includes geometry, ancestry and activation; ignores map key order and names',async()=>{
 const f=fixture(),a=(await f.resolve(p)).referenceVersion;
 f.base.get('zone').name='renamed';assert.equal((await f.resolve(p)).referenceVersion,a);
 const g=f.base.get('zone').geometry;f.base.get('zone').geometry={coordinates:g.coordinates,type:g.type};assert.equal((await f.resolve(p)).referenceVersion,a);
 f.base.get('zone').geometry.coordinates[0][1][0]=44.51;assert.notEqual((await f.resolve(p)).referenceVersion,a);
});
test('invalid geometry, missing candidates and wrong partition responses are errors',async()=>{
 for(const shape of [null,{type:'Point',coordinates:[44,31]},{type:'Polygon',coordinates:[[[44,31],[45,31],[45,32],[44,32]]]},{type:'Polygon',coordinates:[[[44,31],[45,31],['45',32],[44,31]]]}]){
  const f=fixture();f.base.get('zone').geometry=shape;await code(f.resolve(p),'REGION_REFERENCE_UNAVAILABLE');
 }
 const f=fixture();f.base.delete('zone');await code(f.resolve(p),'REGION_REFERENCE_UNAVAILABLE');
 const g=fixture();g.index.set(cell,[{h3_cell:'foreign',regionId:'zone'}]);await code(g.resolve(p),'REGION_REFERENCE_UNAVAILABLE');
});
test('query continues an empty page, and refuses unbounded pagination',async()=>{
 const f=fixture(),send=f.db.send;let first=true;
 f.db.send=async cmd=>{if(cmd.input.IndexName && cmd.input.ExpressionAttributeValues[':cell']===cell && first){first=false;return{Items:[],LastEvaluatedKey:{index_cell_id:'resume'}};}return send(cmd);};
 assert.equal((await f.resolve(p)).regionId,'zone');assert.ok(f.calls.some(q=>q.ExclusiveStartKey));
 f.db.send=async()=>({Items:[],LastEvaluatedKey:{index_cell_id:'stuck'}});await code(f.resolve(p),'REGION_REFERENCE_UNAVAILABLE');
});
test('reference outages sanitize AWS errors; malformed coordinates make no read',async()=>{
 const f=fixture();await code(f.resolve({latitude:NaN,longitude:44}),'INVALID_ROUTE_INPUT');assert.equal(f.calls.length,0);
 f.db.send=async()=>{throw Error('sensitive AWS context');};await code(f.resolve(p),'REGION_REFERENCE_UNAVAILABLE');
});
test('staging composition rechecks actual region reader after provider I/O',async()=>{
 const f=fixture();const original=f.db.send;
 f.db.send=async cmd=>{const c={input:{...cmd.input,TableName:cmd.input.TableName==='WizzCentral_Regions'?'regions':'derived'},constructor:cmd.constructor};return original(c);};
 let calls=0;
 const router=createStagingDeliveryRouting({db:f.db,getAccessToken:async()=>'test',profile:'driving',ttlSeconds:120,timeoutMs:1000,
 fetchImpl:async()=>{calls++;f.base.get('zone').geometry.coordinates[0][1][0]=44.51;return new Response(JSON.stringify({code:'Ok',routes:[{distance:100,duration:10}]}));}});
 await code(router.getDeliveryRoute(p,p),'OUTSIDE_COVERAGE');assert.equal(calls,1);
});
