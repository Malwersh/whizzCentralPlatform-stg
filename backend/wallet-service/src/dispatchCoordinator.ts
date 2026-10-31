const {dispatchWaveSK,dispatchOfferSK}=require('../../src/utils/dispatch-cycle-keys');
import {DynamoDBDocumentClient,TransactWriteCommand} from '@aws-sdk/lib-dynamodb';
import {validateDispatchCycle,decideDispatchTransition,DispatchProgress} from './dispatchCycle';
import {strongGet,exactCheck,updateChecked,detach,equal,FinancialRow as Row} from './driverFinancialTransaction';
import {quoteEntityIdValid,quoteHash} from './deliveryQuoteRecord';
import {resolveFinancialOffer} from './financialOfferVersion';
import {createStagingDriverOfferOrderReader,financialSnapshotFromOrderRead} from './driverOfferOrderReader';
import {unavailableDispatchSearch} from './financialSearch';
const {isFinancialOrder,isTerminalOrderStatus,FINANCIAL_FIELDS}=require('../../order-service/legacy-order-policy');
const T={jobs:'WizzDispatchJobs_staging',orders:'WizzOrders',offers:'WaveOffers_staging',branches:'WhizzMerchants_Businesses',deletions:'staging-AccountDeletion'};
const fail=(code='DISPATCH_TRANSITION_CONFLICT'):never=>{throw Object.assign(Error(code),{code});};
const iso=(ms:number)=>new Date(ms).toISOString();
const ms=(value:any)=>{
 if(typeof value!=='string'||!Number.isFinite(Date.parse(value))||iso(Date.parse(value))!==value)return fail();
 return Date.parse(value);
};
/** A single coordinator for the existing job partition. It persists decisions,
 * never invokes Lambda, selects recipients, sends an offer or moves funds.
 * A future executor must fence every write with the current intent lease token;
 * external invocation is at least once, not exactly once.
 */
export function createStagingDispatchCoordinator(options:{db:Pick<DynamoDBDocumentClient,'send'>;now?:()=>number;enableDeliveryFunding?:boolean;enableFullCash?:boolean}) {
 const {db}=options,now=options.now??Date.now;
 async function bound(orderId:string,assignmentId:string){
  if(![orderId,assignmentId].every(quoteEntityIdValid))return fail();
  const jobKey={orderId,SK:'METADATA'},orderKey={PK:'ORDER#'+orderId,SK:'META'};
  const job=await strongGet(db,T.jobs,jobKey);if(!job||job.dispatchJobId!==assignmentId)return fail();
  const cycle=validateDispatchCycle(job.dispatchCycle);
  if(cycle.orderId!==orderId||cycle.assignmentId!==assignmentId||job.financialDispatch!==(cycle.engine==='FINANCIAL')||job.maxWaves!==cycle.policy.values.dispatch!.profiles[cycle.engine].normalWaves.length)return fail();
  const order=await strongGet(db,T.orders,orderKey);
  if(!order||order.orderId!==orderId||order.deliveryJobId!==assignmentId||![order.storeId,order.businessId].some(v=>v===job.restaurantId)||[order.storeId,order.businessId].some(v=>v!==undefined&&v!==job.restaurantId)||isFinancialOrder(order)!==(cycle.engine==='FINANCIAL'))return fail();
  if(job.expiresAt!==cycle.searchDeadline&&!(cycle.engine==='FINANCIAL'&&order.financialRelease&&ms(job.expiresAt)>ms(cycle.startedAt)))return fail();
  const stop=job.status==='assigned'||order.driverId!=null||order.assignedDriverId!=null?'ASSIGNED':
   isTerminalOrderStatus(order.status)||isTerminalOrderStatus(order.orderStatus)?'ORDER_TERMINAL':null;
  if(stop)return {stop,job,cycle,order,jobKey,orderKey,guards:[] as Row[]};
  if([order.deletionRequestId,order.deletionStatus,order.deletedAt,order.cancellationRequestId,order.cancellationStatus,order.returnCaseId,order.returnStatus].some(v=>v!=null)||order.isDeleted===true)return fail();
  let releaseGuard:Row|null=null;
  if(cycle.engine==='FINANCIAL'){const verified=await createStagingDriverOfferOrderReader({db,enableDeliveryFunding:options.enableDeliveryFunding,enableFullCash:options.enableFullCash}).read({orderId,branchId:job.restaurantId});if(!equal(order.financialSnapshot,financialSnapshotFromOrderRead(verified)))return fail();releaseGuard=verified.releaseCondition;}
  else if(![order.status,order.orderStatus].some(s=>s==='ready_for_pickup')||[order.status,order.orderStatus].some(s=>s!==undefined&&s!=='ready_for_pickup'))return fail();
  const branchKey={businessId:job.restaurantId},branch=await strongGet(db,T.branches,branchKey);
  if(!branch||branch.status!=='approved'||branch.isActive===false||branch.ordersBlocked===true||branch.platformSuspended===true||!quoteEntityIdValid(branch.ownerId)||branch.deletionRequestId!=null||branch.deletedAt!=null||branch.isDeleted===true)return fail();
  const orderFields=[...new Set([...Object.keys(order),...FINANCIAL_FIELDS,'driverId','assignedDriverId','deletionRequestId','deletionStatus','deletedAt','isDeleted','cancellationRequestId','cancellationStatus','returnCaseId','returnStatus'])];
  const guards:Row[]=[exactCheck(T.orders,orderKey,order,orderFields),exactCheck(T.branches,branchKey,branch,[...new Set([...Object.keys(branch),'ownerId','deletedAt','deletionRequestId','isDeleted','isActive','ordersBlocked','platformSuspended'])]),
   ...['BUSINESS_LIFECYCLE#MERCHANT#'+job.restaurantId,'ACCOUNT_LIFECYCLE#MERCHANT#'+branch.ownerId].map(pk=>({ConditionCheck:{TableName:T.deletions,Key:{pk,sk:'META'},ConditionExpression:'attribute_not_exists(pk)'}}))];
  if(releaseGuard)guards.push(releaseGuard);
  return {stop:null,job,cycle,order,jobKey,orderKey,guards};
 }
 async function intentFor(c:Awaited<ReturnType<typeof bound>>){
  const ref=c.job.dispatchTransition;if(!ref)return null;
  if(!quoteEntityIdValid(ref.id)||!Number.isSafeInteger(ref.sequence)||ref.sequence<1||ref.cycleId!==c.cycle.id)return fail();
  const key={orderId:c.cycle.orderId,SK:'DISPATCH_TRANSITION#'+ref.id},record=await strongGet(db,T.jobs,key);
  if(!record||record.kind!=='DISPATCH_TRANSITION'||record.intentId!==ref.id||record.sequence!==ref.sequence||record.cycleId!==c.cycle.id||record.cycleDigest!==c.cycle.digest||record.assignmentId!==c.cycle.assignmentId||record.policyVersion!==c.cycle.policy.version||!['START_WAVE','REVIEW'].includes(record.action)||!['PENDING','LEASED','APPLIED','CANCELLED'].includes(record.state)||!Number.isSafeInteger(record.leaseVersion)||record.leaseVersion<0)return fail();
  if(record.action==='START_WAVE'&&(!Number.isSafeInteger(record.waveNumber)||record.waveNumber<1||record.waveNumber>c.job.maxWaves||ms(record.waveDeadline)>ms(c.cycle.searchDeadline)))return fail();
  if(record.action==='START_WAVE'){const profile=c.cycle.policy.values.dispatch!.profiles[c.cycle.engine];if(!equal(record.rule,profile.normalWaves[record.waveNumber-1])||record.offerTtlSeconds!==profile.offerTtlSeconds||ms(record.waveDeadline)<=ms(record.createdAt)||ms(record.waveDeadline)>ms(record.createdAt)+profile.waveDurationSeconds*1000)return fail();}
  if(record.state==='LEASED'&&(!quoteEntityIdValid(record.leaseOwner)||record.leaseVersion<1||ms(record.leaseUntil)>ms(record.waveDeadline)))return fail();
  if(record.state==='APPLIED')ms(record.appliedAt);
  return {key,record};
 }
 async function progressFor(c:Awaited<ReturnType<typeof bound>>,prior:Awaited<ReturnType<typeof intentFor>>){
  const n=c.job.currentWaveNumber;if(!Number.isSafeInteger(n)||n<0||n>c.job.maxWaves)return fail();
  const guards:Row[]=[],expire:Row[]=[];
  if(n===0)return {progress:{currentWave:0,assigned:false,terminal:false,waveState:'NONE',waveDeadline:null} as DispatchProgress,guards,expire};
  if(!prior||prior.record.action!=='START_WAVE'||prior.record.state!=='APPLIED'||prior.record.waveNumber!==n)return fail('DISPATCH_WAVE_NOT_READY');
  const financial=c.cycle.engine==='FINANCIAL',waveKey={orderId:c.cycle.orderId,SK:dispatchWaveSK(c.cycle,n)},wave=await strongGet(db,T.jobs,waveKey);
  if(!wave||wave.assignmentId!==c.cycle.assignmentId||wave.branchId!==c.job.restaurantId||!['READY','EXPIRED'].includes(wave.state)||!Array.isArray(wave.driverIds)||wave.driverIds.length>25||new Set(wave.driverIds).size!==wave.driverIds.length||!wave.driverIds.every(quoteEntityIdValid))return fail('DISPATCH_WAVE_NOT_READY');
  if(financial){if(wave.kind!=='FINANCIAL_WAVE'||!equal(wave.operatingLimits,c.cycle.policy))return fail();}
  else if(wave.kind!=='DISPATCH_WAVE'||wave.cycleDigest!==c.cycle.digest)return fail();
  guards.push(exactCheck(T.jobs,waveKey,wave));
  let allDeclined=wave.driverIds.length>0,accepted=false,latest=0;
  for(const driverId of wave.driverIds){
   const key={orderId:c.cycle.orderId,SK:dispatchOfferSK(c.cycle,driverId,n)},offer=await strongGet(db,T.offers,key);
   if(!offer||offer.orderId!==c.cycle.orderId||offer.driverId!==driverId||offer.waveNumber!==n)return fail();
   if(financial){const rebuilt=resolveFinancialOffer(offer.financialOffer,options.enableDeliveryFunding,options.enableFullCash);if(!equal(rebuilt.versionedOffer,offer.financialOffer)||rebuilt.assignmentId!==c.cycle.assignmentId||rebuilt.driverId!==driverId||rebuilt.assignmentVersion!==n)return fail();}
   else if(offer.dispatchJobId!==c.cycle.assignmentId||offer.dispatchCycleId!==c.cycle.id)return fail();
   const pending=financial?'financial_pending':'pending',declined=financial?'financial_declined':'rejected',expired=financial?'financial_expired':'expired',winner=financial?'financial_accepted':'accepted';
   if(![pending,declined,expired,winner].includes(offer.responseStatus))return fail();
   if(offer.responseStatus===winner){
    const release=c.order.financialRelease,archive=financial&&release?await strongGet(db,'staging-Holds',{orderId:c.cycle.orderId,sk:'ASSIGNMENT_RELEASE#'+release.attempt}):null;
    if(archive?.kind==='COD_ASSIGNMENT_RELEASE'&&archive.outcome==='UNASSIGNED'&&archive.driverId===driverId&&archive.offerId===resolveFinancialOffer(offer.financialOffer,options.enableDeliveryFunding,options.enableFullCash).offerId&&archive.operationId===release.operationId&&archive.offerId===release.offerId&&archive.attempt===release.attempt){/* bound() already fences this exact release through the verified order reader. */}
    else accepted=true;
   }
   if(offer.responseStatus!==declined)allDeclined=false;
   const deadline=ms(offer.expiresAt);if(deadline>ms(prior.record.waveDeadline))return fail();latest=Math.max(latest,deadline);
   if(offer.responseStatus===pending&&deadline<=now())expire.push(updateChecked(exactCheck(T.offers,key,offer),'SET #state=:state',{'#state':'responseStatus'},{':state':expired}));
   else guards.push(exactCheck(T.offers,key,offer));
  }
  const deadline=latest?Math.min(latest,ms(prior.record.waveDeadline)):ms(prior.record.waveDeadline);
  const waveState=wave.driverIds.length===0?'EMPTY':allDeclined?'ALL_DECLINED':deadline<=now()?'EXPIRED':'OPEN';
  return {progress:{currentWave:n,assigned:accepted,terminal:false,waveState,waveDeadline:iso(deadline)} as DispatchProgress,guards,expire};
 }
 function receipt(row:Row,claimed:boolean){return {handled:true,action:row.action,intentId:row.intentId,cycleId:row.cycleId,sequence:row.sequence,waveNumber:row.waveNumber??null,state:row.state,claimed};}
 async function commit(tx:Row[]){if(tx.length>100||Buffer.byteLength(JSON.stringify(tx))>3500000)return fail();await db.send(new TransactWriteCommand({TransactItems:tx as any,ClientRequestToken:quoteHash(tx).slice(0,36)}));}
 return {
  async plan(input:{orderId:string;assignmentId:string;source:'START'|'TIMEOUT'|'DECLINE'}){
   if(!input||Object.keys(input).sort().join(',')!=='assignmentId,orderId,source'||!['START','TIMEOUT','DECLINE'].includes(input.source))return fail();
   const c=await bound(input.orderId,input.assignmentId);if(c.stop)return {handled:true,action:'STOP',reason:c.stop};
   const prior=await intentFor(c),time=now();if(!Number.isSafeInteger(time)||time<ms(c.cycle.startedAt))return fail();
   if(c.job.status==='no_driver_available'&&prior?.record.action==='REVIEW')return receipt(prior.record,false);
   if(c.job.status!=='searching')return fail();
   if(prior&&prior.record.action==='START_WAVE'&&['PENDING','LEASED'].includes(prior.record.state)&&time<Math.min(ms(c.cycle.searchDeadline),ms(prior.record.waveDeadline)))return receipt(prior.record,false);
   // No wave means no offer has been issued by the fenced producer. A delayed
   // performance refresh may retry preparation without spending a wave or
   // extending the original search/offer budget. Never reset a persisted plan.
   if(c.cycle.engine==='FINANCIAL'&&prior&&prior.record.action==='START_WAVE'&&['PENDING','LEASED'].includes(prior.record.state)&&time>=ms(prior.record.waveDeadline)&&time<Math.min(ms(c.cycle.searchDeadline),ms(c.job.expiresAt))&&c.job.currentWaveNumber===prior.record.waveNumber-1){
    const waveKey={orderId:input.orderId,SK:dispatchWaveSK(c.cycle,prior.record.waveNumber)},wave=await strongGet(db,T.jobs,waveKey);
    if(!wave){
     const profile=c.cycle.policy.values.dispatch!.profiles.FINANCIAL,deadline=iso(Math.min(time+profile.waveDurationSeconds*1000,ms(c.cycle.searchDeadline),ms(c.job.expiresAt)));
     const next={...prior.record,state:'PENDING',firstCreatedAt:prior.record.firstCreatedAt??prior.record.createdAt,createdAt:iso(time),waveDeadline:deadline,leaseUntil:iso(time),preparationRetries:(prior.record.preparationRetries??0)+1};
     const write=updateChecked(exactCheck(T.jobs,prior.key,prior.record),'SET #s=:s,#at=:at,#first=:first,#deadline=:deadline,#until=:until,#retries=:retries',{'#s':'state','#at':'createdAt','#first':'firstCreatedAt','#deadline':'waveDeadline','#until':'leaseUntil','#retries':'preparationRetries'},{':s':'PENDING',':at':next.createdAt,':first':next.firstCreatedAt,':deadline':deadline,':until':next.leaseUntil,':retries':next.preparationRetries});
     await commit([write,exactCheck(T.jobs,c.jobKey,c.job),...c.guards,{ConditionCheck:{TableName:T.jobs,Key:waveKey,ConditionExpression:'attribute_not_exists(orderId)'}}]);
     return receipt(next,false);
    }
   }
   let progress:DispatchProgress={currentWave:0,assigned:false,terminal:false,waveState:'NONE',waveDeadline:null},waveGuards:Row[]=[],expire:Row[]=[];
   if(prior&&['PENDING','LEASED'].includes(prior.record.state)){progress={currentWave:prior.record.waveNumber,assigned:false,terminal:false,waveState:'PREPARING',waveDeadline:prior.record.waveDeadline};}
   if(!prior||prior.record.state==='APPLIED'){const evidence=await progressFor(c,prior);progress=evidence.progress;waveGuards=evidence.guards;expire=evidence.expire;}
   let decision=decideDispatchTransition(c.cycle,progress,iso(time));
   if(c.job.financialRedispatch&&c.cycle.engine==='FINANCIAL'){
    const r=c.job.financialRedispatch,release=c.order.financialRelease;
    if(!release||r.operationId!==release.operationId||r.waveNumber!==c.job.currentWaveNumber+1||!Array.isArray(r.excludeDriverIds)||!r.excludeDriverIds.every(quoteEntityIdValid))return fail();
   }
   if(c.cycle.engine==='FINANCIAL'&&c.order.financialRelease){
    if(time>=ms(c.job.expiresAt))decision={action:'REVIEW',reason:'SEARCH_DEADLINE'};
    else if(decision.action==='START_WAVE')decision={...decision,deadline:iso(Math.min(ms(decision.deadline),ms(c.job.expiresAt)))};
   }
   if(input.source==='START'&&decision.action==='REVIEW')return {handled:true,action:'STOP',reason:'REVIEW_REQUIRES_TIMEOUT_HOST'};
   if(!['START_WAVE','REVIEW'].includes(decision.action))return {handled:true,...decision};
   const target=decision.action==='START_WAVE'?decision.waveNumber:0,intentId='DT:'+quoteHash({cycle:c.cycle.id,assignment:c.cycle.assignmentId,wave:target,action:decision.action}).slice(0,48);
   const key={orderId:input.orderId,SK:'DISPATCH_TRANSITION#'+intentId},sequence=(prior?.record.sequence??0)+1;
   const row:Row={...key,kind:'DISPATCH_TRANSITION',intentId,cycleId:c.cycle.id,cycleDigest:c.cycle.digest,assignmentId:c.cycle.assignmentId,policyVersion:c.cycle.policy.version,sequence,source:input.source,
    action:decision.action,state:decision.action==='START_WAVE'?'PENDING':'APPLIED',createdAt:iso(time),leaseVersion:0,
    ...(decision.action==='START_WAVE'?{waveNumber:decision.waveNumber,waveDeadline:decision.deadline,rule:decision.rule,offerTtlSeconds:decision.offerTtlSeconds}:{reason:decision.reason,appliedAt:iso(time)})};
   const ref={id:intentId,sequence,cycleId:c.cycle.id},search=decision.action==='REVIEW'?unavailableDispatchSearch(decision.reason==='SEARCH_DEADLINE'?'SEARCH_WINDOW_EXPIRED':decision.reason==='PREPARATION_DEADLINE'?'PREPARATION_DEADLINE':'MAX_WAVES_REACHED',iso(time)):null;
   const jobFields=[...new Set([...Object.keys(c.job),'dispatchTransition','assignedDriverId','driverId','deletionRequestId'])];
   const jobWrite=updateChecked(exactCheck(T.jobs,c.jobKey,c.job,jobFields),search?'SET #ref=:ref, #status=:status, #review=:review':'SET #ref=:ref',
    {'#ref':'dispatchTransition',...(search?{'#status':'status','#review':'dispatchReview'}:{})},{':ref':ref,...(search?{':status':'no_driver_available',':review':{...search,cycleId:c.cycle.id,intentId}}:{})});
   const tx:Row[]=[jobWrite,{Put:{TableName:T.jobs,Item:row,ConditionExpression:'attribute_not_exists(orderId)'}},...waveGuards,...expire];
   const guards=[...c.guards];
   if(search){const orderGuard=guards.shift()!;tx.push(updateChecked(orderGuard,'SET #ds=:ds, #fs=:fs',{'#ds':'dispatchStatus','#fs':'financialSearch'},{':ds':search.status,':fs':search}));}
   tx.push(...guards);
   if(prior){if(['PENDING','LEASED'].includes(prior.record.state)&&search)tx.push(updateChecked(exactCheck(T.jobs,prior.key,prior.record),'SET #state=:state',{'#state':'state'},{':state':'CANCELLED'}));else tx.push(exactCheck(T.jobs,prior.key,prior.record));}
   try{await commit(tx);}catch(error:any){
    console.error('DISPATCH_TRANSITION_COMMIT_FAILED',{code:error?.name??'Unknown',reasons:(error?.CancellationReasons??[]).map((r:any)=>r.Code??'None')});
    const fresh=await bound(input.orderId,input.assignmentId);if(fresh.stop)return {handled:true,action:'STOP',reason:fresh.stop};
    const existing=await intentFor(fresh);if(existing?.record.intentId===intentId)return receipt(existing.record,false);return fail('DISPATCH_TRANSITION_UNAVAILABLE');
   }
   return receipt(row,true);
  },
  async acquire(input:{orderId:string;assignmentId:string;intentId:string;owner:string;leaseSeconds:number}){
   if(!input||Object.keys(input).sort().join(',')!=='assignmentId,intentId,leaseSeconds,orderId,owner'||![input.intentId,input.owner].every(quoteEntityIdValid)||!Number.isSafeInteger(input.leaseSeconds)||input.leaseSeconds<1||input.leaseSeconds>120)return fail();
   const c=await bound(input.orderId,input.assignmentId),prior=await intentFor(c),time=now();
   if(c.stop||!prior||prior.record.intentId!==input.intentId||prior.record.action!=='START_WAVE'||!['PENDING','LEASED','APPLIED'].includes(prior.record.state)||time>=Math.min(ms(c.cycle.searchDeadline),ms(prior.record.waveDeadline))||time<ms(c.cycle.startedAt))return fail();
   const record=prior.record;
   if(record.leaseOwner&&ms(record.leaseUntil)>time){if(record.leaseOwner===input.owner)return {acquired:true,replayed:true,intentId:record.intentId,leaseVersion:record.leaseVersion,leaseUntil:record.leaseUntil};return {acquired:false,intentId:record.intentId};}
   if(record.leaseVersion>=Number.MAX_SAFE_INTEGER)return fail();
   const version=record.leaseVersion+1,until=iso(Math.min(time+input.leaseSeconds*1000,ms(c.cycle.searchDeadline),ms(record.waveDeadline)));
   const write=updateChecked(exactCheck(T.jobs,prior.key,record),'SET #state=:state, #owner=:owner, #until=:until, #version=:version',{'#state':'state','#owner':'leaseOwner','#until':'leaseUntil','#version':'leaseVersion'},
    {':state':record.state==='APPLIED'?'APPLIED':'LEASED',':owner':input.owner,':until':until,':version':version});
   try{await commit([write,exactCheck(T.jobs,c.jobKey,c.job),...c.guards]);}catch{return {acquired:false,intentId:record.intentId};}
   return {acquired:true,replayed:false,intentId:record.intentId,leaseVersion:version,leaseUntil:until};
  },
  async responseFence(input:{orderId:string;assignmentId:string;waveNumber:number}){
   if(!input||Object.keys(input).sort().join(',')!=='assignmentId,orderId,waveNumber'||!Number.isSafeInteger(input.waveNumber)||input.waveNumber<1)return fail();
   const c=await bound(input.orderId,input.assignmentId),prior=await intentFor(c),time=now();
   if(c.stop||c.job.status!=='searching'||c.job.currentWaveNumber!==input.waveNumber||!prior||prior.record.action!=='START_WAVE'||prior.record.state!=='APPLIED'||prior.record.waveNumber!==input.waveNumber||time>=Math.min(ms(c.cycle.searchDeadline),ms(prior.record.waveDeadline)))return fail('DISPATCH_WAVE_NOT_READY');
   const key={orderId:input.orderId,SK:dispatchWaveSK(c.cycle,input.waveNumber)},wave=await strongGet(db,T.jobs,key);
   if(!wave||wave.kind!==(c.cycle.engine==='FINANCIAL'?'FINANCIAL_WAVE':'DISPATCH_WAVE')||wave.waveNumber!==input.waveNumber||wave.state!=='READY'||wave.assignmentId!==input.assignmentId||wave.branchId!==c.job.restaurantId||wave.cycleDigest!==c.cycle.digest||wave.transitionId!==prior.record.intentId||!Array.isArray(wave.driverIds)||wave.driverIds.length>25||new Set(wave.driverIds).size!==wave.driverIds.length||!wave.driverIds.every(quoteEntityIdValid))return fail('DISPATCH_WAVE_NOT_READY');
   return {job:detach(c.job),order:detach(c.order),cycle:c.cycle,intent:detach(prior.record),wave:detach(wave),guards:[exactCheck(T.jobs,c.jobKey,c.job),exactCheck(T.jobs,prior.key,prior.record),exactCheck(T.jobs,key,wave),...c.guards]};
  },
  async executionFence(input:{orderId:string;assignmentId:string;intentId:string;owner:string;leaseVersion:number}){
   if(!input||Object.keys(input).sort().join(',')!=='assignmentId,intentId,leaseVersion,orderId,owner'||![input.intentId,input.owner].every(quoteEntityIdValid)||!Number.isSafeInteger(input.leaseVersion)||input.leaseVersion<1)return fail();
   const c=await bound(input.orderId,input.assignmentId),prior=await intentFor(c),time=now();
   if(c.stop||!prior||prior.record.intentId!==input.intentId||!['LEASED','APPLIED'].includes(prior.record.state)||prior.record.leaseOwner!==input.owner||prior.record.leaseVersion!==input.leaseVersion||ms(prior.record.leaseUntil)<=time||Math.min(ms(c.cycle.searchDeadline),ms(prior.record.waveDeadline))<=time)return fail('DISPATCH_LEASE_EXPIRED');
   return {intent:detach(prior.record),guards:[exactCheck(T.jobs,c.jobKey,c.job),exactCheck(T.jobs,prior.key,prior.record),...c.guards],requiresAtomicComposition:true};
  }
 };
}
