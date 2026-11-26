'use strict';
function registrationOptions(rows) {
 const byId=new Map(rows.map(r=>[r.regionId,r]));
 const active=r=>r && (r.effective_is_active===1||r.effective_is_active===true||r.effective?.isActive===true);
 const country=rows.find(r=>Number(r.level)===0&&(r.name_ar==='العراق'||String(r.name).toLowerCase()==='iraq'));
 if(!country||!active(country))throw new Error('Iraq registration unavailable');
 const regions=[];
 for(const row of rows){
  if(Number(row.level)!==3||!active(row)||row.effective_config?.delivery===false)continue;
  const district=byId.get(row.parent_id),governorate=byId.get(district?.parent_id);
  if(Number(district?.level)!==2||Number(governorate?.level)!==1||governorate.parent_id!==country.regionId||!active(district)||!active(governorate))continue;
  regions.push({regionId:row.regionId,name:row.name_ar||row.name,governorateId:governorate.regionId,districtId:district.regionId,districtName:district.name_ar||district.name});
 }
 const ids=new Set(regions.map(r=>r.governorateId));
 const governorates=rows.filter(r=>ids.has(r.regionId)).map(r=>({regionId:r.regionId,name:r.name_ar||r.name}));
 return {country:{regionId:country.regionId,name:'العراق',code:'IQ'},governorates,regions};
}
function validateRegistration(body,options){
 if(!['car','motorcycle'].includes(body.vehicleType))throw new Error('Invalid vehicle type');
 const region=options.regions.find(r=>r.regionId===body.work_region_id&&r.governorateId===body.governorate_id);
 if(!region)throw new Error('Invalid work region');
 return {...body,profileSchemaVersion:2,country_id:options.country.regionId,country_code:'IQ',country_name:'العراق',governorate_name:options.governorates.find(g=>g.regionId===region.governorateId).name,work_region_name:region.name,home_region_id:region.regionId,home_region_name:region.name,parent_district_id:region.districtId,parent_district_name:region.districtName};
}
module.exports={registrationOptions,validateRegistration};
