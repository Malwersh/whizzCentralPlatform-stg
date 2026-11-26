'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createRegions,TABLES}=require('./regions.cjs');
const {createHash}=require('node:crypto');
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v)??'null';
function fixture(){const ids=['iq','gov','district','leaf'];const rows=ids.map((regionId,level)=>({base:{regionId,level,parent_id:level?ids[level-1]:'ROOT',name_ar:level?'منطقة':'العراق',is_active:1,version:1,...(level===3?{geometry:{type:'Polygon',coordinates:[[[44,31],[45,31],[45,32],[44,31]]]}}:{})},derived:{regionId,effective_is_active:1,version:1,effective_config:{delivery:true}}}));const proof=rows.map(({base:b,derived:d})=>({id:b.regionId,level:b.level,parentId:b.parent_id,active:b.is_active,effectiveActive:d.effective_is_active,version:b.version,derivedVersion:d.version}));const coverage={regionPath:ids,referenceVersion:createHash('sha256').update(canonical({schemaVersion:1,proof,geometry:rows[3].base.geometry})).digest('hex')};class GetCommand{constructor(input){this.input=input;}}const api=createRegions({sdk:{GetCommand},resolveCoverage:async()=>coverage,db:{send:async c=>({Item:rows[ids.indexOf(c.input.Key.regionId)][c.input.TableName===TABLES.regions?'base':'derived']})}});return {api,ids,rows,coverage};}
test('returns eight version fences for matching published ancestry',async()=>{const f=fixture();const r=await f.api.validate(f.ids,31.5,44.5);assert.equal(r.checks.length,8);assert.equal(r.regionId,'leaf');});
test('rejects point resolving to a different region',async()=>{const f=fixture();f.coverage.regionPath=['iq','gov','district','other'];await assert.rejects(()=>f.api.validate(f.ids,31.5,44.5),/LOCATION_OUTSIDE/);});
test('rejects delivery disabled after coverage lookup',async()=>{const f=fixture();f.rows[3].derived.effective_config.delivery=false;await assert.rejects(()=>f.api.validate(f.ids,31.5,44.5),/DELIVERY_UNAVAILABLE/);});
test('rejects geometry version change between lookup and transaction preparation',async()=>{const f=fixture();f.rows[3].base.version=2;await assert.rejects(()=>f.api.validate(f.ids,31.5,44.5),/REGION_CHANGED_RETRY/);});
test('rejects hierarchy change',async()=>{const f=fixture();f.rows[2].base.parent_id='other';await assert.rejects(()=>f.api.validate(f.ids,31.5,44.5),/REGION_UNAVAILABLE/);});
test('published list keeps only Iraq delivery leaves and their ancestors',async()=>{
 class GetCommand{constructor(input){this.input=input;}}class QueryCommand{constructor(input){this.input=input;}}
 const bases=[{regionId:'iq',level:0,name_ar:'العراق',parent_id:'ROOT'},{regionId:'g',level:1,name_ar:'النجف',parent_id:'iq'},{regionId:'d',level:2,name_ar:'القضاء',parent_id:'g'},{regionId:'ok',level:3,name_ar:'متاح',parent_id:'d'},{regionId:'off',level:3,name_ar:'متوقف',parent_id:'d'}].map(r=>({...r,is_active:1,version:1}));
 const derived=bases.map(r=>({...r,effective_is_active:1,effective_config:{delivery:r.regionId!=='off'}}));let queried=false;
 const api=createRegions({sdk:{GetCommand,QueryCommand},resolveCoverage:async()=>null,db:{send:async c=>{if(c instanceof QueryCommand){queried=true;assert.equal(c.input.IndexName,'active-regions-index');return {Items:derived};}return {Item:(c.input.TableName===TABLES.regions?bases:derived).find(r=>r.regionId===c.input.Key.regionId)};}}});
 assert.deepEqual((await api.list()).items.map(r=>r.id),['iq','g','d','ok']);assert.ok(queried);
});
