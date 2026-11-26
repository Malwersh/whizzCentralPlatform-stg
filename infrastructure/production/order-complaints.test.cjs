'use strict';

const assert = require('node:assert/strict');
const {test} = require('node:test');
const {createHash, randomUUID} = require('node:crypto');
const {createHandler, tables} = require(process.env.WIZZ_COMPLAINT_BUNDLE);
const {identities:{admin}} = require('./wallet-identity-bindings.json');

const now = Date.parse('2026-11-24T20:00:00Z');
const time = new Date(now).toISOString();
const customer = '11111111-1111-4111-8111-111111111111';
const staff = '33333333-3333-4333-8333-333333333333';
const policy = {version:1, policyVersion:'test-published-v1', values:{
  postDeliveryClaimSeconds:86400, appealSeconds:259200, lateSafetyAndCashReviewAllowed:true,
  sla:Object.fromEntries(['SAFETY','CUSTODY','COD','FINANCIAL','STANDARD'].map(kind =>
    [kind,{responseSeconds:60,escalationSeconds:300}])),
}};

function fixture({finance=false}={}) {
  const keyAttributes = {
    [tables.orders]:['PK','SK'], [tables.customers]:['userId'], [tables.staff]:['pk','sk'],
    [tables.cases]:['orderId','sk'], [tables.sessions]:['sessionId'], [tables.lifecycle]:['operationId'],
    [tables.notifications]:['eventId'], [tables.deletion]:['pk','sk'], [tables.benefits]:['pk','sk'],
    [tables.attachments]:['attachmentId'],
  };
  const rows = new Map(), commands = [];
  const key = (table, item) => JSON.stringify([table,...keyAttributes[table].map(k => item[k])]);
  const get = (table, item) => rows.get(key(table,item));
  const put = (table, item) => rows.set(key(table,item), item);
  put(tables.customers,{userId:customer,cognitoSub:customer,isActive:true});
  put(tables.orders,{PK:'ORDER#order-fixture',SK:'META',orderId:'order-fixture',orderNumber:'ORD1795000000000',userSub:customer,
    userId:customer,storeId:'restaurant-fixture',status:'delivered',deliveredAt:time});
  put(tables.staff,{pk:'OPERATIONAL_SETTINGS#ORDER_EXCEPTION_CASES',sk:'CURRENT',...policy});
  put(tables.staff,{pk:'EMPLOYEE#'+staff,sk:'PROFILE',employeeId:staff,version:1,status:'ACTIVE',
    roles:finance?['finance_approver']:['operations'],approvalLimit:10000,scope:{allRegions:true},displayName:'مراجع الاختبار'});
  const db = {send: async command => {
    const input = command.input;
    commands.push(input);
    if (command.constructor.name === 'GetCommand') return {Item:structuredClone(get(input.TableName,input.Key))};
    if (input.IndexName === 'GSI_OrderNumber') {
      assert.equal(input.ExpressionAttributeValues[':number'],'ORD1795000000000');
      return {Items:[get(tables.orders,{PK:'ORDER#order-fixture',SK:'META'})]};
    }
    if (command.constructor.name === 'QueryCommand') return {Items:[...rows].filter(([k]) =>
      JSON.parse(k)[0] === input.TableName).map(([,row]) => row), LastEvaluatedKey:null};
    if (command.constructor.name === 'TransactWriteCommand') {
      for (const {Put:op} of input.TransactItems) if (op) put(op.TableName,structuredClone(op.Item));
      return {};
    }
    throw Error(command.constructor.name);
  }};
  const image = Buffer.from('fixture-image');
  const s3 = [];
  const handler = createHandler({db,now:()=>now,apiId:'aaaaaaaaaa',
    evidenceObject:async key => {s3.push(key);return {
      ContentLength:image.length,ContentType:'image/png',Body:{transformToByteArray:async()=>image},
    };},
    verifyCustomer:async token => {if (token !== 'customer') throw Error('invalid'); return {sub:customer};},
    verifyStaff:async token => {
      if (token !== 'staff') throw Error('invalid');
      return {sub:staff,username:'staff-fixed',iss:'https://cognito-idp.us-east-1.amazonaws.com/'+admin.poolId,
        client_id:admin.clientId,exp:now/1000+600,auth_time:now/1000-1200,token_use:'access'};
    },
    getStaff:async username => ({Username:username,Enabled:true,UserStatus:'CONFIRMED',
      UserAttributes:[{Name:'sub',Value:staff}],UserMFASettingList:['SOFTWARE_TOKEN_MFA']}),
  });
  const call = async (side, method, query, body, token=side) => {
    const r = await handler({resource:'/complaints/'+side,requestContext:{apiId:'aaaaaaaaaa',stage:'production'},
      httpMethod:method,queryStringParameters:query,headers:{Authorization:'Bearer '+token},body:JSON.stringify(body)});
    return {status:r.statusCode,body:JSON.parse(r.body)};
  };
  const action = (side, action, version, params) => call(side,'POST',{},{
    orderId:'order-fixture', action,...(action === 'READ' ? {} : {expectedVersion:version,requestId:randomUUID()}),...params,
  });
  return {call,action,get,put,commands,s3,image};
}

test('production customer complaint reaches the staff queue and decision reaches the customer',async () => {
  const f = fixture();
  assert.equal((await f.action('customer','READ')).body.canOpen,true);
  const open = await f.action('customer','OPEN',0,{type:'QUALITY',reason:'وصف مشكلة الطلب'});
  assert.equal(open.body.status,'OPEN');
  const queue = await f.call('staff','GET',{state:'open'});
  assert.equal(queue.body.items[0].orderId,'order-fixture');
  assert.equal(queue.body.items[0].orderNumber,'ORD1795000000000');
  const caseRead = await f.call('staff','GET',{orderId:'ord1795000000000'});
  assert.equal(caseRead.body.orderNumber,'ORD1795000000000');
  assert.equal(caseRead.body.userCanReview,true);
  assert.equal(caseRead.body.userCanApproveRemedy,false);
  assert.equal((await f.action('staff','CLAIM',1,{reason:'تولي متابعة شكوى الزبون'})).body.status,'IN_REVIEW');
  const decision = await f.action('staff','DECIDE',2,{
    outcome:'UNDETERMINED',reason:'السبب الداخلي للمراجعة',publicReason:'المعلومات الحالية غير كافية للحسم',
    evidenceIds:[caseRead.body.case.evidence[0].id],allocations:[],remedyAmountIqd:0,
  });
  assert.equal(decision.body.status,'DECIDED',JSON.stringify(decision));
  const publicRead = (await f.action('customer','READ')).body;
  assert.equal(publicRead.decision.reason,'المعلومات الحالية غير كافية للحسم');
  assert.equal(publicRead.decision.internalReason,undefined);
  assert.equal(publicRead.case,undefined);
  const writes = f.commands.filter(c => c.TransactItems).flatMap(c => c.TransactItems);
  const notice = writes.find(op => op.Put?.TableName === tables.notifications).Put.Item;
  assert.equal(notice.type,'order_complaint_updated');
  assert.equal(notice.driverId,customer);
  assert.equal(notice.caseId,open.body.caseId);
  assert(writes.every(op => JSON.stringify(op).includes('wizz-production-')));
  assert(writes.filter(op => op.Put).every(op => ![tables.orders,tables.customers].includes(op.Put.TableName)));
});

test('customer and admin routes reject tokens issued to the other app',async () => {
  const f = fixture();
  assert.equal((await f.call('staff','GET',{state:'open'},undefined,'customer')).status,401);
  assert.equal((await f.call('customer','POST',{}, {action:'READ',orderId:'order-fixture'},'staff')).status,401);
  assert.deepEqual(f.commands,[]);
});

test('staff can view retained evidence only when it is linked to the reviewed case',async () => {
  const f = fixture();
  await f.action('customer','OPEN',0,{type:'QUALITY',reason:'وصف مشكلة الطلب'});
  const row = f.get(tables.cases,{orderId:'order-fixture',sk:'CUSTOMER_POST_DELIVERY'});
  const attachmentId = randomUUID();
  const hash = value => createHash('sha256').update(value).digest('hex');
  const checksum = createHash('sha256').update(f.image).digest('base64');
  const key = 'complaint-evidence/'+hash(row.caseId)+'/'+attachmentId+'/'+hash(checksum);
  f.put(tables.attachments,{attachmentId,subjectId:customer,userType:'customer',status:'PUBLISHED',
    size:f.image.length,contentType:'image/png',key,checksum,sessionId:row.supportSessionId,messageKey:'message',
    retentionHold:true,evidenceRetention:{kind:'CUSTOMER_POST_DELIVERY_EVIDENCE',caseId:row.caseId,
      orderId:row.orderId,customerId:customer,sessionId:row.supportSessionId,checksum,retainedAt:time}});
  const query = {view:'evidence',orderId:row.orderId,attachmentId};
  assert.equal((await f.call('staff','GET',query)).status,404);
  assert.deepEqual(f.s3,[]);
  row.evidence.push({attachmentId,actorId:customer,sessionId:row.supportSessionId,checksum,retained:true});
  const response = await f.call('staff','GET',query);
  assert.equal(response.status,200);
  assert.equal(response.body.dataBase64,f.image.toString('base64'));
  assert.deepEqual(f.s3,[key]);
});

test('production rejection keeps a non-redeemable compensation amount from entering the case',async () => {
  const f = fixture({finance:true});
  await f.action('customer','OPEN',0,{type:'QUALITY',reason:'وصف مشكلة الطلب'});
  await f.action('staff','CLAIM',1,{reason:'تولي متابعة شكوى الزبون'});
  const caseRead=await f.call('staff','GET',{orderId:'order-fixture'});
  const values={outcome:'ACCEPTED',reason:'السبب الداخلي للمراجعة',publicReason:'اعتمدنا قسيمة تعويض للطلب',
    evidenceIds:[caseRead.body.case.evidence[0].id],allocations:[]};
  const invalid=await f.action('staff','DECIDE',2,{...values,remedyAmountIqd:1501});
  assert.equal(invalid.status,400);
  assert.equal(invalid.body.code,'COMPLAINT_REMEDY_DENOMINATION_INVALID');
  assert.equal((await f.action('staff','DECIDE',2,{...values,remedyAmountIqd:1500})).body.status,'REMEDY_PENDING');
});
