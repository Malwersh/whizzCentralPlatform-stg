'use strict';
const {ScanCommand,GetCommand}=require('@aws-sdk/lib-dynamodb');
const BASE='WizzCentral_Regions',DERIVED='WizzCentral_RegionsDerived_staging';
const fail=code=>Object.assign(Error(code),{status:400});
const enabled=v=>v===true||v===1||v==='1'||v==='true';
async function scan(db,table,projection,names){let items=[],cursor;do{const page=await db.send(new ScanCommand({TableName:table,ConsistentRead:true,ExclusiveStartKey:cursor,ProjectionExpression:projection,...(Object.keys(names).length?{ExpressionAttributeNames:names}:{})}));items.push(...page.Items||[]);cursor=page.LastEvaluatedKey;if(items.length>20000)throw Object.assign(Error('REGIONS_TOO_LARGE'),{status:503});}while(cursor);return items;}
function hierarchy(base,derived=[]){
 const effective=new Map(derived.map(r=>[r.regionId,r]));const rows=new Map(base.map(r=>[r.regionId,r]));
 function available(r,seen=new Set()){
  if(!r||seen.has(r.regionId)||!enabled(r.is_active))return false;
  seen.add(r.regionId);const d=effective.get(r.regionId);if(d&&d.effective_is_active!==undefined&&!enabled(d.effective_is_active))return false;
  const level=Number(r.level);if(!Number.isInteger(level)||level<0||level>3)return false;
  if(level===0)return !r.parent_id;
  const parent=rows.get(r.parent_id);return Number(parent?.level)===level-1&&available(parent,seen);
 }
 return [...rows.values()].filter(r=>available(r)).map(r=>({id:r.regionId,labelAr:r.name_ar||r.name,labelEn:r.name||r.name_ar,level:Number(r.level),parentId:r.parent_id||null})).sort((a,b)=>a.level-b.level||a.labelAr.localeCompare(b.labelAr,'ar'));
}
async function list(db){const [base,derived]=await Promise.all([scan(db,BASE,'regionId, #level, parent_id, #name, name_ar, is_active',{'#level':'level','#name':'name'}),scan(db,DERIVED,'regionId, effective_is_active',{})]);return {items:hierarchy(base,derived)};}
function path(items,ids){
 if(!Array.isArray(ids)||ids.length!==4||ids.some(id=>typeof id!=='string'||!id||id.length>100)||new Set(ids).size!==4)throw fail('REGION_PATH_REQUIRED');
 const selected=ids.map(id=>items.find(r=>r.id===id));
 if(selected.some((r,i)=>!r||r.level!==i||(i>0&&r.parentId!==ids[i-1])))throw fail('REGION_UNAVAILABLE');
 return {regionPath:ids,regionId:ids[3],countryId:ids[0],governorateId:ids[1],districtId:ids[2],regionNames:selected.map(r=>r.labelAr)};
}
function insideRing(point,ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const [x,y]=ring[i].map(Number),[px,py]=ring[j].map(Number);if(![x,y,px,py].every(Number.isFinite))throw fail('REGION_GEOMETRY_INVALID');if(((y>point[1])!==(py>point[1]))&&(point[0]<(px-x)*(point[1]-y)/(py-y)+x))inside=!inside;}return inside;}
function contains(geometry,latitude,longitude){
 if(typeof latitude!=='number'||typeof longitude!=='number'||!Number.isFinite(latitude)||!Number.isFinite(longitude)||Math.abs(latitude)>90||Math.abs(longitude)>180)throw fail('INVALID_LOCATION');
 const polys=geometry?.type==='Polygon'?[geometry.coordinates]:geometry?.type==='MultiPolygon'?geometry.coordinates:null;
 if(!Array.isArray(polys)||!polys.length)throw fail('REGION_GEOMETRY_UNAVAILABLE');
 return polys.some(p=>Array.isArray(p)&&p.length>0&&insideRing([longitude,latitude],p[0])&&!p.slice(1).some(r=>insideRing([longitude,latitude],r)));
}
async function validate(db,ids,latitude,longitude){
 const selection=path((await list(db)).items,ids),checks=[];
 const rows=await Promise.all(ids.map(async id=>({base:(await db.send(new GetCommand({TableName:BASE,Key:{regionId:id},ConsistentRead:true}))).Item,derived:(await db.send(new GetCommand({TableName:DERIVED,Key:{regionId:id},ConsistentRead:true}))).Item})));
 for(let i=0;i<rows.length;i++){
  const {base,derived}=rows[i];if(!base||!enabled(base.is_active)||Number(base.level)!==i||(i&&base.parent_id!==ids[i-1])||(derived?.effective_is_active!==undefined&&!enabled(derived.effective_is_active)))throw fail('REGION_UNAVAILABLE');
  checks.push({ConditionCheck:{TableName:BASE,Key:{regionId:ids[i]},ConditionExpression:'#a=:a'+(i?' AND #p=:p':''),ExpressionAttributeNames:{'#a':'is_active',...(i?{'#p':'parent_id'}:{})},ExpressionAttributeValues:{':a':base.is_active,...(i?{':p':ids[i-1]}:{})}}});
  if(derived?.effective_is_active!==undefined)checks.push({ConditionCheck:{TableName:DERIVED,Key:{regionId:ids[i]},ConditionExpression:'#a=:a',ExpressionAttributeNames:{'#a':'effective_is_active'},ExpressionAttributeValues:{':a':derived.effective_is_active}}});
 }
 if(!contains(rows[3].base.geometry,latitude,longitude))throw fail('LOCATION_OUTSIDE_REGION');return {...selection,checks};
}

module.exports={list,hierarchy,path,contains,validate,BASE,DERIVED};
