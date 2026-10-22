import {DynamoDBDocumentClient,TransactWriteCommand} from '@aws-sdk/lib-dynamodb';
import {strongGet,exactCheck,equal,FinancialRow as Row} from './driverFinancialTransaction';
import {setFinancialFields as set,prepareCodRelease} from './financialRelease';
import {quoteHash,quoteEntityIdValid} from './deliveryQuoteRecord';
import {prepareFullCashOrderSnapshot} from './fullCashOffer';
import {prepareDeliveryFundedFinancialSnapshot} from './deliveryFundedOffer';
import {prepareDriverOfferFinancialSnapshot} from './driverOfferOrderReader';
import {fromWholeIqd,readMoney} from './money';
const T={orders:'WizzOrders',branches:'WhizzMerchants_Businesses',events:'staging-WalletLifecycle',deletion:'staging-AccountDeletion',holds:'staging-Holds',audit:'staging-AuditLog'};
const fail=(code:string):never=>{throw Object.assign(Error(code),{code});};
export type MerchantResponseActor={kind:'SYSTEM'|'MERCHANT';subjectId:string;businessId:string;ownerId:string;guards:Row[]};
/** Pre-acceptance only. Never touches an assigned driver's hold or earnings. */
export function createMerchantPendingResponse(options:{db:Pick<DynamoDBDocumentClient,'send'>;now?:()=>number;enableDeliveryFunding?:boolean;enableFullCash?:boolean;authenticate:()=>Promise<MerchantResponseActor>}){
 const {db,authenticate}=options,now=options.now??Date.now;
 async function run(orderId:string,mode:'AUTO_ACCEPT'|'EXPIRE'|'REJECT',reason?:string){
  if(!quoteEntityIdValid(orderId)||!['AUTO_ACCEPT','EXPIRE','REJECT'].includes(mode))return fail('INVALID_MERCHANT_RESPONSE');
  const actor=await authenticate();if(!['SYSTEM','MERCHANT'].includes(actor.kind)||!quoteEntityIdValid(actor.subjectId)||!quoteEntityIdValid(actor.businessId)||!quoteEntityIdValid(actor.ownerId)||!Array.isArray(actor.guards)||actor.kind==='SYSTEM'&&mode==='REJECT'||actor.kind==='MERCHANT'&&mode!=='REJECT')return fail('MERCHANT_RESPONSE_UNAUTHORIZED');
  const at=new Date(now()).toISOString(),key={PK:'ORDER#'+orderId,SK:'META'},eventKey={operationId:'MERCHANT_RESPONSE#'+orderId};
  const o=await strongGet(db,T.orders,key),event=await strongGet(db,T.events,eventKey);
  if(!o||o.orderId!==orderId||o.storeId!==actor.businessId||o.businessId!=null&&o.businessId!==actor.businessId)return fail('MERCHANT_RESPONSE_UNAVAILABLE');
  if(mode==='REJECT'&&reason!==undefined&&(typeof reason!=='string'||!reason.trim()||reason.length>500))return fail('INVALID_MERCHANT_RESPONSE');
  const requestDigest=quoteHash({orderId,mode,actorKind:actor.kind,actorId:actor.subjectId,reason:mode==='REJECT'?(reason??'رفض المطعم الطلب').trim():null});
  if(event?.status==='DONE'){
   if(actor.kind==='MERCHANT'&&(event.responseMode!==mode||event.responseDigest!==requestDigest||o.status!=='cancelled'))return fail('ORDER_ALREADY_HANDLED');
   return {status:o.status,replayed:true};
  }
  if(actor.kind==='SYSTEM'&&(!event||event.kind!=='MERCHANT_RESPONSE'||event.orderId!==orderId||event.branchId!==actor.businessId||event.status!=='PENDING'||event.queuePartition!=='MERCHANT_RESPONSE'||!Number.isSafeInteger(event.nextAttemptAt)))return fail('MERCHANT_RESPONSE_UNAVAILABLE');
  if(event&&event.orderId!==orderId)return fail('MERCHANT_RESPONSE_UNAVAILABLE');
  const deadline=Date.parse(o.merchantAcceptanceDeadlineAt??'');
  if(!Number.isFinite(deadline)||!o.merchantResponsePolicy||o.merchantResponsePolicy.schemaVersion!==1||!Number.isSafeInteger(o.merchantResponsePolicy.acceptanceSeconds)||o.merchantResponsePolicy.acceptanceSeconds<60||o.merchantResponsePolicy.acceptanceSeconds>1800)return fail('MERCHANT_RESPONSE_POLICY_REQUIRED');
  const eventDone=(result:string)=>event?set(exactCheck(T.events,eventKey,event),{status:'DONE',result,responseMode:result==='ALREADY_HANDLED'?'ALREADY_HANDLED':mode,responseActorId:actor.subjectId,responseDigest:requestDigest,completedAt:at,queuePartition:'MERCHANT_RESPONSE_DONE',nextAttemptAt:0}):{Put:{TableName:T.events,Item:{...eventKey,kind:'MERCHANT_RESPONSE',merchantResponseSchemaVersion:1,orderId,branchId:actor.businessId,status:'DONE',result,responseMode:mode,responseActorId:actor.subjectId,responseDigest:requestDigest,completedAt:at},ConditionExpression:'attribute_not_exists(operationId)'}};
  if(o.status!=='pending'){
   if(actor.kind!=='SYSTEM')return fail('ORDER_ALREADY_HANDLED');
   await db.send(new TransactWriteCommand({TransactItems:[eventDone('ALREADY_HANDLED'),exactCheck(T.orders,key,o),...actor.guards] as any}));return {status:o.status,replayed:true};
  }
  if(o.deletionRequestId!=null||o.deletedAt!=null||o.isDeleted===true)return fail('MERCHANT_RESPONSE_UNAVAILABLE');
  if(mode==='EXPIRE'&&now()<deadline||mode==='AUTO_ACCEPT'&&now()>=deadline)return fail('MERCHANT_RESPONSE_NOT_DUE');
  const branchKey={businessId:actor.businessId},b=await strongGet(db,T.branches,branchKey);
  if(!b||b.ownerId!==b.cognitoUserId||b.ownerId!==actor.ownerId||!b.ownerId||b.deletionRequestId!=null)return fail('MERCHANT_RESPONSE_UNAVAILABLE');
  const guards:Row[]=[exactCheck(T.branches,branchKey,b,['businessId','ownerId','cognitoUserId','status','isActive','acceptingOrders','ordersPausedUntil','orderPauseId','lastStatusUpdate','onboardingSchemaVersion','onboardingComplete','orderReceptionSettings','deletionRequestId','deletedAt','platformSuspended','ordersBlocked'])];
  for(const pk of ['BUSINESS_LIFECYCLE#MERCHANT#'+actor.businessId,'ACCOUNT_LIFECYCLE#MERCHANT#'+b.ownerId]){
   const k={pk,sk:'META'};if(await strongGet(db,T.deletion,k))return fail('MERCHANT_RESPONSE_UNAVAILABLE');
   guards.push({ConditionCheck:{TableName:T.deletion,Key:k,ConditionExpression:'attribute_not_exists(pk)'}});
  }
  // Avoid duplicate branch/deletion checks already supplied by the verified device/owner context.
  const guardKeys=new Set(guards.map(x=>quoteHash([x.ConditionCheck.TableName,x.ConditionCheck.Key])));
  for(const g of actor.guards){const q=g.ConditionCheck;if(!q||!guardKeys.has(quoteHash([q.TableName,q.Key])))guards.push(g);}
  const financial=Object.prototype.hasOwnProperty.call(o,'financialSnapshot')||Object.prototype.hasOwnProperty.call(o,'commercialPricing');
  if(o.financialSnapshot?.schemaVersion===3&&options.enableFullCash!==true)return fail('MERCHANT_RESPONSE_FINANCIAL_REVIEW_REQUIRED');
  if(o.financialSnapshot?.schemaVersion===2&&options.enableDeliveryFunding!==true)return fail('MERCHANT_RESPONSE_FINANCIAL_REVIEW_REQUIRED');
  if(o.driverId!=null||o.assignedDriverId!=null||o.financialAcceptance!=null||o.financialOutcome!=null||o.returnCaseId!=null||o.walletPendingHoldId!=null||o.pickedUpAt!=null||o.pickupAt!=null||o.cashCollected===true||o.cashCollectedAmount>0||!['pending','unpaid',null,undefined].includes(o.paymentStatus)||o.holdId!=null||o.holdAmount!=null&&o.holdAmount!==0||['ACTIVE','SETTLED','CAPTURED'].includes(o.holdStatus))return fail('MERCHANT_RESPONSE_FINANCIAL_REVIEW_REQUIRED');
  const status=mode==='AUTO_ACCEPT'?'confirmed':mode==='EXPIRE'?'expired':'cancelled';
  const operationId='MRC:'+quoteHash({orderId,mode}).slice(0,48),fields:Row={status,orderStatus:status,updatedAt:at,merchantRespondedAt:at,merchantResponseActor:{kind:actor.kind,subjectId:actor.subjectId}};
  const bucket=typeof o.storeStatus==='string'&&o.storeStatus.match(/#b\d+$/)?.[0];if(!bucket)return fail('MERCHANT_RESPONSE_UNAVAILABLE');fields.storeStatus=actor.businessId+'#'+status+bucket;
  const ops:Row[]=[...guards];
  const jobKey={orderId,SK:'METADATA'},job=await strongGet(db,'WizzDispatchJobs_staging',jobKey);
  if(job){
   if(job.driverId!=null||job.assignedDriverId!=null||(job.currentWaveNumber??0)!==0||!['pending','created','waiting_for_merchant','searching'].includes(job.status))return fail('MERCHANT_RESPONSE_FINANCIAL_REVIEW_REQUIRED');
   ops.push(mode==='AUTO_ACCEPT'?exactCheck('WizzDispatchJobs_staging',jobKey,job):set(exactCheck('WizzDispatchJobs_staging',jobKey,job),{status:'cancelled',completedAt:at,merchantResponseOperationId:operationId}));
  }else ops.push({ConditionCheck:{TableName:'WizzDispatchJobs_staging',Key:jobKey,ConditionExpression:'attribute_not_exists(orderId)'}});

  if(mode==='AUTO_ACCEPT'){
   const policy=o.merchantResponsePolicy,minutes=policy.defaultPreparationMinutes;
   const serving=b.acceptingOrders===true||b.orderPauseId&&Date.parse(b.ordersPausedUntil)>now()&&Date.parse(o.createdAt)<=Date.parse(b.lastStatusUpdate);
   if(policy.autoAccept!==true||b.orderReceptionSettings?.autoAccept!==true||!serving||b.isActive!==true||b.platformSuspended===true||b.ordersBlocked===true||!['approved','active'].includes(b.status)||b.onboardingSchemaVersion&&!b.onboardingComplete||!Number.isSafeInteger(minutes)||minutes<5||minutes>120)return fail('MERCHANT_AUTO_ACCEPT_UNAVAILABLE');
   fields.confirmedAt=at;fields.estimatedPreparationTime=minutes;fields.estimatedReadyAt=new Date(now()+minutes*60000).toISOString();
   const seconds=o.deliveryQuote?.route?.durationSeconds;
   if(Number.isSafeInteger(seconds)&&seconds>0&&seconds<=86400){const t=now()+minutes*60000+seconds*1000;fields.estimatedDeliveryTime=new Date(t).toISOString();fields.deliveryEstimate={schemaVersion:1,basis:'PREPARATION_AND_SAVED_ROUTE',updatedAt:at,preparationMinutes:minutes,deliverySeconds:seconds,earliestAt:fields.estimatedDeliveryTime,latestAt:new Date(t+300000).toISOString(),driverWaitIncluded:false};}
  }else{
   fields.cancelReason=mode==='EXPIRE'?'لم يرد المطعم خلال مهلة قبول الطلب':String(reason??'رفض المطعم الطلب').slice(0,500);fields.cancelledAt=at;fields.canceledBy=mode==='EXPIRE'?'system':'restaurant';
   if(financial){
    const snapshot=o.financialSnapshot,fullCash=snapshot?.schemaVersion===3,deliveryFunded=snapshot?.schemaVersion===2||fullCash&&snapshot.deliveryFunding!=null;
    if(deliveryFunded&&options.enableDeliveryFunding!==true)return fail('MERCHANT_RESPONSE_FINANCIAL_REVIEW_REQUIRED');
    let original:Row;
    try{
     const rebuilt=fullCash?prepareFullCashOrderSnapshot({order:snapshot.order,deliveryFunding:snapshot.deliveryFunding}):deliveryFunded?prepareDeliveryFundedFinancialSnapshot({order:snapshot.order,deliveryFunding:snapshot.deliveryFunding}):prepareDriverOfferFinancialSnapshot(snapshot?.snapshot);
     if(!equal(snapshot,rebuilt))return fail('MERCHANT_RESPONSE_FINANCIAL_REVIEW_REQUIRED');
     original=fullCash||deliveryFunded?snapshot.order:snapshot.snapshot;
    }catch{return fail('MERCHANT_RESPONSE_FINANCIAL_REVIEW_REQUIRED');}
    if(original.orderId!==orderId||original.branchId!==actor.businessId||original.merchantId!==o.merchantId||original.allocation.paymentMethod!=='COD'||!['cash','cod'].includes(String(o.paymentMethod).toLowerCase())||o.commercialPricing?.schemaVersion!==(deliveryFunded?2:1))return fail('MERCHANT_RESPONSE_FINANCIAL_REVIEW_REQUIRED');
    if(deliveryFunded&&!equal(o.commercialPricing.deliveryFunding,snapshot.deliveryFunding))return fail('MERCHANT_RESPONSE_FINANCIAL_REVIEW_REQUIRED');
    const funding=readMoney(o.commercialPricing.funding?.amount);if(!equal(funding,readMoney(original.allocation.platformGoodsDiscount)))return fail('MERCHANT_RESPONSE_FINANCIAL_REVIEW_REQUIRED');
    // The original pending state proves there is no driver collateral. Reuse the
    // existing audited release planner for promotion funding only; all original
    // order fields remain fenced by the transaction below.
    const release=await prepareCodRelease(db,{...o,holdId:null,holdAmount:0,holdStatus:'NOT_REQUIRED'},
      {allocation:{driverWalletHold:fromWholeIqd(0),platformGoodsDiscountFunding:funding,...(deliveryFunded?{platformDeliveryPromotionFunding:snapshot.deliveryFunding.allocation.platformShare}:{})}},at,operationId,true,options.enableDeliveryFunding===true,deliveryFunded?snapshot.deliveryFunding:undefined,options.enableFullCash===true);
    for(const op of release.operations){if(op.Put?.TableName==='staging-LedgerEntries')op.Put.Item.category='MERCHANT_PENDING_PROMOTION_RELEASED';}
    ops.push(...release.operations,{Put:{TableName:T.holds,Item:{orderId,sk:'FINANCIAL_OUTCOME',kind:'MERCHANT_PENDING_CANCEL_JOURNAL',financialSchemaVersion:fullCash?4:deliveryFunded?3:2,...(fullCash?{settlementModel:'FULL_CASH_AT_DELIVERY_V1'}:{}),...(deliveryFunded?{deliveryFunding:snapshot.deliveryFunding}:{}),action:'MERCHANT_RESPONSE_'+mode,outcome:'CANCELLED',operationId,branchId:actor.businessId,actorKind:actor.kind,actorId:actor.subjectId,receipt:{success:true,kind:'MERCHANT_PENDING_CANCELLED',orderId,operationId,status},journalLines:release.journalLines,createdAt:at,reason:fields.cancelReason},ConditionExpression:'attribute_not_exists(orderId)'}});
    fields.financialOutcome=operationId;fields.walletFinancialStatus='CANCELLED';
   }else if(!['cash','cod'].includes(String(o.paymentMethod).toLowerCase()))return fail('MERCHANT_RESPONSE_FINANCIAL_REVIEW_REQUIRED');
  }
  ops.push(set(exactCheck(T.orders,key,o),fields),eventDone(status),{Put:{TableName:T.audit,Item:{datePartition:'date#'+at.slice(0,10).replace(/-/g,''),sk:at+'#'+operationId,logId:operationId,action:'MERCHANT_RESPONSE_'+mode,actorId:actor.subjectId,actorKind:actor.kind,businessId:actor.businessId,orderId,createdAt:at},ConditionExpression:'attribute_not_exists(sk)'}});
  if(!equal(actor,await authenticate()))return fail('MERCHANT_RESPONSE_UNAUTHORIZED');
  await db.send(new TransactWriteCommand({TransactItems:ops as any,ClientRequestToken:quoteHash(ops).slice(0,36)}));return {status,replayed:false};
 }
 return {run};
}
