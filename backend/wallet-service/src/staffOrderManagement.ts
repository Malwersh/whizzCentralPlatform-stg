import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';
import {CognitoIdentityProviderClient} from '@aws-sdk/client-cognito-identity-provider';
import {createExceptionStaffAuthority} from './exceptionStaffAuthority';
import {createCustomerCancellation} from './customerCancellation';
import {createStagingCodReassignment} from './codReassignment';
import {createFinanceRollout} from './financeRollout';
import {readDeliveryOperations} from './deliveryOperations';
import {strongGet} from './driverFinancialTransaction';
import {quoteEntityIdValid} from './deliveryQuoteRecord';
const {allowed}=require('../../staff-service/catalog');
type Row=Record<string,any>;
const fail=(code:string):never=>{throw Object.assign(Error(code),{code});};
const before=new Set(['pending','confirmed','preparing','in_kitchen','ready','ready_for_pickup','reassigning','assigned','accepted','heading_to_store','arrived_at_store']);
export function createStaffOrderManagement({db,authority,rollout,enableFullCash,enableDeliveryFunding,operating}:any){
 return async(v:Row)=>{
  if(!v||!quoteEntityIdValid(v.orderId)||!['READ','REQUEST_CANCELLATION','CANCEL_ORDER','UNASSIGN_REDISPATCH'].includes(v.action))return fail('INVALID_ORDER_MANAGEMENT');
  const keys=v.action==='READ'?['action','orderId']:['REQUEST_CANCELLATION','CANCEL_ORDER'].includes(v.action)?['action','orderId','reason','idempotencyKey']:['action','orderId','reason','idempotencyKey','offerId','attempt'];
  if(Object.keys(v).sort().join(',')!==keys.sort().join(','))return fail('INVALID_ORDER_MANAGEMENT');
  const actor=await authority.authenticate();await rollout.order(v.orderId,'DRAIN');
  const access=await authority.read(actor),o=await strongGet(db,'WizzOrders',{PK:'ORDER#'+v.orderId,SK:'META'});
  if(!o||o.orderId!==v.orderId||o.deletedAt!=null||o.deletionRequestId!=null||o.isDeleted===true)return fail('ORDER_MANAGEMENT_UNAVAILABLE');
  const eligible=enableFullCash&&o.financialSnapshot?.schemaVersion===3&&o.merchantHandover?.state!=='HANDED_TO_DRIVER'&&before.has(o.status)&&o.pickedUpAt==null&&o.pickupAt==null&&o.financialOutcome==null&&o.returnCaseId==null&&o.cashCollected!==true&&Number(o.cashCollectedAmount??0)===0;
  const cancellation=await strongGet(db,'staging-Holds',{orderId:v.orderId,sk:'CUSTOMER_CANCELLATION'});
  const pending=cancellation?.state==='REQUESTED';
  if(v.action==='READ')return {success:true,item:{orderId:v.orderId,orderNumber:o.orderNumber||v.orderId,status:o.status,branchName:o.storeName||o.restaurantName||'',driverAssigned:!!o.financialAcceptance,driverName:o.driverName||null,holdStatus:o.holdStatus||'NONE',holdAmount:o.holdAmount||0,attempt:o.assignmentAttemptCounter??null,offerId:o.financialAcceptance?.offerId??null,cancellation: cancellation?{caseId:cancellation.caseId,state:cancellation.state,hasRetentionProof:cancellation.merchantRetentionProof?.goodsRetainedByBranch===true}:null,merchantHandover:o.merchantHandover||null,canRequestCancellation:eligible&&(!cancellation||pending)&&allowed(access.employee,'orders.cancel'),canUnassign:eligible&&!pending&&!!o.financialAcceptance&&['assigned','accepted','heading_to_store','arrived_at_store'].includes(o.status)&&allowed(access.employee,'orders.assign'),limitation:eligible?null:'لا يمكن تغيير الإسناد أو الإلغاء المباشر بعد الاستلام أو إغلاق الطلب؛ تابع الحالة من قضايا الطلبات.'}};
  if(typeof v.reason!=='string'||v.reason.trim().length<5||v.reason.length>1000||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v.idempotencyKey||''))return fail('ORDER_MANAGEMENT_REASON_REQUIRED');
  if(['REQUEST_CANCELLATION','CANCEL_ORDER'].includes(v.action)){
   await authority.cancel(actor);
   const api=createCustomerCancellation({db,authenticate:authority.authenticate,authorizeStaff:authority.cancel,enableFullCash,enableDeliveryFunding,administrativeCancellation:true});
   let record=cancellation;
   if(!record){await api.request({orderId:v.orderId,reason:v.reason,idempotencyKey:v.idempotencyKey});record=await strongGet(db,'staging-Holds',{orderId:v.orderId,sk:'CUSTOMER_CANCELLATION'});}
   if(record?.state==='CANCELLED')return {success:true,cancelled:true,cancellationStatus:'CANCELLED',replayed:true};
   if(!record||record.state!=='REQUESTED')return fail('CANCELLATION_CONFLICT');
   const decision={requestId:record.requestId,expectedVersion:record.version,decisionId:v.idempotencyKey,reason:v.reason.trim()};
   if(o.financialAcceptance)return createStagingCodReassignment({db,authenticate:authority.authenticate,authorizeStaff:authority.cancel,cancelActorKind:'STAFF',administrativeCancellation:true,cancellationDecision:decision,enableFullCash,enableDeliveryFunding,reassignmentWindowSeconds:120}).cancelBeforePickup({orderId:v.orderId,branchId:o.storeId,offerId:o.financialAcceptance.offerId,attempt:o.assignmentAttemptCounter,cashCollected:false});
   return api.adminCancelUnassigned({orderId:v.orderId,...decision,cashCollected:false});
  }
  await authority.assign(actor);
  if(pending)return fail('ORDER_CANCELLATION_PENDING');
  const settings=await operating();
  return createStagingCodReassignment({db,authenticate:authority.authenticate,authorizeStaff:authority.assign,unassignActorKind:'STAFF',assignmentDecision:{reason:v.reason.trim(),idempotencyKey:v.idempotencyKey},enableFullCash,enableDeliveryFunding,reassignmentWindowSeconds:settings.values.reassignmentWindowSeconds,maximumWaves:settings.values.maximumWaves,operatingCondition:settings.condition,operatingVersion:settings.version}).unassign({orderId:v.orderId,offerId:v.offerId,attempt:v.attempt,cashCollected:false,reason:'Other'});
 };
}
export async function handler(event:Row){
 try{
  if(!event||Object.keys(event).sort().join(',')!=='accessToken,action,body'||event.action!=='staff_order_management'||typeof event.accessToken!=='string')return fail('UNAUTHORIZED');
  if(process.env.AWS_REGION!=='us-east-1'||(process.env.STAGE??process.env.ENVIRONMENT)!=='staging'||process.env.FINANCIAL_COD_ASSIGNMENTS_MODE!=='REQUIRED'||process.env.FINANCIAL_SETTLEMENT_MODEL!=='FULL_CASH_AT_DELIVERY_V1')return fail('ORDER_MANAGEMENT_DISABLED');
  const raw=DynamoDBDocumentClient.from(new DynamoDBClient({region:'us-east-1'}),{marshallOptions:{removeUndefinedValues:true}}),rollout=createFinanceRollout({db:raw}),db=rollout.db;
  const authority=createExceptionStaffAuthority({db,cognito:new CognitoIdentityProviderClient({region:'us-east-1'}),accessToken:event.accessToken});
  const result=await createStaffOrderManagement({db,authority,rollout,enableFullCash:true,enableDeliveryFunding:process.env.FINANCIAL_DELIVERY_FUNDING_MODE==='REQUIRED',operating:()=>readDeliveryOperations(db,process.env)})(event.body);
  return {statusCode:200,result};
 }catch(e:any){return {statusCode:e?.code==='UNAUTHORIZED'?401:409,code:e?.code||'ORDER_MANAGEMENT_UNAVAILABLE'};}
}
// Shared factories also fence legacy entry points against merchant handover races.
export {createStagingCodReassignment,createCustomerCancellation};
