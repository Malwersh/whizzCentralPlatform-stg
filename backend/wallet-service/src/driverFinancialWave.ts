import {financialWaveSK} from './financialDispatchKeys';
import {DeliveryOperationsValues} from './deliveryOperationsPolicy';
import { DynamoDBDocumentClient, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { createStagingDriverOfferContext } from './driverOfferContext';
import { createStagingDriverOfferStore } from './driverOfferStore';
import { resolveFinancialOffer,versionedFinancialOfferView } from './financialOfferVersion';
import { quoteHash, quoteEntityIdValid } from './deliveryQuoteRecord';
import { detach, equal, strongGet, exactCheck, updateChecked, FinancialRow as Row } from './driverFinancialTransaction';
const jobs='WizzDispatchJobs_staging',offers='WaveOffers_staging';
const conflict=():never=>{throw Object.assign(Error('FINANCIAL_WAVE_CONFLICT'),{code:'FINANCIAL_WAVE_CONFLICT'});};
/** Durable wave plan in the existing dispatch partition. Delivery is at least once with a fixed eventId.
 * A READY wave is required by acceptance. Notifications carry the allowlisted financial view only.
 */
export function createStagingDriverFinancialWave(options:{db:Pick<DynamoDBDocumentClient,'send'>;
  pinnedTransitionId?:string;enableDeliveryFunding?:boolean;enableFullCash?:boolean;
  operating?:{version:number;values:DeliveryOperationsValues;condition:Row|null};
  context:ReturnType<typeof createStagingDriverOfferContext>;sendOffer:(driverId:string,message:Row)=>Promise<void>;now?:()=>number}) {
 const {db,context,sendOffer}=options,now=options.now??Date.now,store=createStagingDriverOfferStore({db,now,enableDeliveryFunding:options.enableDeliveryFunding,enableFullCash:options.enableFullCash});
 return Object.freeze({async run(value:unknown){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='branchId,driverIds,orderId,waveNumber')return conflict();
  const r=detach(value as Row),{orderId,branchId,waveNumber}=r;
  if(![orderId,branchId].every(quoteEntityIdValid)||!Number.isSafeInteger(waveNumber)||waveNumber<1||waveNumber>1000||
    !Array.isArray(r.driverIds)||r.driverIds.length>25||!r.driverIds.every(quoteEntityIdValid)||new Set(r.driverIds).size!==r.driverIds.length)return conflict();
  const driverIds=[...r.driverIds].sort(),jobKey={orderId,SK:'METADATA'};
  const selectedJob=await strongGet(db,jobs,jobKey),waveKey={orderId,SK:financialWaveSK(selectedJob,waveNumber)};
  if(selectedJob&&Object.prototype.hasOwnProperty.call(selectedJob,'dispatchCycle')?(!options.pinnedTransitionId||selectedJob.dispatchTransition?.id!==options.pinnedTransitionId):options.pinnedTransitionId!==undefined)return conflict();
  let wave=await strongGet(db,jobs,waveKey);
  if(!wave){
   const job=await strongGet(db,jobs,jobKey);
   if(!job||job.status!=='searching'||job.currentWaveNumber!==waveNumber-1||job.restaurantId!==branchId||
     !quoteEntityIdValid(job.dispatchJobId)||Date.parse(job.expiresAt)<=now()||!Number.isFinite(Date.parse(job.expiresAt)))return conflict();
   wave={...waveKey,kind:'FINANCIAL_WAVE',state:'PREPARING',assignmentId:job.dispatchJobId,branchId,driverIds,
    delivered:[],version:1,createdAt:new Date(now()).toISOString(),expiresAt:job.expiresAt,
    ...(options.operating?{operatingLimits:{version:options.operating.version,values:options.operating.values}}:{})};
   try{await db.send(new TransactWriteCommand({TransactItems:[updateChecked(exactCheck(jobs,jobKey,job),
     'SET #uFinancial=:uTrue, #uPreparing=:uWave, #uMax=:uMax', {'#uFinancial':'financialDispatch','#uPreparing':'financialPreparingWave','#uMax':'financialSearchMaxWave'}, {':uTrue':true,':uWave':waveNumber,':uMax':job.financialSearchMaxWave??(job.currentWaveNumber===0?(options.operating?.values.maximumWaves??job.maxWaves??4):(job.maxWaves??4))}),
    {Put:{TableName:jobs,Item:wave,ConditionExpression:'attribute_not_exists(orderId)'}},...(options.operating?.condition?[options.operating.condition]:[])] as any}));}
   catch{wave=await strongGet(db,jobs,waveKey);if(!wave)return conflict();}
  }
  if(options.operating&&wave.operatingLimits&&!equal(wave.operatingLimits,{version:options.operating.version,values:options.operating.values}))return conflict();
  if(wave.kind!=='FINANCIAL_WAVE'||wave.branchId!==branchId||!equal(wave.driverIds,driverIds)||!['PREPARING','READY'].includes(wave.state)||Date.parse(wave.expiresAt)<=now())return conflict();
  if(wave.state==='PREPARING'){
   for(const driverId of driverIds){
    const offerId='FINO:'+quoteHash({orderId,assignmentId:wave.assignmentId,waveNumber,driverId}).slice(0,48);
    const key={orderId,SK:`FINANCIAL#${driverId}#WAVE#${waveNumber}`},saved=await strongGet(db,offers,key);
    if(saved){
     if(saved.offerId!==offerId||saved.financialOffer?.assignmentId!==wave.assignmentId||saved.responseStatus!=='financial_pending')return conflict();
     versionedFinancialOfferView(saved.financialOffer,driverId,resolveFinancialOffer(saved.financialOffer,options.enableDeliveryFunding,options.enableFullCash).driverSubjectId,new Date(now()).toISOString(),options.enableDeliveryFunding,options.enableFullCash);
    }else{
     for(let positionAttempt=0;positionAttempt<3;positionAttempt++){
      const prepared=await context.prepare({orderId,branchId,driverId,waveNumber,offerId});
      if(resolveFinancialOffer(prepared.offer,options.enableDeliveryFunding,options.enableFullCash).assignmentId!==wave.assignmentId)return conflict();
      try{await store.save(prepared);break;}catch(error:any){if(error?.code!=='DRIVER_OFFER_POSITION_CONFLICT'||positionAttempt===2)throw error;}
     }
    }
   }
   const job=await strongGet(db,jobs,jobKey);
   if(!job||job.status!=='searching'||job.currentWaveNumber!==waveNumber-1||job.dispatchJobId!==wave.assignmentId)return conflict();
   const ready={...wave,state:'READY',version:wave.version+1};
   try{await db.send(new TransactWriteCommand({TransactItems:[
    updateChecked(exactCheck(jobs,jobKey,job),'SET #uWave=:uWave, #uFinancial=:uTrue, #uRedispatch=:uNull, #uPreparing=:uNull',
      {'#uWave':'currentWaveNumber','#uFinancial':'financialDispatch','#uRedispatch':'financialRedispatch','#uPreparing':'financialPreparingWave'},{':uWave':waveNumber,':uTrue':true,':uNull':null}),
    updateChecked(exactCheck(jobs,waveKey,wave),'SET #uState=:uReady, #uVersion=:uVersion',
      {'#uState':'state','#uVersion':'version'},{':uReady':'READY',':uVersion':ready.version})] as any}));wave=ready;}
   catch{wave=await strongGet(db,jobs,waveKey);if(wave?.state!=='READY'||wave.assignmentId!==job.dispatchJobId)return conflict();}
  }
  for(const driverId of driverIds){
   wave=await strongGet(db,jobs,waveKey);
   if(!wave||wave.state!=='READY')return conflict();
   if(wave.delivered.includes(driverId))continue;
   const saved=await strongGet(db,offers,{orderId,SK:`FINANCIAL#${driverId}#WAVE#${waveNumber}`});
   // A notification can be received and declined before its send ACK is saved.
   // The durable response is authoritative; skip it without inventing a delivery ACK.
   if(options.pinnedTransitionId&&saved&&(['financial_declined','financial_expired'].includes(saved.responseStatus)||(saved.responseStatus==='financial_pending'&&Date.parse(saved.expiresAt)<=now())))continue;
   if(!saved||saved.responseStatus!=='financial_pending')return conflict();
   const offer=resolveFinancialOffer(saved.financialOffer,options.enableDeliveryFunding,options.enableFullCash);
   if(!equal(offer.versionedOffer,saved.financialOffer)||offer.assignmentId!==wave.assignmentId)return conflict();
   let live:Awaited<ReturnType<typeof context.checkAcceptance>>|undefined;
   // Heartbeats can update the exact position fence during identity/lease reads.
   // Retry only an isolated position CAS loss; every attempt rereads all guards.
   for(let positionAttempt=0;positionAttempt<3;positionAttempt++){
    live=await context.checkAcceptance({orderId,branchId,driverId,waveNumber,offerId:offer.offerId});
    if(live.subjectId!==offer.driverSubjectId||live.assignment.dispatchJobId!==wave.assignmentId)return conflict();
    const preflight:Row[]=[live.order.condition,...(live.order.releaseCondition?[live.order.releaseCondition]:[]),...Object.values(live.guards).filter(v=>!Array.isArray(v)),
      ...live.guards.deletions,exactCheck(jobs,waveKey,wave),exactCheck(offers,{orderId,SK:saved.SK},saved)];
    const positionIndex=preflight.findIndex(op=>op===live!.guards.position);
    try{await db.send(new TransactWriteCommand({TransactItems:preflight as any}));break;}
    catch(error:any){
     const reasons=error?.CancellationReasons;
     const positionOnly=error?.name==='TransactionCanceledException'&&positionIndex>=0&&Array.isArray(reasons)&&reasons.length>=preflight.length&&
       reasons[positionIndex]?.Code==='ConditionalCheckFailed'&&reasons.every((r:any,i:number)=>i===positionIndex||r?.Code==='None');
     if(!positionOnly||positionAttempt===2)throw error;
    }
   }
   if(!live)return conflict();
   const view=versionedFinancialOfferView(offer,driverId,live.subjectId,new Date(now()).toISOString(),options.enableDeliveryFunding,options.enableFullCash);
   await sendOffer(driverId,{type:'financial_wave_offer',eventId:offer.offerId,waveNumber,offer:{...view,...(live.order.display?{display:live.order.display}:{})}});
   try{await db.send(new TransactWriteCommand({TransactItems:[updateChecked(exactCheck(jobs,waveKey,wave),
     'SET #uDelivered=:uDelivered, #uVersion=:uVersion',{'#uDelivered':'delivered','#uVersion':'version'},
     {':uDelivered':[...wave.delivered,driverId],':uVersion':wave.version+1})] as any}));}
   catch{const latest=await strongGet(db,jobs,waveKey);if(!latest?.delivered?.includes(driverId))throw Error('FINANCIAL_DELIVERY_ACK_UNCERTAIN');}
  }
  const finalOffers=await Promise.all(driverIds.map(driverId=>strongGet(db,offers,{orderId,SK:`FINANCIAL#${driverId}#WAVE#${waveNumber}`})));
  const deadlines=finalOffers.map(row=>Date.parse(row?.expiresAt));
  if(deadlines.some(n=>!Number.isFinite(n)))return conflict();
  const timeoutAt=new Date(Math.min(Date.parse(wave.expiresAt),deadlines.length?Math.max(...deadlines):now())).toISOString();
  return {kind:'FINANCIAL_WAVE_READY',orderId,waveNumber,offers:driverIds.length,timeoutAt};
 }, async expire(orderId:string,waveNumber:number){
  if(!quoteEntityIdValid(orderId)||!Number.isSafeInteger(waveNumber)||waveNumber<1||waveNumber>1000)return conflict();
  const jobKey={orderId,SK:'METADATA'},job=await strongGet(db,jobs,jobKey),waveKey={orderId,SK:financialWaveSK(job,waveNumber)};
  const wave=await strongGet(db,jobs,waveKey);
  if(job?.status==='assigned')return {expired:false,assigned:true};
  if(!wave||wave.kind!=='FINANCIAL_WAVE'||job?.status!=='searching'||job.dispatchJobId!==wave.assignmentId)return conflict();
  if(wave.state==='EXPIRED')return {expired:true,driverIds:wave.driverIds};
  if(!['PREPARING','READY'].includes(wave.state)||job.currentWaveNumber!==(wave.state==='READY'?waveNumber:waveNumber-1))return conflict();
  const rows=await Promise.all(wave.driverIds.map((driverId:string)=>strongGet(db,offers,{orderId,SK:`FINANCIAL#${driverId}#WAVE#${waveNumber}`})));
  const deadline=wave.state==='PREPARING'?Date.parse(wave.expiresAt):(rows.length?Math.max(...rows.map((r:Row)=>Date.parse(r?.expiresAt))):Date.parse(wave.createdAt));
  if(!Number.isFinite(deadline)||deadline>now())return {expired:false,assigned:false};
  const writes:Row[]=[updateChecked(exactCheck(jobs,jobKey,job),'SET #uWave=:uWave',{'#uWave':'currentWaveNumber'},{':uWave':waveNumber}),
   updateChecked(exactCheck(jobs,waveKey,wave),'SET #uState=:uState',{'#uState':'state'},{':uState':'EXPIRED'})];
  for(const saved of rows){if(!saved||saved.responseStatus==='financial_declined')continue;if(saved.responseStatus!=='financial_pending')return conflict();
   writes.push(updateChecked(exactCheck(offers,{orderId,SK:saved.SK},saved),'SET #uStatus=:uStatus',{'#uStatus':'responseStatus'},{':uStatus':'financial_expired'}));}
  await db.send(new TransactWriteCommand({TransactItems:writes as any}));
  return {expired:true,driverIds:wave.driverIds};
 }});
}
