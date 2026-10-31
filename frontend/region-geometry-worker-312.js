'use strict';
importScripts('./region-geometry-runtime-312.js?v=312');
onmessage=function(event){const {token,region,regions}=event.data;try{postMessage({token,result:RegionGeometry312.validate(region,regions)});}catch{postMessage({token,result:{valid:false,errors:[{code:'GEOMETRY_INVALID',message:'تعذر التحقق من الحدود. أعد المحاولة.'}],highlights:[]}});}};
