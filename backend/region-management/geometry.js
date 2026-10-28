'use strict';
// Shared by the browser worker and the authoritative management service.
const {feature,featureCollection}=require('@turf/helpers');
const {area}=require('@turf/area');
const {booleanValid}=require('@turf/boolean-valid');
const {kinks}=require('@turf/kinks');
const {difference}=require('@turf/difference');
const {intersect}=require('@turf/intersect');
const MAX_VERTICES=6000,MAX_GEOMETRY_BYTES=190000;
const labels={GEOMETRY_REQUIRED:'ارسم حدود المنطقة أولًا.',GEOMETRY_TYPE:'الحدود يجب أن تكون مضلعًا أو مجموعة مضلعات.',GEOMETRY_INVALID:'الحدود غير صالحة. راجع النقاط والثقوب وأجزاء المضلع.',GEOMETRY_SELF_INTERSECTION:'خط الحدود يتقاطع مع نفسه. صحّح نقاط التقاطع.',GEOMETRY_LIMIT:'الحدود شديدة التعقيد؛ قلّل عدد النقاط دون تغيير النطاق المقصود.',PARENT_REQUIRED:'اختر المنطقة الأب الصحيحة.',PARENT_LEVEL_INVALID:'مستوى المنطقة الأب غير صحيح.',OUTSIDE_PARENT:'جزء من الحدود خارج المنطقة الأب المختارة.',SIBLING_OVERLAP:'يوجد تداخل داخل مساحة منطقة أخرى من المستوى نفسه.',CHILD_OUTSIDE:'الحدود الجديدة تترك جزءًا من منطقة تابعة خارجها.',LEVEL_IMMUTABLE:'لا يمكن تغيير مستوى منطقة قائمة.',PARENT_MOVE_REVIEW_REQUIRED:'نقل منطقة قائمة إلى أب آخر يحتاج مراجعة أثر مستقلة.',DUPLICATE_NAME:'يوجد اسم مطابق في المستوى والأب نفسيهما.'};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const issue=(code,extra={})=>({code,message:labels[code]||code,...extra});
function inspect(geometry){
 const errors=[];if(!geometry)return {valid:false,errors:[issue('GEOMETRY_REQUIRED')],highlights:[]};
 if(!['Polygon','MultiPolygon'].includes(geometry.type))return {valid:false,errors:[issue('GEOMETRY_TYPE')],highlights:[]};
 let count=0;
 try{
  if(JSON.stringify(geometry).length>MAX_GEOMETRY_BYTES)throw 'GEOMETRY_LIMIT';
  const polygons=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;
  if(!Array.isArray(polygons)||!polygons.length)throw 'GEOMETRY_INVALID';
  for(const poly of polygons){if(!Array.isArray(poly)||!poly.length)throw 'GEOMETRY_INVALID';for(const ring of poly){
   if(!Array.isArray(ring)||ring.length<4||!same(ring[0],ring.at(-1)))throw 'GEOMETRY_INVALID';
   if(new Set(ring.slice(0,-1).map(p=>JSON.stringify(p))).size<3)throw 'GEOMETRY_INVALID';
   for(let i=0;i<ring.length;i++){const p=ring[i];if(++count>MAX_VERTICES)throw 'GEOMETRY_LIMIT';if(!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)||Math.abs(p[0])>180||Math.abs(p[1])>90||(i>0&&same(p,ring[i-1])))throw 'GEOMETRY_INVALID';}
  }}
  const f=feature(geometry),crossings=kinks(f);
  if(crossings.features.length)return {valid:false,errors:[issue('GEOMETRY_SELF_INTERSECTION')],highlights:crossings.features};
  if(!booleanValid(f)||!Number.isFinite(area(f))||area(f)<=0.1)throw 'GEOMETRY_INVALID';
  for(const poly of polygons){
   const shell=feature({type:'Polygon',coordinates:[poly[0]]});
   for(let i=1;i<poly.length;i++){
    const hole=feature({type:'Polygon',coordinates:[poly[i]]});
    const outside=difference(featureCollection([hole,shell]));if(outside&&area(outside)>0.01)throw 'GEOMETRY_INVALID';
    for(let j=1;j<i;j++){const overlap=intersect(featureCollection([hole,feature({type:'Polygon',coordinates:[poly[j]]})]));if(overlap&&area(overlap)>0.01)throw 'GEOMETRY_INVALID';}
   }
  }
  for(let i=0;i<polygons.length;i++)for(let j=0;j<i;j++){const a=feature({type:'Polygon',coordinates:polygons[i]}),b=feature({type:'Polygon',coordinates:polygons[j]});const overlap=intersect(featureCollection([a,b]));if(overlap&&area(overlap)>0.01)throw 'GEOMETRY_INVALID';}
  return {valid:true,errors:[],highlights:[],vertices:count,areaM2:area(f)};
 }catch(code){errors.push(issue(typeof code==='string'?code:'GEOMETRY_INVALID'));return {valid:false,errors,highlights:[]};}
}
function excess(a,b){const out=difference(featureCollection([feature(a),feature(b)]));return out&&area(out)>Math.max(0.01,area(feature(a))*1e-10)?out:null;}
function validate(region,regions,options={}){
 const result=inspect(region?.geometry);if(!result.valid)return result;
 const errors=[],highlights=[],byId=new Map(regions.map(r=>[r.regionId,r]));const old=byId.get(region.regionId);
 if(old&&Number(old.level)!==Number(region.level))errors.push(issue('LEVEL_IMMUTABLE'));
 if(old&&(old.parent_id||null)!==(region.parent_id||null))errors.push(issue('PARENT_MOVE_REVIEW_REQUIRED'));
 const parent=byId.get(region.parent_id);
 if(Number(region.level)>0){
  if(!parent)errors.push(issue('PARENT_REQUIRED'));
  else if(Number(parent.level)!==Number(region.level)-1)errors.push(issue('PARENT_LEVEL_INVALID'));
  else if(!inspect(parent.geometry).valid)errors.push(issue('GEOMETRY_INVALID',{regionId:parent.regionId,message:'حدود المنطقة الأب تحتاج تصحيحًا قبل نشر هذه المنطقة.'}));
  else try{const outside=excess(region.geometry,parent.geometry);if(outside){errors.push(issue('OUTSIDE_PARENT',{regionId:parent.regionId}));highlights.push(outside);}}catch{errors.push(issue('GEOMETRY_INVALID'));}
 }else if(region.parent_id)errors.push(issue('PARENT_LEVEL_INVALID'));
 for(const other of regions){if(other.regionId===region.regionId)continue;
  if(Number(other.level)===Number(region.level)){
   if((other.parent_id||null)===(region.parent_id||null)&&[other.name?.trim().toLowerCase(),other.name_ar?.trim()].some((n,i)=>n&&n===[region.name?.trim().toLowerCase(),region.name_ar?.trim()][i]))errors.push(issue('DUPLICATE_NAME',{regionId:other.regionId}));
   if(!inspect(other.geometry).valid)continue;
   try{const overlap=intersect(featureCollection([feature(region.geometry),feature(other.geometry)]));if(overlap&&area(overlap)>Math.max(0.01,Math.min(area(feature(region.geometry)),area(feature(other.geometry)))*1e-10)){errors.push(issue('SIBLING_OVERLAP',{regionId:other.regionId,regionName:other.name_ar||other.name}));highlights.push(overlap);}}catch{errors.push(issue('GEOMETRY_INVALID',{regionId:other.regionId}));}
  }
  if(other.parent_id===region.regionId&&inspect(other.geometry).valid)try{const out=excess(other.geometry,region.geometry);if(out){errors.push(issue('CHILD_OUTSIDE',{regionId:other.regionId,regionName:other.name_ar||other.name}));highlights.push(out);}}catch{errors.push(issue('GEOMETRY_INVALID'));}
 }
 return {...result,valid:errors.length===0,errors,highlights};
}
module.exports={inspect,validate,excess,labels,MAX_VERTICES,MAX_GEOMETRY_BYTES};
