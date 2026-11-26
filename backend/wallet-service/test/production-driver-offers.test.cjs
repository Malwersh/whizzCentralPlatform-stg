'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createProductionDriverOffers}=require('../dist/productionDriverOffers');

function fixture() {
  const calls=[];
  const handler=createProductionDriverOffers({
    authenticate:async token=>{
      if(token!=='valid.dev.token') throw Error('UNAUTHORIZED');
      return {subjectId:'driver1'};
    },
    read:async (input,actor)=>{calls.push({input,actor});return {success:true};},
    respond:async (action,input,actor,verify)=>{
      assert.deepEqual(await verify(),actor);
      calls.push({action,input,actor});return {success:true,orderId:input.orderId};
    },
    display:async (input,actor)=>{calls.push({input,actor});return {success:true,acknowledged:true};},
    trip:async (action,orderId,input,actor)=>{calls.push({action,orderId,input,actor});return {success:true,orderId};},
    readOrder:async(driverId,orderId)=>{
      calls.push({driverId,orderId});
      return orderId?{orderId,status:'assigned'}:{hasActiveOrder:false,order:null};
    },
  });
  return {calls,request:async (resource,body={},overrides={})=>{
    const result=await handler({resource,httpMethod:'POST',headers:{Authorization:'Bearer valid.dev.token'},
      requestContext:{stage:'production'},body:JSON.stringify(body),...overrides});
    return {status:result.statusCode,body:JSON.parse(result.body)};
  }};
}
const input={orderId:'order1',offerId:'FINO:1234',waveNumber:1,driverId:'driver1'};

test('accept and decline use only the offer selector and authenticated driver',async()=>{
  const f=fixture();
  for(const [path,action,extra] of [['accept-wave-offer','accept',{}],['reject-wave-offer','decline',{reason:'driver_declined'}]]) {
    const r=await f.request('/driver/'+path,{...input,...extra});
    assert.equal(r.status,200);
    assert.deepEqual(f.calls.at(-1),{action,input:{orderId:'order1',offerId:'FINO:1234',waveNumber:1},actor:{driverId:'driver1',subjectId:'driver1'}});
  }
});

test('signed offer references and active reads use the correct role',async()=>{
  const f=fixture();
  const ref={...input,dispatchDriverId:'driver1',financialPushVersion:'1',cycleId:'cycle1',expiresAt:'2099-11-23T22:00:00.000Z',offerDigest:'a'.repeat(64)};
  assert.equal((await f.request('/driver/financial-wave-offer',ref)).status,200);
  assert.equal(f.calls[0].input.financialPushVersion,1);
  assert.deepEqual((await f.request('/driver/active-order',null,{httpMethod:'GET'})).body,{hasActiveOrder:false,order:null});
  const path='/driver/orders/{orderId}';
  const detail=await f.request(path,null,{httpMethod:'GET',pathParameters:{orderId:'order1'}});
  assert.equal(detail.body.orderId,'order1');
  assert.deepEqual(f.calls[2],{driverId:'driver1',orderId:'order1'});
});

test('foreign identities, malformed selectors, legacy offers and staging are refused',async()=>{
  const f=fixture();
  for(const [changes,options,status] of [
    [{driverId:'another-driver'},{},401],[{offerId:'OFFER_old'},{},400],[{price:100},{},400],
    [{waveNumber:0},{},400],[{}, {headers:{}},401],[{},{requestContext:{stage:'staging'}},404],
  ]) assert.equal((await f.request('/driver/accept-wave-offer',{...input,...changes},options)).status,status);
  assert.equal(f.calls.length,0);
});

test('trip routes require the production driver session and an allowed action', async () => {
  const f=fixture(),path='/driver/orders/{orderId}/{tripAction}';
  const parameters={orderId:'order1',tripAction:'pickup'};
  assert.equal((await f.request(path, null, {headers:{},pathParameters:parameters})).status,401);
  assert.equal((await f.request(path, {}, {pathParameters:{...parameters,tripAction:'toString'}})).status,404);
  assert.equal((await f.request(path, {}, {pathParameters:parameters,body:null})).status,200);
  assert.deepEqual(f.calls,[{action:'pickup',orderId:'order1',input:{},actor:{driverId:'driver1',subjectId:'driver1'}}]);
});


test('offer display accepts only the signed-in driver and offer reference',async()=>{
  const f=fixture(),path='/driver/offers/displayed';
  assert.equal((await f.request(path,input)).status,400);
  assert.equal((await f.request(path,{orderId:'order1',offerId:'FINO:1234'},{headers:{}})).status,401);
  assert.equal((await f.request(path,{orderId:'order1',offerId:'FINO:1234'})).body.acknowledged,true);
  assert.deepEqual(f.calls,[{input:{orderId:'order1',offerId:'FINO:1234'},actor:{driverId:'driver1',subjectId:'driver1'}}]);
});
