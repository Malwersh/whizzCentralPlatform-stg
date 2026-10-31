import {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';
import {readStagingCommercialAgreement} from './orderCommercialSource';
import {validateCommercialCharge} from './orderCommercialPricing';
import {moneyFromMinor,readMoney,readWholeIqdRounding,quantizeWholeIqd} from './money';
import {quoteEntityIdValid} from './deliveryQuoteRecord';
export async function serviceFeePreview320(db:Pick<DynamoDBDocumentClient,'send'>,value:any,now=Date.now()){
 if(!value||Object.keys(value).join(',')!=='branchId'||!quoteEntityIdValid(value.branchId))throw Object.assign(Error('INVALID_STOREFRONT_REQUEST'),{code:'INVALID_STOREFRONT_REQUEST'});
 const {terms}=await readStagingCommercialAgreement(db,value.branchId,now);
 const charge=validateCommercialCharge(terms.serviceFee);
 let amount=charge.kind==='FIXED'?readMoney(charge.fixed):charge.kind==='NONE'?moneyFromMinor(0):null;
 if(amount&&charge.finalRounding)amount=quantizeWholeIqd(amount,readWholeIqdRounding(charge.finalRounding));
 return {kind:'SERVICE_FEE_PREVIEW',schemaVersion:1,branchId:value.branchId,baseServiceFee:amount,createdAt:new Date(now).toISOString(),expiresAt:new Date(Math.min(now+120000,terms.effectiveTo===null?Infinity:Date.parse(terms.effectiveTo))).toISOString(),informationalOnly:true,requiresFinalConfirmation:true};
}
