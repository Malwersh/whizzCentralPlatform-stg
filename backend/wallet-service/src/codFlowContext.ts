import {financialOfferSK} from './financialOfferKey';
import {verifyFullCashAssignment} from './fullCashOffer';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { verifyDeliveryFundedAssignment } from './deliveryFundedOffer';
import { verifyFinancialAssignment } from './financialAssignment';
import { quoteHash, quoteEntityIdValid } from './deliveryQuoteRecord';
import { detach, strongGet, exactCheck, FinancialRow as Row } from './driverFinancialTransaction';
export type ReturnActor={kind:'DRIVER'|'MERCHANT_OWNER'|'STAFF';subjectId:string};
const T={orders:'WizzOrders',offers:'WaveOffers_staging',holds:'staging-Holds',driver:'WhizzDrivers_staging',branch:'WhizzMerchants_Businesses',deletion:'staging-AccountDeletion'};
const fail=(code='COD_RETURN_CONFLICT'):never=>{throw Object.assign(Error(code),{code});};
export function createCodFlowContext(options:{db:Pick<DynamoDBDocumentClient,'send'>;authenticate:()=>Promise<ReturnActor>;now:()=>number;enableDeliveryFunding?:boolean;enableFullCash?:boolean;authorizeStaff?:(actor:ReturnActor,order:Row,branch:Row)=>Promise<Row[]>}){
 const {db,authenticate,now}=options;
 async function context(v:Row,kind:ReturnActor['kind']){
  const actor=detach(await authenticate());if(actor.kind!==kind||!quoteEntityIdValid(actor.subjectId))return fail('UNAUTHORIZED');
  const key={PK:'ORDER#'+v.orderId,SK:'META'},order=await strongGet(db,T.orders,key);
  if(!order||order.orderId!==v.orderId||order.assignmentAttemptCounter!==v.attempt||order.financialAcceptance?.offerId!==v.offerId||
   order.deletedAt!=null||order.deletionStatus!=null||order.deletionRequestId!=null||order.isDeleted===true||!quoteEntityIdValid(order.driverId))return fail();
  const driverKey={driverId:order.driverId},driver=await strongGet(db,T.driver,driverKey),subject=driver?.cognitoSub??driver?.driverId;
  if(!driver||!quoteEntityIdValid(subject)||driver.deletionRequestId!=null||driver.deletedAt!=null||driver.isDeleted===true)return fail();
  const offerKey={orderId:v.orderId,SK:await financialOfferSK(db,v.orderId,order.driverId,order.assignmentWaveNumber)},saved=await strongGet(db,T.offers,offerKey);
  let offer:Row;
  if(order.financialAcceptance?.schemaVersion===3){if(options.enableFullCash!==true)return fail('FULL_CASH_RELEASE_DISABLED');const verified=verifyFullCashAssignment(order,saved!,subject);offer={...verified.baseOffer,digest:verified.digest,allocation:verified.settlement.allocation};}
  else if(order.financialAcceptance?.schemaVersion===2){if(options.enableDeliveryFunding!==true)return fail('DELIVERY_FUNDED_RELEASE_DISABLED');const verified=verifyDeliveryFundedAssignment(order,saved!,subject);offer={...verified.baseOffer,digest:verified.digest,allocation:verified.allocation};}
  else offer=verifyFinancialAssignment(order,saved,subject);
  const branchKey={businessId:offer.branchId},branch=await strongGet(db,T.branch,branchKey);
  if(!branch||!quoteEntityIdValid(branch.ownerId)||branch.cognitoUserId!==branch.ownerId||branch.organizationId!==offer.source.order.merchantId||
   branch.deletionRequestId!=null||branch.deletedAt!=null||branch.isDeleted===true)return fail();
  if(v.branchId!==undefined&&v.branchId!==offer.branchId)return fail('FORBIDDEN');
  let staffGuards:Row[]=[];
  if(kind==='STAFF'){if(!options.authorizeStaff)return fail('FORBIDDEN');staffGuards=await options.authorizeStaff(actor,order,branch);if(!Array.isArray(staffGuards)||!staffGuards.length)return fail('FORBIDDEN');}
  else if(kind==='DRIVER'?actor.subjectId!==subject:actor.subjectId!==branch.ownerId||actor.subjectId===subject)return fail('FORBIDDEN');
  const guards:Row[]=[...staffGuards,exactCheck(T.driver,driverKey,driver),exactCheck(T.offers,offerKey,saved!),exactCheck(T.branch,branchKey,branch)];
  for(const pk of new Set(['ACCOUNT_LIFECYCLE#DRIVER#'+order.driverId,'ACCOUNT_LIFECYCLE#DRIVER#'+subject,'BUSINESS_LIFECYCLE#MERCHANT#'+offer.branchId,'ACCOUNT_LIFECYCLE#MERCHANT#'+branch.ownerId]))
   guards.push({ConditionCheck:{TableName:T.deletion,Key:{pk,sk:'META'},ConditionExpression:'attribute_not_exists(pk)'}});
  const returnId='RET:'+quoteHash({orderId:v.orderId,attempt:v.attempt,offerId:v.offerId,digest:offer.digest}).slice(0,48),returnKey={orderId:v.orderId,sk:'RETURN#'+v.attempt};
  const record=await strongGet(db,T.holds,returnKey);
  if(record&&(record.kind!=='COD_RETURN_CASE'||record.schemaVersion!==1||record.orderId!==v.orderId||record.sk!==returnKey.sk||record.returnId!==returnId||record.driverId!==order.driverId||record.driverSubjectId!==subject||record.branchId!==offer.branchId||record.attempt!==v.attempt||record.offerId!==v.offerId||record.offerDigest!==offer.digest||record.cashCollected!==false||!Number.isSafeInteger(record.version)||record.version<1||record.version>=Number.MAX_SAFE_INTEGER))return fail();
  if(!Number.isSafeInteger(now())||Date.parse(order.financialAcceptance.acceptedAt)>now())return fail();
  return {actor,key,order,driver,branch,subject,offer,offerKey,guards,returnId,returnKey,record,timestamp:new Date(now()).toISOString()};
 }
 return context;
}
