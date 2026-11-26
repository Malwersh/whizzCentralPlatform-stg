'use strict';
const active = r => r && r.effective_config?.delivery!==false && (r.effective_is_active === true || r.effective_is_active === 1 || r.effective?.isActive === true);
const name = r => r.name_ar || r.name || '';
const date = at => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Baghdad',year:'numeric',month:'2-digit',day:'2-digit'}).format(at);
async function readDemand({db,GetCommand,tables,driverId,now=new Date(),simulationDrivers=[]}) {
 const get=async(table,key)=>(await db.send(new GetCommand({TableName:table,Key:key,ConsistentRead:true}))).Item;
 const driver=await get(tables.drivers,{driverId});
 if(!driver || driver.isDeleted || driver.deletedAt || driver.isBanned || driver.isSuspended) return {statusCode:403,result:{success:false,code:'DRIVER_UNAVAILABLE'}};
 const live=await get(tables.live,{driverId});
 const regionId=live?.isSearching===true && live.current_work_region_id ? live.current_work_region_id : driver.work_region_id || driver.home_region_id;
 const region=regionId ? await get(tables.regions,{regionId}) : null;
 const empty={success:true,state:'NO_REGION',timezone:'Asia/Baghdad',days:[]};
 if(!active(region) || Number(region.level)!==3) return {statusCode:200,result:empty};
 const district=region.parent_id ? await get(tables.regions,{regionId:region.parent_id}) : null;
 const area={id:regionId,name:name(region)};
 const dataset=tables.dataset==='TEST' && simulationDrivers.includes(driverId)?'SIMULATION':tables.dataset;
 if(!['TEST','LIVE','SIMULATION'].includes(dataset)) throw Error('INVALID_DEMAND_DATASET');
 const result={...empty,state:'INSUFFICIENT',area,sourceArea:area,isTestData:dataset!=='LIVE',days:[],generatedAt:null};
 if(!tables.demand) return {statusCode:200,result};
 const health=await get(tables.demand,{pk:'HEALTH#'+dataset,sk:'LATEST'});
 const fresh=at=>Number.isFinite(Date.parse(at)) && now-Date.parse(at)>=-300000 && now-Date.parse(at)<=7200000;
 if(!health || !fresh(health.completedAt)) return {statusCode:200,result:{...result,state:'UPDATING'}};
 const valid=s=>s && s.schemaVersion===1 && s.dataset===dataset && s.timezone==='Asia/Baghdad' && s.generatedAt===health.completedAt && fresh(s.generatedAt) && Array.isArray(s.days) && s.days.length===7;
 const today=date(now);
 const current=s=>valid(s) && s.days[0].date===today;
 const clean=s=>s.days.map(d=>({date:d.date,confidence:d.confidence,slots:d.confidence==='INSUFFICIENT'?[]:d.slots.map(v=>({hour:v.hour,score:v.score,level:v.level}))}));
 let snapshot=await get(tables.demand,{pk:'FORECAST#'+dataset+'#'+regionId,sk:'LATEST'});
 if(!current(snapshot)){
  const previousDay=date(new Date(now.getTime()-86400000));
  const verifiedInsufficient=valid(snapshot) && snapshot.days[0].date===previousDay &&
    snapshot.days[1].date===today && snapshot.days.every(day=>day.confidence==='INSUFFICIENT');
  if(verifiedInsufficient){
   if(active(district) && Number(district.level)===2){
    const wider=await get(tables.demand,{pk:'FORECAST#'+dataset+'#'+district.regionId,sk:'LATEST'});
    if(!valid(wider) || wider.days.some(day=>day.confidence!=='INSUFFICIENT')){
     return {statusCode:200,result:{...result,state:'UPDATING'}};
    }
   }
   return {statusCode:200,result:{...result,generatedAt:snapshot.generatedAt,days:clean(snapshot).slice(1)}};
  }
  return {statusCode:200,result:{...result,state:'UPDATING'}};
 }
 if(!snapshot.days.some(d=>d.confidence!=='INSUFFICIENT') && active(district) && Number(district.level)===2) {
  const wider=await get(tables.demand,{pk:'FORECAST#'+dataset+'#'+district.regionId,sk:'LATEST'});
  if(current(wider) && wider.days.some(d=>d.confidence!=='INSUFFICIENT')) { snapshot=wider;result.sourceArea={id:district.regionId,name:name(district)};result.isWiderArea=true; }
 }
 return {statusCode:200,result:{...result,state:snapshot.days.some(d=>d.confidence!=='INSUFFICIENT')?'READY':'INSUFFICIENT',generatedAt:snapshot.generatedAt,days:clean(snapshot)}};
}
module.exports={readDemand};
