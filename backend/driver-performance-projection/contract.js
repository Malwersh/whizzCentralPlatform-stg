'use strict';
const POLICY='DRIVER_PERFORMANCE_PROJECTION_V1',TABLE='DriverPerformanceSnapshots_staging';
const validId=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,149}$/.test(v);
const validDate=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
function stateOf(row,health,now=Date.now()){
 if(!row?.snapshot||row.schemaVersion!==1||row.policyVersion!==POLICY||!validId(row.driverId)||row.pk!=='DRIVER#'+row.driverId||row.sk!=='STATE')return 'UNAVAILABLE';
 if(!Number.isSafeInteger(row.generation)||row.generation!==row.builtGeneration)return 'UPDATING';
 if(!validDate(row.validUntil)||Date.parse(row.validUntil)<=now)return 'STALE';
 if(!health||health.healthy!==true||health.policyVersion!==POLICY||!validDate(health.updatedAt)||Date.parse(health.updatedAt)>now+5000||now-Date.parse(health.updatedAt)>180000)return 'STALE';
 return 'CURRENT';
}
async function readSnapshot({db,GetCommand,driverId,table=TABLE,now=()=>Date.now(),includeDetails=true}){
 if(!validId(driverId)||table!==TABLE)throw Error('PERFORMANCE_PROJECTION_UNAVAILABLE');
 const get=async key=>(await db.send(new GetCommand({TableName:table,Key:key,ConsistentRead:true}))).Item;
 const [row,health]=await Promise.all([get({pk:'DRIVER#'+driverId,sk:'STATE'}),get({pk:'CONTROL',sk:'HEALTH'})]);
 if(row&&(row.driverId!==driverId||row.pk!=='DRIVER#'+driverId||row.sk!=='STATE'))throw Error('PERFORMANCE_PROJECTION_UNAVAILABLE');
 const status=stateOf(row,health,now());
 if(!row?.snapshot)return {schemaVersion:1,rulesVersion:'OBSERVED_DRIVER_PERFORMANCE_V4',updatedAt:null,acceptanceRate:null,completionRate:null,customerRating:null,customerRatingCount:0,acceptanceRateStatus:'INSUFFICIENT_DATA',completionRateStatus:'INSUFFICIENT_DATA',projection:{status,policyVersion:POLICY},details:{}};
 const result=structuredClone(row.snapshot);
 result.projection={status,policyVersion:POLICY,version:row.builtGeneration,computedAt:row.computedAt,validUntil:row.validUntil};
 if(status!=='CURRENT'){
  for(const name of ['acceptanceRate','completionRate','onTimeRate'])if(name in result)result[name+'Status']=result[name]===null?'INSUFFICIENT_DATA':'PROVISIONAL';
  if(result.ratingWindow&&result.ratingWindow.count>0)result.ratingWindow.status='PROVISIONAL';
  if(result.rejections)result.rejections.status='PARTIAL';
 }
 if(includeDetails){const detail=await get({pk:row.pk,sk:row.detailsKey});if(!detail||detail.version!==row.builtGeneration||detail.policyVersion!==POLICY)throw Error('PERFORMANCE_PROJECTION_UNAVAILABLE');result.details=detail.details;}
 return result;
}
function dispatchMetrics(row,health,now=Date.now(),newDriverBoundary=5){
 if(stateOf(row,health,now)!=='CURRENT')return null;
 const p=row.snapshot,a=p.acceptance,c=p.completion,r=p.rejections;
 if(!a||!c||!r||!Number.isSafeInteger(r.consecutive)||r.consecutive<0||!a.windowComplete||!c.windowComplete||!r.windowComplete)return null;
 for(const key of ['acceptanceRate','completionRate'])if(p[key]!==null&&(!Number.isFinite(p[key])||p[key]<0||p[key]>1))return null;
 return {metricsSnapshot_acceptanceRate:p.acceptanceRate,metricsSnapshot_completionRate:p.completionRate,metricsSnapshot_consecutiveRejections:r.consecutive,metricsSnapshot_totalTrips:p.experience?.totalFulfilled??((c.completed+c.returned)>=newDriverBoundary?c.completed+c.returned:null),metricsSnapshot_responseRate:a.sampleSize?(a.accepted+a.declined)/a.sampleSize:null,rating:p.customerRating,performanceSnapshotAuthoritative:true,performanceSnapshotVersion:row.builtGeneration};
}
function viewForRules(snapshot,version=4){
 const result=structuredClone(snapshot);if(version===4)return result;
 result.rulesVersion='OBSERVED_DRIVER_PERFORMANCE_V'+version;
 const allTime=result.ratingAllTime;result.customerRating=allTime?.average??null;result.customerRatingCount=allTime?.count??0;
 if(version===1&&result.acceptance){const a=result.acceptance,denominator=a.accepted+a.declined,expired=a.expiredDelivered||0;result.acceptance={...a,sampleSize:denominator,expiredDelivered:0,unconfirmedExcluded:(a.unconfirmedExcluded||0)+expired};result.acceptanceRate=denominator?a.accepted/denominator:null;result.acceptanceRateStatus=!denominator?'INSUFFICIENT_DATA':expired||result.projection?.status!=='CURRENT'?'PROVISIONAL':result.acceptanceRateStatus;}
 if(version<3)for(const key of ['onTimeRate','onTimeRateStatus','punctuality','activity','details','ratingWindow','ratingReview'])delete result[key];
 return result;
}
module.exports={POLICY,TABLE,validId,validDate,stateOf,readSnapshot,dispatchMetrics,viewForRules};
