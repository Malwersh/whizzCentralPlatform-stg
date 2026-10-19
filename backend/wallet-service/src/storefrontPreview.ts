import {minimumOrderIqd} from './branchMinimumOrder';
import {DynamoDBDocumentClient,GetCommand} from '@aws-sdk/lib-dynamodb';
import {createStagingDeliveryPricingContext} from './deliveryPricingContext';
import {createStagingDeliveryPromotionSelection} from './deliveryPromotionSelection';
import {createStagingOrderGoodsPricing} from './orderGoodsPricing';
import {createCoveredDeliveryRouter} from './roadRouting';
import {moneyFromMinor} from './money';
import {quoteEntityIdValid,quoteHash} from './deliveryQuoteRecord';
import type {QuoteCustomer} from './deliveryQuote';
type Row=Record<string,any>;
/** Informational preview: no reservation, financial writes or customer counter increments.
 * Confirmation remains with the original fenced commercial order writer. */
export function createStagingStorefrontPreview(options:{db:Pick<DynamoDBDocumentClient,'send'>;authenticateCustomer:()=>Promise<QuoteCustomer>;
 createRouter:(db:Pick<DynamoDBDocumentClient,'send'>)=>ReturnType<typeof createCoveredDeliveryRouter>;
 beforeCalculate:(customer:QuoteCustomer,selection:{branchId:string;addressId:string})=>Promise<void>;now?:()=>number}){
 const now=options.now??Date.now,db=options.db;
 return {async preview(value:unknown){
  const fail=():never=>{throw Object.assign(Error('INVALID_STOREFRONT_REQUEST'),{code:'INVALID_STOREFRONT_REQUEST'});};
  if(!value||typeof value!=='object'||Array.isArray(value))return fail();
  const r=JSON.parse(JSON.stringify(value)) as Row;
  if(Object.keys(r).sort().join(',')!=='addressId,branchId,hasGoodsDiscount,items'||!quoteEntityIdValid(r.branchId)||!quoteEntityIdValid(r.addressId)||typeof r.hasGoodsDiscount!=='boolean'||!Array.isArray(r.items)||r.items.length>40)return fail();
  const c=await options.authenticateCustomer();
  if(!quoteEntityIdValid(c?.userId)||!quoteEntityIdValid(c.subjectId)||c.userId==='guest'||c.condition?.ConditionCheck?.TableName!=='WizzUser_users_staging'||c.condition.ConditionCheck.Key?.userId!==c.userId)throw Error('CUSTOMER_UNAVAILABLE');
  await options.beforeCalculate(c,{branchId:r.branchId,addressId:r.addressId});
  const context=createStagingDeliveryPricingContext({db,authenticateCustomer:options.authenticateCustomer,router:options.createRouter(db),now});
  const priced=await context.calculate({branchId:r.branchId,addressId:r.addressId});
  let goodsGross=moneyFromMinor(0);
  if(r.items.length)goodsGross=(await createStagingOrderGoodsPricing({db}).price({branchId:r.branchId,items:r.items})).goodsGross;
  const selectedRule=priced.pricingRequest.rules.find((rule:Row)=>rule.id===priced.calculation.rule.id&&rule.version===priced.calculation.rule.version);
  if(!selectedRule||(selectedRule.effectiveTo!==null&&typeof selectedRule.effectiveTo!=='string'))throw Error('PRICING_CONTEXT_CHANGED');
  let customerFee=priced.calculation.customerDeliveryFee,kind='CALCULATED',policyPin:unknown=null,validUntil=new Date(Math.min(Date.parse(priced.binding.route.expiresAt),selectedRule.effectiveTo===null?Infinity:Date.parse(selectedRule.effectiveTo))).toISOString();
  if(priced.context.merchantId!=='UNBOUND_MERCHANT'){
   const state=(await db.send(new GetCommand({TableName:'staging-WizzOfferJourney',Key:{pk:'USER#'+c.subjectId,sk:'ORDERS'},ConsistentRead:true}))).Item;
   if(state&&(!Number.isSafeInteger(state.count)||state.count<0))throw Error('DELIVERY_CUSTOMER_FACTS_REQUIRED');
   const selection=await createStagingDeliveryPromotionSelection({db,pricingRequest:priced.pricingRequest,now,previewOnly:true,
    customerFacts:async()=>({customerId:c.userId,isNewCustomer:!state||state.count===0,conditions:[c.condition]})}).prepare({orderId:'PREVIEW:'+quoteHash({customer:c.userId,...r}).slice(0,48),branchId:r.branchId,merchantId:priced.context.merchantId,goodsGross,
     goodsAfterDiscounts:r.hasGoodsDiscount?moneyFromMinor(0):goodsGross,hasGoodsDiscount:r.hasGoodsDiscount,referenceFee:customerFee});
   if(selection.applied){const until=selection.validUntil;if(typeof until!=='string'||!Number.isFinite(Date.parse(until)))throw Error('DELIVERY_POLICY_UNAVAILABLE');customerFee=selection.customerFee!;kind=typeof selection.customerRule==='string'?selection.customerRule:'PROMOTION';policyPin=selection.deliveryFunding!.policyPin;validUntil=new Date(Math.min(Date.parse(validUntil),Date.parse(until))).toISOString();}
  }
  const fresh=await options.authenticateCustomer();if(fresh.userId!==c.userId||fresh.subjectId!==c.subjectId)throw Error('CUSTOMER_UNAVAILABLE');
  const prep=priced.preparationMinutes;if(prep!==null&&(!Number.isInteger(prep)||prep<5||prep>120))throw Error('INVALID_PREPARATION_TIME');
  const minimum=minimumOrderIqd({minimum_order:priced.minimumOrderAmountIqd});
  const route=priced.calculation.deliveryRoute,seconds=route.durationSeconds,meters=route.distanceMeters;
  if(!Number.isFinite(seconds)||seconds<0||!Number.isFinite(meters)||meters<0)throw Error('INVALID_STOREFRONT_ROUTE');
  return {schemaVersion:1,kind:'STOREFRONT_PREVIEW',branchId:r.branchId,addressId:r.addressId,createdAt:new Date(now()).toISOString(),expiresAt:validUntil,
   policyVersion:priced.policyVersion,policyPin,pricingMode:kind,customerDeliveryFee:customerFee,preparationMinutes:prep,
   minimumOrderAmountIqd:minimum,goodsGross,minimumOrderMet:minimum===null||goodsGross.minorAmount>=minimum*1000,remainingToMinimumIqd:minimum===null?0:Math.max(0,(minimum*1000-goodsGross.minorAmount)/1000),roadDistanceMeters:meters,deliveryDurationSeconds:seconds,arrivalMinutes:prep===null?null:{minimum:prep+Math.ceil(seconds/60),maximum:prep+Math.ceil(seconds/60)+5},
   basketFingerprint:quoteHash({items:r.items,hasGoodsDiscount:r.hasGoodsDiscount}),requiresFinalConfirmation:true};
 }};
}
