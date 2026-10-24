import {financialWaveSK} from './financialDispatchKeys';
import {DynamoDBDocumentClient,TransactWriteCommand} from '@aws-sdk/lib-dynamodb';
import {strongGet,exactCheck,updateChecked,equal,FinancialRow as Row} from './driverFinancialTransaction';
import {resolveFinancialOffer,versionedFinancialOfferView} from './financialOfferVersion';
import {createStagingDriverOfferOrderReader,financialSnapshotFromOrderRead} from './driverOfferOrderReader';
import {quoteHash,quoteEntityIdValid} from './deliveryQuoteRecord';
import {validateDispatchCycle} from './dispatchCycle';
const JOBS='WizzDispatchJobs_staging',OFFERS='WaveOffers_staging';
const fail=(code='FINANCIAL_DELIVERY_PROOF_REQUIRED'):never=>{throw Error(code);};
/** Separate channel acknowledgements on the original offer, never a financial
 * mutation. A provider ACK is not proof of receipt on the driver's device.
 * External send/ACK is at least once; event identity and deadline never change.
 */
export function createStagingFinancialOfferDelivery(options:{db:Pick<DynamoDBDocumentClient,'send'>;now?:()=>number;enableDeliveryFunding?:boolean;enableFullCash?:boolean;
 beforeSend:(orderId:string,driverId:string)=>Promise<void>;
 postSocket:(connectionId:string,message:Row)=>Promise<unknown>;
 postPush:(reference:Row)=>Promise<{statusCode:number;body:string}>}){
 const {db}=options,now=options.now??Date.now;
 return async(driverId:string,message:Row)=>{
  if(!quoteEntityIdValid(driverId)||message?.type!=='financial_wave_offer'||!message.offer||message.eventId!==message.offer.offerId||message.waveNumber!==message.offer.waveNumber)return fail();
  const {orderId,offerId,waveNumber}=message.offer;
  if(![orderId,offerId].every(quoteEntityIdValid)||!Number.isSafeInteger(waveNumber)||waveNumber<1||waveNumber>1000)return fail();
  const key={orderId,SK:`FINANCIAL#${driverId}#WAVE#${waveNumber}`};
  async function fence(){const f=await readStagingFinancialOfferDelivery(options,{orderId,offerId,waveNumber,dispatchDriverId:driverId});if(!equal(message,f.message))return fail();return f;}
  function ack(row:Row,reference:Row){
   const digest=quoteHash(reference),a=row.financialDeliveryAck;
   if(a===undefined)return {schemaVersion:1,referenceDigest:digest,websocketAccepted:false,websocketUnavailable:false,pushAccepted:false};
   if(a.schemaVersion!==1||a.referenceDigest!==digest||!['websocketAccepted','websocketUnavailable','pushAccepted'].every(k=>typeof a[k]==='boolean'))return fail();return a;
  }
  async function check(){const f=await fence();await db.send(new TransactWriteCommand({TransactItems:f.guards as any}));return f;}
  async function mark(field?:'websocketAccepted'|'websocketUnavailable'|'pushAccepted'){
   const f=await fence(),a={...ack(f.saved,f.reference),...(field?{[field]:true}:{}),updatedAt:new Date(now()).toISOString()};
   const writes=[updateChecked(exactCheck(OFFERS,key,f.saved),'SET #ack=:ack',{'#ack':'financialDeliveryAck'},{':ack':a}),...f.guards.filter(g=>g.ConditionCheck.TableName!==OFFERS)];
   try{await db.send(new TransactWriteCommand({TransactItems:writes as any,ClientRequestToken:quoteHash(writes).slice(0,36)}));}
   catch(error){const latest=await strongGet(db,OFFERS,key);if(!latest||!latest.financialDeliveryAck||field&&ack(latest,f.reference)[field]!==true)throw error;}
  }
  let f=await check();if(!f.saved.financialDeliveryAck){await mark();f=await check();}
  let a=ack(f.saved,f.reference);
  if(!a.websocketAccepted&&!a.websocketUnavailable){
   if(typeof f.state?.connectionId!=='string'||!f.state.connectionId.trim())await mark('websocketUnavailable');
   else{await options.beforeSend(orderId,driverId);let accepted=false;try{await options.postSocket(f.state.connectionId,message);accepted=true;}catch(error:any){if(error?.statusCode===410||error?.$metadata?.httpStatusCode===410)await mark('websocketUnavailable');}
    // An uncertain socket send must not prevent the independent push attempt.
    if(accepted)await mark('websocketAccepted');}
  }
  f=await check();a=ack(f.saved,f.reference);
  if(!a.pushAccepted){
   await options.beforeSend(orderId,driverId);
   const response=await options.postPush(f.reference);let body:Row;try{body=JSON.parse(response.body);}catch{return fail('FINANCIAL_DELIVERY_RETRY_REQUIRED');}
   if(response.statusCode<200||response.statusCode>=300||body.success!==true||body.offerId!==offerId||body.eventId!==offerId||body.cycleId!==f.reference.cycleId||body.driverId!==f.reference.driverId||!Number.isSafeInteger(body.successCount)||body.successCount<1)return fail('FINANCIAL_DELIVERY_RETRY_REQUIRED');
   await mark('pushAccepted');
  }
  f=await check();a=ack(f.saved,f.reference);
  if(!a.pushAccepted||!a.websocketAccepted&&!a.websocketUnavailable)return fail('FINANCIAL_DELIVERY_RETRY_REQUIRED');
 };
}

/** Read-only original-offer proof shared by sending, push receiving and driver hydration. */
export async function readStagingFinancialOfferDelivery(options:{db:Pick<DynamoDBDocumentClient,'send'>;now?:()=>number;enableDeliveryFunding?:boolean;enableFullCash?:boolean},selector:{orderId:string;offerId:string;waveNumber:number;dispatchDriverId:string}){
 const {db}=options,now=options.now??Date.now,{orderId,offerId,waveNumber,dispatchDriverId:driverId}=selector;
 if(Object.keys(selector).sort().join(',')!=='dispatchDriverId,offerId,orderId,waveNumber'||![orderId,offerId,driverId].every(quoteEntityIdValid)||!Number.isSafeInteger(waveNumber)||waveNumber<1||waveNumber>1000)return fail();
 const key={orderId,SK:`FINANCIAL#${driverId}#WAVE#${waveNumber}`};
   const saved=await strongGet(db,OFFERS,key),job=await strongGet(db,JOBS,{orderId,SK:'METADATA'}),waveKey={orderId,SK:financialWaveSK(job,waveNumber)},wave=await strongGet(db,JOBS,waveKey);
   if(!job||!saved||saved.responseStatus!=='financial_pending'||saved.isWinner!==false||saved.offerId!==offerId||saved.driverId!==driverId)return fail();
   const offer=resolveFinancialOffer(saved.financialOffer,options.enableDeliveryFunding,options.enableFullCash),cycle=validateDispatchCycle(job?.dispatchCycle);
   if(cycle.engine!=='FINANCIAL'||cycle.assignmentId!==offer.assignmentId||cycle.orderId!==orderId||job?.dispatchJobId!==offer.assignmentId||job.status!=='searching'||job.financialDispatch!==true||job.currentWaveNumber!==waveNumber||job.driverId!=null||job.assignedDriverId!=null||
     !wave||wave.kind!=='FINANCIAL_WAVE'||wave.state!=='READY'||wave.assignmentId!==offer.assignmentId||!Array.isArray(wave.driverIds)||!wave.driverIds.includes(driverId))return fail();
   const intent=await strongGet(db,JOBS,{orderId,SK:'DISPATCH_TRANSITION#'+job.dispatchTransition?.id});
   if(!intent||intent.state!=='APPLIED'||intent.cycleDigest!==cycle.digest||intent.waveNumber!==waveNumber||Date.parse(intent.waveDeadline)<=now())return fail();
   const read=await createStagingDriverOfferOrderReader({db,enableDeliveryFunding:options.enableDeliveryFunding,enableFullCash:options.enableFullCash}).read({orderId,branchId:offer.branchId});
   if(offer.versionedOffer.schemaVersion===2?!equal(financialSnapshotFromOrderRead(read),offer.versionedOffer.financialSnapshot):read.snapshotHash!==offer.snapshotHash)return fail();
   const view=versionedFinancialOfferView(offer,driverId,offer.driverSubjectId,new Date(now()).toISOString(),options.enableDeliveryFunding,options.enableFullCash);
   const expected={type:'financial_wave_offer',eventId:offerId,waveNumber,offer:{...view,...(read.display?{display:read.display}:{})}};
   if(saved.expiresAt!==view.expiresAt||Date.parse(view.expiresAt)>Date.parse(intent.waveDeadline))return fail();
   const state=await strongGet(db,'WizzDriverLiveState_staging',{driverId});
   const reference={financialPushVersion:1,orderId,offerId,waveNumber,dispatchDriverId:driverId,driverId:offer.driverSubjectId,cycleId:cycle.id,expiresAt:view.expiresAt,offerDigest:view.offerDigest};
   const guards=[exactCheck(OFFERS,key,saved),exactCheck(JOBS,{orderId,SK:'METADATA'},job),exactCheck(JOBS,waveKey,wave),exactCheck(JOBS,{orderId,SK:intent.SK},intent),read.condition,...(read.releaseCondition?[read.releaseCondition]:[])];
   return {saved,state,reference,guards,message:expected};
}
