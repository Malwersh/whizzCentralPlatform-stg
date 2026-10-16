import { DynamoDBDocumentClient, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { createStagingDriverOfferContext } from './driverOfferContext';
import { createStagingDriverOfferStore } from './driverOfferStore';
import { driverOfferView, buildDriverOffer } from './driverOffer';
import { quoteHash, quoteEntityIdValid } from './deliveryQuoteRecord';
import { detach, equal, strongGet, exactCheck, updateChecked, FinancialRow as Row } from './driverFinancialTransaction';
const jobs='WizzDispatchJobs_staging',offers='WaveOffers_staging';
const conflict=():never=>{throw Object.assign(Error('FINANCIAL_WAVE_CONFLICT'),{code:'FINANCIAL_WAVE_CONFLICT'});};
/** Durable wave plan in the existing dispatch partition. Delivery is at least once with a fixed eventId.
 * A READY wave is required by acceptance. Notifications carry the allowlisted financial view only.
 */
export function createStagingDriverFinancialWave(options:{db:Pick<DynamoDBDocumentClient,'send'>;
  context:ReturnType<typeof createStagingDriverOfferContext>;sendOffer:(driverId:string,message:Row)=>Promise<void>;now?:()=>number}) {
 const {db,context,sendOffer}=options,now=options.now??Date.now,store=createStagingDriverOfferStore({db,now});
 return Object.freeze({async run(value:unknown){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='branchId,driverIds,orderId,waveNumber')return conflict();
  const r=detach(value as Row),{orderId,branchId,waveNumber}=r;
  if(![orderId,branchId].every(quoteEntityIdValid)||!Number.isSafeInteger(waveNumber)||waveNumber<1||waveNumber>1000||
    !Array.isArray(r.driverIds)||r.driverIds.length>25||!r.driverIds.every(quoteEntityIdValid)||new Set(r.driverIds).size!==r.driverIds.length)return conflict();
  const driverIds=[...r.driverIds].sort(),waveKey={orderId,SK:`FINANCIAL_WAVE#${waveNumber}`},jobKey={orderId,SK:'METADATA'};
  let wave=await strongGet(db,jobs,waveKey);
  if(!wave){
   const job=await strongGet(db,jobs,jobKey);
   if(!job||job.status!=='searching'||job.currentWaveNumber!==waveNumber-1||job.restaurantId!==branchId||
     !quoteEntityIdValid(job.dispatchJobId)||Date.parse(job.expiresAt)<=now()||!Number.isFinite(Date.parse(job.expiresAt)))return conflict();
   wave={...waveKey,kind:'FINANCIAL_WAVE',state:'PREPARING',assignmentId:job.dispatchJobId,branchId,driverIds,
    delivered:[],version:1,createdAt:new Date(now()).toISOString(),expiresAt:job.expiresAt};
   try{await db.send(new TransactWriteCommand({TransactItems:[updateChecked(exactCheck(jobs,jobKey,job),
     'SET #uFinancial=:uTrue, #uPreparing=:uWave', {'#uFinancial':'financialDispatch','#uPreparing':'financialPreparingWave'}, {':uTrue':true,':uWave':waveNumber}),
    {Put:{TableName:jobs,Item:wave,ConditionExpression:'attribute_not_exists(orderId)'}}] as any}));}
   catch{wave=await strongGet(db,jobs,waveKey);if(!wave)return conflict();}
  }
  if(wave.kind!=='FINANCIAL_WAVE'||wave.branchId!==branchId||!equal(wave.driverIds,driverIds)||!['PREPARING','READY'].includes(wave.state)||Date.parse(wave.expiresAt)<=now())return conflict();
  if(wave.state==='PREPARING'){
   for(const driverId of driverIds){
    const offerId='FINO:'+quoteHash({orderId,assignmentId:wave.assignmentId,waveNumber,driverId}).slice(0,48);
    const key={orderId,SK:`FINANCIAL#${driverId}#WAVE#${waveNumber}`},saved=await strongGet(db,offers,key);
    if(saved){
     if(saved.offerId!==offerId||saved.financialOffer?.assignmentId!==wave.assignmentId||saved.responseStatus!=='financial_pending')return conflict();
     driverOfferView(saved.financialOffer,driverId,saved.financialOffer.driverSubjectId,new Date(now()).toISOString());
    }else{
     const prepared=await context.prepare({orderId,branchId,driverId,waveNumber,offerId});
     if(prepared.offer.assignmentId!==wave.assignmentId)return conflict();
     await store.save(prepared);
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
   if(!saved||saved.responseStatus!=='financial_pending')return conflict();
   const offer=buildDriverOffer(saved.financialOffer?.source);
   if(!equal(offer,saved.financialOffer)||offer.assignmentId!==wave.assignmentId)return conflict();
   const live=await context.checkAcceptance({orderId,branchId,driverId,waveNumber,offerId:offer.offerId});
   if(live.subjectId!==offer.driverSubjectId||live.assignment.dispatchJobId!==wave.assignmentId)return conflict();
   // Revalidate all DynamoDB references before an external send. A winner racing AFTER this check
   // can still cause a stale notification; acceptance's atomic conditions remain authoritative.
   await db.send(new TransactWriteCommand({TransactItems:[live.order.condition,...(live.order.releaseCondition?[live.order.releaseCondition]:[]),...Object.values(live.guards).filter(v=>!Array.isArray(v)),
    ...live.guards.deletions,exactCheck(jobs,waveKey,wave),exactCheck(offers,{orderId,SK:saved.SK},saved)] as any}));
   const view=driverOfferView(offer,driverId,live.subjectId,new Date(now()).toISOString());
   await sendOffer(driverId,{type:'financial_wave_offer',eventId:offer.offerId,waveNumber,offer:view});
   try{await db.send(new TransactWriteCommand({TransactItems:[updateChecked(exactCheck(jobs,waveKey,wave),
     'SET #uDelivered=:uDelivered, #uVersion=:uVersion',{'#uDelivered':'delivered','#uVersion':'version'},
     {':uDelivered':[...wave.delivered,driverId],':uVersion':wave.version+1})] as any}));}
   catch{const latest=await strongGet(db,jobs,waveKey);if(!latest?.delivered?.includes(driverId))throw Error('FINANCIAL_DELIVERY_ACK_UNCERTAIN');}
  }
  return {kind:'FINANCIAL_WAVE_READY',orderId,waveNumber,offers:driverIds.length};
 }, async expire(orderId:string,waveNumber:number){
  if(!quoteEntityIdValid(orderId)||!Number.isSafeInteger(waveNumber)||waveNumber<1||waveNumber>1000)return conflict();
  const jobKey={orderId,SK:'METADATA'},waveKey={orderId,SK:`FINANCIAL_WAVE#${waveNumber}`};
  const job=await strongGet(db,jobs,jobKey),wave=await strongGet(db,jobs,waveKey);
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
