const {test}=require('node:test'),assert=require('node:assert/strict');
const {deliveryPromotionCustomerFacts:read}=require('../dist/deliveryPromotionCustomer');
function fixture(count=0,stored=false){
 const condition={ConditionCheck:{TableName:'WizzUser_users_staging',Key:{userId:'customer'},ConditionExpression:'cognitoSub=:sub',ExpressionAttributeValues:{':sub':'subject'}}};
 const key={pk:'USER#subject',sk:'ORDERS'};
 const context={identity:{sub:'subject',userId:'customer'},guarded:{sub:'subject',condition},customer:{key,stored:stored?{...key,count,version:4}:null,getCount:async()=>count}};
 const order={Put:{TableName:'staging-WizzOfferJourney',Item:{...key,count:count+1,version:stored?5:1},ConditionExpression:stored?'#v=:v':'attribute_not_exists(pk)',...(stored?{ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':v':4}}:{})}};
 return {context,order};
}
test('customer identity and first-order facts use existing authenticated history and exact counter write',async()=>{
 for(const [count,stored] of [[0,false],[3,false],[0,true],[3,true]]){
  const f=fixture(count,stored),r=await read(f.context,f.order);assert.equal(r.customerId,'customer');assert.equal(r.isNewCustomer,count===0);assert.deepEqual(r.conditions,[f.context.guarded.condition]);
 }
});
test('foreign identity, missing counter writer and corrupt history cannot authorize a delivery offer',async()=>{
 for(const edit of [f=>f.context.guarded.sub='other',f=>f.context.guarded.condition.ConditionCheck.Key.userId='other',f=>f.context.customer.key.pk='USER#other',f=>f.order=null,f=>f.order.Put.Item.count=99,f=>f.order.Put.ConditionExpression='attribute_exists(pk)',f=>f.context.customer.getCount=async()=>-1]){
  const f=fixture();edit(f);await assert.rejects(read(f.context,f.order),/DELIVERY_CUSTOMER_FACTS_REQUIRED/);
 }
 const f=fixture(1,true);f.order.Put.ExpressionAttributeValues[':v']=2;await assert.rejects(read(f.context,f.order));
});
