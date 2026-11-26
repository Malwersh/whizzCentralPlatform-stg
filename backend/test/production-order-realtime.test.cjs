'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { marshall } = require('@aws-sdk/util-dynamodb');
const { createGateway, createBroadcast } = require('../src/handlers/production-order-realtime');

const order = {
  PK: 'ORDER#order1', SK: 'META', orderId:'order1', userId:'customer1',userSub:'customer1',
  businessId:'branch1',driverId:'driver1',status:'confirmed',deliveryAddress:{phone:'private'},
};
const now = () => 10;
const streamArn = 'arn:aws:dynamodb:us-east-1:746727375268:table/wizz-production-Orders/stream/sample';
function fixture(dispatchReady) {
  const conns = new Map();
  const calls = [];
  const sent = [];
  const state = { owner: 'merchant1', closed: new Set() };
  const verify = async token => {
    const role = token.split('.')[0];
    if (!['customer','merchant','driver'].includes(role)) throw Error('invalid');
    return { role, subjectId: role+'1', expiresAt: 100 };
  };
  const db = { async send(command) {
    const input = command.input;
    calls.push(input);
    if (input.TransactItems) {
      const registration=input.TransactItems.find(item=>item.Put)?.Put;
      if(registration){
        const fence=input.TransactItems.find(item=>item.ConditionCheck?.TableName==='wizz-production-AccountDeletion');
        if(state.closeOnConnect || state.closed.has(fence.ConditionCheck.Key.pk)) {
          throw Object.assign(Error('conditional cancellation'),{name:'TransactionCanceledException'});
        }
        conns.set(registration.Item.connectionId,registration.Item);
      }
      return {};
    }
    const name = input.TableName.slice('wizz-production-'.length);
    if (name === 'DriverLiveState' && input.UpdateExpression) return {};
    if (input.IndexName === 'Audience') {
      return { Items: [...conns.values()].filter(item => item.audience === input.ExpressionAttributeValues[':audience']) };
    }
    if (input.Item) { conns.set(input.Item.connectionId,input.Item);return {}; }
    if (command.constructor.name === 'DeleteCommand') { conns.delete(input.Key.connectionId);return {}; }
    if (input.UpdateExpression) { conns.get(input.Key.connectionId).unsubscribed=input.ExpressionAttributeValues[':unsubscribed'];return {}; }
    const key=input.Key;
    const values={
      Orders:key.PK===order.PK?order:undefined,
      Customers:{ userId:key.userId,cognitoSub:key.userId,isActive:true },
      Drivers:{ driverId:key.driverId,status:'APPROVED',isActive:true,isVerified:true },
      Merchants:{ businessId:key.businessId,isActive:true,status:'approved',ownerId:state.owner,cognitoUserId:state.owner },
      AccountDeletion:state.closed.has(key.pk)?{pk:key.pk}:undefined,
      OrderConnections:conns.get(key.connectionId),
    };
    return { Item: values[name] };
  }};
  const send = async (id, data) => { sent.push({id,data}); };
  const gateway=createGateway({ db, verify, send, now });
  const connect=(id,role,query={})=>gateway({requestContext:{stage:'production',routeKey:'$connect',connectionId:id},
    headers:role?{Authorization:'Bearer '+role+'.token.sig'}:{},queryStringParameters:query});
  const message=(id,input)=>gateway({requestContext:{stage:'production',routeKey:'$default',connectionId:id},body:JSON.stringify(input)});
  const broadcast=createBroadcast({ db, send, streamArn, now, dispatchReady });
  const disconnect=id=>gateway({requestContext:{stage:'production',routeKey:'$disconnect',connectionId:id}});
  return {connect,message,disconnect,broadcast,conns,calls,sent,state};
}
test('credentials and ownership are verified for customer, merchant and driver connections',async()=>{
  const f=fixture();
  assert.equal((await f.connect('none',null)).statusCode,401);
  assert.equal((await f.connect('no','forged',{orderId:'order1'})).statusCode,401);
  assert.equal((await f.connect('no','customer',{orderId:'other'})).statusCode,403);
  assert.equal((await f.connect('no','driver',{driverId:'other'})).statusCode,403);
  assert.equal((await f.connect('no','merchant')).statusCode,403);
  assert.equal((await f.connect('c1','customer',{orderId:'order1'})).statusCode,200);
  assert.equal((await f.connect('m1','merchant',{businessId:'branch1'})).statusCode,200);
  assert.equal((await f.connect('d1','driver',{driverId:'driver1'})).statusCode,200);
  assert.equal(f.conns.get('d1').identityScope346.driverId,'driver1');
  assert.equal((await f.message('c1',{action:'get_order_status',orderId:'other'})).statusCode,403);
  assert.equal((await f.message('c1',{action:'subscribe_order',orderId:'order1'})).statusCode,200);
  assert.equal(f.sent[0].data.status,'confirmed');
  assert.equal((await f.message('c1',{type:'get_order_status',order_id:'order1'})).statusCode,200);
  assert.equal((await f.message('c1',{type:'get_order_status',orderId:'order1',order_id:'other'})).statusCode,400);
  assert.equal((await f.message('d1',{action:'authenticate',userType:'merchant'})).statusCode,200);
  assert.deepEqual(f.sent.at(-1),{id:'d1',data:{type:'auth_success',userType:'driver'}});
  f.state.closed.add('ACCOUNT_LIFECYCLE#CUSTOMER#customer1');
  assert.equal((await f.message('c1',{action:'heartbeat'})).statusCode,403);
});
test('production events notify scoped recipients without order PII or delivery to stale owner',async()=>{
  const f=fixture();
  for(const [id,role,query] of [['c1','customer',{orderId:'order1'}],['m1','merchant',{businessId:'branch1'}],['d1','driver',{}]]) {
    assert.equal((await f.connect(id,role,query)).statusCode,200);
  }
  const record={eventSource:'aws:dynamodb',eventSourceARN:streamArn,eventName:'INSERT',dynamodb:{NewImage:marshall(order)}};
  const invalid=await f.broadcast({Records:[{...record,eventSourceARN:streamArn.replace('746727375268','699561669180')}]});
  assert.deepEqual(invalid,{orders:0,sent:0});
  assert.deepEqual(await f.broadcast({Records:[record]}),{orders:1,sent:3});
  assert.equal(f.sent.find(x=>x.id==='m1').data.type,'NEW_ORDER');
  assert.ok(f.sent.every(x=>x.data.deliveryAddress===undefined));
  f.sent.length=0;
  f.state.owner='merchant2';
  await f.message('c1',{type:'unsubscribe_order',order_id:'order1'});
  const updated={...record,eventName:'MODIFY',dynamodb:{NewImage:marshall(order),OldImage:marshall({...order,status:'pending'})}};
  assert.deepEqual(await f.broadcast({Records:[updated]}),{orders:1,sent:1});
  assert.deepEqual(f.sent.map(x=>x.id),['d1']);
});


test('authenticated driver connects offer transport without writing searching or GPS state',async()=>{
  const f=fixture();
  await f.connect('d1','driver',{driverId:'driver1'});
  assert.equal((await f.message('d1',{action:'authenticate',driverId:'other'})).statusCode,403);
  assert.equal(f.calls.some(input=>input.TransactItems?.some(item=>item.Update)),false);
  assert.equal((await f.message('d1',{action:'authenticate',driverId:'driver1'})).statusCode,200);
  const writes=f.calls.find(input=>input.TransactItems?.some(item=>item.Update)).TransactItems;
  assert.equal(writes.length,4);
  const live=writes.find(item=>item.Update).Update;
  assert.equal(live.TableName,'wizz-production-DriverLiveState');
  assert.deepEqual(live.Key,{driverId:'driver1'});
  assert.doesNotMatch(live.UpdateExpression,/isSearching|latitude|isActive/);
  assert.equal((await f.message('d1',{action:'driver_status',driverId:'driver1',isSearching:true})).statusCode,200);
  assert.equal(f.calls.filter(input=>input.TransactItems).length,2);
  await f.disconnect('d1');
  assert.ok(f.calls.find(input=>input.TableName==='wizz-production-DriverLiveState'&&input.ConditionExpression==='connectionId=:connection'));
});

test('driver closing between a socket scope read and registration prevents connection creation',async()=>{
  const f=fixture();
  f.state.closeOnConnect=true;
  assert.equal((await f.connect('d1','driver',{driverId:'driver1'})).statusCode,403);
  assert.equal(f.conns.has('d1'),false);
});

test('the first ready transition hands off stream identity and omits customer and financial details', async () => {
  const forwarded = [];
  const f = fixture(async record => forwarded.push(record));
  const ready = {
    ...order, status: 'ready_for_pickup', orderStatus: 'ready_for_pickup',
    financialSnapshot: { protectedFunding: 'private' }, customerPhone: 'private',
  };
  const record = {
    eventSource: 'aws:dynamodb', eventSourceARN: streamArn, eventName: 'MODIFY', eventID: 'stream-event',
    dynamodb: {
      SequenceNumber: '123',
      Keys: marshall({ PK: order.PK, SK: order.SK }),
      OldImage: marshall({ ...order, status: 'preparing', orderStatus: 'preparing' }),
      NewImage: marshall(ready),
    },
  };
  await f.broadcast({ Records: [
    { ...record, eventSourceARN: streamArn.replace('746727375268', '699561669180') },
    { ...record, dynamodb: { ...record.dynamodb, OldImage: marshall(ready) } },
    record,
    { ...record, dynamodb: { ...record.dynamodb, NewImage: marshall({ ...ready, deliveryJobId: 'existing' }) } },
  ] });
  assert.equal(forwarded.length, 1);
  assert.equal(forwarded[0].eventID, record.eventID);
  assert.equal(forwarded[0].dynamodb.SequenceNumber, '123');
  assert.deepEqual(forwarded[0].dynamodb.Keys, record.dynamodb.Keys);
  assert.equal(forwarded[0].dynamodb.NewImage.status.S, 'ready_for_pickup');
  assert.deepEqual(forwarded[0].dynamodb.NewImage.financialSnapshot, { BOOL: true });
  assert.doesNotMatch(JSON.stringify(forwarded), /private|customerPhone|deliveryAddress/);
});

test('kitchen fanout receives only order and branch keys from the production stream', async () => {
  const batches = [];
  const broadcast = createBroadcast({
    db: { send: async () => { throw Error('unchanged order must not be broadcast'); } },
    send: async () => {}, streamArn, forwardKitchen: async records => batches.push(records),
  });
  const make = (arn, branch) => ({
    eventSource: 'aws:dynamodb', eventSourceARN: arn, eventName: 'MODIFY',
    dynamodb: { SequenceNumber: '12',
      NewImage: marshall({ PK: 'ORDER#order1', SK: 'META', orderId: 'order1', status: 'preparing',
        storeId: branch, customerPhone: 'private', total: 10 }),
      OldImage: marshall({ PK: 'ORDER#order1', SK: 'META', orderId: 'order1', status: 'preparing',
        storeId: 'old-branch', customerPhone: 'private' }) },
  });
  await broadcast({ Records: [make(streamArn + '-other', 'outside'), make(streamArn, 'branch')] });
  assert.equal(batches.length, 1);
  assert.equal(batches[0].length, 1);
  assert.deepEqual(batches[0][0].dynamodb.NewImage, marshall({ PK: 'ORDER#order1', SK: 'META', storeId: 'branch' }));
  assert.deepEqual(batches[0][0].dynamodb.OldImage, marshall({ PK: 'ORDER#order1', SK: 'META', storeId: 'old-branch' }));
});
