'use strict';

const assert=require('node:assert/strict');
const {test}=require('node:test');
const {createHandler}=require('./customer-inbox.cjs');
const subject='11111111-1111-4111-8111-111111111111';
const apiId='aaaaaaaaaa';
const now=new Date('2026-11-24T21:10:00Z');
const notice={eventId:'CN:sample',type:'support_reply',title:'رد جديد من الدعم',body:'رد',createdAt:'2026-11-24T20:00:00.000Z',
  orderId:'order-one',sessionId:'support-one'};
function fixture({locked=false,conflict=null,existing={}}={}){
  const calls=[];
  let watermark;
  const profile={userId:subject,cognitoSub:subject,isActive:true,...existing};
  const store={async send(command){
    const input=command.input;
    calls.push({kind:command.constructor.name,input});
    if(command.constructor.name==='GetCommand'){
      if(input.TableName.endsWith('Customers'))return {Item:structuredClone(profile)};
      if(input.TableName.endsWith('AccountDeletion'))return locked?{Item:{pk:'locked'}}:{};
      return watermark?{Item:{readThrough:watermark}}:{};
    }
    if(command.constructor.name==='QueryCommand'){
      assert.equal(input.IndexName,'ByDriver');
      assert.deepEqual(input.ExpressionAttributeValues,{':subject':subject,':app':'user'});
      return {Items:[notice],LastEvaluatedKey:{eventId:notice.eventId,driverId:subject,createdAt:notice.createdAt}};
    }
    const items=input.TransactItems;
    assert.equal(items[0].ConditionCheck.ConditionExpression,'attribute_not_exists(pk)');
    assert.equal((items[1].ConditionCheck??items[1].Update).Key.userId,subject);
    if(conflict)throw Object.assign(Error(),{name:'TransactionCanceledException',CancellationReasons:conflict.map(Code=>({Code}))});
    if(items[1].Update){
      const values=items[1].Update.ExpressionAttributeValues;
      profile.notification_settings=values[':settings'];
      if(Object.hasOwn(values,':consent'))profile.marketing_consent=values[':consent'];
      return {};
    }
    if(items[2].Update.TableName.endsWith('IdempotencyKeys'))watermark=items[2].Update.ExpressionAttributeValues[':now'];
    return {};
  }};
  const handler=createHandler({db:store,apiId,now:()=>now,verify:async token=>{
    if(token!=='customer-token')throw Error('Invalid identity');
    return {sub:subject};
  }});
  const request=(httpMethod='GET',extra={})=>handler({httpMethod,resource:'/wallet/transfers/notifications',
    requestContext:{apiId,stage:'production'},headers:{Authorization:'Bearer customer-token'},...extra});
  return {calls,request};
}
const getData=response=>JSON.parse(response.body);

test('only the signed production customer can query notices and unrelated cursors are rejected',async()=>{
  const f=fixture();
  assert.equal((await f.request('GET',{headers:{Authorization:'Bearer merchant-token'}})).statusCode,401);
  assert.equal((await f.request('GET',{requestContext:{apiId,stage:'staging'}})).statusCode,404);
  assert.equal(f.calls.length,0);
  const other=Buffer.from(JSON.stringify({driverId:'different',eventId:'event',createdAt:'date'})).toString('base64url');
  const response=await f.request('GET',{queryStringParameters:{cursor:other,subjectId:'another'}});
  assert.equal(response.statusCode,400);
  assert.equal(getData(response).error.code,'INVALID_CURSOR');
  assert.equal(f.calls.filter(x=>x.kind==='QueryCommand').length,0);
});

test('support links survive synchronization and read-all is shared through a monotonic watermark',async()=>{
  const f=fixture();
  const first=getData(await f.request());
  assert.equal(first.notifications[0].readAt,null);
  assert.equal(first.notifications[0].sessionId,notice.sessionId);
  assert.equal(first.notifications[0].source,'server');
  assert.equal(first.notifications[0].target,'');
  const changed=await f.request('POST',{body:JSON.stringify({all:true,subject:'ignored'})});
  assert.deepEqual(getData(changed),{read:true});
  const write=f.calls.find(x=>x.kind==='TransactWriteCommand').input.TransactItems[2].Update;
  assert.equal(write.Key.idempotencyKey,'CUSTOMER_NOTIFICATION_READ#'+subject);
  assert.match(write.ConditionExpression,/readThrough <= :now/);
  const next=getData(await f.request('GET',{queryStringParameters:{cursor:first.nextCursor}}));
  assert.equal(next.notifications[0].readAt,now.toISOString());
  assert.equal(f.calls.at(-1).input.ExclusiveStartKey.driverId,subject);
});

test('selected read updates are deduplicated and must belong to the signed customer and app',async()=>{
  const f=fixture();
  const response=await f.request('POST',{body:JSON.stringify({eventIds:[notice.eventId,notice.eventId]})});
  assert.equal(response.statusCode,200);
  const items=f.calls.at(-1).input.TransactItems;
  assert.equal(items.length,3);
  assert.match(items[2].Update.ConditionExpression,/attribute_exists\(eventId\) AND driverId = :subject AND recipientApp = :app/);
  assert.equal(items[2].Update.ExpressionAttributeValues[':subject'],subject);
});

test('deleted and concurrently restricted users cannot read or change notifications',async()=>{
  const locked=fixture({locked:true});
  assert.equal((await locked.request()).statusCode,403);
  assert.equal((await locked.request('POST',{body:'{"all":true}'})).statusCode,403);
  assert.equal(locked.calls.every(x=>x.kind==='GetCommand'),true);
  const pending=fixture({conflict:['ConditionalCheckFailed','None','None']});
  assert.equal((await pending.request('POST',{body:'{"all":true}'})).statusCode,403);
  const later=fixture({conflict:['None','None','ConditionalCheckFailed']});
  assert.equal((await later.request('POST',{body:'{"all":true}'})).statusCode,200);
});


test('customer preferences default promotions off, stay scoped to the signed account and persist consent atomically',async()=>{
  const f=fixture({existing:{notification_settings:{sound_enabled:false}}});
  const queryStringParameters={view:'preferences'};
  const read=async()=>getData(await f.request('GET',{queryStringParameters})).data.notification_settings;
  assert.deepEqual(await read(),{sound_enabled:false,promotion_notifications:false});
  const post=values=>f.request('POST',{queryStringParameters,body:JSON.stringify({notification_settings:values})});
  assert.equal((await post({promotion_notifications:1})).statusCode,400);
  assert.equal((await post({promotion_notifications:true,order_notifications:false})).statusCode,200);
  let prefs=await read();assert.deepEqual(prefs,{sound_enabled:false,promotion_notifications:true,order_notifications:false});
  assert.equal((await post({promotion_notifications:false})).statusCode,200);
  prefs=await read();assert.equal(prefs.promotion_notifications,false);
  assert.equal(f.calls.filter(x=>x.kind==='TransactWriteCommand').length,2);
  assert.ok(f.calls.filter(x=>x.kind==='TransactWriteCommand').every(x=>
    x.input.TransactItems[1].Update.ConditionExpression.includes('#notificationSnapshot')));
  const racing=fixture({conflict:['None','ConditionalCheckFailed']});
  assert.equal((await racing.request('POST',{queryStringParameters,
    body:JSON.stringify({notification_settings:{promotion_notifications:true}})})).statusCode,409);
});
