import { quoteEntityIdValid } from './deliveryQuoteRecord';
type Row=Record<string,any>;
/** Host-only bridge to the existing offer journey counter. The exact counter Put
 * must join the order transaction; returning facts alone never authorizes a use.
 * NEW_CUSTOMER here means no previous order, consistent with first-order offers.
 */
export async function deliveryPromotionCustomerFacts(context:Row,accountOrder:Row|null){
 const identity=context?.identity,state=context?.customer,profile=context?.guarded?.condition?.ConditionCheck;
 const fail=():never=>{throw Error('DELIVERY_CUSTOMER_FACTS_REQUIRED');};
 if(!quoteEntityIdValid(identity?.sub)||!quoteEntityIdValid(identity?.userId)||
  context.guarded?.sub!==identity.sub||profile?.TableName!=='WizzUser_users_staging'||profile.Key?.userId!==identity.userId||
  !profile.ConditionExpression||state?.key?.pk!=='USER#'+identity.sub||state.key.sk!=='ORDERS'||typeof state.getCount!=='function')return fail();
 const count=await state.getCount();
 if(!Number.isSafeInteger(count)||count<0||count>=Number.MAX_SAFE_INTEGER)return fail();
 const put=accountOrder?.Put,stored=state.stored;
 if(put?.TableName!=='staging-WizzOfferJourney'||put.Item?.pk!==state.key.pk||put.Item.sk!=='ORDERS'||put.Item.count!==count+1)return fail();
 if(stored){
  if(!Number.isSafeInteger(stored.version)||stored.version<1||stored.count!==count||
   put.Item.version!==stored.version+1||put.ConditionExpression!=='#v=:v'||
   put.ExpressionAttributeNames?.['#v']!=='version'||put.ExpressionAttributeValues?.[':v']!==stored.version)return fail();
 }else if(put.Item.version!==1||put.ConditionExpression!=='attribute_not_exists(pk)')return fail();
 return {customerId:identity.userId,isNewCustomer:count===0,conditions:[context.guarded.condition]};
}
