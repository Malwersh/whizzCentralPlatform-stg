const {dispatchOfferSK}=require('../../src/utils/dispatch-cycle-keys');
import {DynamoDBDocumentClient,TransactWriteCommand} from '@aws-sdk/lib-dynamodb';
import {quoteHash} from './deliveryQuoteRecord';
import {strongGet,exactCheck,updateChecked,FinancialRow as Row} from './driverFinancialTransaction';
import {composeDispatchTransaction} from './dispatchTransaction';
import {buildLegacySourcePush,buildLegacySourceMessage,createStagingPinnedLegacyRunner} from './dispatchLegacySource';
import {createStagingLegacyWaveExecutor} from './dispatchLegacy';
const {pinnedWavePushData,pinnedWavePushDigest}=require('../../src/utils/pinned-wave-push');
type Context=Parameters<Parameters<typeof createStagingLegacyWaveExecutor>[0]['sendOffer']>[2];
const fail=(code='LEGACY_DELIVERY_PROOF_REQUIRED'):never=>{throw Error(code);};
/** Channel acknowledgements live on the EXISTING offer. No tokens, addresses,
 * connection ids or credentials are written to deliveryAck or application logs.
 * A provider acknowledgement is not device receipt. Lost network/ACK remains
 * at-least-once; stable offer/event identity lets the client converge.
 */
export function createStagingLegacyOfferDelivery(options:{db:Pick<DynamoDBDocumentClient,'send'>;now?:()=>number;
 beforeSend?:(orderId:string,driverId:string)=>Promise<void>;
 postSocket:(connectionId:string,message:Row)=>Promise<unknown>;
 postPush:(payload:Row)=>Promise<{statusCode:number;body:string}>}){
 const now=options.now??Date.now,{db}=options;
 return async(driverId:string,message:Row,context:Context)=>{
  const data=pinnedWavePushData(buildLegacySourcePush(message),now());
  if(message.dispatchDriverId!==driverId||data.dispatchDriverId!==driverId||message.eventId!==message.offerId)return fail();
  const digest=quoteHash(message),pushDigest=pinnedWavePushDigest(data),key={orderId:message.orderId,SK:dispatchOfferSK({id:message.cycleId,engine:'LEGACY',...(message.dispatchKeyVersion===2?{keyVersion:2}:{})},driverId,message.waveNumber)};
  function ack(row:Row){const a=row.deliveryAck;if(a===undefined)return {schemaVersion:1,messageDigest:digest,pushDigest,websocketAccepted:false,websocketUnavailable:false,pushAccepted:false};
   if(a.schemaVersion!==1||a.messageDigest!==digest||a.pushDigest!==pushDigest||!['websocketAccepted','websocketUnavailable','pushAccepted'].every(k=>typeof a[k]==='boolean'))return fail();return a;}
  async function fence(){const f=await context.fence();if(f.offer.offerId!==message.offerId||f.offer.driverId!==driverId||f.offer.driverSubjectId!==message.driverId||f.offer.dispatchCycleId!==message.cycleId||quoteHash(buildLegacySourceMessage({job:{},offer:f.offer}))!==digest)return fail();return f;}
  async function check(){const f=await fence();await db.send(new TransactWriteCommand({TransactItems:composeDispatchTransaction([],f.guards) as any}));return f;}
  async function mark(field?:'websocketAccepted'|'websocketUnavailable'|'pushAccepted'){
   const f=await fence(),saved={...ack(f.offer),...(field?{[field]:true}:{}),updatedAt:new Date(now()).toISOString()};
   const writes=[updateChecked(exactCheck('WaveOffers_staging',key,f.offer),'SET #ack=:ack',{'#ack':'deliveryAck'},{':ack':saved})];
   const tx=composeDispatchTransaction(writes,f.guards);
   try{await db.send(new TransactWriteCommand({TransactItems:tx as any,ClientRequestToken:quoteHash(tx).slice(0,36)}));}
   catch(error){const latest=await strongGet(db,'WaveOffers_staging',key);if(!latest||field&&ack(latest)[field]!==true||!field&&!latest.deliveryAck)throw error;}
  }
  let f=await check();if(!f.offer.deliveryAck){await mark();f=await check();}let a=ack(f.offer);
  if(!a.websocketAccepted&&!a.websocketUnavailable){
   if(typeof f.connectionId!=='string'||!f.connectionId.trim())await mark('websocketUnavailable');
   else{let result:'ACCEPTED'|'UNAVAILABLE'|'RETRY'='RETRY';
    await options.beforeSend?.(message.orderId,driverId);
    try{await options.postSocket(f.connectionId,message);result='ACCEPTED';}catch(error:any){if(error?.statusCode===410||error?.$metadata?.httpStatusCode===410)result='UNAVAILABLE';}
    if(result!=='RETRY')await mark(result==='ACCEPTED'?'websocketAccepted':'websocketUnavailable');
   }
  }
  f=await check();a=ack(f.offer);
  if(!a.pushAccepted){
   // Receiver checks the same expiry again; never extend validity on retry.
   pinnedWavePushData(buildLegacySourcePush(message),now());let accepted=false;
   await options.beforeSend?.(message.orderId,driverId);
   try{const response=await options.postPush({...data,dispatchMessageDigest:digest}),body=JSON.parse(response.body);
    accepted=response.statusCode>=200&&response.statusCode<300&&body.success===true&&body.offerId===message.offerId&&body.eventId===message.eventId&&body.cycleId===message.cycleId&&body.driverId===message.driverId&&Number.isSafeInteger(body.successCount)&&body.successCount>0;
   }catch{/* Provider errors and unparseable acknowledgements never count as success. */}
   if(accepted)await mark('pushAccepted');
  }
  f=await check();a=ack(f.offer);
  if(!a.pushAccepted||!a.websocketAccepted&&!a.websocketUnavailable)return fail('LEGACY_DELIVERY_RETRY_REQUIRED');
 };
}
/** Trusted production transport binding, still dependency-injected and NOT an
 * enabled Lambda entry point. Existing provider transports are supplied by host. */
export function createStagingLegacyTransportRunner(options:Parameters<typeof createStagingLegacyOfferDelivery>[0]){
 return createStagingPinnedLegacyRunner({...options,sendOffer:createStagingLegacyOfferDelivery(options)});
}

export function createStagingLegacyExistingTransportRunner(options:Omit<Parameters<typeof createStagingLegacyOfferDelivery>[0],'postSocket'|'postPush'>&{api:{postToConnection:(input:Row)=>{promise:()=>Promise<unknown>}};notificationsBase:string;internalKey:string}){
 const {createWaveOfferTransport}=require('../../../lambda/WaveSystem_StartWave/wave-offer-transport');
 const transport=createWaveOfferTransport(options);
 return createStagingLegacyTransportRunner({...options,postSocket:transport.postSocket,postPush:transport.postPush});
}
