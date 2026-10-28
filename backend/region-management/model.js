'use strict';
const {createHash}=require('crypto');
const geo=require('./geometry');
const h3=require('h3-js');
const {feature,featureCollection}=require('@turf/helpers');
const {lineOverlap}=require('@turf/line-overlap');
const {polygonToLine}=require('@turf/polygon-to-line');
const {length}=require('@turf/length');
const INPUT=['regionId','name','name_ar','level','parent_id','is_active','geometry','service_config','delivery_config','archived'];
const editable=r=>Object.fromEntries(INPUT.filter(k=>r[k]!==undefined).map(k=>[k,r[k]]));
const FIELDS=['regionId','name','name_ar','level','parent_id','is_active','geometry','version','service_config','delivery_config','self_pricing','self_limits','override_parent_active','archived','publicationId','indexPublicationId','_regionPublication'];
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v);
const clone=v=>JSON.parse(JSON.stringify(v));
function canonical(v){if(v===undefined)return 'null';if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';if(v&&typeof v==='object')return '{'+Object.keys(v).filter(k=>v[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';return JSON.stringify(v);}
const digest=v=>createHash('sha256').update(canonical(v)).digest('hex');
const fail=(code,status=400,details)=>Object.assign(Error(code),{code,status,...(details?{details}:{})});
const enabled=v=>[true,1,'1','true'].includes(v);
const version=r=>Number.isSafeInteger(r?.version)?r.version:0;
const reference=r=>Object.fromEntries(FIELDS.filter(k=>r[k]!==undefined).map(k=>[k,r[k]]));
const catalogDigest=rows=>digest(rows.map(reference).sort((a,b)=>a.regionId.localeCompare(b.regionId)));
function normalize(raw,old){
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(k=>!['regionId','name','name_ar','level','parent_id','is_active','geometry','service_config','delivery_config','archived'].includes(k)))throw fail('REGION_INPUT_INVALID');
 if(!id(raw.regionId)||![0,1,2,3].includes(raw.level)||typeof raw.is_active!=='boolean')throw fail('REGION_INPUT_INVALID');
 for(const key of ['name','name_ar'])if(typeof raw[key]!=='string'||!raw[key].trim()||raw[key].length>120)throw fail('REGION_NAME_REQUIRED');
 if(raw.parent_id!==null&&!id(raw.parent_id))throw fail('REGION_PARENT_INVALID');
 if(old&&(Number(old.level)!==raw.level||(old.parent_id||null)!==raw.parent_id))throw fail(Number(old.level)!==raw.level?'LEVEL_IMMUTABLE':'PARENT_MOVE_REVIEW_REQUIRED');
 const structure=geo.inspect(raw.geometry);if(!structure.valid)throw fail(structure.errors[0].code,400,structure);
 const services=raw.service_config??old?.service_config??{};
 if(!services||typeof services!=='object'||Array.isArray(services)||Object.keys(services).some(k=>!['delivery','pickup','dineIn'].includes(k)||typeof services[k]!=='boolean'))throw fail('REGION_SERVICE_INVALID');
 const delivery=raw.delivery_config??old?.delivery_config??{};
 if(!delivery||typeof delivery!=='object'||Array.isArray(delivery)||Object.keys(delivery).some(k=>!['estimated_time_minutes','base_fee','minimum_order'].includes(k)||!Number.isFinite(delivery[k])||delivery[k]<0||delivery[k]>10000000))throw fail('REGION_DELIVERY_INVALID');
 if(delivery.estimated_time_minutes!==undefined&&(!Number.isInteger(delivery.estimated_time_minutes)||delivery.estimated_time_minutes<1||delivery.estimated_time_minutes>1440))throw fail('REGION_DELIVERY_INVALID');
 if(raw.archived!==undefined&&typeof raw.archived!=='boolean')throw fail('REGION_INPUT_INVALID');
 const next={...(old?reference(old):{}),...clone(raw),geometry:{type:raw.geometry.type,coordinates:clone(raw.geometry.coordinates)},name:raw.name.trim(),name_ar:raw.name_ar.trim(),service_config:clone(services),delivery_config:clone(delivery)};
 if(next.archived)next.is_active=false;
 return next;
}
const geometryChanged=(old,next)=>!old||digest(old.geometry)!==digest(next.geometry);
function validatePlan(base,changes){
 const old=new Map(base.map(r=>[r.regionId,r])),next=new Map(base.map(r=>[r.regionId,r]));for(const r of changes)next.set(r.regionId,r);
 const rows=[...next.values()],errors=[],highlights=[];
 for(const r of changes){
  const previous=old.get(r.regionId),needsGeometry=geometryChanged(previous,r)||(!enabled(previous?.is_active)&&enabled(r.is_active));
  // Existing imperfect boundaries are reported, but stopping a service must not
  // require redrawing geography or silently alter its coordinates.
  if(needsGeometry){const result=geo.validate(r,rows.filter(x=>x.regionId!==r.regionId).concat(previous?[previous]:[]));for(const e of result.errors)errors.push({...e,editedRegionId:r.regionId});highlights.push(...result.highlights);}
  const chain=[];let node=r;
  for(let expected=r.level;expected>=0;expected--){if(!node||Number(node.level)!==expected||chain.includes(node.regionId)){errors.push({code:'REGION_HIERARCHY_INVALID',editedRegionId:r.regionId});break;}chain.push(node.regionId);if(expected===0){if(node.parent_id)errors.push({code:'REGION_HIERARCHY_INVALID',editedRegionId:r.regionId});break;}node=next.get(node.parent_id);}
  for(const other of rows){if(other.regionId===r.regionId||other.level!==r.level||(other.parent_id||null)!==(r.parent_id||null))continue;if(other.name?.trim().toLowerCase()===r.name.toLowerCase()||other.name_ar?.trim()===r.name_ar)errors.push({code:'DUPLICATE_NAME',editedRegionId:r.regionId,regionId:other.regionId,message:geo.labels.DUPLICATE_NAME});}
 }
 return {valid:errors.length===0,errors,highlights,rows};
}
function chainFor(r,byId){const chain=[];for(let expected=Number(r.level);expected>=0;expected--){if(!r||Number(r.level)!==expected||chain.some(n=>n.regionId===r.regionId))throw fail('REGION_HIERARCHY_INVALID');chain.push(r);r=byId.get(r.parent_id);}return chain;}
function derive(r,rows,previous={},at,derivedRows=[]){
 const chain=chainFor(r,new Map(rows.map(x=>[x.regionId,x]))),config={};
 for(const n of [...chain].reverse()){
  for(const [key,value]of Object.entries(n.service_config||{}))config[key]=clone(value);
  if(n.delivery_config&&(config.delivery===true||config.delivery&&typeof config.delivery==='object'))config.delivery={...(typeof config.delivery==='object'?config.delivery:{}),...n.delivery_config};
 }
 const nearest=field=>chain.find(n=>n[field]&&Object.keys(n[field]).length)?.[field];
 const parentDerived=field=>chain.slice(1).map(n=>derivedRows.find(d=>d.regionId===n.regionId)?.[field]).find(v=>v!==undefined);
 return {...previous,regionId:r.regionId,parent_id:r.parent_id||'ROOT',level:r.level,name:r.name,name_ar:r.name_ar,
  effective_is_active:chain.every(n=>enabled(n.is_active)&&!n.archived)?1:0,effective_config:config,
  effective_pricing:nearest('self_pricing')??previous.effective_pricing??parentDerived('effective_pricing')??{},effective_limits:nearest('self_limits')??previous.effective_limits??parentDerived('effective_limits')??{},
  inheritance_chain:chain.map(n=>n.regionId),computed_at:at,version:r.version,publicationId:r.publicationId};
}
function indexCells(region){
 if(region.level!==3)return {resolution:null,cells:[]};
 const polygons=region.geometry.type==='Polygon'?[region.geometry.coordinates]:region.geometry.coordinates;
 // Match all supported resolver resolutions. Never silently truncate a region.
 for(const resolution of [9,8,7,6]){
  if(require('@turf/area').area(feature(region.geometry))/h3.getHexagonAreaAvg(resolution,'m2')>50000)continue;
  const cells=new Set();for(const polygon of polygons)for(const cell of h3.polygonToCellsExperimental(polygon,resolution,h3.POLYGON_TO_CELLS_FLAGS.containmentOverlapping,true)){cells.add(cell);if(cells.size>65000)break;}
  if(cells.size<=60000&&cells.size>0)return {resolution,cells:[...cells].sort()};
 }
 throw fail('REGION_INDEX_TOO_LARGE');
}
function lines(geometry){return (geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates).map(coordinates=>polygonToLine(feature({type:'Polygon',coordinates})));}
function neighbor(a,b,rows){
 let km=0;for(const x of lines(a.geometry))for(const y of lines(b.geometry))for(const segment of lineOverlap(x,y,{tolerance:0}).features)km+=length(segment,{units:'kilometers'});
 if(km<0.001)return null;
 const byId=new Map(rows.map(r=>[r.regionId,r])),ac=chainFor(a,byId),bc=chainFor(b,byId),sameDistrict=a.parent_id===b.parent_id,sameGovernorate=ac[2]?.regionId===bc[2]?.regionId;
 const priority=sameDistrict?(km>=5?0:1):sameGovernorate&&km>=8?1:2;
 return {shared_boundary_km:km,expansion_priority:priority,relationship_type:'adjacent'};
}
function neighborChanges(base,changes,rows,existing,publicationId,at){
 const affected=new Set(changes.filter(r=>r.level===3&&geometryChanged(base.find(x=>x.regionId===r.regionId),r)).map(r=>r.regionId));
 const wanted=new Map();for(const a of rows.filter(r=>r.level===3))for(const b of rows.filter(r=>r.level===3&&r.regionId>a.regionId)){
  if(!affected.has(a.regionId)&&!affected.has(b.regionId))continue;
  const rel=neighbor(a,b,rows);if(!rel)continue;
  for(const [s,t]of [[a,b],[b,a]]){const pair=s.regionId+'#'+t.regionId;wanted.set(pair,{neighbor_pair_id:pair,source_region_id:s.regionId,target_region_id:t.regionId,source_level:3,target_level:3,source_parent_id:s.parent_id,target_parent_id:t.parent_id,source_region_name:s.name,target_region_name:t.name,...rel,publicationId,discovered_at:at});}
 }
 return {puts:[...wanted.values()],deletes:existing.filter(n=>(affected.has(n.source_region_id)||affected.has(n.target_region_id))&&!wanted.has(n.neighbor_pair_id))};
}
module.exports={INPUT,editable,FIELDS,id,clone,canonical,digest,reference,version,catalogDigest,normalize,geometryChanged,validatePlan,derive,indexCells,neighborChanges,fail,enabled};
