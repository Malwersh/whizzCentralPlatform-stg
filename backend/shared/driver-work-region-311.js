'use strict';
// Authoritative work-region permission. A driver's historical tier and live-state
// allowed_region_ids are deliberately not authorization inputs.
const TABLES={base:'WizzCentral_Regions',derived:'WizzCentral_RegionsDerived_staging',neighbors:'WizzCentral_RegionNeighbors_staging'};
const enabled=v=>v===true||v===1||v==='1'||v==='true';
const validId=v=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,150}$/.test(v);
const enforced=()=>process.env.DRIVER_WORK_REGION_ENFORCE==='true';
const error=code=>Object.assign(Error(code),{code});
function contains(shape,lat,lng){
 if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180||!shape||!['Polygon','MultiPolygon'].includes(shape.type))return false;
 const polygons=shape.type==='Polygon'?[shape.coordinates]:shape.coordinates;
 if(!Array.isArray(polygons)||!polygons.length)return false;
 let count=0;
 function ring(points){
  if(!Array.isArray(points)||points.length<4)throw error('DRIVER_REGION_GEOMETRY_INVALID');
  if(JSON.stringify(points[0])!==JSON.stringify(points.at(-1)))throw error('DRIVER_REGION_GEOMETRY_INVALID');
  let inside=false;
  for(let i=0,j=points.length-1;i<points.length;j=i++){
   const a=points[i],b=points[j];
   if(++count>50000||![a,b].every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=180&&Math.abs(p[1])<=90))throw error('DRIVER_REGION_GEOMETRY_INVALID');
   const cross=(lng-a[0])*(b[1]-a[1])-(lat-a[1])*(b[0]-a[0]);
   if(Math.abs(cross)<1e-12&&lng>=Math.min(a[0],b[0])&&lng<=Math.max(a[0],b[0])&&lat>=Math.min(a[1],b[1])&&lat<=Math.max(a[1],b[1]))return -1;
   if((a[1]>lat)!==(b[1]>lat)&&lng<(b[0]-a[0])*(lat-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }
  return inside?1:0;
 }
 try{let found=false;for(const polygon of polygons){if(!Array.isArray(polygon)||!polygon.length)return false;const outer=ring(polygon[0]);if(outer===-1)return false;let hole=false;for(const h of polygon.slice(1)){const r=ring(h);if(r===-1)return false;if(r===1)hole=true;}if(outer===1&&!hole)found=true;}return found;}catch{return false;}
}
function create({db,GetCommand,tables=TABLES}){
 // Request-local only. Each new preparation/acceptance re-reads the sources.
 const reads=new Map();
 const baseFields=['regionId','level','parent_id','is_active','version'];
 const derivedFields=['regionId','effective_is_active','effective_config','version'];
 async function read(table,key,fields){
  const memo=table+JSON.stringify(key)+fields.join(',');
  if(!reads.has(memo))reads.set(memo,(async()=>{
   try{const names=Object.fromEntries(fields.map((v,i)=>['#r'+i,v]));const row=(await db.send(new GetCommand({TableName:table,Key:key,ConsistentRead:true,ProjectionExpression:Object.keys(names).join(','),ExpressionAttributeNames:names}))).Item;
    const values={},terms=[];for(const [alias,name]of Object.entries(names)){if(row?.[name]===undefined)terms.push('attribute_not_exists('+alias+')');else{const token=':v'+alias.slice(2);values[token]=row[name];terms.push(alias+'='+token);}}
    return {row,guard:{ConditionCheck:{TableName:table,Key:key,ConditionExpression:terms.join(' AND '),ExpressionAttributeNames:names,...(Object.keys(values).length?{ExpressionAttributeValues:values}:{})}}};
   }catch{throw error('DRIVER_REGION_REFERENCE_UNAVAILABLE');}
  })());return reads.get(memo);
 }
 async function region(id,guards){
  if(!validId(id))return false;
  let next=id;
  for(let level=3;level>=0;level--){
   const [a,b]=await Promise.all([read(tables.base,{regionId:next},baseFields),read(tables.derived,{regionId:next},derivedFields)]);
   guards.push(a.guard,b.guard);
   if(a.row?.regionId!==next||b.row?.regionId!==next||Number(a.row.level)!==level||!enabled(a.row.is_active)||!enabled(b.row.effective_is_active)||b.row.effective_config?.delivery===false)return false;
   if(level===0)return !a.row.parent_id||['root','ROOT'].includes(a.row.parent_id);
   next=a.row.parent_id;if(!validId(next))return false;
  }
  return false;
 }
 async function relation(source,target,priority,guards){
  if(source===target)return true;
  const pair=source+'#'+target;
  const r=await read(tables.neighbors,{neighbor_pair_id:pair},['neighbor_pair_id','source_region_id','target_region_id','source_level','target_level','expansion_priority']);
  guards.push(r.guard);const n=r.row;
  return n?.neighbor_pair_id===pair&&n.source_region_id===source&&n.target_region_id===target&&n.source_level===3&&n.target_level===3&&[0,1].includes(n.expansion_priority)&&n.expansion_priority<=priority;
 }
 return {async check(profile,current,target,priority=1,point){
  const guards=[];const work=profile?.work_region_id;
  if(![work,current,target].every(validId)||![0,1].includes(priority))return {allowed:false,code:'DRIVER_WORK_REGION_REQUIRED',guards:[]};
  for(const id of new Set([work,current,target]))if(!await region(id,guards))return {allowed:false,code:'DRIVER_WORK_REGION_CLOSED',guards:[]};
  if(!await relation(work,current,1,guards)||!await relation(work,target,1,guards)||!await relation(current,target,priority,guards))return {allowed:false,code:'DRIVER_WORK_REGION_NOT_ALLOWED',guards:[]};
  if(point){const shape=await read(tables.base,{regionId:current},['geometry']);guards.push(shape.guard);if(!contains(shape.row?.geometry,point.lat,point.lng))return {allowed:false,code:'DRIVER_REGION_POSITION_MISMATCH',guards:[]};}
  // Deduplicate hierarchy/edge reads and merge the geometry predicate on its base item.
  const unique=new Map();
  for(const g of guards){const c=g.ConditionCheck,k=c.TableName+JSON.stringify(c.Key);let item=unique.get(k);if(!item){item={table:c.TableName,key:c.Key,fields:{}};unique.set(k,item);}
   for(const [alias,name]of Object.entries(c.ExpressionAttributeNames)){const token=':v'+alias.slice(2);item.fields[name]=c.ExpressionAttributeValues?.[token];}
  }
  const combined=[...unique.values()].map(item=>{const names={},values={},terms=[];Object.entries(item.fields).forEach(([name,value],i)=>{const alias='#g'+i;names[alias]=name;if(value===undefined)terms.push('attribute_not_exists('+alias+')');else{const token=':g'+i;values[token]=value;terms.push(alias+'='+token);}});return {ConditionCheck:{TableName:item.table,Key:item.key,ConditionExpression:terms.join(' AND '),ExpressionAttributeNames:names,...(Object.keys(values).length?{ExpressionAttributeValues:values}:{})}};});
  const targetPriority=current===target?0:(await read(tables.neighbors,{neighbor_pair_id:current+'#'+target},['neighbor_pair_id','source_region_id','target_region_id','source_level','target_level','expansion_priority'])).row.expansion_priority;
  return {allowed:true,code:'ELIGIBLE',priority:targetPriority,guards:combined};
 }};
}
module.exports={TABLES,enforced,create,contains};
