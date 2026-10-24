import {readFinancialPushReference} from './financialPushReference';
import {readStagingFinancialOfferDelivery} from './financialOfferDelivery';
import {equal,strongGet,FinancialRow as Row} from './driverFinancialTransaction';
import {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';
export function createStagingFinancialOfferHydration(options:{db:Pick<DynamoDBDocumentClient,'send'>;now?:()=>number;enableDeliveryFunding?:boolean;enableFullCash?:boolean;authenticate:()=>Promise<{driverId:string;subjectId:string}>;authorize:(reference:Row)=>Promise<void>}){
 return async(value:Row)=>{
  const reference=readFinancialPushReference(value),actor=await options.authenticate();
  if(actor.driverId!==reference.dispatchDriverId||actor.subjectId!==reference.driverId)throw Error('UNAUTHORIZED');
  await options.authorize(reference);
  const proof=await readStagingFinancialOfferDelivery(options,{orderId:reference.orderId,offerId:reference.offerId,waveNumber:reference.waveNumber,dispatchDriverId:actor.driverId});
  if(!equal(reference,proof.reference))throw Error('FINANCIAL_OFFER_NOT_AVAILABLE');
  const driver=await strongGet(options.db,'WhizzDrivers_staging',{driverId:actor.driverId});
  if(!driver||(driver.cognitoSub??driver.driverId)!==actor.subjectId||!['APPROVED','VERIFIED'].includes(String(driver.status||driver.registrationStatus).toUpperCase())||driver.isDeleted===true||driver.deletedAt!=null||driver.deletionRequestId!=null||driver.isBanned===true||driver.isSuspended===true)throw Error('UNAUTHORIZED');
  for(const pk of new Set(['ACCOUNT_LIFECYCLE#DRIVER#'+actor.subjectId,'ACCOUNT_LIFECYCLE#DRIVER#'+actor.driverId,'BUSINESS_LIFECYCLE#MERCHANT#'+proof.message.offer.branchId]))if(await strongGet(options.db,'staging-AccountDeletion',{pk,sk:'META'}))throw Error('FINANCIAL_OFFER_NOT_AVAILABLE');
  return {success:true,message:proof.message};
 };
}
