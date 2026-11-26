import {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';
import {orderPrice} from './legacyOrderPrices';
import {quoteHash,quoteEntityIdValid} from './deliveryQuoteRecord';
import {strongGet,exactCheck,detach,FinancialRow as Row} from './driverFinancialTransaction';
import {createStagingLegacyWaveExecutor,legacyBranchProof} from './dispatchLegacy';
import {createStagingDispatchCandidates} from './dispatchCandidates';
const {FINANCIAL_FIELDS}=require('../../order-service/legacy-order-policy');
const {buildLegacyOfferRow}=require('../../../lambda/WaveSystem_StartWave/legacy-offer-contract');
const {createDriverSelection}=require('../../../lambda/WaveSystem_StartWave/driver-selection');
const distance=createDriverSelection({}).calculateDistance;
const fail=():never=>{throw Error('LEGACY_SOURCE_REVIEW_REQUIRED');};
function text(v:any,max:number,required=false):string{if(v==null&&!required)return '';if(typeof v!=='string'||v.length>max||required&&!v.trim())return fail();return v.trim();}
function address(v:any):string{return text(typeof v==='string'?v:v?.fullAddress??v?.address,1000,true);}
function image(v:any):string|null{if(v==null||v==='')return null;if(typeof v!=='string'||v.length>2048)return fail();try{const u=new URL(v);if(u.protocol!=='https:'||u.username||u.password)return fail();return v;}catch{return fail();}}
function point(lat:any,lng:any){if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180)return fail();return {lat,lng};}
function whole(v:any){if(!Number.isSafeInteger(v)||v<0||v%1000!==0)return fail();return v/1000;}
/** Uses the same known-writer price proof as merchant reports. No heuristic units,
 * fee fallback, default coordinates, new commission/routing rule, or money writes.
 * Limited legacy COD subset: undiscounted goods + explicit delivery + cash tip.
 * Other charges/funding need their financial snapshot, not a guessed migration.
 */
export function readLegacyOrderAmounts(order:Row){
 if(FINANCIAL_FIELDS.some((k:string)=>Object.prototype.hasOwnProperty.call(order,k))||!orderPrice(order)||!['cod','COD'].includes(order.paymentMethod)||order.paymentStatus!=='pending'||!['cod','COD'].includes(order.paymentChannel))return fail();
 const p=order.pricing;
 if(['serviceFee','packagingFee','tax','rounding','discount'].some(k=>p[k]!==0))return fail();
 const goods=whole(p.goodsSubtotal),fee=whole(p.deliveryFee),tip=whole(p.tip),total=whole(p.total);
 if(!Number.isSafeInteger(fee+tip)||!Number.isSafeInteger(goods+fee+tip)||goods+fee+tip!==total)return fail();
 return {goods,fee,tip,total};
}
export function buildLegacySourceMessage({offer}: {job:Row;offer:Row}){
 if(offer.legacySourceVersion!==1||offer.legacyPresentationDigest!==quoteHash(offer.legacyPresentation))return fail();
 const view={...detach(offer.legacyPresentation),offerId:offer.offerId,orderId:offer.orderId,jobId:offer.dispatchJobId,dispatchCycleId:offer.dispatchCycleId,waveNumber:offer.waveNumber,
   sentAt:offer.sentAt,expiresAt:offer.expiresAt,deliveryFee:offer.baseDeliveryFee,tip:offer.tipAmount,estimatedEarnings:offer.estimatedEarningsAtOffer,holdRequiredAmount:offer.holdRequiredAmount,bonusAmount:0,isEmergencyWave:false,currency:'IQD',moneyUnit:'IQD_WHOLE',legacySourceVersion:1};
 const message={...(offer.dispatchKeyVersion===2?{dispatchKeyVersion:2}:{}),type:'new_wave_offer',action:'wave_assignment',eventId:offer.offerId,dispatchDriverId:offer.driverId,driverId:offer.driverSubjectId,offerId:offer.offerId,orderId:offer.orderId,cycleId:offer.dispatchCycleId,waveNumber:offer.waveNumber,offer:view};
 if(Buffer.byteLength(JSON.stringify(message))>24000)return fail();return message;
}
/** Flat push envelope is projected from the SAME stored message, never repriced. */
export function buildLegacySourcePush(message:Row){
 const o=message.offer;if(message.type!=='new_wave_offer'||!o||o.moneyUnit!=='IQD_WHOLE'||o.legacySourceVersion!==1||o.offerId!==message.offerId||o.dispatchCycleId!==message.cycleId)return fail();
 const fields=['offerId','orderId','waveNumber','restaurantId','restaurantName','restaurantAddress','restaurantImageUrl','restaurantLat','restaurantLng','customerAddress','customerLat','customerLng','deliveryFee','tip','bonusAmount','orderTotal','holdRequiredAmount','estimatedEarnings','currency','distance','estimatedMinutes','itemsCount','sentAt','expiresAt','moneyUnit','legacySourceVersion'];
 const payload={...(message.dispatchKeyVersion===2?{dispatchKeyVersion:2}:{}),...Object.fromEntries(fields.filter(k=>o[k]!==undefined).map(k=>[k,o[k]])),dispatchDriverId:message.dispatchDriverId,driverId:message.driverId,cycleId:message.cycleId,eventId:message.eventId,type:'new_wave_offer',action:'wave_assignment'};
 if(Buffer.byteLength(JSON.stringify(Object.fromEntries(Object.entries(payload).map(([k,v])=>[k,String(v)]))))>3500)return fail();return payload;
}
export function createStagingLegacyOfferSource(options:{db:Pick<DynamoDBDocumentClient,'send'>;now?:()=>number}){
 const now=options.now??Date.now,{db}=options;
 return {message:async(input:{job:Row;offer:Row})=>buildLegacySourceMessage(input),async prepare(input:{job:Row;intent:Row;order:Row;driverId:string}){
  const {job,intent,order,driverId}=input,amount=readLegacyOrderAmounts(order);
  if(!quoteEntityIdValid(job.restaurantId)||![order.storeId,order.businessId].some(v=>v===job.restaurantId)||[order.storeId,order.businessId].some(v=>v!==undefined&&v!==job.restaurantId)||order.orderId!==job.orderId||order.PK!=='ORDER#'+job.orderId||order.SK!=='META'||!Array.isArray(order.items)||order.items.length<1||order.items.length>100)return fail();
  const branch=await strongGet(db,'WhizzMerchants_Businesses',{businessId:job.restaurantId}),state=await strongGet(db,'WizzDriverLiveState_staging',{driverId});
  if(!branch||branch.status!=='approved'||branch.isDeleted===true||branch.deletedAt!=null||branch.deletionRequestId!=null||!state)return fail();
  const pickup=point(branch.latitude,branch.longitude),customer=point(order.deliveryAddress?.lat,order.deliveryAddress?.lng),driver=point(state.lat,state.lng),pickupKm=distance(driver.lat,driver.lng,pickup.lat,pickup.lng);
  if(!quoteEntityIdValid(branch.regionId)||pickupKm*1000>intent.rule.radiusMeters)return fail();
  let itemTotal=0n;
  const items=order.items.map((item:Row)=>{
   if(!quoteEntityIdValid(item.itemId??item.skuId)||!Number.isSafeInteger(item.quantity)||item.quantity<1||item.quantity>1000||!Array.isArray(item.modifiers)||item.modifiers.length>20)return fail();
   const price=whole(item.unitPrice),modifiers=item.modifiers.map((m:Row)=>({name:text(m.name,120,true),price:whole(m.price)}));
   itemTotal+=(BigInt(item.unitPrice)+item.modifiers.reduce((n:bigint,m:Row)=>n+BigInt(m.price),0n))*BigInt(item.quantity);
   return {itemId:item.itemId??item.skuId,name:text(item.name,160,true),quantity:item.quantity,price,modifiers,imageUrl:image(item.imageUrl),notes:text(item.notes,500)};
  });
  if(itemTotal!==BigInt(order.pricing.goodsSubtotal))return fail();
  const km=distance(pickup.lat,pickup.lng,customer.lat,customer.lng),presentation={restaurantId:job.restaurantId,restaurantName:text(branch.businessName??branch.name,160,true),restaurantAddress:address(branch.address),restaurantLat:pickup.lat,restaurantLng:pickup.lng,restaurantImageUrl:image(branch.businessPhotoUrl),customerAddress:address(order.deliveryAddress),customerLat:customer.lat,customerLng:customer.lng,orderTotal:amount.total,distance:km,estimatedMinutes:Math.ceil(km*5),distanceBasis:'HAVERSINE_BRANCH_TO_CUSTOMER',durationBasis:'LEGACY_5_MIN_PER_KM_ESTIMATE',items,itemsCount:items.length,specialInstructions:text(order.deliveryInstructions,1000)};
  const at=new Date(now()).toISOString(),seconds=Math.floor((Date.parse(intent.waveDeadline)-now())/1000),ttl=Math.min(intent.offerTtlSeconds,seconds);
  if(!Number.isSafeInteger(ttl)||ttl<1)return fail();
  const row:Row=buildLegacyOfferRow({...job,deliveryFee:amount.fee,orderTotal:amount.total,restaurantName:presentation.restaurantName,restaurantRegionId:branch.regionId,distanceKm:km,estimatedMinutes:presentation.estimatedMinutes},{...state,distance:pickupKm},intent.waveNumber,{at,ttlSeconds:ttl,useExactDeliveryFee:true});delete row.ttl;
  Object.assign(row,{currency:'IQD',holdRequiredAmount:amount.goods,baseDeliveryFee:amount.fee,tipAmount:amount.tip,estimatedEarningsAtOffer:amount.fee+amount.tip,distanceKmAtOffer:km,legacySourceVersion:1,legacyBranchDigest:legacyBranchProof(branch),legacyPresentation:presentation,legacyPresentationDigest:quoteHash(presentation)});
  // Fail before persisting an undeliverable presentation; final sender checks again.
  buildLegacySourcePush(buildLegacySourceMessage({job,offer:{...row,dispatchCycleId:job.dispatchCycle.id,driverSubjectId:driverId}}));
  return {record:row,sourceGuards:[exactCheck('WhizzMerchants_Businesses',{businessId:job.restaurantId},branch,[...new Set([...Object.keys(branch),'isDeleted','deletedAt','deletionRequestId'])]),exactCheck('WizzDriverLiveState_staging',{driverId},state)]};
 }};
}
export function createStagingPinnedLegacyRunner(options:{db:Pick<DynamoDBDocumentClient,'send'>;now?:()=>number;sendOffer:Parameters<typeof createStagingLegacyWaveExecutor>[0]['sendOffer']}){
 const source=createStagingLegacyOfferSource(options);
 return createStagingLegacyWaveExecutor({...options,selectDrivers:createStagingDispatchCandidates(options),prepareOffer:source.prepare,message:source.message});
}
