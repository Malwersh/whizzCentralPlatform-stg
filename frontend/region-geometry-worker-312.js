'use strict';
importScripts('./region-geometry-runtime-312.js?v=323');
onmessage=function(event){
 const {token,region,regions,preview}=event.data;
 try{
  const result=preview?RegionGeometry312.preview(region,regions,preview.sketch):RegionGeometry312.validate(region,regions);
  postMessage({token,result});
 }catch{postMessage({token,result:{valid:false,errors:[{code:'GEOMETRY_INVALID',message:'تعذر التحقق من الحدود. أعد المحاولة.'}],highlights:[]}});}
};
