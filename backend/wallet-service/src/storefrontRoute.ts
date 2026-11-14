import {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';
import {createStagingDeliveryPricingContext} from './deliveryPricingContext';
import {createCoveredDeliveryRouter} from './roadRouting';
import {quoteEntityIdValid} from './deliveryQuoteRecord';
import {minimumOrderIqd} from './branchMinimumOrder';
import type {QuoteCustomer} from './deliveryQuote';

/** Authenticated route-only fallback. Never returns a price or a checkout authorization. */
export function createStagingStorefrontRoute(options:{db:Pick<DynamoDBDocumentClient,'send'>;
 authenticateCustomer:()=>Promise<QuoteCustomer>;
 createRouter:(db:Pick<DynamoDBDocumentClient,'send'>)=>ReturnType<typeof createCoveredDeliveryRouter>;
 beforeCalculate:(customer:QuoteCustomer,selection:{branchId:string;addressId:string})=>Promise<void>;now?:()=>number}) {
 return {async preview(value:unknown){
  const r=value as Record<string,unknown>;
  if(!r||typeof r!=='object'||Array.isArray(r)||Object.keys(r).sort().join(',')!=='addressId,branchId'||
   !quoteEntityIdValid(r.branchId)||!quoteEntityIdValid(r.addressId))
   throw Object.assign(Error('INVALID_STOREFRONT_REQUEST'),{code:'INVALID_STOREFRONT_REQUEST'});
  const selection={branchId:r.branchId as string,addressId:r.addressId as string};
  const c=await options.authenticateCustomer();
  if(!quoteEntityIdValid(c?.userId)||!quoteEntityIdValid(c.subjectId)||c.userId==='guest'||
   c.condition?.ConditionCheck?.TableName!=='WizzUser_users_staging'||c.condition.ConditionCheck.Key?.userId!==c.userId)
   throw Error('CUSTOMER_UNAVAILABLE');
  await options.beforeCalculate(c,selection);
  const route=await createStagingDeliveryPricingContext({db:options.db,authenticateCustomer:options.authenticateCustomer,
   router:options.createRouter(options.db),now:options.now}).routeInformation(selection);
  const fresh=await options.authenticateCustomer();
  if(fresh.userId!==c.userId||fresh.subjectId!==c.subjectId)throw Error('CUSTOMER_UNAVAILABLE');
  const readinessReasons:string[]=[];
  const prep=Number.isInteger(route.preparationMinutes)&&route.preparationMinutes>=5&&route.preparationMinutes<=120?route.preparationMinutes:null;
  if(prep===null)readinessReasons.push('PREPARATION_UNAVAILABLE');
  let minimum:number|null=null;
  try{minimum=minimumOrderIqd({minimum_order:route.minimumOrderAmountIqd});}catch{readinessReasons.push('MINIMUM_ORDER_INVALID');}
  return {...route,preparationMinutes:prep,minimumOrderAmountIqd:minimum,readinessReasons,
   arrivalMinutes:prep===null?null:{minimum:prep+Math.ceil(route.deliveryDurationSeconds/60),maximum:prep+Math.ceil(route.deliveryDurationSeconds/60)+5},
   pricingAvailable:false,requiresFinalConfirmation:true};
 }};
}
