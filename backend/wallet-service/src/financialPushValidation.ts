import {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';
import {readFinancialPushReference} from './financialPushReference';
import {readStagingFinancialOfferDelivery} from './financialOfferDelivery';
import {quoteHash} from './deliveryQuoteRecord';
import {strongGet,equal,FinancialRow as Row} from './driverFinancialTransaction';
import {createFinanceRollout} from './financeRollout';
const fail=():never=>{throw Error('FINANCIAL_PUSH_NOT_ALLOWED');};
/** Internal read-only validator; returns only the verified reference, never amounts/items. */
export function createStagingFinancialPushValidation(options:{db:Pick<DynamoDBDocumentClient,'send'>;now?:()=>number;env?:Row}){
 const {db}=options,now=options.now??Date.now,env=options.env??process.env;
 return async(value:Row)=>{
  if(env.STAGE!=='staging'||env.AWS_REGION!=='us-east-1'||env.FINANCIAL_PUSH_VALIDATION_MODE!=='REQUIRED'||!['OFF','REQUIRED'].includes(env.FINANCIAL_DELIVERY_FUNDING_MODE??'OFF'))return fail();
  const reference=readFinancialPushReference(value),enabled=env.FINANCIAL_DELIVERY_FUNDING_MODE==='REQUIRED';
   const rollout=createFinanceRollout({db,env,now});await rollout.order(reference.orderId,'SEND');rollout.driver(reference.orderId,reference.dispatchDriverId,reference.driverId);
   const proof=await readStagingFinancialOfferDelivery({db,now,enableDeliveryFunding:enabled},{orderId:reference.orderId,offerId:reference.offerId,waveNumber:reference.waveNumber,dispatchDriverId:reference.dispatchDriverId});
   if(!equal(proof.reference,reference)||proof.saved.financialDeliveryAck?.schemaVersion!==1||proof.saved.financialDeliveryAck.referenceDigest!==quoteHash(reference))return fail();
   const driver=await strongGet(db,'WhizzDrivers_staging',{driverId:reference.dispatchDriverId});
   if(!driver||(driver.cognitoSub??driver.driverId)!==reference.driverId||!['APPROVED','VERIFIED'].includes(String(driver.status||driver.registrationStatus).toUpperCase())||driver.isDeleted===true||driver.deletedAt!=null||driver.deletionRequestId!=null||driver.isBanned===true||driver.isSuspended===true)return fail();
   for(const pk of new Set(['ACCOUNT_LIFECYCLE#DRIVER#'+reference.driverId,'ACCOUNT_LIFECYCLE#DRIVER#'+reference.dispatchDriverId,'BUSINESS_LIFECYCLE#MERCHANT#'+proof.message.offer.branchId]))if(await strongGet(db,'staging-AccountDeletion',{pk,sk:'META'}))return fail();
  return {success:true,reference};
 };
}
