const {test}=require('node:test');const assert=require('node:assert/strict');
const {createHandler,nextAggregate}=require('../../backend/src/handlers/order-ratings');
const env={ORDERS_TABLE:'orders',CUSTOMERS_TABLE:'customers',MERCHANTS_TABLE:'merchants',DRIVERS_TABLE:'drivers',RATINGS_TABLE:'ratings'};
function fixture({order={},customer={},merchant={},driver={},subject='sub-1',beforeCommit}={}){
 const rows=new Map([['orders:o1',{PK:'ORDER#o1',SK:'META',orderId:'o1',status:'delivered',userId:'user-1',userSub:'sub-1',storeId:'m1',driverId:'d1',...order}],['customers:user-1',{userId:'user-1',cognitoSub:'sub-1',isActive:true,...customer}],['merchants:m1',{businessId:'m1',businessName:'مطعم',...merchant}],['drivers:d1',{driverId:'d1',name:'سائق',...driver}]]);let commits=0,writes=0;
 const key=(table,k)=>table+':'+(k.PK?.replace('ORDER#','')||k.pk||k.userId||k.businessId||k.driverId);
 const conflict=()=>{throw Object.assign(new Error(),{name:'TransactionCanceledException'});};
 const db={async send(cmd){const i=cmd.input;if(cmd.constructor.name==='GetCommand')return {Item:structuredClone(rows.get(key(i.TableName,i.Key)))};
  assert.equal(cmd.constructor.name,'TransactWriteCommand');commits++;if(beforeCommit)beforeCommit({rows,commits});
  // Atomic condition evaluation before any writes; model the actual ownership and CAS fences.
  for(const op of i.TransactItems){if(op.ConditionCheck){const c=op.ConditionCheck,r=rows.get(key(c.TableName,c.Key)),v=c.ExpressionAttributeValues;
    if(c.TableName==='orders'){
     if(!r||r.status!==v[':status']||r.userId!==v[':uid']||r.storeId!==v[':mid']||r.isGuestOrder===true||r.isDeleted===true||r.deletedAt||r.deletionRequestId)conflict();
     for(const f of ['userSub','customerId','driverId'])if(r[f]!==v[':'+f])conflict();
    }else if(!r||r.isActive===false||r.deletionRequestId||r.deletedAt||(r.cognitoSub!=null&&r.cognitoSub!==v[':sub']))conflict();
   }else if(op.Put){const p=op.Put,old=rows.get(key(p.TableName,p.Item));if(p.ExpressionAttributeValues?old?.version!==p.ExpressionAttributeValues[':previous']:!!old)conflict();
   }else if(op.Update){const u=op.Update,r=rows.get(key(u.TableName,u.Key));if(!r||r.deletionRequestId||r.deletedAt)conflict();}}
  for(const op of i.TransactItems){if(op.Put){rows.set(key(op.Put.TableName,op.Put.Item),structuredClone(op.Put.Item));writes++;}if(op.Update){const u=op.Update,v=u.ExpressionAttributeValues;Object.assign(rows.get(key(u.TableName,u.Key)),{customerRating:v[':avg'],customerRatingCount:v[':count'],customerRatingSum:v[':sum']});writes++;}}
  return {};
 }};
 const h=createHandler({db,env,verify:async t=>{if(t!=='valid')throw Error();return {sub:subject};},now:()=> '2026-10-24T00:00:00Z'});
 const call=async(method='POST',body={merchantStars:4,driverStars:5},token='valid')=>{const r=await h({httpMethod:method,pathParameters:{orderId:'o1'},headers:{Authorization:'Bearer '+token},body:JSON.stringify(body)});return {status:r.statusCode,...JSON.parse(r.body)};};
 return {rows,call,get writes(){return writes;},get commits(){return commits;}};
}
test('one transaction saves separate ratings and verified aggregates without altering legacy ratings',async()=>{
 const f=fixture({merchant:{rating:4.9,reviewCount:100}});const r=await f.call();assert.equal(r.status,200);assert.equal(f.commits,1);assert.equal(f.rows.get('ratings:MERCHANT#m1').sum,4);assert.equal(f.rows.get('ratings:DRIVER#d1').sum,5);assert.equal(f.rows.get('merchants:m1').customerRating,4);assert.equal(f.rows.get('merchants:m1').rating,4.9);
});
test('retry returns the saved review and does not increment aggregates',async()=>{const f=fixture();await f.call();const r=await f.call();assert.equal(r.alreadySaved,true);assert.equal(f.commits,1);assert.equal(f.rows.get('ratings:DRIVER#d1').count,1);});
test('another payload cannot replace a saved rating',async()=>{const f=fixture();await f.call();assert.equal((await f.call('POST',{merchantStars:1,driverStars:1})).code,'ALREADY_RATED');assert.equal(f.commits,1);});
test('GET restores the owner review without writing',async()=>{const f=fixture();assert.equal((await f.call('GET')).driverEligible,true);assert.equal(f.writes,0);await f.call();assert.equal((await f.call('GET')).review.merchantStars,4);});
for(const [name,options,code]of [['another owner',{subject:'other'},'ORDER_FORBIDDEN'],['guest',{order:{isGuestOrder:true}},'ORDER_FORBIDDEN'],['wrong profile subject',{customer:{cognitoSub:'other'}},'ORDER_FORBIDDEN'],['inactive account',{customer:{isActive:false}},'ORDER_FORBIDDEN'],['deleting account',{customer:{deletionRequestId:'x'}},'ORDER_FORBIDDEN'],['pending order',{order:{status:'pending'}},'ORDER_NOT_DELIVERED'],['cancelled order',{order:{status:'cancelled'}},'ORDER_NOT_DELIVERED']])test(name+' cannot rate',async()=>{const f=fixture(options);assert.equal((await f.call()).code,code);assert.equal(f.writes,0);});
test('forged ownership in body is ignored',async()=>{const f=fixture({subject:'other'});assert.equal((await f.call('POST',{merchantStars:4,driverStars:5,userId:'other',userSub:'other'})).status,403);});
test('missing bearer cannot read or write',async()=>{const f=fixture();assert.equal((await f.call('POST',{},'bad')).status,401);assert.equal((await f.call('GET',{},'bad')).status,401);assert.equal(f.writes,0);});
for(const value of [0,6,2.5,'5',null])test('invalid stars '+value+' rejected',async()=>{const f=fixture();assert.equal((await f.call('POST',{merchantStars:value,driverStars:5})).status,400);assert.equal(f.writes,0);});
test('malformed or oversized comments rejected',async()=>{for(const comment of [{},'x'.repeat(501)]){const f=fixture();assert.equal((await f.call('POST',{merchantStars:4,driverStars:5,comment})).status,400);assert.equal(f.writes,0);}});
test('restaurant delivery without assigned driver only rates restaurant',async()=>{const f=fixture({order:{driverId:undefined}});assert.equal((await f.call('GET')).driverEligible,false);assert.equal((await f.call('POST',{merchantStars:3})).status,200);assert.equal(f.rows.has('ratings:DRIVER#d1'),false);});
test('driver cannot be supplied or omitted against authoritative assignment',async()=>{const f=fixture();assert.equal((await f.call('POST',{merchantStars:4,driverId:'other'})).code,'DRIVER_RATING_INVALID');const g=fixture({order:{driverId:undefined}});assert.equal((await g.call()).code,'DRIVER_RATING_INVALID');});
test('body target IDs cannot redirect ratings',async()=>{const f=fixture();await f.call('POST',{merchantStars:4,driverStars:5,driverId:'attacker',merchantId:'attacker'});assert.equal(f.rows.has('ratings:DRIVER#attacker'),false);assert.equal(f.rows.get('ratings:ORDER#o1').driverId,'d1');});
test('ownership revocation between read and transaction saves nothing',async()=>{const f=fixture({beforeCommit:({rows})=>{rows.get('orders:o1').userSub='other';}});assert.equal((await f.call()).status,403);assert.equal(f.writes,0);});
test('delivery/driver changes between read and transaction cannot publish old recipients',async()=>{const f=fixture({beforeCommit:({rows})=>{rows.get('orders:o1').status='cancelled';}});assert.equal((await f.call()).code,'ORDER_NOT_DELIVERED');assert.equal(f.writes,0);});
test('concurrent aggregate writer retries using fresh sum and count',async()=>{const f=fixture({beforeCommit:({rows,commits})=>{if(commits===1)rows.set('ratings:MERCHANT#m1',{pk:'MERCHANT#m1',sum:5,count:1,version:1,average:5});}});assert.equal((await f.call()).status,200);assert.equal(f.commits,2);assert.equal(f.rows.get('ratings:MERCHANT#m1').average,4.5);assert.equal(f.rows.get('ratings:MERCHANT#m1').count,2);});
test('corrupt aggregates fail closed',async()=>{const f=fixture();f.rows.set('ratings:MERCHANT#m1',{pk:'MERCHANT#m1',sum:99,count:1,version:1});assert.equal((await f.call()).status,503);assert.equal(f.writes,0);});
test('missing target cannot create a phantom profile',async()=>{const f=fixture();f.rows.delete('drivers:d1');assert.equal((await f.call()).status,503);assert.equal(f.writes,0);});
test('averages use stored sums and counts with two-decimal precision',()=>{assert.deepEqual(nextAggregate({sum:9,count:2,version:2},'x',5),{pk:'x',sum:14,count:3,average:4.67,version:3});});
test('simultaneous retries for one order commit only one rating and one aggregate increment',async()=>{const f=fixture();const results=await Promise.all([f.call(),f.call()]);assert.deepEqual(results.map(r=>r.status),[200,200]);assert.equal(f.rows.get('ratings:MERCHANT#m1').count,1);assert.equal(f.rows.get('ratings:DRIVER#d1').count,1);});
