import {calculateStoreDeliveryAgreement} from './storeDeliveryAgreement';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { strongGet, exactCheck } from './driverFinancialTransaction';
import { createStagingDeliveryFundingReader } from './deliveryFundingReader';
import { calculateDeliveryPromotionCandidate } from './deliveryPromotion';
import { createStagingDeliveryCampaignBudget, validateDeliveryCampaignBudgetRecord, validateDeliveryCampaignUsageRecord } from './deliveryCampaignBudget';
import { quoteEntityIdValid,quoteHash } from './deliveryQuoteRecord';
import { readMoney } from './money';
type Row=Record<string,any>;
const P='staging-MerchantPlatform',S='staging-PlatformStaff',B='WhizzMerchants_Businesses';
/** Trusted server composition, not an HTTP endpoint. pricingRequest must come from
 * the server-owned road quote, and customerFacts from live authentication/history,
 * never body fields. No wallet or order writes: returns transaction operations.
 */
export function createStagingDeliveryPromotionSelection(options:{db:Pick<DynamoDBDocumentClient,'send'>;pricingRequest:Row;customerFacts:()=>Promise<{customerId:string;isNewCustomer:boolean;conditions:Row[]}>;now?:()=>number;previewOnly?:boolean;lifecycleReadMode?:'GET'|'CONDITION_CHECK'}) {
 const {db}=options,now=options.now??Date.now,pricingRequest=JSON.parse(JSON.stringify(options.pricingRequest));
 const reader=createStagingDeliveryFundingReader({db,now,lifecycleReadMode:options.lifecycleReadMode});
 return Object.freeze({async prepare(facts:{orderId:string;branchId:string;merchantId:string;goodsGross:unknown;goodsAfterDiscounts:unknown;hasGoodsDiscount:boolean;referenceFee:unknown}){
  if(!quoteEntityIdValid(facts.orderId)||pricingRequest.context?.branchId!==facts.branchId||pricingRequest.context?.merchantId!==facts.merchantId)throw Error('DELIVERY_PROMOTION_SCOPE_MISMATCH');
  const customer=await options.customerFacts();if(!quoteEntityIdValid(customer.customerId)||typeof customer.isNewCustomer!=='boolean'||!Array.isArray(customer.conditions)||!customer.conditions.length||customer.conditions.some(x=>!x.ConditionCheck))throw Error('DELIVERY_CUSTOMER_FACTS_REQUIRED');
  const branch=await strongGet(db,B,{businessId:facts.branchId});if(!branch||branch.organizationId!==facts.merchantId)throw Error('DELIVERY_POLICY_UNAVAILABLE');
  const revision=branch.deliveryOfferRevision??0;if(!Number.isSafeInteger(revision)||revision<0)throw Error('DELIVERY_POLICY_UNAVAILABLE');
  const common:Row[]=[exactCheck(B,{businessId:facts.branchId},branch,[...new Set([...Object.keys(branch),'deliveryOfferRevision'])]),...customer.conditions];
  let cursor:Row|undefined;const indexes:Row[]=[];
  for(let page=0;page<4;page++){
   const q=await db.send(new QueryCommand({TableName:P,KeyConditionExpression:'pk=:pk AND begins_with(sk,:prefix)',ExpressionAttributeValues:{':pk':'BRANCH#'+facts.branchId,':prefix':'COMMERCIAL#DELIVERY#'},ConsistentRead:true,Limit:25,...(cursor?{ExclusiveStartKey:cursor}:{})}));
   indexes.push(...q.Items??[]);cursor=q.LastEvaluatedKey;if(indexes.length>50)throw Error('DELIVERY_POLICY_SELECTION_LIMIT');if(!cursor)break;
  }
  if(cursor)throw Error('DELIVERY_POLICY_SELECTION_LIMIT');
  const choices:Array<{candidate:Row;resolved:Row;policy:Row;budget:Row;usage:Row|null}>=[];
  const agreements:Array<{resolved:Row;policy:Row}>=[];
  let activeCount=0;const discovered=new Set<string>();
  for(const index of indexes){
   if(index.pk!=='BRANCH#'+facts.branchId||index.kind!=='DELIVERY'||index.ownerId!==branch.ownerId||index.businessId!==facts.branchId||typeof index.recordPk!=='string'||!index.recordPk.startsWith('DELIVERY_FUNDING#'))throw Error('DELIVERY_POLICY_SCOPE_MISMATCH');
   if(discovered.has(index.recordPk))throw Error('DELIVERY_POLICY_SCOPE_MISMATCH');discovered.add(index.recordPk);
   const key={pk:index.recordPk,sk:'CURRENT'},current=await strongGet(db,S,key);
   if(!current){common.push({ConditionCheck:{TableName:S,Key:key,ConditionExpression:'attribute_not_exists(pk)'}});continue;}
   if(index.sk!=='COMMERCIAL#DELIVERY#'+current.id||index.recordPk!=='DELIVERY_FUNDING#'+current.id)throw Error('DELIVERY_POLICY_SCOPE_MISMATCH');
   common.push(exactCheck(S,key,current));
   if(current.status!=='ACTIVE'||Date.parse(current.policy?.effectiveFrom)>now()||Date.parse(current.policy?.effectiveTo)<=now())continue;
   if(++activeCount>8)throw Error('DELIVERY_POLICY_SELECTION_LIMIT');
   const resolved=await reader.prepare({branchId:facts.branchId,policyPin:{policyId:current.id,version:current.version,termsHash:current.termsHash}}),policy=resolved.policy;
   if(policy.schemaVersion===2){
    common.push(...resolved.operations);
    if(policy.eligibility.regionIds.includes(pricingRequest.context.zoneId))agreements.push({resolved,policy});
    continue;
   }
   const uk={pk:'DELIVERY_USAGE#'+policy.id,sk:'CUSTOMER#'+customer.customerId},usage=await strongGet(db,S,uk);if(usage)validateDeliveryCampaignUsageRecord(usage);
   const bk={pk:'DELIVERY_BUDGET#'+policy.id,sk:'VERSION#'+policy.version},b=await strongGet(db,S,bk);if(!b)throw Error('DELIVERY_BUDGET_UNAVAILABLE');validateDeliveryCampaignBudgetRecord(b);
   if(quoteHash(b.policyPin)!==quoteHash({policyId:policy.id,version:policy.version,termsHash:resolved.policyPin.termsHash})||b.merchantTotal!==policy.limits.merchantBudget.minorAmount||b.platformTotal!==policy.limits.platformBudget.minorAmount)throw Error('DELIVERY_BUDGET_UNAVAILABLE');
   const candidate=calculateDeliveryPromotionCandidate({pricingRequest,policy,eligibility:{goodsGross:facts.goodsGross,goodsAfterDiscounts:facts.goodsAfterDiscounts,hasGoodsDiscount:facts.hasGoodsDiscount,isNewCustomer:customer.isNewCustomer,customerUses:(usage?.reservedUses??0)+(usage?.completedUses??0)}});
   if(candidate.calculation.components.beforeDiscount.minorAmount!==readMoney(facts.referenceFee).minorAmount)throw Error('DELIVERY_REFERENCE_PRICE_CHANGED');
   if(candidate.applied&&candidate.funding&&b.merchantAvailable>=candidate.funding.allocation.merchantShare.minorAmount&&b.platformAvailable>=candidate.funding.allocation.platformShare.minorAmount)choices.push({candidate,resolved,policy,budget:b,usage});
   else common.push(exactCheck(S,bk,b),usage?exactCheck(S,uk,usage):{ConditionCheck:{TableName:S,Key:uk,ConditionExpression:'attribute_not_exists(pk)'}});
   common.push(...resolved.operations);
   if(choices.length>8)throw Error('DELIVERY_POLICY_SELECTION_LIMIT');
  }
  if(agreements.length>1)throw Error('DELIVERY_AGREEMENT_OVERLAP');
  if(agreements.length===1){
   const {policy,resolved}=agreements[0],deliveryFunding=calculateStoreDeliveryAgreement(policy,facts.referenceFee);
   for(const choice of choices){common.push(exactCheck(S,{pk:choice.budget.pk,sk:choice.budget.sk},choice.budget));const uk={pk:'DELIVERY_USAGE#'+choice.policy.id,sk:'CUSTOMER#'+customer.customerId};common.push(choice.usage?exactCheck(S,uk,choice.usage):{ConditionCheck:{TableName:S,Key:uk,ConditionExpression:'attribute_not_exists(pk)'}});}
   const reservation=options.previewOnly===true?null:await createStagingDeliveryCampaignBudget({db,now}).reserve({orderId:facts.orderId,customerId:customer.customerId,policy,referenceFee:facts.referenceFee,customerFee:deliveryFunding.allocation.customerFee});
   if(reservation?.replayed)throw Error('DELIVERY_ORDER_RECOVERY_REQUIRED');
   return {applied:true,agreement:true,commission:policy.commission,minimumOrderAmountIqd:policy.eligibility.minimumGoods.minorAmount/1000,deliveryFunding,customerFee:deliveryFunding.allocation.customerFee,validUntil:resolved.validUntil,operations:options.previewOnly===true?[]:[...common,...reservation!.operations],customerRule:policy.customerRule.kind};
  }
  choices.sort((a,b)=>a.candidate.calculation.customerDeliveryFee.minorAmount-b.candidate.calculation.customerDeliveryFee.minorAmount||(a.policy.id<b.policy.id?-1:a.policy.id>b.policy.id?1:0));
  const best=choices[0];
  for(const other of choices.slice(1)){common.push(exactCheck(S,{pk:other.budget.pk,sk:other.budget.sk},other.budget));const uk={pk:'DELIVERY_USAGE#'+other.policy.id,sk:'CUSTOMER#'+customer.customerId};common.push(other.usage?exactCheck(S,uk,other.usage):{ConditionCheck:{TableName:S,Key:uk,ConditionExpression:'attribute_not_exists(pk)'}});}
  if(!best)return {applied:false as const,operations:common};
  const c=best.candidate.calculation;
  const cashRoundingEvidence=c.components.finalRounding?.mode==='CEILING'?{
   schemaVersion:1,beneficiary:'PLATFORM',policy:c.components.finalRounding,
   referenceFee:c.components.beforeDiscount,requestedDiscount:c.components.requestedDiscount,
   customerFeeBeforeRounding:c.components.customerFeeBeforeFinalRounding,
   roundingAdjustment:c.components.promotionRoundingAdjustment,
   chargedFee:c.customerDeliveryFee,actualPromotionSaving:c.discountFundingAmount}:null;
  if(options.previewOnly===true)return {applied:true as const,...(cashRoundingEvidence?{cashRoundingEvidence}:{}),deliveryFunding:best.candidate.funding,customerFee:best.candidate.calculation.customerDeliveryFee,validUntil:best.resolved.validUntil,operations:[],customerRule:best.policy.customerRule.kind};
  const reservation=await createStagingDeliveryCampaignBudget({db,now}).reserve({orderId:facts.orderId,customerId:customer.customerId,policy:best.policy,referenceFee:facts.referenceFee,customerFee:best.candidate.calculation.customerDeliveryFee});
  if(reservation.replayed)throw Error('DELIVERY_ORDER_RECOVERY_REQUIRED');
  return {applied:true as const,...(cashRoundingEvidence?{cashRoundingEvidence}:{}),deliveryFunding:best.candidate.funding,customerFee:best.candidate.calculation.customerDeliveryFee,validUntil:best.resolved.validUntil,customerRule:best.policy.customerRule.kind,operations:[...common,...reservation.operations]};
 }});
}
