import {readExceptionCasePolicy,casePhase} from './exceptionCasePolicy';
import {exceptionCaseIndexOperation} from './orderExceptionCaseIndex';
import {DynamoDBDocumentClient,TransactWriteCommand} from '@aws-sdk/lib-dynamodb';
import {strongGet,exactCheck,equal,detach} from './driverFinancialTransaction';
import {setFinancialFields as set,prepareCodRelease} from './financialRelease';
import {prepareFullCashOrderSnapshot} from './fullCashOffer';
import {fromWholeIqd,readMoney} from './money';
import {quoteHash,quoteEntityIdValid} from './deliveryQuoteRecord';
import {readOrderExceptionPolicy} from './orderExceptionPolicy';
type Row=Record<string,any>;
const fail=(code='CANCELLATION_CONFLICT'):never=>{throw Object.assign(Error(code),{code});};
const T={orders:'WizzOrders',holds:'staging-Holds',audit:'staging-AuditLog',jobs:'WizzDispatchJobs_staging'};
export type CancellationActor={kind:'CUSTOMER'|'MERCHANT_OWNER'|'STAFF';subjectId:string};
export function createCustomerCancellation(options:{db:Pick<DynamoDBDocumentClient,'send'>;authenticate:()=>Promise<CancellationActor>;now?:()=>number;enableFullCash?:boolean;enableDeliveryFunding?:boolean;administrativeCancellation?:boolean;authorizeStaff?:(actor:CancellationActor,order:Row,branch:Row)=>Promise<Row[]>}){
 const {db,authenticate}=options,now=options.now??Date.now;
 async function load(orderId:string){
  if(!quoteEntityIdValid(orderId))return fail('INVALID_CANCELLATION');
  const actor=detach(await authenticate());if(!quoteEntityIdValid(actor.subjectId)||!['CUSTOMER','MERCHANT_OWNER','STAFF'].includes(actor.kind))return fail('UNAUTHORIZED');
  const key={PK:'ORDER#'+orderId,SK:'META'},o=await strongGet(db,T.orders,key);
  if(!o||o.orderId!==orderId||o.isGuestOrder===true||o.deletedAt!=null||o.deletionRequestId!=null||o.isDeleted===true)return fail('CANCELLATION_UNAVAILABLE');
  const guards:Row[]=[];
  if(actor.kind==='CUSTOMER'){if(o.userSub!==actor.subjectId)return fail('FORBIDDEN');}
  else {const bk={businessId:o.storeId},b=await strongGet(db,'WhizzMerchants_Businesses',bk);if(!b||!b.ownerId||b.cognitoUserId!==b.ownerId||b.deletionRequestId!=null||b.deletedAt!=null||b.isDeleted===true)return fail('FORBIDDEN');if(actor.kind==='STAFF'){if(!options.authorizeStaff)return fail('FORBIDDEN');const staffGuards=await options.authorizeStaff(actor,o,b);if(!staffGuards?.length)return fail('FORBIDDEN');guards.push(...staffGuards);}else if(b.ownerId!==actor.subjectId)return fail('FORBIDDEN');guards.push(exactCheck('WhizzMerchants_Businesses',bk,b,[...new Set([...Object.keys(b),'deletedAt','deletionRequestId','isDeleted'])]));for(const pk of ['BUSINESS_LIFECYCLE#MERCHANT#'+o.storeId,'ACCOUNT_LIFECYCLE#MERCHANT#'+b.ownerId])guards.push({ConditionCheck:{TableName:'staging-AccountDeletion',Key:{pk,sk:'META'},ConditionExpression:'attribute_not_exists(pk)'}});}
  const policy=readOrderExceptionPolicy(o);if(!policy||o.financialSnapshot?.schemaVersion!==3||options.enableFullCash!==true)return fail('CANCELLATION_POLICY_REQUIRED');
  return {actor,key,o,guards,policy};
 }
 function beforePickup(o:Row){if(o.merchantHandover?.state==='HANDED_TO_DRIVER'||!['pending','confirmed','preparing','in_kitchen','ready','ready_for_pickup','reassigning','assigned','accepted','heading_to_store','arrived_at_store'].includes(o.status)||o.pickedUpAt!=null||o.pickupAt!=null||o.returnCaseId!=null||o.financialOutcome!=null||o.cashCollected===true||Number(o.cashCollectedAmount??0)!==0)return fail('CANCELLATION_AFTER_PICKUP_OR_TERMINAL');}
 async function commit(c:Row,ops:Row[]){if(!equal(c.actor,await authenticate()))return fail('UNAUTHORIZED');await db.send(new TransactWriteCommand({TransactItems:[...c.guards,...ops] as any,ClientRequestToken:quoteHash(ops).slice(0,36)}));}
 function audit(c:Row,id:string,action:string,at:string){return {Put:{TableName:T.audit,Item:{datePartition:'date#'+at.slice(0,10).replace(/-/g,''),sk:at+'#'+id+'#'+action,logId:id+':'+action,orderId:c.o.orderId,actorId:c.actor.subjectId,actorKind:c.actor.kind,action,createdAt:at},ConditionExpression:'attribute_not_exists(sk)'}};}
 function view(r:Row){return {success:true,orderId:r.orderId,cancellationRequestId:r.requestId,cancellationStatus:r.state,cancelled:r.state==='CANCELLED',newStatus:r.state==='CANCELLED'?'cancelled':r.orderStatusAtRequest,holdReleased:false,caseId:r.caseId,version:r.version,message:r.state==='CANCELLED'?'تم إلغاء الطلب دون رسوم':'سُجل طلب الإلغاء للمراجعة؛ يستمر الطلب حتى تأكيد الإلغاء، ولن تُفرض رسوم غير معلنة'};}
 async function cancelUnassigned(c:Row,record:Row,at:string,extra:Row[]=[],existing=false,review=false){
  const o=c.o;
  if(o.driverId!=null||o.assignedDriverId!=null||o.financialAcceptance!=null||o.holdId!=null||o.walletPendingHoldId!=null||Number(o.holdAmount??0)!==0||['ACTIVE','SETTLED','CAPTURED'].includes(o.holdStatus))return fail('CANCELLATION_ASSIGNED_REVIEW_REQUIRED');
  const snapshot=o.financialSnapshot,rebuilt=prepareFullCashOrderSnapshot({order:snapshot.order,deliveryFunding:snapshot.deliveryFunding});
  if(snapshot.deliveryFunding&&options.enableDeliveryFunding!==true)return fail('CANCELLATION_FINANCIAL_REVIEW_REQUIRED');
  if(!equal(snapshot,rebuilt)||snapshot.order.orderId!==o.orderId||snapshot.order.branchId!==o.storeId||snapshot.order.merchantId!==o.merchantId||snapshot.order.allocation.paymentMethod!=='COD'||o.commercialPricing?.schemaVersion!==(snapshot.deliveryFunding?2:1)||!equal(o.commercialPricing.deliveryFunding,snapshot.deliveryFunding))return fail('CANCELLATION_FINANCIAL_REVIEW_REQUIRED');
  const funding=readMoney(o.commercialPricing.funding?.amount);
  if(!equal(funding,readMoney(snapshot.order.allocation.platformGoodsDiscount)))return fail('CANCELLATION_FINANCIAL_REVIEW_REQUIRED');
  const release=await prepareCodRelease(db,{...o,holdId:null,holdAmount:0,holdStatus:'NOT_REQUIRED'},
    {allocation:{driverWalletHold:fromWholeIqd(0),platformGoodsDiscountFunding:funding,...(snapshot.deliveryFunding?{platformDeliveryPromotionFunding:snapshot.deliveryFunding.allocation.platformShare}:{})}},at,record.requestId,true,options.enableDeliveryFunding===true,snapshot.deliveryFunding,true);
  const jk={orderId:o.orderId,SK:'METADATA'},job=await strongGet(db,T.jobs,jk);
  if(job&&(job.assignedDriverId!=null||job.driverId!=null||!['pending','created','waiting_for_merchant','searching','no_driver_available'].includes(job.status)))return fail('CANCELLATION_CONFLICT');
  const bucket=typeof o.storeStatus==='string'&&o.storeStatus.match(/#b\d+$/)?.[0];if(!bucket)return fail();
  const next={...record,state:'CANCELLED',version:record.version+1,completedAt:at,cancelledBy:c.actor.subjectId,driverFare:{status:'NOT_APPLICABLE',amount:0},merchantCompensation:review?{status:'REVIEW'}:{status:'NOT_APPLICABLE',amount:0},...(review?{settlementStatus:'REVIEW',phaseHistory:[...(record.phaseHistory??[]),...(record.activePhase?[{...record.activePhase,respondedAt:at,responseSource:'ADMIN_CANCELLATION'}]:[])],activePhase:casePhase(record.casePolicySnapshot,'FINANCIAL',at)}:{}),liability:'NOT_ASSESSED',cashCollected:0};
  const fields={status:'cancelled',orderStatus:'cancelled',storeStatus:o.storeId+'#cancelled'+bucket,updatedAt:at,cancelledAt:at,canceledAt:at,canceledBy:c.actor.kind==='CUSTOMER'?'customer':c.actor.kind==='STAFF'?'system':'restaurant',cancelReason:record.reason,financialOutcome:record.requestId,walletFinancialStatus:'CANCELLED',exceptionCancellation:{requestId:record.requestId,caseId:record.caseId,state:'CANCELLED',version:next.version}};
  const outcome={orderId:o.orderId,sk:'FINANCIAL_OUTCOME',kind:record.kind==='MERCHANT_CANCELLATION'?'MERCHANT_CANCELLATION_JOURNAL':'CUSTOMER_CANCELLATION_JOURNAL',financialSchemaVersion:4,settlementModel:'FULL_CASH_AT_DELIVERY_V1',outcome:'CANCELLED',operationId:record.requestId,branchId:o.storeId,actorKind:c.actor.kind,actorId:c.actor.subjectId,journalLines:release.journalLines,receipt:view(next),createdAt:at};
  const caseIndex=await exceptionCaseIndexOperation(db,{caseId:record.caseId,orderId:o.orderId,caseKey:record.sk,caseType:record.kind,state:review?'SETTLEMENT_PENDING':'CANCELLED',open:review,at,branchId:o.storeId,dueAt:next.activePhase?.responseDueAt??at});
  await commit(c,[caseIndex,...release.operations,...extra,set(exactCheck(T.orders,c.key,o,[...new Set([...Object.keys(o),'merchantHandover'])]),fields),job?set(exactCheck(T.jobs,jk,job),{status:'cancelled',completedAt:at,cancellationOperationId:record.requestId}):{ConditionCheck:{TableName:T.jobs,Key:jk,ConditionExpression:'attribute_not_exists(orderId)'}},{Put:{TableName:T.holds,Item:outcome,ConditionExpression:'attribute_not_exists(orderId)'}},audit(c,record.requestId,'CUSTOMER_CANCELLATION_CONFIRMED',at),{Put:{TableName:T.holds,Item:next,...(!existing?{ConditionExpression:'attribute_not_exists(orderId)'}:{ConditionExpression:'#v=:v',ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':v':record.version}})}}]);
  return view(next);
 }
 return {
  async merchantCancelUnassigned(value:Row){
   if(!value||Object.keys(value).sort().join(',')!=='branchId,cashCollected,goodsRetainedByBranch,idempotencyKey,orderId,preparationState,reason'||value.goodsRetainedByBranch!==true||value.cashCollected!==false||!['NOT_STARTED','STARTED','READY'].includes(value.preparationState)||typeof value.reason!=='string'||value.reason.trim().length<5||value.reason.length>1000||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value.idempotencyKey||''))return fail('INVALID_CANCELLATION');
   const c=await load(value.orderId);if(c.actor.kind!=='MERCHANT_OWNER'||value.branchId!==c.o.storeId)return fail('FORBIDDEN');
   const k={orderId:value.orderId,sk:'MERCHANT_CANCELLATION'},old=await strongGet(db,T.holds,k),digest=quoteHash({...value,actorId:c.actor.subjectId});
   if(old){if(old.requestDigest!==digest||old.actorId!==c.actor.subjectId)return fail();return {...view(old),replayed:true};}
   beforePickup(c.o);if(value.preparationState==='NOT_STARTED'&&(c.o.preparingAt!=null||c.o.preparationStartedAt!=null||c.o.inKitchenAt!=null||c.o.readyAt!=null||['preparing','in_kitchen','ready','ready_for_pickup'].includes(c.o.status)))return fail('CANCELLATION_PREPARATION_REVIEW_REQUIRED');
   const policy=await readExceptionCasePolicy(db),at=new Date(now()).toISOString(),requestId='MCAN:'+quoteHash({orderId:value.orderId}).slice(0,48),caseId='OEX:'+quoteHash({requestId}).slice(0,48),review=value.preparationState!=='NOT_STARTED';
   const row={...k,kind:'MERCHANT_CANCELLATION',schemaVersion:1,version:1,caseId,requestId,actorId:c.actor.subjectId,actorKind:'MERCHANT_OWNER',idempotencyKey:value.idempotencyKey,requestDigest:digest,reason:value.reason.trim(),preparationState:value.preparationState,casePolicySnapshot:policy.snapshot,activePhase:casePhase(policy.snapshot,'FINANCIAL',at),policyVersion:c.policy.version,policyDigest:c.policy.digest,state:'REQUESTED',createdAt:at,responsibility:'UNDETERMINED',customerFee:0,merchantRetentionProof:{ownerId:c.actor.subjectId,branchId:c.o.storeId,goodsRetainedByBranch:true,preparationState:value.preparationState,note:value.reason.trim(),recordedAt:at},merchantCompensation:{status:review?'REVIEW':'NOT_APPLICABLE'},driverFare:{status:'NOT_APPLICABLE',amount:0}};
   const extras:Row[]=[policy.condition];const customerKey={orderId:value.orderId,sk:'CUSTOMER_CANCELLATION'},customer=await strongGet(db,T.holds,customerKey);
   if(customer?.state==='REQUESTED'){const {Key:_key,...fence}=exactCheck(T.holds,customerKey,customer).ConditionCheck;extras.push({Put:{...fence,Item:{...customer,state:'SUPERSEDED',version:customer.version+1,linkedCaseId:caseId,updatedAt:at,completedAt:at}}},await exceptionCaseIndexOperation(db,{caseId:customer.caseId,orderId:value.orderId,caseKey:customer.sk,caseType:customer.kind,state:'SUPERSEDED',open:false,at,branchId:c.o.storeId}));}
   else extras.push(customer?exactCheck(T.holds,customerKey,customer):{ConditionCheck:{TableName:T.holds,Key:customerKey,ConditionExpression:'attribute_not_exists(orderId)'}});
   return cancelUnassigned(c,row,at,extras,false,review);
  },
  async adminCancelUnassigned(value:Row){
   if(!value||Object.keys(value).sort().join(',')!==['cashCollected','decisionId','expectedVersion',...(options.administrativeCancellation===true?[]:['goodsRetainedByBranch']),'orderId','reason','requestId'].sort().join(',')||value.cashCollected!==false||options.administrativeCancellation!==true&&value.goodsRetainedByBranch!==true||!quoteEntityIdValid(value.decisionId)||typeof value.reason!=='string'||value.reason.trim().length<5||value.reason.length>1000)return fail('INVALID_CANCELLATION');
   const c=await load(value.orderId);if(c.actor.kind!=='STAFF')return fail('FORBIDDEN');
   const row=await strongGet(db,T.holds,{orderId:value.orderId,sk:'CUSTOMER_CANCELLATION'});
   if(!row||row.requestId!==value.requestId)return fail();
   if(row.state==='CANCELLED'&&row.decision?.decisionId===value.decisionId&&row.decision?.actorId===c.actor.subjectId){if(row.decision.reason!==value.reason.trim()||row.decision.expectedVersion!==value.expectedVersion)return fail();return {...view(row),replayed:true};}
   if(row.state!=='REQUESTED'||row.version!==value.expectedVersion)return fail();beforePickup(c.o);
   const branch=(await strongGet(db,'WhizzMerchants_Businesses',{businessId:c.o.storeId})),proof=row.merchantRetentionProof;
   if(options.administrativeCancellation!==true&&(!proof||proof.ownerId!==branch?.ownerId||proof.branchId!==c.o.storeId||proof.goodsRetainedByBranch!==true))return fail('CANCELLATION_RETAINED_PROOF_REQUIRED');
   const at=new Date(now()).toISOString(),policy=row.casePolicySnapshot?null:await readExceptionCasePolicy(db);
   return cancelUnassigned(c,{...row,...(policy?{casePolicySnapshot:policy.snapshot,casePolicyAdoptedAt:at}:{}),decision:{decisionId:value.decisionId,expectedVersion:value.expectedVersion,actorId:c.actor.subjectId,reason:value.reason.trim(),at}},at,[...(policy?[policy.condition]:[]),{Put:{TableName:T.holds,Item:{orderId:value.orderId,sk:'CASE_DECISION#'+row.caseId+'#'+value.decisionId,kind:'ORDER_EXCEPTION_DECISION',caseId:row.caseId,decisionId:value.decisionId,action:'CANCEL_BEFORE_PICKUP',actorId:c.actor.subjectId,actorKind:'STAFF',reason:value.reason.trim(),caseVersion:row.version,createdAt:at,financialPosting:false},ConditionExpression:'attribute_not_exists(orderId)'}}],true,true);
  },
  async recordMerchantRetention(value:Row){
   if(!value||Object.keys(value).sort().join(',')!=='branchId,expectedVersion,goodsRetainedByBranch,note,orderId,preparationState,requestId'||value.goodsRetainedByBranch!==true||!['NOT_STARTED','STARTED','READY'].includes(value.preparationState)||typeof value.note!=='string'||value.note.trim().length<3||value.note.length>1000)return fail('INVALID_CANCELLATION');
   const c=await load(value.orderId);if(c.actor.kind!=='MERCHANT_OWNER'||c.o.storeId!==value.branchId)return fail('FORBIDDEN');beforePickup(c.o);
   const k={orderId:value.orderId,sk:'CUSTOMER_CANCELLATION'},row=await strongGet(db,T.holds,k);
   if(!row||row.requestId!==value.requestId||row.state!=='REQUESTED')return fail();
   const proof={ownerId:c.actor.subjectId,branchId:c.o.storeId,goodsRetainedByBranch:true,preparationState:value.preparationState,note:value.note.trim()};
   if(row.merchantRetentionProof&&equal(proof,Object.fromEntries(Object.entries(row.merchantRetentionProof).filter(([k])=>!['recordedAt','evidenceId'].includes(k)))))return {...view(row),replayed:true};
   if(row.version!==value.expectedVersion)return fail();
   if(value.preparationState==='NOT_STARTED'&&(c.o.preparingAt!=null||c.o.preparationStartedAt!=null||c.o.inKitchenAt!=null||c.o.readyAt!=null||c.o.financialAcceptance!=null||c.o.driverId!=null||['preparing','in_kitchen','ready','ready_for_pickup'].includes(c.o.status)))return fail('CANCELLATION_PREPARATION_REVIEW_REQUIRED');
   if((row.evidenceIds??[]).length>=100)return fail('EXCEPTION_CASE_EVIDENCE_LIMIT');
   const at=new Date(now()).toISOString(),evidenceId='MERCHANT_RETENTION#'+row.caseId+'#'+(row.version+1),next={...row,version:row.version+1,evidenceIds:[...(row.evidenceIds??[]),evidenceId],merchantRetentionProof:{...proof,recordedAt:at,evidenceId},updatedAt:at};
   const {Key:_key,...condition}=exactCheck(T.holds,k,row).ConditionCheck;
   await commit(c,[{Put:{TableName:T.holds,Item:{orderId:value.orderId,sk:'CASE_EVIDENCE#'+evidenceId,kind:'ORDER_EXCEPTION_EVIDENCE',caseId:row.caseId,evidenceId,type:'MERCHANT_RETENTION',actorId:c.actor.subjectId,actorKind:'MERCHANT_OWNER',proof,createdAt:at},ConditionExpression:'attribute_not_exists(orderId)'}},{Put:{...condition,Item:next}},set(exactCheck(T.orders,c.key,c.o,[...new Set([...Object.keys(c.o),'merchantHandover'])]),{exceptionCancellation:{requestId:row.requestId,caseId:row.caseId,state:row.state,version:next.version},updatedAt:at}),audit(c,row.requestId+'#'+next.version,'MERCHANT_CANCELLATION_RETENTION_RECORDED',at)]);
   return view(next);
  },
  async confirmNoPreparation(value:Row){
   if(!value||Object.keys(value).sort().join(',')!=='branchId,expectedVersion,orderId,preparationNotStarted,requestId'||value.preparationNotStarted!==true||!Number.isSafeInteger(value.expectedVersion))return fail('INVALID_CANCELLATION');
   const c=await load(value.orderId);if(c.actor.kind!=='MERCHANT_OWNER'||c.o.storeId!==value.branchId)return fail('FORBIDDEN');
   const row=await strongGet(db,T.holds,{orderId:value.orderId,sk:'CUSTOMER_CANCELLATION'});
   if(!row||row.requestId!==value.requestId)return fail();
   if(row.state==='CANCELLED')return {...view(row),replayed:true};
   if(row.state!=='REQUESTED'||row.version!==value.expectedVersion)return fail();
   beforePickup(c.o);
   if(row.merchantRetentionProof&&row.merchantRetentionProof.preparationState!=='NOT_STARTED')return fail('CANCELLATION_PREPARATION_REVIEW_REQUIRED');
   if(!['pending','confirmed'].includes(c.o.status)||c.o.preparationStartedAt!=null||c.o.preparingAt!=null||c.o.readyAt!=null||c.o.inKitchenAt!=null)return fail('CANCELLATION_PREPARATION_REVIEW_REQUIRED');
   return cancelUnassigned(c,{...row,merchantNoPreparationConfirmation:{actorId:c.actor.subjectId,confirmedAt:new Date(now()).toISOString()}},new Date(now()).toISOString(),[],true);
  },
  async read(orderId:string,branchId?:string){const c=await load(orderId);if(c.actor.kind==='MERCHANT_OWNER'&&c.o.storeId!==branchId)return fail('FORBIDDEN');const r=await strongGet(db,T.holds,{orderId,sk:'CUSTOMER_CANCELLATION'});return r?{...view(r),reason:r.reason,merchantRetentionProof:c.actor.kind==='CUSTOMER'?(r.merchantRetentionProof?{recordedAt:r.merchantRetentionProof.recordedAt,preparationState:r.merchantRetentionProof.preparationState}:null):r.merchantRetentionProof??null,preparationState:c.o.readyAt!=null||['ready','ready_for_pickup'].includes(c.o.status)?'READY':c.o.inKitchenAt!=null||c.o.preparingAt!=null||c.o.preparationStartedAt!=null||['preparing','in_kitchen'].includes(c.o.status)?'STARTED':'NOT_STARTED',canConfirmNoPreparation:r.state==='REQUESTED'&&(r.merchantRetentionProof?.preparationState??'NOT_STARTED')==='NOT_STARTED'&&['pending','confirmed'].includes(c.o.status)&&c.o.driverId==null&&c.o.assignedDriverId==null&&c.o.preparingAt==null&&c.o.preparationStartedAt==null&&c.o.readyAt==null&&c.o.inKitchenAt==null}: {success:true,orderId,exists:false,mode:c.o.status==='pending'?'IMMEDIATE_IF_STILL_PENDING':'REQUEST_REVIEW',message:c.o.status==='pending'?'يمكن إلغاء الطلب دون رسوم ما دام المطعم لم يقبله':'بعد قبول المطعم يُرسل طلب إلغاء للمراجعة، ولا يتوقف الطلب حتى تأكيد الإلغاء'};},
  async request(value:Row){
   if(!value||Object.keys(value).sort().join(',')!=='idempotencyKey,orderId,reason'||typeof value.reason!=='string'||value.reason.trim().length<3||value.reason.length>500||typeof value.idempotencyKey!=='string'||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value.idempotencyKey))return fail('INVALID_CANCELLATION');
   const v=detach(value),c=await load(v.orderId);if(!['CUSTOMER','STAFF'].includes(c.actor.kind))return fail('FORBIDDEN');
   const k={orderId:v.orderId,sk:'CUSTOMER_CANCELLATION'},prior=await strongGet(db,T.holds,k),digest=quoteHash({...v,actorId:c.actor.subjectId});
   if(prior){if(prior.actorId!==c.actor.subjectId)return fail('FORBIDDEN');if(prior.idempotencyKey===v.idempotencyKey&&prior.requestDigest!==digest)return fail();return {...view(prior),replayed:true};}
   beforePickup(c.o);const casePolicy=await readExceptionCasePolicy(db);const at=new Date(now()).toISOString(),requestId='CAN:'+quoteHash({orderId:v.orderId,actorId:c.actor.subjectId}).slice(0,48);
   const row={...k,casePolicySnapshot:casePolicy.snapshot,activePhase:casePhase(casePolicy.snapshot,'CUSTODY',at),schemaVersion:1,kind:'CUSTOMER_CANCELLATION',version:1,requestId,caseId:'OEX:'+quoteHash({requestId}).slice(0,48),idempotencyKey:v.idempotencyKey,requestDigest:digest,actorId:c.actor.subjectId,actorKind:c.actor.kind,reason:v.reason.trim(),policyVersion:c.policy.version,policyDigest:c.policy.digest,state:'REQUESTED',orderStatusAtRequest:c.o.status,preparationAtRequest:c.o.preparationStartedAt??c.o.preparingAt??null,createdAt:at,responsibility:'UNDETERMINED',customerFee:0,merchantCompensation:{status:'REVIEW'},driverFare:{status:'REVIEW'},returnExtraFee:0};
   try{
    if(c.o.status==='pending'&&c.o.confirmedAt==null&&c.o.preparingAt==null&&c.o.preparationStartedAt==null&&c.o.readyAt==null&&c.o.inKitchenAt==null)return await cancelUnassigned(c,row,at,[casePolicy.condition]);
    const caseIndex=await exceptionCaseIndexOperation(db,{caseId:row.caseId,orderId:v.orderId,caseKey:row.sk,caseType:'CUSTOMER_CANCELLATION',state:'REQUESTED',open:true,at,branchId:c.o.storeId,dueAt:row.activePhase.responseDueAt});
    await commit(c,[casePolicy.condition,caseIndex,{Put:{TableName:T.holds,Item:row,ConditionExpression:'attribute_not_exists(orderId)'}},set(exactCheck(T.orders,c.key,c.o,[...new Set([...Object.keys(c.o),'merchantHandover'])]),{exceptionCancellation:{requestId,caseId:row.caseId,state:'REQUESTED',version:1},updatedAt:at}),audit(c,requestId,c.actor.kind==='STAFF'?'STAFF_CANCELLATION_REQUESTED':'CUSTOMER_CANCELLATION_REQUESTED',at)]);return view(row);
   }catch(e){const saved=await strongGet(db,T.holds,k);if(saved?.actorId===c.actor.subjectId&&saved.requestDigest===digest)return {...view(saved),replayed:true};throw e;}
  }
 };
}
