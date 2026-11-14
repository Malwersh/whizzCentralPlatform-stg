const workRegions=require('../../shared/driver-work-region-311');
const vehicleRegistry=require('../../shared/driver-vehicles-308');
const {dispatchWaveSK,dispatchOfferSK}=require('../../src/utils/dispatch-cycle-keys');
import {DynamoDBDocumentClient,TransactWriteCommand,GetCommand} from '@aws-sdk/lib-dynamodb';
import {dispatchResponseQueue} from './dispatchResponseEvent';
import {createStagingDispatchCoordinator} from './dispatchCoordinator';
import {validateDispatchCycle} from './dispatchCycle';
import {composeDispatchTransaction} from './dispatchTransaction';
import {strongGet,exactCheck,updateChecked,detach,equal,FinancialRow as Row} from './driverFinancialTransaction';
import {quoteEntityIdValid,quoteHash} from './deliveryQuoteRecord';
const {isDriverApproved}=require('../../../lambda/WaveSystem_StartWave/driver_eligibility');
const {FINANCIAL_FIELDS}=require('../../order-service/legacy-order-policy');
const T={jobs:'WizzDispatchJobs_staging',orders:'WizzOrders',offers:'WaveOffers_staging',drivers:'WhizzDrivers_staging',live:'WizzDriverLiveState_staging',locks:'staging-AccountDeletion',holds:'staging-Holds',wallets:'staging-Wallets'};
const bad=(code='PINNED_LEGACY_CONFLICT'):never=>{throw Error(code);};
const iso=(n:number)=>new Date(n).toISOString();
const date=(v:any)=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&iso(Date.parse(v))===v;
const fields=['offerId','orderId','driverId','waveNumber','dispatchJobId','dispatchCycleId','driverSubjectId','sentAt','expiresAt','baseDeliveryFee','bonusAmount','estimatedEarningsAtOffer','holdRequiredAmount','currency','legacyOrderDigest'];
const orderDigest=(order:Row)=>quoteHash(Object.fromEntries(Object.entries(order).filter(([k])=>!['updatedAt','updatedBy','walletPendingHoldId','holdId','holdStatus','holdAmount'].includes(k))));
const branchFields=['businessId','status','businessName','name','address','latitude','longitude','regionId','businessPhotoUrl','isDeleted','deletedAt','deletionRequestId'];
export const legacyBranchProof=(row:Row)=>quoteHash(Object.fromEntries(branchFields.map(k=>[k,row[k]])));
async function sourceBranchGuards(db:Pick<DynamoDBDocumentClient,'send'>,offer:Row,branchId:string):Promise<Row[]>{
 if(offer.legacySourceVersion!==1)return [];
 const branch=await strongGet(db,'WhizzMerchants_Businesses',{businessId:branchId});
 if(!branch||offer.legacyBranchDigest!==legacyBranchProof(branch))return bad('LEGACY_BRANCH_SOURCE_CHANGED');
 return [exactCheck('WhizzMerchants_Businesses',{businessId:branchId},branch,branchFields)];
}
const terms=(row:Row)=>({...(row.driverVehicleSnapshot?{driverVehicleSnapshot:row.driverVehicleSnapshot}:{}),...('dispatchKeyVersion' in row?{dispatchKeyVersion:row.dispatchKeyVersion}:{}),...Object.fromEntries(fields.map(k=>[k,row[k]])),...(row.legacySourceVersion===1?{legacySourceVersion:1,tipAmount:row.tipAmount,legacyBranchDigest:row.legacyBranchDigest,legacyPresentationDigest:row.legacyPresentationDigest}:{})});
function validateOffer(row:Row,intent:Row,cycle:Row,driverId:string){
 if(!row||row.dispatchKeyVersion!==cycle.keyVersion||row.SK!==dispatchOfferSK(cycle,driverId,intent.waveNumber)||typeof row.legacyOrderDigest!=='string'||row.orderId!==cycle.orderId||row.driverId!==driverId||row.waveNumber!==intent.waveNumber||row.dispatchJobId!==cycle.assignmentId||row.dispatchCycleId!==cycle.id||!quoteEntityIdValid(row.offerId)||!quoteEntityIdValid(row.driverSubjectId)||row.currency!=='IQD'||![row.baseDeliveryFee,row.estimatedEarningsAtOffer,row.holdRequiredAmount].every(n=>Number.isSafeInteger(n)&&n>=0)||row.bonusAmount!==0||row.estimatedEarningsAtOffer!==row.baseDeliveryFee+(row.legacySourceVersion===1?row.tipAmount:0)||row.legacySourceVersion!==undefined&&row.legacySourceVersion!==1||row.legacySourceVersion===1&&(!Number.isSafeInteger(row.tipAmount)||row.tipAmount<0||typeof row.legacyBranchDigest!=='string'||!/^[a-f0-9]{64}$/.test(row.legacyBranchDigest)||row.legacyPresentationDigest!==quoteHash(row.legacyPresentation))||!date(row.sentAt)||!date(row.expiresAt)||Date.parse(row.sentAt)<Date.parse(intent.createdAt)||Date.parse(row.expiresAt)<=Date.parse(row.sentAt)||Date.parse(row.expiresAt)>Math.min(Date.parse(intent.waveDeadline),Date.parse(row.sentAt)+intent.offerTtlSeconds*1000)||row.legacyTermsDigest!==quoteHash(terms(row)))return bad();
}
async function driverReferences(db:Pick<DynamoDBDocumentClient,'send'>,driverId:string,subjectId:string|undefined,age:number|null,at:number,targetRegion?:string,waveNumber=1,skipRegion=false){
 const profile=await strongGet(db,T.drivers,{driverId}),state=await strongGet(db,T.live,{driverId});
 const sub=profile?.cognitoSub??driverId;
 if(!quoteEntityIdValid(driverId)||!quoteEntityIdValid(sub)||(subjectId!==undefined&&sub!==subjectId)||!profile||!isDriverApproved(profile)||profile.isDeleted===true||profile.deletedAt!=null||profile.deletionRequestId!=null||profile.isBanned===true||profile.isSuspended===true||!state||state.status!=='available'||state.isSearching!==true||state.isActive!==true||state.currentOrderId!=null||(state.activeOrdersCount??0)!==0)return bad('LEGACY_DRIVER_UNAVAILABLE');
 if(age!==null&&(!date(state.locationUpdatedAt)||Date.parse(state.locationUpdatedAt)>at||Date.parse(state.locationUpdatedAt)+age*1000<=at))return bad('LEGACY_DRIVER_LOCATION_UNAVAILABLE');
 const vehicle=vehicleRegistry.enforce(profile)?vehicleRegistry.eligibility(profile,at):null;
 if(vehicle&&!vehicle.eligible)return bad('LEGACY_DRIVER_UNAVAILABLE');
 const scope=workRegions.enforced()&&!skipRegion?await workRegions.create({db,GetCommand}).check(profile,state.current_work_region_id,targetRegion,waveNumber===1?0:1,{lat:state.lat,lng:state.lng}):null;
 if(scope&&!scope.allowed)return bad('LEGACY_DRIVER_REGION_UNAVAILABLE');
 const guards:Row[]=[...(scope?.guards??[]),exactCheck(T.drivers,{driverId},profile,[...new Set([...Object.keys(profile),'deletionRequestId','deletedAt','isDeleted','isBanned','isSuspended'])]),exactCheck(T.live,{driverId},state,[...new Set([...Object.keys(state),'currentOrderId','activeOrdersCount'])])];
 for(const pk of new Set(['ACCOUNT_LIFECYCLE#DRIVER#'+sub,'ACCOUNT_LIFECYCLE#DRIVER#'+driverId])){if(await strongGet(db,T.locks,{pk,sk:'META'}))return bad('LEGACY_DRIVER_UNAVAILABLE');guards.push({ConditionCheck:{TableName:T.locks,Key:{pk,sk:'META'},ConditionExpression:'attribute_not_exists(pk)'}});}
 return {subjectId:sub,state,guards,vehicle};
}
async function commit(db:Pick<DynamoDBDocumentClient,'send'>,writes:Row[],guards:Row[]){const tx=composeDispatchTransaction(writes,guards);await db.send(new TransactWriteCommand({TransactItems:tx as any,ClientRequestToken:quoteHash(tx).slice(0,36)}));}
/** Adapter, not another coordinator. Price preparation must be server-owned and
 * read from the supplied order; this adapter never guesses price units or funds.
 * No public event accepts prepareOffer, messages, guard expressions or recipients.
 */
export function createStagingLegacyWaveExecutor(options:{db:Pick<DynamoDBDocumentClient,'send'>;now?:()=>number;
 selectDrivers:(input:{job:Row;intent:Row})=>Promise<string[]>;
 prepareOffer:(input:{job:Row;intent:Row;order:Row;driverId:string})=>Promise<Row|{record:Row;sourceGuards:Row[]}>;
 message:(input:{job:Row;offer:Row})=>Promise<Row>;
 sendOffer:(driverId:string,message:Row,context:{fence:()=>Promise<{guards:Row[];offer:Row;connectionId?:string}>})=>Promise<void>}){
 const {db}=options,now=options.now??Date.now,coordinator=createStagingDispatchCoordinator({db,now});
 return {async run(input:{orderId:string;assignmentId:string;owner:string;leaseSeconds:number}){
  if(!input||Object.keys(input).sort().join(',')!=='assignmentId,leaseSeconds,orderId,owner'||![input.orderId,input.assignmentId,input.owner].every(quoteEntityIdValid)||!Number.isSafeInteger(input.leaseSeconds)||input.leaseSeconds<1||input.leaseSeconds>120)return bad();
  const planned=await coordinator.plan({orderId:input.orderId,assignmentId:input.assignmentId,source:'START'});if(['STOP','REVIEW'].includes(planned.action))return planned;
  const job=await strongGet(db,T.jobs,{orderId:input.orderId,SK:'METADATA'}),cycle=validateDispatchCycle(job?.dispatchCycle);if(cycle.engine!=='LEGACY')return bad('LEGACY_ENGINE_REQUIRED');
  const intentId=job!.dispatchTransition.id,lease=await coordinator.acquire({...input,intentId});if(!lease.acquired)return {handled:true,action:'LEASE_BUSY'};
  const selector={orderId:input.orderId,assignmentId:input.assignmentId,intentId,owner:input.owner,leaseVersion:lease.leaseVersion!},first=await coordinator.executionFence(selector),intent=first.intent;
  const key={orderId:input.orderId,SK:dispatchWaveSK(cycle,intent.waveNumber)};let wave=await strongGet(db,T.jobs,key);
  if(!wave){const ids=await options.selectDrivers({job:detach(job!),intent:detach(intent)});
   if(!Array.isArray(ids)||ids.length>25||new Set(ids).size!==ids.length||!ids.every(quoteEntityIdValid)||(intent.rule.recipients!=='ALL'&&ids.length>intent.rule.recipients))return bad('LEGACY_RECIPIENT_LIMIT');
   wave={...key,kind:'DISPATCH_WAVE',state:'PREPARING',assignmentId:input.assignmentId,branchId:job!.restaurantId,cycleDigest:cycle.digest,transitionId:intentId,waveNumber:intent.waveNumber,driverIds:[...ids].sort(),delivered:[],createdAt:iso(now())};
   const fence=await coordinator.executionFence(selector);try{await commit(db,[{Put:{TableName:T.jobs,Item:wave,ConditionExpression:'attribute_not_exists(orderId)'}}],fence.guards);}catch{wave=await strongGet(db,T.jobs,key);if(!wave)return bad();}
  }
  if(wave.kind!=='DISPATCH_WAVE'||wave.assignmentId!==input.assignmentId||wave.cycleDigest!==cycle.digest||wave.transitionId!==intentId||wave.waveNumber!==intent.waveNumber||!['PREPARING','READY'].includes(wave.state)||!Array.isArray(wave.driverIds)||wave.driverIds.length>25||new Set(wave.driverIds).size!==wave.driverIds.length||!wave.driverIds.every(quoteEntityIdValid)||!Array.isArray(wave.delivered)||wave.delivered.some((id:string)=>!wave!.driverIds.includes(id)))return bad();
  const age=cycle.policy.values.dispatch!.profiles.LEGACY.positionMaxAgeSeconds;
  for(const driverId of wave.driverIds){
   const offerKey={orderId:input.orderId,SK:dispatchOfferSK(cycle,driverId,intent.waveNumber)};let saved=await strongGet(db,T.offers,offerKey);
   if(!saved&&wave.state==='PREPARING'){
    const order=await strongGet(db,T.orders,{PK:'ORDER#'+input.orderId,SK:'META'});if(!order)return bad();
    const refs=await driverReferences(db,driverId,undefined,age,now(),job!.restaurantRegionId,intent.waveNumber),result=await options.prepareOffer({job:detach(job!),intent:detach(intent),order:detach(order),driverId});
    const prepared:Row=result.record??result,sourceGuards:Row[]=result.record?result.sourceGuards:[];if(!Array.isArray(sourceGuards))return bad();
    if(prepared?.responseStatus!=='pending'||prepared.isWinner!==false)return bad();
    const proposed:Row={...detach(prepared),...offerKey,dispatchJobId:input.assignmentId,dispatchCycleId:cycle.id,driverSubjectId:refs.subjectId,...(cycle.keyVersion===2?{dispatchKeyVersion:2}:{}),legacyOrderDigest:orderDigest(order),waveNumber:intent.waveNumber,driverId};if(cycle.keyVersion===2)proposed.offerId='OFFER_'+cycle.orderId+'_C'+quoteHash({cycle:cycle.id,driverId,wave:intent.waveNumber}).slice(0,48)+'_W'+intent.waveNumber;if(refs.vehicle){proposed.driverVehicleSnapshot=refs.vehicle.vehicle;if(refs.vehicle.validUntil)proposed.expiresAt=new Date(Math.min(Date.parse(proposed.expiresAt),Date.parse(refs.vehicle.validUntil))).toISOString();}proposed.legacyTermsDigest=quoteHash(terms(proposed));validateOffer(proposed,intent,cycle,driverId);
    if(Date.parse(proposed.sentAt)>now()||Date.parse(proposed.expiresAt)<=now())return bad('LEGACY_OFFER_EXPIRED');
    const fence=await coordinator.executionFence(selector),orderFields=[...new Set([...Object.keys(order),...FINANCIAL_FIELDS])];
    try{await commit(db,[{Put:{TableName:T.offers,Item:proposed,ConditionExpression:'attribute_not_exists(orderId)'}}],[...fence.guards,...refs.guards,...sourceGuards,exactCheck(T.orders,{PK:'ORDER#'+input.orderId,SK:'META'},order,orderFields)]);saved=proposed;}
    catch{saved=await strongGet(db,T.offers,offerKey);if(!saved||!equal(saved,proposed))return bad();}
   }
   if(!saved)return bad();validateOffer(saved,intent,cycle,driverId);
  }
  if(wave.state==='PREPARING'){
   const fence=await coordinator.executionFence(selector),current=await strongGet(db,T.jobs,{orderId:input.orderId,SK:'METADATA'}),intentGuard=fence.guards.find(g=>g.ConditionCheck?.Key.SK==='DISPATCH_TRANSITION#'+intentId)!;
   const writes:Row[]=[updateChecked(exactCheck(T.jobs,key,wave),'SET #ready=:ready',{'#ready':'state'},{':ready':'READY'}),updateChecked(exactCheck(T.jobs,{orderId:input.orderId,SK:'METADATA'},current!),'SET #wave=:wave',{'#wave':'currentWaveNumber'},{':wave':intent.waveNumber}),updateChecked(intentGuard,'SET #ready=:ready, #at=:at',{'#ready':'state','#at':'appliedAt'},{':ready':'APPLIED',':at':iso(now())})];
   const guards=fence.guards.filter(g=>g!==intentGuard);
   for(const id of wave.driverIds){const k={orderId:input.orderId,SK:dispatchOfferSK(cycle,id,intent.waveNumber)},row=await strongGet(db,T.offers,k);if(!row||row.responseStatus!=='pending'||Date.parse(row.expiresAt)<=now())return bad();validateOffer(row,intent,cycle,id);guards.push(exactCheck(T.offers,k,row));}
   try{await commit(db,writes,guards);}catch{const latest=await strongGet(db,T.jobs,key),ack=await strongGet(db,T.jobs,{orderId:input.orderId,SK:'DISPATCH_TRANSITION#'+intentId});if(latest?.state!=='READY'||ack?.state!=='APPLIED')return bad();}
  }
  let deliveryRetry=false;
  try{for(const driverId of wave.driverIds){
   const current=await strongGet(db,T.jobs,key);if(!current||current.state!=='READY')return bad();if(current.delivered.includes(driverId))continue;
   const k={orderId:input.orderId,SK:dispatchOfferSK(cycle,driverId,intent.waveNumber)},offer=await strongGet(db,T.offers,k);if(!offer)return bad();validateOffer(offer,intent,cycle,driverId);
   if(['rejected','expired'].includes(offer.responseStatus)||Date.parse(offer.expiresAt)<=now())continue;if(offer.responseStatus!=='pending')return bad();
   const response=await coordinator.responseFence({orderId:input.orderId,assignmentId:input.assignmentId,waveNumber:intent.waveNumber});if(offer.legacyOrderDigest!==orderDigest(response.order))return bad('LEGACY_ORDER_TERMS_CHANGED');
   const refs=await driverReferences(db,driverId,offer.driverSubjectId,age,now(),job!.restaurantRegionId,intent.waveNumber),fence=await coordinator.executionFence(selector);
   await commit(db,[],[...fence.guards,...response.guards,...refs.guards,...await sourceBranchGuards(db,offer,job!.restaurantId),exactCheck(T.jobs,key,current),exactCheck(T.offers,k,offer)]);
   const message=await options.message({job:detach(job!),offer:detach(offer)});
   if(message?.type!=='new_wave_offer'||message.offer?.offerId!==offer.offerId||message.offer?.orderId!==offer.orderId||message.offer?.jobId!==input.assignmentId||message.offer?.holdRequiredAmount!==offer.holdRequiredAmount||message.offer?.deliveryFee!==offer.baseDeliveryFee||message.offer?.estimatedEarnings!==offer.estimatedEarningsAtOffer||message.offer?.currency!=='IQD'||message.offer?.expiresAt!==offer.expiresAt)return bad('LEGACY_MESSAGE_TERMS_CHANGED');
   if(offer.legacySourceVersion===1&&(message.eventId!==offer.offerId||message.driverId!==offer.driverSubjectId||message.cycleId!==offer.dispatchCycleId||message.offer.dispatchCycleId!==offer.dispatchCycleId||message.offer.tip!==offer.tipAmount||message.offer.moneyUnit!=='IQD_WHOLE'||message.offer.legacySourceVersion!==1||Buffer.byteLength(JSON.stringify(message))>24000))return bad('LEGACY_MESSAGE_SOURCE_CHANGED');
   const deliveryFence=async()=>{
    const row=await strongGet(db,T.offers,k);if(!row||row.responseStatus!=='pending'||row.isWinner!==false||row.legacyTermsDigest!==offer.legacyTermsDigest||Date.parse(row.expiresAt)<=now())return bad('LEGACY_OFFER_EXPIRED');
    validateOffer(row,intent,cycle,driverId);
    const bound=await coordinator.responseFence({orderId:input.orderId,assignmentId:input.assignmentId,waveNumber:intent.waveNumber});
    if(row.legacyOrderDigest!==orderDigest(bound.order))return bad('LEGACY_ORDER_TERMS_CHANGED');
    const refs=await driverReferences(db,driverId,row.driverSubjectId,age,now(),job!.restaurantRegionId,intent.waveNumber),lease=await coordinator.executionFence(selector);
    return {offer:row,connectionId:refs.state.connectionId,guards:[...lease.guards,...bound.guards,...refs.guards,...await sourceBranchGuards(db,row,job!.restaurantId),exactCheck(T.offers,k,row)]};
   };
   await coordinator.executionFence(selector);
   try{await options.sendOffer(driverId,{...message,eventId:offer.offerId},{fence:deliveryFence});}
   catch(error:any){if(error?.message!=='LEGACY_DELIVERY_RETRY_REQUIRED')throw error;deliveryRetry=true;continue;}
   const ack=await coordinator.executionFence(selector);try{await commit(db,[updateChecked(exactCheck(T.jobs,key,current),'SET #delivered=:delivered',{'#delivered':'delivered'},{':delivered':[...current.delivered,driverId]})],ack.guards);}catch{if(!(await strongGet(db,T.jobs,key))?.delivered?.includes(driverId))return bad('LEGACY_DELIVERY_ACK_UNCERTAIN');}
  }}catch(e){const latest=await strongGet(db,T.jobs,{orderId:input.orderId,SK:'METADATA'});if(latest?.dispatchJobId===input.assignmentId&&latest.status==='assigned')return {handled:true,action:'STOP',reason:'ASSIGNED'};throw e;}
  if(deliveryRetry)return bad('LEGACY_DELIVERY_RETRY_REQUIRED');
  return {kind:'LEGACY_WAVE_READY',waveNumber:intent.waveNumber,offers:wave.driverIds.length,timeoutAt:intent.waveDeadline};
 }};
}

/** Atomic Legacy assignment using an ALREADY reserved hold. It never creates,
 * releases or settles money. Legacy pre-hold orchestration must recover uncertain
 * assignment results before releasing funds; this is not the financial writer.
 */
export function createStagingLegacyResponses(options:{db:Pick<DynamoDBDocumentClient,'send'>;now?:()=>number;authenticateDriver:()=>Promise<{driverId:string;subjectId:string}>;acceptanceAttemptId?:string}){
 const {db}=options,now=options.now??Date.now,coordinator=createStagingDispatchCoordinator({db,now});
 async function resumeDecline(offer:Row){try{return {success:true,declined:true,offerId:offer.offerId,transition:await coordinator.plan({orderId:offer.orderId,assignmentId:offer.dispatchJobId,source:'DECLINE'})};}catch{return {success:true,declined:true,offerId:offer.offerId,transitionPending:true};}}
 async function run(action:'ACCEPT'|'DECLINE'|'INSPECT',input:{orderId:string;offerId:string;waveNumber:number}):Promise<Row>{
  if(!['ACCEPT','DECLINE','INSPECT'].includes(action)||!input||Object.keys(input).sort().join(',')!=='offerId,orderId,waveNumber'||![input.orderId,input.offerId].every(quoteEntityIdValid)||!Number.isSafeInteger(input.waveNumber)||input.waveNumber<1)return bad();
  const actor=detach(await options.authenticateDriver());if(!actor||![actor.driverId,actor.subjectId].every(quoteEntityIdValid))return bad('UNAUTHORIZED');
  const currentJob=await strongGet(db,T.jobs,{orderId:input.orderId,SK:'METADATA'}),currentCycle=validateDispatchCycle(currentJob?.dispatchCycle);
  const key={orderId:input.orderId,SK:dispatchOfferSK(currentCycle,actor.driverId,input.waveNumber)},offer=await strongGet(db,T.offers,key);
  if(!offer||offer.offerId!==input.offerId||offer.orderId!==input.orderId||offer.driverId!==actor.driverId||offer.waveNumber!==input.waveNumber||offer.driverSubjectId!==actor.subjectId||offer.legacyTermsDigest!==quoteHash(terms(offer)))return bad();
  const receipt=()=>offer.responseStatus==='accepted'&&offer.isWinner===true&&offer.dispatchReceipt?.driverId===actor.driverId&&offer.dispatchReceipt?.subjectId===actor.subjectId&&offer.dispatchReceipt?.offerId===input.offerId?{...detach(offer.dispatchReceipt),replayed:true}:null;
  const previous=receipt();if(action!=='DECLINE'&&previous)return previous;if(action==='DECLINE'&&offer.responseStatus==='rejected')return resumeDecline(offer);
  if(offer.responseStatus!=='pending'||offer.isWinner!==false||!date(offer.expiresAt)||Date.parse(offer.expiresAt)<=now())return bad('LEGACY_OFFER_EXPIRED');
  const bound=await coordinator.responseFence({orderId:input.orderId,assignmentId:offer.dispatchJobId,waveNumber:input.waveNumber});
  if(bound.cycle.engine!=='LEGACY'||offer.legacyOrderDigest!==orderDigest(bound.order)||!bound.wave.driverIds.includes(actor.driverId))return bad('LEGACY_ENGINE_REQUIRED');validateOffer(offer,bound.intent,bound.cycle,actor.driverId);
  const refs=await driverReferences(db,actor.driverId,actor.subjectId,bound.cycle.policy.values.dispatch!.profiles.LEGACY.positionMaxAgeSeconds,now(),action==='DECLINE'?undefined:bound.job.restaurantRegionId,input.waveNumber,action==='DECLINE'),at=iso(now());
  refs.guards.push(...await sourceBranchGuards(db,offer,bound.job.restaurantId));
  if(action!=='DECLINE'&&refs.vehicle&&(!offer.driverVehicleSnapshot||offer.driverVehicleSnapshot.id!==refs.vehicle.vehicle.id||offer.driverVehicleSnapshot.fingerprint!==refs.vehicle.vehicle.fingerprint))return bad('LEGACY_DRIVER_UNAVAILABLE');
  if(action==='INSPECT')return {kind:'LEGACY_ACCEPTANCE_INSPECTION',actor,offer,cycleId:bound.cycle.id,guards:[...bound.guards,...refs.guards,exactCheck(T.offers,key,offer)]};
  const eventId='DR:'+quoteHash({cycle:bound.cycle.id,offerId:offer.offerId,action}).slice(0,48),event={orderId:input.orderId,SK:'DISPATCH_RESPONSE#'+eventId,kind:'DISPATCH_RESPONSE_OUTBOX',state:'PENDING',eventId,eventType:action==='ACCEPT'?'ACCEPTED':'DECLINED',cycleId:bound.cycle.id,assignmentId:offer.dispatchJobId,offerId:offer.offerId,driverId:actor.driverId,subjectId:actor.subjectId,branchId:bound.job.restaurantId,waveNumber:input.waveNumber,createdAt:at};
  const eventWrite={Put:{TableName:T.jobs,Item:event,ConditionExpression:'attribute_not_exists(orderId)'}};
  if(action==='DECLINE'){
   const fresh=await options.authenticateDriver();if(!equal(fresh,actor))return bad('UNAUTHORIZED');if(Date.parse(offer.expiresAt)<=now())return bad('LEGACY_OFFER_EXPIRED');
   try{await commit(db,[updateChecked(exactCheck(T.offers,key,offer),'SET #state=:state, #at=:at',{'#state':'responseStatus','#at':'responseAt'},{':state':'rejected',':at':at}),eventWrite,dispatchResponseQueue(event)],[...bound.guards,...refs.guards]);}
   catch{const saved=await strongGet(db,T.offers,key);if(saved?.responseStatus!=='rejected'||saved.legacyTermsDigest!==offer.legacyTermsDigest)return bad('LEGACY_DECLINE_UNAVAILABLE');}
   return resumeDecline(offer);
  }
  if((bound.order.assignmentAttemptCounter??0)!==0)return bad('LEGACY_REASSIGNMENT_NOT_READY');
  const holdKey={orderId:input.orderId,sk:'HOLD'},hold=await strongGet(db,T.holds,holdKey),amount=offer.holdRequiredAmount;let moneyGuards:Row[]=[],holdId:string|null=null;
  if(amount>0){
   if(!hold||hold.orderId!==input.orderId||hold.status!=='ACTIVE'||hold.amount!==amount||hold.financialSchemaVersion!==undefined||!quoteEntityIdValid(hold.holdId)||typeof hold.walletId!=='string'||(hold.metadata?.assignmentAttempt??1)!==1)return bad('LEGACY_RESERVATION_REQUIRED');
   const wallet=await strongGet(db,T.wallets,{walletId:hold.walletId,sk:'META'});
   if(!wallet||wallet.ownerType!=='DRIVER'||wallet.ownerId!==actor.driverId||wallet.status!=='ACTIVE'||wallet.currency!=='IQD'||wallet.deletionRequestId!=null||!Number.isSafeInteger(wallet.version)||!Number.isSafeInteger(wallet.lockedBalance)||wallet.lockedBalance<amount)return bad('LEGACY_RESERVATION_REQUIRED');
   holdId=hold.holdId;moneyGuards=[exactCheck(T.holds,holdKey,hold),exactCheck(T.wallets,{walletId:hold.walletId,sk:'META'},wallet,[...new Set([...Object.keys(wallet),'deletionRequestId'])])];
  }else{if(hold)return bad('LEGACY_RESERVATION_CONFLICT');moneyGuards=[{ConditionCheck:{TableName:T.holds,Key:holdKey,ConditionExpression:'attribute_not_exists(orderId)'}}];}
  if(bound.order.holdId!=null&&bound.order.holdId!==holdId)return bad('LEGACY_RESERVATION_CONFLICT');
  if(bound.order.pricing!==undefined&&(!bound.order.pricing||typeof bound.order.pricing!=='object'||Array.isArray(bound.order.pricing)))return bad();
  let attempt:Row|null=null,attemptKey:Row|null=null;
  if(options.acceptanceAttemptId){
   if(!quoteEntityIdValid(options.acceptanceAttemptId))return bad();attemptKey={orderId:input.orderId,SK:'DISPATCH_ACCEPTANCE#'+options.acceptanceAttemptId};attempt=await strongGet(db,T.jobs,attemptKey);
   if(!attempt||attempt.kind!=='LEGACY_ACCEPTANCE_ATTEMPT'||attempt.attemptId!==options.acceptanceAttemptId||attempt.state!=='ASSIGNMENT_PENDING'||attempt.driverId!==actor.driverId||attempt.subjectId!==actor.subjectId||attempt.offerId!==offer.offerId||attempt.cycleId!==bound.cycle.id||attempt.offerDigest!==offer.legacyTermsDigest||attempt.amount!==amount||attempt.holdId!==holdId||(amount>0&&hold?.metadata?.pinnedDispatchAttemptId!==options.acceptanceAttemptId))return bad('LEGACY_ACCEPTANCE_ATTEMPT_CONFLICT');
  }
  const result={success:true,kind:'PINNED_LEGACY_ACCEPTANCE',offerId:offer.offerId,orderId:input.orderId,driverId:actor.driverId,subjectId:actor.subjectId,acceptedAt:at,holdId,holdStatus:amount?'ACTIVE':'NOT_REQUIRED',holdAmount:amount,assignmentAttempt:1,replayed:false,...(options.acceptanceAttemptId?{acceptanceAttemptId:options.acceptanceAttemptId}:{})};
  const writes:Row[]=[eventWrite,dispatchResponseQueue(event),
   updateChecked(exactCheck(T.offers,key,offer),'SET #state=:state, #winner=:winner, #at=:at, #receipt=:receipt',{'#state':'responseStatus','#winner':'isWinner','#at':'responseAt','#receipt':'dispatchReceipt'},{':state':'accepted',':winner':true,':at':at,':receipt':result}),
   updateChecked(exactCheck(T.jobs,{orderId:input.orderId,SK:'METADATA'},bound.job),'SET #state=:state, #driver=:driver, #at=:at',{'#state':'status','#driver':'assignedDriverId','#at':'assignedAt'},{':state':'assigned',':driver':actor.driverId,':at':at}),
   updateChecked(exactCheck(T.live,{driverId:actor.driverId},refs.state),'SET #state=:state, #order=:order, #count=:count, #search=:search',{'#state':'status','#order':'currentOrderId','#count':'activeOrdersCount','#search':'isSearching'},{':state':'busy',':order':input.orderId,':count':1,':search':false}),
   updateChecked(exactCheck(T.orders,{PK:'ORDER#'+input.orderId,SK:'META'},bound.order),'SET #state=:state, #state2=:state, #driver=:driver, #at=:at, #wave=:wave, #attempt=:attempt, #hold=:hold, #hs=:hs, #amount=:amount, #frozen=:frozen, #receipt=:receipt, #pricing=:pricing',{'#state':'status','#state2':'orderStatus','#driver':'driverId','#at':'assignedAt','#wave':'assignmentWaveNumber','#attempt':'assignmentAttemptCounter','#hold':'holdId','#hs':'holdStatus','#amount':'holdAmount','#frozen':'pricingFrozen','#receipt':'dispatchAcceptance','#pricing':'pricing'},{':state':'assigned',':driver':actor.driverId,':at':at,':wave':input.waveNumber,':attempt':1,':hold':holdId,':hs':result.holdStatus,':amount':amount,':frozen':amount>0,':receipt':result,':pricing':{...bound.order.pricing,waveBonus:0,finalDeliveryFee:offer.baseDeliveryFee,isEmergencyWave:false}})];
  if(refs.vehicle){
   if(!offer.driverVehicleSnapshot||offer.driverVehicleSnapshot.id!==refs.vehicle.vehicle.id||offer.driverVehicleSnapshot.fingerprint!==refs.vehicle.vehicle.fingerprint)return bad('LEGACY_DRIVER_UNAVAILABLE');
   const target=writes.find(w=>w.Update?.TableName===T.orders)!.Update;
   target.UpdateExpression+=', #vehicleSnapshot=:vehicleSnapshot';
   target.ExpressionAttributeNames['#vehicleSnapshot']='driverVehicleSnapshot';target.ExpressionAttributeValues[':vehicleSnapshot']=refs.vehicle.vehicle;
  }
  if(attempt&&attemptKey)writes.push(updateChecked(exactCheck(T.jobs,attemptKey,attempt),'SET #state=:state, #receipt=:receipt, #at=:at',{'#state':'state','#receipt':'receipt','#at':'updatedAt'},{':state':'ASSIGNED',':receipt':result,':at':at}));
  if(!equal(await options.authenticateDriver(),actor))return bad('UNAUTHORIZED');if(Date.parse(offer.expiresAt)<=now())return bad('LEGACY_OFFER_EXPIRED');
  try{await commit(db,writes,[...bound.guards,...refs.guards,...moneyGuards]);}
  catch{const saved=await strongGet(db,T.offers,key);if(saved?.responseStatus==='accepted'&&saved.dispatchReceipt?.driverId===actor.driverId&&saved.dispatchReceipt?.subjectId===actor.subjectId&&saved.dispatchReceipt?.offerId===offer.offerId)return {...detach(saved.dispatchReceipt),replayed:true};return bad('LEGACY_ACCEPTANCE_UNAVAILABLE');}
  return result;
 }
 return {respond:(action:'ACCEPT'|'DECLINE',input:{orderId:string;offerId:string;waveNumber:number})=>run(action,input),inspect:(input:{orderId:string;offerId:string;waveNumber:number})=>run('INSPECT',input)};
}
