import {DynamoDBDocumentClient,TransactWriteCommand} from '@aws-sdk/lib-dynamodb';
import {quoteEntityIdValid} from './deliveryQuoteRecord';
import {createStagingDriverOfferOrderReader} from './driverOfferOrderReader';
import {strongGet,exactCheck,updateChecked} from './driverFinancialTransaction';
export function unavailableDispatchSearch(reason:string,observedAt:string) {
 if(!['SEARCH_WINDOW_EXPIRED','MAX_WAVES_REACHED','PREPARATION_DEADLINE'].includes(reason)||!Number.isFinite(Date.parse(observedAt))||new Date(Date.parse(observedAt)).toISOString()!==observedAt)throw Error('INVALID_FINANCIAL_SEARCH');
 return {status:'no_driver_available',reason,reviewStatus:'REQUIRED',observedAt};
}
/** Exhaustion is an operational review state. No cancellation, wallet, hold, ledger or financial-outcome write. */
export function createStagingFinancialSearch(options:{db:Pick<DynamoDBDocumentClient,'send'>;now?:()=>number;enableDeliveryFunding?:boolean}) {
 const {db}=options,now=options.now??Date.now;
 return {async exhaust(orderId:string){
  if(!quoteEntityIdValid(orderId))throw Error('INVALID_FINANCIAL_SEARCH');
  const key={orderId,SK:'METADATA'},job=await strongGet(db,'WizzDispatchJobs_staging',key);
  if(job?.financialDispatch!==true)throw Error('FINANCIAL_SEARCH_REQUIRED');
  if(job.status==='assigned')return {exhausted:false,assigned:true};
  if(job.status==='no_driver_available'&&job.financialSearchVersion===1)return {exhausted:true,replayed:true};
  if(!['searching','no_driver_available'].includes(job.status)||!quoteEntityIdValid(job.restaurantId)||!Number.isFinite(Date.parse(job.expiresAt)))throw Error('FINANCIAL_SEARCH_CONFLICT');
  const timedOut=Date.parse(job.expiresAt)<=now(),waveNumber=job.currentWaveNumber??0;
  const wave=waveNumber>0?await strongGet(db,'WizzDispatchJobs_staging',{orderId,SK:'FINANCIAL_WAVE#'+waveNumber}):null;
  const maxWaves=job.financialSearchMaxWave??job.maxWaves??4;
  if(!Number.isSafeInteger(maxWaves)||maxWaves<1||maxWaves>1000)throw Error('FINANCIAL_SEARCH_CONFLICT');
  if(!timedOut&&!(waveNumber>=maxWaves&&wave?.state==='EXPIRED'))return {exhausted:false,assigned:false};
  const order=await createStagingDriverOfferOrderReader({db,enableDeliveryFunding:options.enableDeliveryFunding}).read({orderId,branchId:job.restaurantId});
  const search=unavailableDispatchSearch(timedOut?'SEARCH_WINDOW_EXPIRED':'MAX_WAVES_REACHED',new Date(now()).toISOString());
  const checks:any[]=[updateChecked(exactCheck('WizzDispatchJobs_staging',key,job),'SET #s=:s, #r=:r, #at=:at, #sv=:sv',{'#s':'status','#r':'noDriverReason','#at':'updatedAt','#sv':'financialSearchVersion'},{':s':search.status,':r':search.reason,':at':search.observedAt,':sv':1}),
   updateChecked(order.condition,'SET #ds=:ds, #fs=:fs',{'#ds':'dispatchStatus','#fs':'financialSearch'},{':ds':search.status,':fs':search})];
  if(wave){
   if(wave.assignmentId!==job.dispatchJobId||!Array.isArray(wave.driverIds)||wave.driverIds.length>25)throw Error('FINANCIAL_SEARCH_CONFLICT');
   checks.push(updateChecked(exactCheck('WizzDispatchJobs_staging',{orderId,SK:wave.SK},wave),'SET #ws=:ws',{'#ws':'state'},{':ws':'EXPIRED'}));
   for(const driverId of wave.driverIds){
    const offerKey={orderId,SK:`FINANCIAL#${driverId}#WAVE#${waveNumber}`},offer=await strongGet(db,'WaveOffers_staging',offerKey);
    if(!offer||['financial_declined','financial_expired'].includes(offer.responseStatus))continue;
    if(offer.responseStatus!=='financial_pending')throw Error('FINANCIAL_SEARCH_CONFLICT');
    checks.push(updateChecked(exactCheck('WaveOffers_staging',offerKey,offer),'SET #os=:os',{'#os':'responseStatus'},{':os':'financial_expired'}));
   }
  }
  if(order.releaseCondition)checks.push(order.releaseCondition);
  checks.push({ConditionCheck:{TableName:'staging-AccountDeletion',Key:{pk:'BUSINESS_LIFECYCLE#MERCHANT#'+job.restaurantId,sk:'META'},ConditionExpression:'attribute_not_exists(pk)'}});
  await db.send(new TransactWriteCommand({TransactItems:checks}));
  return {exhausted:true,replayed:false};
 }};
}
