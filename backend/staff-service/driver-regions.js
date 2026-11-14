(function(root){
 function hierarchy(base,derived){
  const states=new Map(derived.map(r=>[r.regionId,r]));
  const rows=base.map(r=>({...r,...(states.get(r.regionId)||{})}));
  const byId=new Map(rows.map(r=>[r.regionId,r]));
  const active=r=>r && (r.effective_is_active===1||r.effective_is_active===true||r.effective?.isActive===true);
  const name=r=>r?.name_ar||r?.name||r?.regionId||'';
  const regions=rows.filter(r=>Number(r.level)===3).map(r=>{const district=byId.get(r.parent_id),gov=byId.get(district?.parent_id);return {...r,governorateId:gov?.regionId,districtId:district?.regionId,districtName:name(district),displayName:name(r),open:active(r)&&active(district)&&active(gov)&&active(byId.get(gov?.parent_id))&&r.effective_config?.delivery!==false};}).filter(r=>r.governorateId);
  return {regions,governorates:rows.filter(r=>Number(r.level)===1).map(r=>({...r,displayName:name(r)})),byId};
 }
 function updateValues(profile,selection,model){
  const region=model.regions.find(r=>r.regionId===selection.regionId&&r.governorateId===selection.governorateId);
  if(!region)throw Error('اختر محافظة ومنطقة عمل مرتبطة بها');
  if(!region.open && region.regionId!==profile.work_region_id)throw Error('منطقة العمل غير مفتوحة');
  if(profile.isOnline===true && region.regionId!==profile.work_region_id)throw Error('يجب أن يكون السائق غير متصل قبل تغيير منطقة العمل');
  if(!['car','motorcycle'].includes(selection.vehicleType))throw Error('اختر نوع المركبة');
  const gov=model.byId.get(region.governorateId);
  return {name:selection.name.trim(),vehicleType:selection.vehicleType,governorate_id:gov.regionId,governorate_name:gov.name_ar||gov.name,work_region_id:region.regionId,work_region_name:region.displayName,home_region_id:region.regionId,home_region_name:region.displayName,parent_district_id:region.districtId,parent_district_name:region.districtName,city:gov.name_ar||gov.name,home_address_text:selection.landmark.trim()};
 }
 const api={hierarchy,updateValues};if(typeof module!=='undefined')module.exports=api;else root.DriverRegions=api;
})(typeof window!=='undefined'?window:globalThis);
