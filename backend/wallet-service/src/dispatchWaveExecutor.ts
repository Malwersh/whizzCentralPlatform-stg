import {createStagingDispatchCandidates} from './dispatchCandidates';
import {DynamoDBDocumentClient,TransactWriteCommand} from '@aws-sdk/lib-dynamodb';
import {createStagingDispatchCoordinator} from './dispatchCoordinator';
import {createStagingDriverFinancialWave} from './driverFinancialWave';
import {createStagingDriverOfferContext} from './driverOfferContext';
import {validateDispatchCycle} from './dispatchCycle';
import {composeDispatchTransaction} from './dispatchTransaction';
import {strongGet,updateChecked,exactCheck,detach,FinancialRow as Row} from './driverFinancialTransaction';
import {quoteEntityIdValid,quoteHash} from './deliveryQuoteRecord';
/** Server-only adapter over the existing producer and sender. APPLIED means READY
 * in storage, not notification delivery. delivered[] resumes fixed-event-ID sends.
 * Selection and route/identity dependencies must be trusted, never HTTP data.
 */
export function createStagingDispatchWaveExecutor(options:{db:Pick<DynamoDBDocumentClient,'send'>;now?:()=>number;enableDeliveryFunding?:boolean;
 selectDrivers:(input:{job:Row;intent:Row})=>Promise<string[]>;
 context:(input:{db:Pick<DynamoDBDocumentClient,'send'>;offerDeadline:string;offerTtlSeconds:number;positionMaxAgeSeconds:number;enableDeliveryFunding?:boolean})=>ReturnType<typeof createStagingDriverOfferContext>;
 sendOffer:(driverId:string,message:Row)=>Promise<void>}) {
 const {db}=options,now=options.now??Date.now,coordinator=createStagingDispatchCoordinator({db,now,enableDeliveryFunding:options.enableDeliveryFunding});
 return {async run(input:{orderId:string;assignmentId:string;owner:string;leaseSeconds:number}) {
  if(!input||Object.keys(input).sort().join(',')!=='assignmentId,leaseSeconds,orderId,owner'||![input.orderId,input.assignmentId,input.owner].every(quoteEntityIdValid)||!Number.isSafeInteger(input.leaseSeconds)||input.leaseSeconds<1||input.leaseSeconds>120)throw Error('INVALID_DISPATCH_EXECUTOR');
  const planned=await coordinator.plan({orderId:input.orderId,assignmentId:input.assignmentId,source:'START'});
  if(['STOP','REVIEW'].includes(planned.action))return planned;
  const job=await strongGet(db,'WizzDispatchJobs_staging',{orderId:input.orderId,SK:'METADATA'}),cycle=validateDispatchCycle(job?.dispatchCycle);
  if(cycle.engine!=='FINANCIAL')throw Error('LEGACY_CYCLE_EXECUTOR_NOT_READY');
  const intentId=job!.dispatchTransition?.id;
  const lease=await coordinator.acquire({...input,intentId});if(!lease.acquired)return {handled:true,action:'LEASE_BUSY'};
  const selector={orderId:input.orderId,assignmentId:input.assignmentId,intentId,owner:input.owner,leaseVersion:lease.leaseVersion!};
  const first=await coordinator.executionFence(selector),intent=first.intent,profile=cycle.policy.values.dispatch!.profiles.FINANCIAL;
  const key={orderId:input.orderId,SK:'FINANCIAL_WAVE#'+intent.waveNumber},saved=await strongGet(db,'WizzDispatchJobs_staging',key);
  const driverIds=saved?.driverIds??await options.selectDrivers({job:detach(job!),intent:detach(intent)});
  if(!Array.isArray(driverIds)||driverIds.length>25||new Set(driverIds).size!==driverIds.length||!driverIds.every(quoteEntityIdValid)||(intent.rule.recipients!=='ALL'&&driverIds.length>intent.rule.recipients))throw Error('INVALID_PINNED_RECIPIENTS');
  if(saved&&(saved.transitionId!==intentId||saved.cycleDigest!==cycle.digest||saved.waveNumber!==intent.waveNumber))throw Error('PINNED_WAVE_CONFLICT');
  const fencedDb={send:async(command:any)=>{
   if(!(command instanceof TransactWriteCommand))return db.send(command);
   const fence=await coordinator.executionFence(selector),tx:Row[]=detach(command.input.TransactItems as Row[]);
   for(const op of tx){if(op.Put?.TableName==='WizzDispatchJobs_staging'&&op.Put.Item.SK===key.SK)Object.assign(op.Put.Item,{waveNumber:intent.waveNumber,transitionId:intentId,cycleDigest:cycle.digest});
    if(op.Put?.TableName==='WaveOffers_staging'&&Date.parse(op.Put.Item.expiresAt)>Date.parse(intent.waveDeadline))throw Error('PINNED_OFFER_DEADLINE_EXCEEDED');}
   const ready=tx.some(op=>op.Update?.TableName==='WizzDispatchJobs_staging'&&op.Update.Key.SK===key.SK&&op.Update.UpdateExpression.replace(/^SET /,'').split(',').some((term:string)=>{const [field,value]=term.trim().split(/\s*=\s*/);return op.Update.ExpressionAttributeNames?.[field]==='state'&&op.Update.ExpressionAttributeValues?.[value]==='READY';}));
   let guards=fence.guards;
   if(ready){
    for(const driverId of driverIds){const offerKey={orderId:input.orderId,SK:'FINANCIAL#'+driverId+'#WAVE#'+intent.waveNumber},offer=await strongGet(db,'WaveOffers_staging',offerKey);if(!offer||offer.responseStatus!=='financial_pending'||offer.dispatchJobId!==input.assignmentId||offer.waveNumber!==intent.waveNumber||!Number.isFinite(Date.parse(offer.expiresAt))||Date.parse(offer.expiresAt)<=now()||Date.parse(offer.expiresAt)>Date.parse(intent.waveDeadline))throw Error('PINNED_OFFERS_NOT_READY');guards.push(exactCheck('WaveOffers_staging',offerKey,offer));}
    const intentGuard=guards.find(g=>g.ConditionCheck?.TableName==='WizzDispatchJobs_staging'&&g.ConditionCheck.Key.SK==='DISPATCH_TRANSITION#'+intentId)!;
    if(fence.intent.state==='APPLIED')throw Error('PINNED_READY_ALREADY_APPLIED');
    guards=guards.filter(g=>g!==intentGuard);tx.push(updateChecked(intentGuard,'SET #applyState=:applyState, #applyAt=:applyAt',{'#applyState':'state','#applyAt':'appliedAt'},{':applyState':'APPLIED',':applyAt':new Date(now()).toISOString()}));
   }
   const operations=composeDispatchTransaction(tx,guards);
   return db.send(new TransactWriteCommand({TransactItems:operations as any,ClientRequestToken:quoteHash(operations).slice(0,36)}));
  }} as Pick<DynamoDBDocumentClient,'send'>;
  const context=options.context({db:fencedDb,enableDeliveryFunding:options.enableDeliveryFunding,offerDeadline:intent.waveDeadline,offerTtlSeconds:profile.offerTtlSeconds,positionMaxAgeSeconds:profile.positionMaxAgeSeconds!});
  const producer=createStagingDriverFinancialWave({db:fencedDb,context,enableDeliveryFunding:options.enableDeliveryFunding,pinnedTransitionId:intentId,operating:{...cycle.policy,condition:null},now,sendOffer:async(driverId,message)=>{
   await coordinator.executionFence(selector);await options.sendOffer(driverId,message);
  }});
  try{return await producer.run({orderId:input.orderId,branchId:job!.restaurantId,waveNumber:intent.waveNumber,driverIds});}
  catch(error){
   const latest=await strongGet(db,'WizzDispatchJobs_staging',{orderId:input.orderId,SK:'METADATA'});
   if(latest?.dispatchJobId===input.assignmentId&&latest.status==='assigned')return {handled:true,action:'STOP',reason:'ASSIGNED'};
   throw error;
  }
 }};
}

/** Production dependency shape, still not an activated runtime entry point.
 * Candidate selection uses the shared Legacy algorithm with captured policy.
 */
export function createStagingPinnedFinancialRunner(options:Omit<Parameters<typeof createStagingDriverOfferContext>[0],'positionMaxAgeSeconds'|'offerTtlSeconds'|'offerDeadline'> & {sendOffer:(driverId:string,message:Row)=>Promise<void>}) {
 const selectDrivers=createStagingDispatchCandidates({db:options.db,now:options.now,enableDeliveryFunding:options.enableDeliveryFunding});
 return createStagingDispatchWaveExecutor({db:options.db,now:options.now,enableDeliveryFunding:options.enableDeliveryFunding,selectDrivers,sendOffer:options.sendOffer,
  context:input=>createStagingDriverOfferContext({...input,cognito:options.cognito,router:options.router,now:options.now})});
}
