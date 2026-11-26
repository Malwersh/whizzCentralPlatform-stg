'use strict';
const {createHash}=require('node:crypto');
const {ratingChronology}=require('./driver-rating-chronology-281');
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const fingerprint=r=>createHash('sha256').update(canonical(Object.fromEntries(['pk','orderId','subjectId','merchantId','driverId','merchantStars','driverStars','comment','createdAt'].map(k=>[k,r[k]??null])))).digest('hex');
const validId=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,149}$/.test(v);
const same=(a,b)=>canonical(a)===canonical(b);
function validAggregate(a,driverId){return !a||a.pk==='DRIVER#'+driverId&&['count','sum','version'].every(k=>Number.isSafeInteger(a[k]))&&a.count>=0&&a.version>0&&a.sum>=a.count&&a.sum<=5*a.count&&(a.count?a.average===Math.round(a.sum/a.count*100)/100:a.average===null)&&['underReviewCount','excludedCount'].every(k=>a[k]===undefined||Number.isSafeInteger(a[k])&&a[k]>=0);}
async function moderation(record,review,getHold){
 const m=record.driverModeration;
 if(!m&&!review)return {status:'INCLUDED',reason:'ORIGINAL_VERIFIED_CUSTOMER_RATING'};
 if(!m||!review||m.schemaVersion!==1||review.kind!=='DRIVER_RATING_REVIEW'||review.schemaVersion!==1||review.actorKind!=='STAFF'||review.orderId!==record.orderId||review.driverId!==record.driverId||m.caseId!==review.caseId||m.version!==review.version||m.source!==fingerprint(record)||review.ratingSource!==m.source||m.state!==review.state||m.decision!==(review.decision?.value??'PENDING_REVIEW'))return {status:'UNVERIFIED',reason:'RATING_REVIEW_SOURCE_UNVERIFIED'};
 const h=review.history?.at(-1);if(!h||!validId(h.id))return {status:'UNVERIFIED',reason:'RATING_REVIEW_EVENT_UNVERIFIED'};
 const event=await getHold(record.orderId,'RATING_REVIEW_EVENT#'+h.id);
 const bound=e=>e?.kind==='DRIVER_RATING_REVIEW_EVENT'&&e.schemaVersion===1&&e.actorKind==='STAFF'&&e.caseId===review.caseId&&e.orderId===record.orderId&&e.driverId===record.driverId&&e.ratingSource===m.source;
 const expectedIncluded=review.state==='RESOLVED'&&review.decision?.value==='KEEP';
 if(!bound(event)||event.recordId!==h.id||event.action!==h.action||event.receipt?.version!==review.version||event.receipt?.caseId!==review.caseId||event.receipt?.ratingIncluded!==expectedIncluded||m.included!==expectedIncluded)return {status:'UNVERIFIED',reason:'RATING_REVIEW_EVENT_UNVERIFIED'};
 if(review.state==='APPEAL_OPEN'&&(review.appeals||[]).some(a=>a.status==='OPEN'))return {status:'REVIEW',reason:'RATING_APPEAL_OPEN'};
 if(review.state==='OPEN'&&(!review.decision||review.decision.value==='PENDING_REVIEW'))return {status:'REVIEW',reason:'RATING_REVIEW_PENDING'};
 if(review.state!=='RESOLVED'||(review.appeals||[]).some(a=>a.status==='OPEN')||!['KEEP','EXCLUDE'].includes(review.decision?.value))return {status:'UNVERIFIED',reason:'RATING_REVIEW_STATE_UNVERIFIED'};
 const decision=await getHold(record.orderId,'RATING_REVIEW_EVENT#'+review.decision.id);
 if(!bound(decision)||decision.action!=='DECIDE_DRIVER_RATING_REVIEW'||decision.recordId!==review.decision.id||!same(decision.decision,review.decision))return {status:'UNVERIFIED',reason:'RATING_DECISION_UNVERIFIED'};
 return expectedIncluded?{status:'INCLUDED',reason:'RATING_REVIEW_CONFIRMED'}:{status:'EXCLUDED',reason:'RATING_REVIEW_EXCLUDED'};
}
async function readRatingWindow({db,GetCommand,QueryCommand,driverId,tables,readOrder,now=()=>Date.now(),windowSize=100,maxPages=20,maxRows=2000,maxDurationMs=8000}){
 const blank=(status,reason,extra={})=>({basis:'LAST_100_VALID_CUSTOMER_RATINGS_V1',windowSize,average:null,count:0,status,reason,events:[],affectsEligibility:false,...extra});
 if(!validId(driverId)||windowSize!==100||!tables?.ratings||!tables?.ratingIndex||!tables?.holds)return blank('UNAVAILABLE','RATING_WINDOW_NOT_CONFIGURED');
 const started=Date.now(),asOf=new Date(now()).toISOString(),get=async(table,key)=>(await db.send(new GetCommand({TableName:table,Key:key,ConsistentRead:true}))).Item;
 try{
  const rootKey={pk:'DRIVER#'+driverId},before=await get(tables.ratings,rootKey);
  if(!validAggregate(before,driverId))return blank('UNAVAILABLE','RATING_AGGREGATE_UNVERIFIED');
  const expected=(before?.count??0)+(before?.underReviewCount??0)+(before?.excludedCount??0),keys=[],seen=new Set();let cursor,pages=0,exhausted=false,staleIndex=0;
  do{
   if(Date.now()-started>maxDurationMs||keys.length>=maxRows)break;
   const r=await db.send(new QueryCommand({TableName:tables.ratings,IndexName:tables.ratingIndex,KeyConditionExpression:'#driver=:driver AND #sort<=:asOf',ExpressionAttributeNames:{'#driver':'driverRatingKey','#sort':'driverRatingSort'},ExpressionAttributeValues:{':driver':'DRIVER#'+driverId,':asOf':asOf+'#~'},ScanIndexForward:false,Limit:Math.min(100,maxRows-keys.length),...(cursor?{ExclusiveStartKey:cursor}:{})}));
   for(const row of r.Items||[]){if(typeof row.pk!=='string'||!row.pk.startsWith('ORDER#')||row.driverRatingKey!=='DRIVER#'+driverId||typeof row.driverRatingSort!=='string'||row.driverRatingSort>asOf+'#~'){staleIndex++;continue;}if(seen.has(row.pk)){staleIndex++;continue;}seen.add(row.pk);keys.push(row);}
   cursor=r.LastEvaluatedKey;pages++;exhausted=!cursor;
  }while(cursor&&pages<maxPages);
  if(!before&&keys.length)return blank('UNAVAILABLE','RATING_AGGREGATE_UNVERIFIED');
  keys.sort((a,b)=>a.driverRatingSort<b.driverRatingSort?1:a.driverRatingSort>b.driverRatingSort?-1:0);
  const events=[];let sum=0,count=0,underReview=0,excluded=0,unverified=0,rowsExamined=0;
  for(let offset=0;offset<keys.length&&count<windowSize;offset+=5){
   if(Date.now()-started>maxDurationMs)break;
   const batch=await Promise.all(keys.slice(offset,offset+5).map(async index=>{
    const record=await get(tables.ratings,{pk:index.pk}),coords=ratingChronology(record);
    if(!coords||record.pk!==index.pk||record.pk!=='ORDER#'+record.orderId||record.driverId!==driverId||!same(coords,{driverRatingKey:index.driverRatingKey,driverRatingSort:index.driverRatingSort})||record.driverRatingKey!==coords.driverRatingKey||record.driverRatingSort!==coords.driverRatingSort)return {status:'UNVERIFIED',reason:'RATING_INDEX_SOURCE_CHANGED',occurredAt:null};
    const order=await readOrder(record.orderId);
    if(!order||order.orderId!==record.orderId||order.driverId!==driverId||order.storeId!==record.merchantId||!['delivered','completed'].includes(order.status)||order.isGuestOrder===true||order.isDeleted===true||order.deletedAt!=null||order.deletionRequestId!=null||!validId(record.subjectId)||!(order.userSub!=null?order.userSub===record.subjectId:order.userId===record.subjectId||order.customerId===record.subjectId))return {orderId:record.orderId,occurredAt:record.createdAt,status:'UNVERIFIED',reason:'RATING_ORDER_SOURCE_UNVERIFIED'};
    const review=await get(tables.holds,{orderId:record.orderId,sk:'DRIVER_RATING_REVIEW'}),result=await moderation(record,review,(orderId,sk)=>get(tables.holds,{orderId,sk}));
    return {orderId:record.orderId,orderNumber:order.orderNumber||null,occurredAt:record.createdAt,stars:record.driverStars,...result};
   }));
   for(const event of batch){if(count>=windowSize)break;rowsExamined++;events.push(event);if(event.status==='INCLUDED'){count++;sum+=event.stars;}else if(event.status==='REVIEW')underReview++;else if(event.status==='EXCLUDED')excluded++;else unverified++;}
  }
  const after=await get(tables.ratings,rootKey);
  if(!same(before,after))return blank('UNAVAILABLE','RATING_SOURCE_CHANGED_DURING_READ',{updatedAt:asOf,allTime:{included:after?.count??null,underReview:after?.underReviewCount??null,excluded:after?.excludedCount??null}});
  const complete=exhausted&&keys.length===expected&&!staleIndex,processed=count===windowSize||rowsExamined===keys.length;
  const status=!complete||!processed||unverified?'PROVISIONAL':count?'AVAILABLE':'INSUFFICIENT_DATA';
  return {basis:'LAST_100_VALID_CUSTOMER_RATINGS_V1',windowSize,average:count?Math.round(sum/count*100)/100:null,count,status,reason:!complete?'RATING_INDEX_COVERAGE_PENDING':!processed?'RATING_READ_BOUNDED':unverified?'RATING_RECORDS_UNVERIFIED':count?'LATEST_VALID_RATINGS':'NO_INCLUDED_RATINGS',updatedAt:asOf,underReview,excluded,unverified,events,coverage:{pages,indexRows:keys.length,expectedRows:expected,indexComplete:complete,rowsExamined,windowComplete:processed,sourceStable:true,eventuallyConsistentIndex:true},allTime:{included:before?.count??0,underReview:before?.underReviewCount??0,excluded:before?.excludedCount??0},affectsEligibility:false};
 }catch(error){return blank('UNAVAILABLE','RATING_WINDOW_READ_UNAVAILABLE');}
}
module.exports={readRatingWindow,moderation,fingerprint,validAggregate};
