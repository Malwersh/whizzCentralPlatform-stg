import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { createStagingPlatformPromotionResolution } from './platformPromotionResolution';
import { createStagingDeliveryCampaignBudget } from './deliveryCampaignBudget';
import { retainPlannedEvidence } from './driverFinancialTransaction';
type Row=Record<string,any>;
/** Verify and fence original funding, without spending/reserving/releasing it.
 * Used when a driver accepts an already-funded order. No client amounts/policy.
 */
export async function prepareDeliveryFundingRetention(db:Pick<DynamoDBDocumentClient,'send'>,input:{orderId:string;at:string;operationId:string;deliveryFunding:Row;goodsAmount:unknown;commercialPricing:Row}) {
 const {orderId,at,operationId,deliveryFunding,goodsAmount,commercialPricing}=input;
 const agreement=commercialPricing?.agreement,funding=commercialPricing?.funding;
 if(!agreement)throw Error('DELIVERY_FUNDING_PROOF_REQUIRED');
 const cash=await createStagingPlatformPromotionResolution({db}).prepare({orderId,operationId,outcome:'RELEASED',at,expected:[
  {kind:'GOODS',amount:goodsAmount,metadata:{agreementId:agreement.id,agreementVersion:agreement.version,fundingPolicy:funding?.policy??null}},
  {kind:'DELIVERY',amount:deliveryFunding.allocation.platformShare,metadata:{policyPin:deliveryFunding.policyPin}}]});
 const campaign=await createStagingDeliveryCampaignBudget({db}).settle({orderId,outcome:'RELEASED',expectedFunding:deliveryFunding});
 if(cash.replayed||campaign.replayed)throw Error('DELIVERY_FUNDING_NOT_RESERVED');
 return [...retainPlannedEvidence([...cash.operations.filter(o=>o.Update||o.ConditionCheck),...campaign.operations] as Row[]),...(cash.walletCheck?[cash.walletCheck]:[])];
}
