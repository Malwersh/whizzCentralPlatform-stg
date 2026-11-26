'use strict';

const assert=require('node:assert/strict');
const {test}=require('node:test');
const {createProductionHandler}=require('./order-ratings.cjs');
const {ratingReference}=require('../../backend/driver-performance-projection/model');
const now='2026-11-24T21:00:00.000Z';
const apiId='aaaaaaaaaa';
const orderId='rating-fixture';
const subject='customer-one';
const fixture=({status='delivered',driver=true,locked=false}={})=>{
  const ratings=new Map(),writes=[];
  const order={orderId,userId:subject,userSub:subject,storeId:'merchant-one',status,
    ...(driver?{driverId:'driver-one'}:{})};
  const tables={
    'wizz-production-Orders':order,
    'wizz-production-Customers':{userId:subject,cognitoSub:subject,isActive:true},
    'wizz-production-Merchants':{businessId:'merchant-one',businessName:'مطعم'},
    'wizz-production-Drivers':{driverId:'driver-one',cognitoSub:'driver-one',name:'سائق'},
  };
  const db={async send(command){
    const input=command.input;
    if(command.constructor.name==='GetCommand'){
      if(input.TableName==='wizz-production-AccountDeletion')return locked&&input.Key.pk.startsWith('ACCOUNT_LIFECYCLE#CUSTOMER#')?{Item:input.Key}:{};
      if(input.TableName==='wizz-production-OrderRatings')return {Item:ratings.get(input.Key.pk)};
      return {Item:tables[input.TableName]};
    }
    assert.equal(command.constructor.name,'TransactWriteCommand');
    writes.push(input.TransactItems);
    for(const {Put} of input.TransactItems)if(Put)ratings.set(Put.Item.pk,Put.Item);
    return {};
  }};
  const handler=createProductionHandler({apiId,db,now:()=>now,verify:async token=>{
    if(token!=='customer-access'&&token!=='other-access')throw Error('invalid token');
    return {sub:token==='customer-access'?subject:'other'};
  }});
  const call=(method='GET',data,extra={})=>handler({
    httpMethod:method,resource:'/orders/{orderId}/rating',requestContext:{stage:'production',apiId},
    pathParameters:{orderId},headers:{Authorization:'Bearer customer-access'},
    ...(data!==undefined?{body:JSON.stringify(data)}:{}),...extra,
  });
  return {ratings,writes,call};
};
const body={merchantStars:5,driverStars:4,comment:'خدمة ممتازة'};
const json=res=>JSON.parse(res.body);

test('delivered order rates merchant and driver atomically and emits the production driver reference',async()=>{
  const f=fixture();
  const loaded=json(await f.call());
  assert.deepEqual([loaded.driverEligible,loaded.merchantName,loaded.review],[true,'مطعم',null]);
  const result=await f.call('POST',body);
  assert.equal(result.statusCode,200);
  assert.equal(json(result).orderId,orderId);
  const row=f.ratings.get('ORDER#'+orderId);
  assert.equal(ratingReference(row).indexRow.driverRatingKey,'DRIVER#driver-one');
  assert.equal(ratingReference(row).indexRow.driverRatingSort,now+'#'+orderId);
  assert.deepEqual(f.ratings.get('MERCHANT#merchant-one'),{pk:'MERCHANT#merchant-one',count:1,sum:5,average:5,version:1});
  assert.deepEqual(f.ratings.get('DRIVER#driver-one'),{pk:'DRIVER#driver-one',count:1,sum:4,average:4,version:1});
  const items=f.writes[0];
  assert.equal(items.filter(x=>x.ConditionCheck?.TableName==='wizz-production-AccountDeletion').length,3);
  assert.equal(items.filter(x=>x.Update?.UpdateExpression.startsWith('SET customerRating=')).length,2);
  assert.deepEqual(json(await f.call()).review,{...body,createdAt:now});
});

test('same submission is idempotent and conflicting second vote cannot alter totals',async()=>{
  const f=fixture();
  assert.equal((await f.call('POST',body)).statusCode,200);
  assert.equal(json(await f.call('POST',body)).alreadySaved,true);
  assert.equal(json(await f.call('POST',{...body,merchantStars:1})).code,'ALREADY_RATED');
  assert.equal(f.writes.length,1);
});

test('undelivered, unowned and restricted orders cannot be rated',async()=>{
  const undelivered=fixture({status:'pending'});
  assert.equal(json(await undelivered.call('POST',body)).code,'ORDER_NOT_DELIVERED');
  const owner=fixture();
  const foreign=await owner.call('POST',body,{headers:{Authorization:'Bearer other-access'}});
  assert.equal(foreign.statusCode,403);
  const locked=fixture({locked:true});
  assert.equal((await locked.call()).statusCode,403);
  assert.equal((await locked.call('POST',body)).statusCode,403);
  assert.equal(undelivered.writes.length+owner.writes.length+locked.writes.length,0);
});

test('authentication and exact environment are mandatory and rating inputs are bounded',async()=>{
  const f=fixture();
  assert.equal((await f.call('GET',undefined,{headers:{}})).statusCode,401);
  assert.equal((await f.call('GET',undefined,{requestContext:{stage:'staging',apiId}})).statusCode,404);
  assert.equal(json(await f.call('POST',{...body,merchantStars:6})).code,'RATING_INVALID');
  assert.equal(json(await f.call('POST',{...body,comment:'ا'.repeat(501)})).code,'RATING_INVALID');
  assert.equal(f.writes.length,0);
});

test('an order delivered without a driver accepts the merchant rating only',async()=>{
  const f=fixture({driver:false});
  assert.equal(json(await f.call()).driverEligible,false);
  assert.equal(json(await f.call('POST',body)).code,'DRIVER_RATING_INVALID');
  assert.equal((await f.call('POST',{merchantStars:3})).statusCode,200);
  assert.equal(f.ratings.size,2);
  assert.equal(f.ratings.get('ORDER#'+orderId).driverStars,null);
});
