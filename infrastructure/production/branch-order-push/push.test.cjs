'use strict';

const assert=require('node:assert/strict');
const {test}=require('node:test');
const {marshall}=require('@aws-sdk/util-dynamodb');
const {createWorker}=require('./worker.cjs');
const {createRegistry,resource}=require('./registration.cjs');
const {tables,digest,bindingKey,reverseKey,tokenKey}=require('./bindings.cjs');

const branch='branch1',device='device1',token='t'.repeat(60),owner='owner1';
const at=Date.now(), seconds=Math.floor(at/1000), ttl=seconds+1200;
const stream='arn:aws:dynamodb:us-east-1:746727375268:table/wizz-production-Orders/stream/2026-11-24T09:00:00.000';
const sound={values:{merchantNewOrder:'merchant_bell'},catalog:[{id:'merchant_bell',file:'merchant_bell.wav'}]};

function fixture() {
  const rows=new Map(), calls=[], sent=[];
  const key=(table,value)=>table+'|'+JSON.stringify(value);
  const save=(table,k,row)=>rows.set(key(table,k),structuredClone(row));
  const get=(table,k)=>rows.get(key(table,k));
  const conflicting=()=>Object.assign(Error('condition'),{name:'ConditionalCheckFailedException'});
  const order={PK:'ORDER#order1',SK:'META',orderId:'order1',businessId:branch,storeId:branch,status:'pending',
    merchantAcceptanceDeadlineAt:new Date(at+300000).toISOString(),customerName:'private'};
  const orderKey={PK:order.PK,SK:order.SK};
  const d={pk:'BRANCH#'+branch,sk:'DEVICE#'+device,businessId:branch,deviceId:device,ownerId:owner,
    status:'ACTIVE',expiresAt:ttl,version:3};
  const deviceKey={pk:d.pk,sk:d.sk};
  save(tables.orders,orderKey,order);
  save(tables.merchants,{businessId:branch},{ownerId:owner,cognitoUserId:owner,status:'approved'});
  save(tables.platform,deviceKey,d);
  const db={async send(command){
    const input=command.input;
    calls.push(input);
    if(input.TransactItems){
      for(const item of input.TransactItems){
        if(!item.Put)continue;
        const {TableName,Item}=item.Put;
        const k=TableName===tables.registry?{token:Item.token}:{pk:Item.pk,sk:Item.sk};
        save(TableName,k,Item);
      }
      return {};
    }
    if(input.IndexName)return {Items:[...rows.entries()].filter(([k,r])=>k.startsWith(tables.registry+'|')&&r.businessId===input.ExpressionAttributeValues[':branch']).map(x=>x[1])};
    const {TableName,Key,UpdateExpression,ExpressionAttributeValues:v}=input;
    const current=get(TableName,Key);
    if(command.constructor.name==='DeleteCommand'){
      if(current?.tokenHash!==v[':token']||current.deviceVersion!==v[':version'])throw conflicting();
      rows.delete(key(TableName,Key));return {};
    }
    if(UpdateExpression){
      const marker=current??{};
      if(v[':lease']!==undefined){
        if(marker.deliveredAt||marker.leaseUntil>seconds)throw conflicting();
        save(TableName,Key,{leaseOwner:v[':owner'],leaseUntil:v[':lease'],ttl:v[':ttl']});
      }else{
        if(marker.leaseOwner!==v[':owner'])throw conflicting();
        save(TableName,Key,{ttl:marker.ttl,...(UpdateExpression.startsWith('SET')?{deliveredAt:v[':at']}:{})});
      }
      return {};
    }
    return {Item:current?structuredClone(current):undefined};
  }};
  const registry=createRegistry({db,policy:async()=>sound,now:()=>at,authorize:async(event,branchId,required,reception)=>{
    if(event.headers?.Authorization!=='paired')throw Object.assign(Error('DEVICE_REVOKED'),{status:401});
    if(branchId!==branch)throw Object.assign(Error('BRANCH_SCOPE_REQUIRED'),{status:403});
    assert.deepEqual(required,[]);assert.equal(reception,true);
    return {receptionOnly:true,deviceId:device,deviceVersion:d.version,deviceExpiresAt:ttl,
      actor:{ownerId:owner,guards:[{ConditionCheck:{TableName:tables.platform,Key:deviceKey}}]}};
  }});
  const register=async(patch={},headers={Authorization:'paired'})=>{
    const response=await registry({resource,httpMethod:'POST',requestContext:{stage:'production'},headers,
      body:JSON.stringify({action:'register_push',businessId:branch,pushToken:token,platform:'ios',soundEnabled:true,soundReady:[],...patch})});
    return {status:response.statusCode,body:JSON.parse(response.body)};
  };
  const run=(next=order,prev,options={})=>{
    const work=createWorker({db,now:()=>at,stream,policy:async()=>sound,messaging:async()=>({send:async payload=>{
      if(options.pushError)throw options.pushError;
      sent.push(payload);
    }})});
    return work({Records:[{eventSource:'aws:dynamodb',eventSourceARN:options.stream??stream,eventName:prev?'MODIFY':'INSERT',
      dynamodb:{NewImage:marshall(next),...(prev&&{OldImage:marshall(prev)}),SequenceNumber:'1',ApproximateCreationDateTime:seconds}}]});
  };
  return {db,register,run,sent,save,get,calls,d,order,orderKey,deviceKey};
}

test('registration is scoped to the device branch and writes registry and reverse pointer together',async()=>{
  const f=fixture();
  assert.equal((await f.register({},{Authorization:'anonymous'})).status,401);
  assert.equal((await f.register({businessId:'foreign'})).status,403);
  assert.equal((await f.register({},{Authorization:'paired','X-Staff-Session':'unexpected'})).status,400);
  assert.equal(f.calls.length,0);
  assert.equal((await f.register()).status,200);
  const tx=f.calls.at(-1).TransactItems;
  assert.equal(tx.length,4);
  assert.equal(f.get(tables.registry,tokenKey(device)).env,'production');
  assert.equal(f.get(tables.registry,reverseKey(digest(token))).boundDeviceId,device);
  assert.equal(f.get(tables.platform,bindingKey(branch,device)).tokenHash,digest(token));
});

test('new order alerts omit customer details and stream replay sends once',async()=>{
  const f=fixture();
  await f.register();
  assert.deepEqual(await f.run(),{batchItemFailures:[]});
  assert.deepEqual(await f.run(),{batchItemFailures:[]});
  assert.equal(f.sent.length,1);
  const [message]=f.sent;
  assert.equal(message.data.action,'new_order');
  assert.equal(message.data.businessId,branch);
  assert.equal(message.apns.payload.aps.sound,'merchant_bell.wav');
  assert.equal(message.android.notification.channelId,'merchant_orders_merchant_bell');
  assert.equal(JSON.stringify(message).includes('private'),false);
});

test('revoked, moved, expired or transferred devices receive no alert',async()=>{
  for(const disposition of ['revoked','moved','expired','transferred']){
    const f=fixture();
    await f.register();
    if(disposition==='revoked')f.save(tables.platform,f.deviceKey,{...f.d,status:'REVOKED'});
    if(disposition==='expired')f.save(tables.platform,f.deviceKey,{...f.d,expiresAt:seconds-1});
    if(disposition==='moved')f.save(tables.registry,reverseKey(digest(token)),{boundDeviceId:'new-device',boundBranchId:'somewhere-else',deviceVersion:2,ttl});
    if(disposition==='transferred')f.save(tables.merchants,{businessId:branch},{ownerId:'new',cognitoUserId:'new',status:'approved'});
    assert.deepEqual(await f.run(),{batchItemFailures:[]});
    assert.equal(f.sent.length,0);
  }
});

test('cancellation includes review and final state and honors silent device configuration',async()=>{
  const f=fixture();
  await f.register({soundEnabled:false});
  const pending=f.order;
  const requested={...pending,exceptionCancellation:{state:'REQUESTED',requestId:'req1'}};
  f.save(tables.orders,f.orderKey,requested);
  await f.run(requested,pending);
  const cancelled={...requested,status:'cancelled',canceledBy:'customer',exceptionCancellation:{state:'CANCELLED',requestId:'req1'}};
  f.save(tables.orders,f.orderKey,cancelled);
  await f.run(cancelled,requested);
  assert.deepEqual(f.sent.map(msg=>msg.data.action),['customer_cancellation_requested','order_cancellation_confirmed']);
  assert.ok(f.sent.every(msg=>msg.apns.payload.aps.sound===undefined && msg.android.notification.channelId==='merchant_orders_silent'));
  await f.run();
  assert.equal(f.sent.length,2);
});

test('transient send failure is retried and invalid token clears the matching binding',async()=>{
  const f=fixture();
  await f.register();
  const temporary=Object.assign(Error('temporary'),{code:'messaging/internal-error'});
  assert.deepEqual(await f.run(f.order,null,{pushError:temporary}),{batchItemFailures:[{itemIdentifier:'1'}]});
  assert.deepEqual(await f.run(),{batchItemFailures:[]});
  assert.equal(f.sent.length,1);
  const g=fixture();
  await g.register();
  const invalid=Object.assign(Error('invalid'),{code:'messaging/registration-token-not-registered'});
  assert.deepEqual(await g.run(g.order,null,{pushError:invalid}),{batchItemFailures:[]});
  assert.equal(g.get(tables.platform,bindingKey(branch,device)),undefined);
  await assert.rejects(g.run(g.order,null,{stream:'staging'}),/INVALID_ORDER_NOTICE_EVENT/);
});
