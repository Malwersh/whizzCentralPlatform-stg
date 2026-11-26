'use strict';
const {quoteHash}=require('../../dist/deliveryQuoteRecord');
module.exports=function seed(f,owner,{debt=0,credit=0}={}){
 f.put('staging-MerchantPlatform',{pk:'OPERATIONAL_SETTINGS#MERCHANT_CORRECTIONS',sk:'CURRENT',kind:'MERCHANT_CORRECTION_POLICY',version:1,recoveryMode:'OFFSET_NEXT_SETTLEMENT',applyCredits:true});
 f.put('staging-MerchantPlatform',{pk:'MERCHANT_CORRECTIONS#branch1',sk:'POSITION',kind:'MERCHANT_CORRECTION_POSITION',branchId:'branch1',ownerId:owner,creditIqd:credit,debtIqd:debt,creditPaidIqd:0,debtRecoveredIqd:0,version:1});
 for(const [direction,amountIqd]of [['DEBIT',debt],['CREDIT',credit]]){
  if(!amountIqd)continue;const correctionId=direction==='DEBIT'?'00000000-0000-4000-8000-000000000001':'00000000-0000-4000-8000-000000000002';
  const r={pk:'MERCHANT_CORRECTIONS#branch1',sk:'REQUEST#'+correctionId,kind:'MERCHANT_SETTLEMENT_CORRECTION',correctionId,branchId:'branch1',ownerId:owner,orderId:'previous-paid-order',status:'POSTED',version:2,direction,amountIqd,requestDigest:'source-request-'+direction,createdAt:'2026-10-22T00:00:00.000Z'};
  f.put('staging-MerchantPlatform',r);const j={...r,sk:'JOURNAL#'+correctionId,kind:'MERCHANT_POST_PAYOUT_CORRECTION_JOURNAL'};f.put('staging-MerchantPlatform',{...j,digest:quoteHash(j)});
 }
};
