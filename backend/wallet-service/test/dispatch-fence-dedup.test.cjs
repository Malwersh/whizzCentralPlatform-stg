const {test}=require('node:test'),assert=require('node:assert/strict');
const {composeDispatchTransaction:compose}=require('../dist/dispatchTransaction');
const {exactCheck}=require('../dist/driverFinancialTransaction');
const guard=(condition,names,values)=>({ConditionCheck:{TableName:'WizzOrders',Key:{PK:'ORDER#synthetic',SK:'META'},ConditionExpression:condition,ExpressionAttributeNames:names,...(values?{ExpressionAttributeValues:values}:{})}});
test('identical field/value and absence fences deduplicate across aliases while contradictory and new checks remain',()=>{
 const first=guard('#a=:a AND attribute_not_exists(#b)',{'#a':'status','#b':'driverId'},{':a':'ready_for_pickup'});
 const second=guard('#x=:x AND attribute_not_exists(#y) AND #z=:z AND #u=:u',{'#x':'status','#y':'driverId','#z':'version','#u':'status'},{':x':'ready_for_pickup',':z':4,':u':'assigned'});
 const [{ConditionCheck:q}]=compose([first],[second]);assert.equal((q.ConditionExpression.match(/attribute_not_exists/g)??[]).length,1);assert.equal(q.ConditionExpression.split(' AND ').length,4);assert.deepEqual(Object.values(q.ExpressionAttributeValues).sort(),[4,'assigned','ready_for_pickup'].sort());assert.equal(Object.values(q.ExpressionAttributeNames).filter(n=>n==='driverId').length,1);
});
test('large overlapping source/read guards stay below DynamoDB operator limit without omitting any original field',()=>{
 const row=Object.fromEntries(Array.from({length:100},(_,i)=>['field'+i,i])),a=exactCheck('WizzOrders',{PK:'ORDER#synthetic',SK:'META'},row),b=exactCheck('WizzOrders',a.ConditionCheck.Key,row);
 const [{ConditionCheck:q}]=compose([a],[b,b]);assert.equal(q.ConditionExpression.split(' AND ').length,100);assert.equal(Object.keys(q.ExpressionAttributeValues).length,100);assert.deepEqual(new Set(Object.values(q.ExpressionAttributeNames)),new Set(Object.keys(row)));
});
test('OR, ranges and unsupported atoms remain intact; nested pure conjunction duplicates may be removed',()=>{
 const a=guard('#a=:a',{'#a':'status'},{':a':'ready'}),or=guard('(#b=:b OR #b=:c)',{'#b':'status'},{':b':'ready',':c':'assigned'});
 const [{ConditionCheck:q}]=compose([a],[or]);assert.match(q.ConditionExpression,/ OR /);assert.equal(Object.keys(q.ExpressionAttributeValues).length,3);
 const nested=guard('((#b=:b) AND (attribute_not_exists(#d)))',{'#b':'status','#d':'driverId'},{':b':'ready'}),[{ConditionCheck:n}]=compose([a],[nested]);assert.equal(n.ConditionExpression.split(' AND ').length,2);assert.equal(Object.values(n.ExpressionAttributeNames).filter(x=>x==='status').length,1);
});
