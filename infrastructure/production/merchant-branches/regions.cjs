'use strict';
const {createHash}=require('node:crypto');
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v)??'null';
const TABLES=Object.freeze({regions:'wizz-production-Regions',derived:'wizz-production-RegionsDerived',index:'wizz-production-RegionIndex'});
const enabled=v=>[true,1,'1','true'].includes(v);
const fail=code=>Object.assign(Error(code),{code,status:409});
function createRegions({db,sdk,resolveCoverage}){
 if(typeof resolveCoverage!=='function')throw Error('COVERAGE_RESOLVER_REQUIRED');
 const read=async(table,regionId)=>(await db.send(new sdk.GetCommand({TableName:table,Key:{regionId},ConsistentRead:true}))).Item;
 return {async list(){
  const candidates=[];let cursor;
  do{const page=await db.send(new sdk.QueryCommand({TableName:TABLES.derived,IndexName:'active-regions-index',KeyConditionExpression:'effective_is_active=:active',ExpressionAttributeValues:{':active':1},ExclusiveStartKey:cursor,Limit:100}));candidates.push(...page.Items||[]);cursor=page.LastEvaluatedKey;if(candidates.length>1000)throw fail('REGION_CATALOG_CAPACITY');}while(cursor);
  const rows=new Map();
  // Re-read authoritative rows; index entries can lag a publication.
  for(let offset=0;offset<candidates.length;offset+=10)await Promise.all(candidates.slice(offset,offset+10).map(async candidate=>{const [base,derived]=await Promise.all([read(TABLES.regions,candidate.regionId),read(TABLES.derived,candidate.regionId)]);if(base&&derived&&enabled(base.is_active)&&!base.archived&&enabled(derived.effective_is_active)&&Number.isInteger(base.version)&&base.version>=1&&Number.isInteger(derived.version)&&derived.version>=1&&typeof (base.name_ar||base.name)==='string')rows.set(base.regionId,{base,derived});}));
  const result=[],included=new Set();
  for(let level=0;level<4;level++)for(const {base,derived} of rows.values()){
   if(Number(base.level)!==level)continue;
   if(level===0){if(base.parent_id&&!['ROOT','root'].includes(base.parent_id))continue;if(!['IQ','IRQ'].includes(String(base.country_code||base.code||'').toUpperCase())&&!/^(العراق|iraq)$/i.test(base.name_ar||base.name||''))continue;}
   else if(!included.has(base.parent_id))continue;
   if(level===3){const d=derived.effective_config?.delivery;if(!enabled(d)&&!(d&&typeof d==='object'&&!Array.isArray(d)&&(d.enabled===undefined||enabled(d.enabled))&&(d.available===undefined||enabled(d.available))))continue;}
   included.add(base.regionId);result.push({id:base.regionId,level,parentId:base.parent_id||null,labelAr:base.name_ar||base.name});
  }
  const needed=new Set(result.filter(r=>r.level===3).map(r=>r.id));for(let level=3;level>0;level--)for(const r of result)if(r.level===level&&needed.has(r.id))needed.add(r.parentId);
  return {items:result.filter(r=>needed.has(r.id)).sort((a,b)=>a.level-b.level||a.labelAr.localeCompare(b.labelAr,'ar'))};
 },async validate(regionPath,latitude,longitude){
  if(!Array.isArray(regionPath)||regionPath.length!==4||new Set(regionPath).size!==4||regionPath.some(x=>typeof x!=='string'||!x||x.length>100))throw fail('REGION_PATH_REQUIRED');
  const coverage=await resolveCoverage({latitude,longitude});
  if(!coverage||JSON.stringify(coverage.regionPath)!==JSON.stringify(regionPath))throw fail('LOCATION_OUTSIDE_REGION');
  const rows=await Promise.all(regionPath.map(async id=>{const [base,derived]=await Promise.all([read(TABLES.regions,id),read(TABLES.derived,id)]);return {base,derived};}));
  const names=[],checks=[];
  rows.forEach(({base,derived},level)=>{
   if(!base||!derived||base.regionId!==regionPath[level]||derived.regionId!==base.regionId||Number(base.level)!==level||!enabled(base.is_active)||base.archived||!enabled(derived.effective_is_active)||(level>0?base.parent_id!==regionPath[level-1]:base.parent_id&&!['ROOT','root'].includes(base.parent_id)))throw fail('REGION_UNAVAILABLE');
   if(level===0&&!['IQ','IRQ'].includes(String(base.country_code||base.code||'').toUpperCase())&&!/^(العراق|iraq)$/i.test(base.name_ar||base.name||''))throw fail('REGION_UNAVAILABLE');
   if(level===3){const delivery=derived.effective_config?.delivery;if(!enabled(delivery)&&!(delivery&&typeof delivery==='object'&&!Array.isArray(delivery)&&(delivery.enabled===undefined||enabled(delivery.enabled))&&(delivery.available===undefined||enabled(delivery.available))))throw fail('REGION_DELIVERY_UNAVAILABLE');}
   names.push(base.name_ar||base.name);
   for(const [table,row,active] of [[TABLES.regions,base,'is_active'],[TABLES.derived,derived,'effective_is_active']]){
    // Require versions so geometry, hierarchy and delivery changes invalidate submission.
    if(!Number.isInteger(row.version)||row.version<1)throw fail('REGION_VERSION_REQUIRED');
    checks.push({ConditionCheck:{TableName:table,Key:{regionId:row.regionId},ConditionExpression:'#v=:v AND #a=:a',ExpressionAttributeNames:{'#v':'version','#a':active},ExpressionAttributeValues:{':v':row.version,':a':row[active]}}});
   }
  });
  const proof=rows.map(({base,derived})=>({id:base.regionId,level:base.level,parentId:base.parent_id??null,active:base.is_active,effectiveActive:derived.effective_is_active,version:base.version??null,derivedVersion:derived.version??null}));
  const g=rows[3].base.geometry,geometry={type:g?.type,coordinates:g?.coordinates};
  const digest=createHash('sha256').update(canonical({schemaVersion:1,proof,geometry})).digest('hex');
  if(digest!==coverage.referenceVersion)throw fail('REGION_CHANGED_RETRY');
  return {regionId:regionPath[3],regionNames:names,checks};
 }};
}
module.exports={createRegions,TABLES};
