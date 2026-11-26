'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createProductionMerchantOrderResponses } = require('../dist/productionMerchantOrderResponses');

const now = Date.parse('2026-11-23T12:00:00Z');
const env = {
  ENVIRONMENT:'production', STAGE:'production', AWS_REGION:'us-east-1',
  FINANCIAL_COD_ACCOUNT_ID:'746727375268', MERCHANT_RESPONSE_MODE:'REQUIRED',
};
const event = (action='confirm', body={ businessId:'branch1', estimatedPreparationTime:25 }) => ({
  resource:'/merchant/order/{orderId}/{action}', httpMethod:'PUT', requestContext:{stage:'production'},
  pathParameters:{orderId:'order1',action}, body:JSON.stringify(body),
});
function fixture({ subject='owner1', locked=false,status='pending',financial=false,returning=false }={}) {
  const calls = [];
  const order = {
    PK:'ORDER#order1', SK:'META', orderId:'order1', businessId:'branch1', storeId:'branch1', status,orderStatus:status,
    paymentMethod:'cash', paymentStatus:'pending', storeStatus:'branch1#'+status+'#b1',
    merchantAcceptanceDeadlineAt:'2026-11-23T12:05:00.000Z',
    merchantResponsePolicy:{schemaVersion:1,acceptanceSeconds:300}, deliveryQuote:{route:{durationSeconds:180}},
  };
  if (financial) {
    order.financialSnapshot = { schemaVersion: 3, settlementModel: 'FULL_CASH_AT_DELIVERY_V1' };
    order.financeRollout = { scopeId: 'GENERAL_PRODUCTION_FULL_CASH_V1', schemaVersion: 2 };
  }
  if (returning) {
    Object.assign(order,{status:'return_arrived',returnCaseId:'RET:verified',assignmentAttemptCounter:2,
      financialAcceptance:{offerId:'offer:verified',privateGuarantee:1500}});
  }
  const input = {
    Orders:order,
    Merchants:{businessId:'branch1',ownerId:'owner1',cognitoUserId:'owner1',isActive:true,status:'approved'},
    WalletLifecycle:{operationId:'MERCHANT_RESPONSE#order1',orderId:'order1',status:'PENDING'},
  };
  const db = { async send(command) {
    calls.push(command.input);
    if (command.input.TransactItems) return {};
    if (command.input.IndexName) return {Items:[
      {
        ...order,
        financialSnapshot:{privateField:'private'},
        financialAssignment:{attempt:2,internalHold:200},
        exceptionPolicy:{version:'exception-policy-v1',privateField:'private'},
        exceptionCancellation:{state:'REQUESTED',caseId:'OEX:example',privateField:'private'},
      },
      {...order,businessId:'foreign'}, {...order,orderId:'order2',PK:'ORDER#order2',status:'cancelled'},
    ]};
    const table = command.input.TableName.replace('wizz-production-', '');
    return { Item:table==='AccountDeletion' && locked ? {pk:command.input.Key.pk} : input[table] };
  }};
  const authenticate = async () => {
    if (!subject) throw Object.assign(Error('UNAUTHORIZED'),{status:401});
    return {sub:subject};
  };
  return { handler:createProductionMerchantOrderResponses({db,authenticate,env,now:()=>now}),calls };
}

test('production merchant confirm and reject commit only the scoped response transaction',async()=>{
  for (const action of ['confirm','reject']) {
    const f=fixture();
    const body=action==='confirm'?{estimatedPreparationTime:25}:{reason:'صنف غير متوفر'};
    const r=await f.handler(event(action,body));
    assert.equal(r.statusCode,200,r.body);
    assert.ok(f.calls.filter(call=>call.TableName).every(call=>call.TableName.startsWith('wizz-production-')));
    const mutations=f.calls.filter(call=>call.TransactItems);
    assert.equal(mutations.length,1);
    const transaction=mutations[0].TransactItems;
    assert.equal(transaction.some(item=>item.Update?.TableName==='wizz-production-Orders'),true);
    assert.equal(transaction.some(item=>item.Update?.TableName==='wizz-production-WalletLifecycle'),true);
    assert.equal(JSON.parse(r.body).status,action==='confirm'?'confirmed':'cancelled');
    if(action==='confirm') assert.equal(transaction.some(item=>item.Update?.TableName==='wizz-production-Wallets'),false);
  }
});

test('anonymous, another owner, stale branch and staging requests make no writes',async()=>{
  for (const [options,request,status] of [
    [{subject:null},event(),401],
    [{subject:'other'},event(),404],
    [{locked:true},event(),404],
    [{},event('confirm',{businessId:'other'}),404],
    [{},event('unknown'),400],
    [{},{...event(),requestContext:{stage:'staging'}},404],
  ]) {
    const f=fixture(options);
    const response=await f.handler(request);
    assert.equal(response.statusCode,status,response.body);
    assert.equal(f.calls.some(call=>call.TransactItems),false);
  }
});


test('orders list loads the authorized branch directly and projects its screen fields',async()=>{
  const f=fixture();
  const request={resource:'/merchant/orders/{businessId}',httpMethod:'GET',requestContext:{stage:'production'},
    pathParameters:{businessId:'branch1'}};
  const result=await f.handler(request);
  assert.equal(result.statusCode,200,result.body);
  const { orders } = JSON.parse(result.body);
  assert.deepEqual(orders.map(order=>[order.orderId,order.financialAssignment,order.financialSnapshot]),[
    ['order1',{attempt:2},undefined],
  ]);
  assert.deepEqual(orders[0].exceptionCancellation, {state:'REQUESTED',caseId:'OEX:example'});
  assert.equal(orders[0].exceptionPolicyVersion, 'exception-policy-v1');
  assert.equal(orders[0].exceptionPolicy, undefined);
  assert.equal(orders[0].status, 'pending');
  const inactive=await f.handler({...request,queryStringParameters:{status:'cancelled'}});
  assert.deepEqual(JSON.parse(inactive.body).orders.map(order=>order.orderId),['order2']);
  assert.equal(f.calls.find(call=>call.IndexName).IndexName,'GSI_BusinessId');
  const other=fixture({subject:'other'});
  assert.equal((await other.handler(request)).statusCode,404);
  assert.ok(other.calls.every(call=>!call.IndexName));
});


test('the existing owner return screen receives the verified offer, attempt and return reference',async()=>{
  const f=fixture({returning:true});
  const result=await f.handler({resource:'/merchant/orders/{businessId}',httpMethod:'GET',
    requestContext:{stage:'production'},pathParameters:{businessId:'branch1'}});
  assert.equal(result.statusCode,200,result.body);
  const [order]=JSON.parse(result.body).orders;
  assert.equal(order.status,'return_arrived');
  assert.deepEqual(order.financialAssignment,{offerId:'offer:verified',attempt:2,returnId:'RET:verified'});
  assert.equal(order.financialAcceptance,undefined);
});

test('only the branch owner can move a confirmed order to preparation without changing funds',async()=>{
  const request=event('status',{status:'preparing',businessId:'branch1'});
  const f=fixture({status:'confirmed'});
  const response=await f.handler(request);
  assert.equal(response.statusCode,200,response.body);
  assert.equal(JSON.parse(response.body).status,'preparing');
  const transaction=f.calls.find(call=>call.TransactItems).TransactItems;
  assert.deepEqual(transaction.map(item=>(item.Update??item.ConditionCheck??item.Put).TableName),[
    'wizz-production-Orders','wizz-production-Merchants','wizz-production-AccountDeletion',
    'wizz-production-AccountDeletion','wizz-production-AuditLog',
  ]);
  assert.equal(transaction[0].Update.ExpressionAttributeValues[':bucket'],'branch1#preparing#b1');
  for (const [options,otherRequest,code] of [
    [{status:'preparing'},request,200],
    [{status:'pending'},request,409],
    [{status:'confirmed',subject:'unrelated'},request,404],
    [{status:'confirmed'},event('status',{status:'ready_for_pickup'}),409],
  ]) {
    const candidate=fixture(options);
    assert.equal((await candidate.handler(otherRequest)).statusCode,code);
    assert.equal(candidate.calls.some(call=>call.TransactItems),false);
  }
});

test('a full-cash order in preparation can become ready once without modifying accounting', async () => {
  const request = event('status', { status: 'ready_for_pickup', businessId: 'branch1' });
  const active = fixture({ status: 'preparing', financial: true });
  const response = await active.handler(request);
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(JSON.parse(response.body).status, 'ready_for_pickup');
  const tx = active.calls.find(call => call.TransactItems).TransactItems;
  const update = tx[0].Update;
  assert.equal(update.ExpressionAttributeValues[':bucket'], 'branch1#ready_for_pickup#b1');
  assert.equal(update.ExpressionAttributeNames['#stepAt'], 'readyAt');
  assert.ok(Object.values(update.ExpressionAttributeNames).includes('financialSnapshot'));
  assert.equal(tx.at(-1).Put.Item.action, 'MERCHANT_MARKED_ORDER_READY');
  assert.equal(tx.slice(1).some(item => item.Update), false);

  for (const [options, expected] of [
    [{ status: 'ready_for_pickup', financial: true }, 200],
    [{ status: 'preparing' }, 409],
    [{ status: 'preparing', financial: true, subject: 'other' }, 404],
  ]) {
    const candidate = fixture(options);
    const outcome = await candidate.handler(request);
    assert.equal(outcome.statusCode, expected, outcome.body);
    if (expected === 200) assert.equal(JSON.parse(outcome.body).replayed, true);
    assert.equal(candidate.calls.some(call => call.TransactItems), false);
  }
});
