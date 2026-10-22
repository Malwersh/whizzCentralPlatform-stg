const {dispatchWaveSK}=require('../../src/utils/dispatch-cycle-keys');
import {DynamoDBDocumentClient,ScanCommand} from '@aws-sdk/lib-dynamodb';
import {validateDispatchCycle} from './dispatchCycle';
import {createStagingDriverOfferOrderReader} from './driverOfferOrderReader';
import {strongGet,equal,FinancialRow as Row} from './driverFinancialTransaction';
import {quoteEntityIdValid,quoteCanonical} from './deliveryQuoteRecord';
const {createDriverSelection}=require('../../../lambda/WaveSystem_StartWave/driver-selection');
const {isDriverApproved}=require('../../../lambda/WaveSystem_StartWave/driver_eligibility');
const LIVE='WizzDriverLiveState_staging';
const fail=():never=>{throw Error('DISPATCH_CANDIDATES_UNAVAILABLE');};
/** Read adapter around the SAME Legacy filter/ranking, not v1.6 Score/Tiers.
 * New-cycle readers finish all bounded pages, fail closed, then strongly hydrate
 * current state/profile before applying the captured rule. No offers or money.
 */
export function createStagingDispatchCandidates(options:{db:Pick<DynamoDBDocumentClient,'send'>;now?:()=>number;enableDeliveryFunding?:boolean;enableFullCash?:boolean}) {
 const {db}=options,now=options.now??Date.now;
 return async(input:{job:Row;intent:Row})=>{
  const {job,intent}=input,c=validateDispatchCycle(job.dispatchCycle),profile=c.policy.values.dispatch!.profiles[c.engine],rule=profile.normalWaves[intent.waveNumber-1];
  if(job.dispatchJobId!==c.assignmentId||job.orderId!==c.orderId||job.status!=='searching'||intent.cycleDigest!==c.digest||intent.cycleId!==c.id||job.dispatchTransition?.id!==intent.intentId||!equal(intent.rule,rule)||!rule||Date.parse(intent.waveDeadline)<=now()||!['LEASED','APPLIED'].includes(intent.state))return fail();
  let point:Row,regionId:string;
  if(c.engine==='FINANCIAL'){const order=await createStagingDriverOfferOrderReader({db,enableDeliveryFunding:options.enableDeliveryFunding,enableFullCash:options.enableFullCash}).read({orderId:c.orderId,branchId:job.restaurantId});point=order.snapshot.branchPoint;regionId=order.snapshot.zoneId;}
  else{const branch=await strongGet(db,'WhizzMerchants_Businesses',{businessId:job.restaurantId});if(!branch||branch.status!=='approved')return fail();point={latitude:job.restaurantLat??branch.latitude,longitude:job.restaurantLng??branch.longitude};regionId=job.restaurantRegionId??branch.regionId;}
  if(!quoteEntityIdValid(regionId)||!Number.isFinite(point.latitude)||Math.abs(point.latitude)>90||!Number.isFinite(point.longitude)||Math.abs(point.longitude)>180)return fail();
  const excluded=new Set<string>();for(const list of [job.excludedDrivers??[],job.financialExcludedDriverIds??[]]){if(!Array.isArray(list)||!list.every(quoteEntityIdValid))return fail();for(const id of list)excluded.add(id);}
  const previouslyOffered=new Set<string>();
  for(let n=1;n<intent.waveNumber;n++){const wave=await strongGet(db,'WizzDispatchJobs_staging',{orderId:c.orderId,SK:dispatchWaveSK(c,n)});if(!wave||wave.assignmentId!==c.assignmentId||!Array.isArray(wave.driverIds)||wave.driverIds.length>25||!wave.driverIds.every(quoteEntityIdValid))return fail();for(const id of wave.driverIds)previouslyOffered.add(id);}
  async function read(all:boolean):Promise<Row[]>{
   let cursor:any,rows:Row[]=[],pages=0;const seen=new Set<string>();
   do{
    if(++pages>8)return fail();
    const q={TableName:LIVE,Limit:250,ExclusiveStartKey:cursor,ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':available':'available',...(!all?{':region':regionId}:{})}};
    // Live-state staging has no region GSI. Use its existing bounded scan access,
    // retaining the region predicate and strongly hydrating every result below.
    const result:any=await db.send(new ScanCommand({...q,FilterExpression:all?'#s=:available':'current_work_region_id=:region AND #s=:available'}));
    if(!Array.isArray(result.Items??[])||(result.Items?.length??0)>250)return fail();rows.push(...(result.Items??[]));if(rows.length>2000)return fail();cursor=result.LastEvaluatedKey;
    if(cursor){const k=quoteCanonical(cursor);if(seen.has(k))return fail();seen.add(k);}
   }while(cursor);
   const ids=[...new Set(rows.map(r=>r.driverId))];if(!ids.every(quoteEntityIdValid))return fail();
   const live:Row[]=[];
   for(const driverId of ids){const [state,driver]=await Promise.all([strongGet(db,LIVE,{driverId}),strongGet(db,'WhizzDrivers_staging',{driverId})]);
    if(!state||!driver||!isDriverApproved(driver)||driver.isDeleted===true||driver.deletedAt!=null||driver.deletionRequestId!=null||driver.isSuspended===true||driver.isBanned===true)continue;
    if(c.engine==='FINANCIAL'&&(![driver.status,driver.registrationStatus].some(s=>['APPROVED','VERIFIED'].includes(String(s).toUpperCase()))||state.isActive!==true||state.currentOrderId!=null||(state.activeOrdersCount??0)!==0))continue;
    const observed=Date.parse(state.locationUpdatedAt);if(profile.positionMaxAgeSeconds!==null&&(!Number.isFinite(observed)||observed>now()||observed+profile.positionMaxAgeSeconds*1000<=now()))continue;
    if(['metricsSnapshot_acceptanceRate','metricsSnapshot_completionRate','metricsSnapshot_responseRate'].some(k=>state[k]!=null&&(!Number.isFinite(state[k])||state[k]<0||state[k]>1)))continue;
    if(['metricsSnapshot_totalTrips','metricsSnapshot_consecutiveRejections'].some(k=>state[k]!=null&&(!Number.isSafeInteger(state[k])||state[k]<0)))continue;
    if(state.rating!=null&&(!Number.isFinite(state.rating)||state.rating<0||state.rating>5))continue;
    if(profile.newDriverExemption.missingHistory==='NOT_EXEMPT'&&!(state.metricsSnapshot_totalTrips!=null&&state.metricsSnapshot_totalTrips<profile.newDriverExemption.belowCompletedTrips)&&[state.metricsSnapshot_acceptanceRate,state.metricsSnapshot_completionRate,state.metricsSnapshot_consecutiveRejections].some(v=>v==null))continue;
    live.push(state);
   }
   return live;
  }
  const selector=createDriverSelection({console:{log(){},warn(){},error(){}},MAX_DISTANCE_KM:20,queryDriversByRegion:()=>read(false),queryAllAvailableDrivers:()=>read(true)});
  const thresholds={MIN_ACCEPTANCE_RATE:rule.minimumAcceptancePercent/100,MIN_COMPLETION_RATE:rule.minimumCompletionPercent/100,MAX_CONSECUTIVE_REJECTIONS:rule.maximumConsecutiveDeclines,MAX_DISTANCE_KM:rule.radiusMeters/1000,NEW_DRIVER_BELOW_TRIPS:profile.newDriverExemption.belowCompletedTrips,MISSING_HISTORY:profile.newDriverExemption.missingHistory,REOFFER_FROM_WAVE:profile.repeatOffers.reofferFromWave??Number.MAX_SAFE_INTEGER,STRICT_COORDINATES:true,DETERMINISTIC_TIES:true};
  const candidates:Row[]=await selector.getQualifiedDrivers({...job,restaurantLat:point.latitude,restaurantLng:point.longitude,restaurantRegionId:regionId},[...excluded],[...excluded],[...previouslyOffered],rule.recipients==='ALL',false,intent.waveNumber,thresholds);
  if(rule.recipients==='ALL'&&candidates.length>25)throw Error('DISPATCH_ALL_REQUIRES_PAGED_EXECUTOR');
  return candidates.slice(0,rule.recipients==='ALL'?candidates.length:rule.recipients).map(r=>r.driverId);
 };
}
