'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { marshall } = require('@aws-sdk/util-dynamodb');
const { checkoutTables } = require('../dist/checkoutTables');
const { createStagingDispatchCreator } = require('../dist/dispatchCreator');
const { financialDispatchTables } = require('../dist/walletBindings');
const { createStagingDispatchWaveExecutor } = require('../dist/dispatchWaveExecutor');
const { createStagingDriverOfferContext } = require('../dist/driverOfferContext');
const { createStagingFinancialOfferHydration } = require('../dist/financialOfferHydration');
const { createStagingDriverOfferAcceptance } = require('../dist/driverOfferAcceptance');
const { createStagingFinancialPushHandler } = require('../dist/financialOfferNotification');
const { createStagingFinancialOfferDelivery, readStagingFinancialOfferDelivery } = require('../dist/financialOfferDelivery');
const { route } = require('./helpers/driver-offer-fixture.cjs');
const { fixture } = require('./helpers/dispatch-cycle-fixture.cjs');

test('production ready transition pins, prepares and delivers an idempotent wave using production bindings', async t => {
  const f = fixture('FINANCIAL',{enableFullCash:true});
  const previous = process.env;
  const template = require('../../../infrastructure/production/order-financial-runtime.template.json');
  process.env = {
    ...Object.fromEntries(Object.entries(template.Resources.Function.Properties.Environment.Variables)
      .filter(([, value]) => typeof value === 'string')),
    STAGE: 'production', ENVIRONMENT: 'production', AWS_REGION: 'us-east-1',
  };
  t.after(() => { process.env = previous; });

  const prod = checkoutTables();
  const stage = checkoutTables({});
  const tokens = new Map(Object.entries(prod).map(([key, value]) => [value, stage[key]]));
  for (const key of ['driver','live','offers']) {
    tokens.set(financialDispatchTables()[key], financialDispatchTables({})[key]);
  }
  tokens.set('wizz-production-OrderConnections','WizzUser_websocket_connections_staging');
  const phone = '+9647700000000';
  const driver = f.get('WhizzDrivers_staging',{driverId:'driver1'});
  Object.assign(driver,{isActive:true,isVerified:true,phoneNumber:phone});
  f.put('WizzUser_websocket_connections_staging',{
    connectionId:'driver1', isActive:true,
    identityScope346:{version:1,role:'DRIVER',subjectId:'driver1',driverId:'driver1',expiresAt:Math.floor(f.time/1000)+100},
  });
  const used = [];
  function bind(input) {
    assert.ok(tokens.has(input.TableName), 'unbound production table ' + input.TableName);
    used.push(input.TableName);
    return { ...input, TableName: tokens.get(input.TableName) };
  }
  const db = { async send(command) {
    const { input } = command;
    const translated = input.TransactItems ? { ...input, TransactItems: input.TransactItems.map(item => {
      const [kind, operation] = Object.entries(item)[0];
      return { [kind]: bind(operation) };
    }) } : bind(input);
    return f.db.send(new command.constructor(translated));
  } };
  const key = { PK: 'ORDER#order1', SK: 'META' };
  const current = f.get(stage.orders, key);
  const record = { eventName: 'MODIFY', eventSource: 'aws:dynamodb',
    eventSourceARN: 'arn:aws:dynamodb:us-east-1:746727375268:table/wizz-production-Orders/stream/2026-11-23T00:00:00.000',
    eventID: 'test', dynamodb: { SequenceNumber: '1', Keys: marshall(key),
      OldImage: marshall({ ...current, status: 'preparing' }), NewImage: marshall(current) } };
  const started = [];
  const creator = createStagingDispatchCreator({ db, enableFullCash:true, now: () => f.time,
    invokeStart: async command => { started.push(command); } });
  await assert.rejects(creator.process({ ...record, eventSourceARN:
    'arn:aws:dynamodb:us-east-1:699561669180:table/WizzOrders/stream/2026-11-23T00:00:00.000' }),
  /INVALID_DISPATCH_STREAM_SOURCE/);
  assert.equal(used.length, 0);
  const first = await creator.process(record);
  const replay = await creator.process(record);
  assert.equal(first.created, true);
  assert.equal(replay.replayed, true);
  assert.equal(f.job().dispatchJobId, first.dispatchJobId);
  assert.deepEqual(started[0], started[1]);
  const sockets=[],pushes=[],firebase=[];
  const notificationDb={send:async command=>{
    const {TableName,IndexName,Key}=command.input;
    if(TableName==='wizz-production-PushDeviceTokens'){
      const productions={token:'test-production-token',env:'production',subjectId:'driver1',app:'driver',ttl:Math.floor(f.time/1000)+100};
      const rejected={...productions,token:'test-staging-token',env:'staging'};
      if(IndexName==='SubjectIdIndex')return {Items:[productions,rejected]};
      assert.equal(Key.token,productions.token);
      return {Item:productions};
    }
    assert.equal(TableName,'wizz-production-PlatformStaff');
    return {};
  }};
  const push=createStagingFinancialPushHandler({db:notificationDb,now:()=>f.time,
    env:{...process.env,PINNED_DISPATCH_ACCOUNT_ID:'746727375268',PINNED_FINANCIAL_PUSH_MODE:'REQUIRED',PUSH_TOKENS_TABLE:'wizz-production-PushDeviceTokens'},
    getMessaging:async()=>({sendEachForMulticast:async payload=>{firebase.push(payload);return {successCount:1};}}),
    verifyReference:async ref=>{
      const proof=await readStagingFinancialOfferDelivery({db,enableFullCash:true,now:()=>f.time},
        {orderId:ref.orderId,offerId:ref.offerId,waveNumber:ref.waveNumber,dispatchDriverId:ref.dispatchDriverId});
      assert.deepEqual(proof.reference,ref);
    },
  });
  const sendOffer=createStagingFinancialOfferDelivery({db,enableFullCash:true,now:()=>f.time,beforeSend:async()=>{},
    postSocket:async (connection,message)=>sockets.push({connection,message}),
    postPush:async reference=>{
      pushes.push(reference);
      return push(reference);
    },
  });
  const context=input=>createStagingDriverOfferContext({...input,enableFullCash:true,now:()=>f.time,
    router:{getRoute:async (a,b)=>route('production-route',a,b)},
    cognito:{send:async command=>{
      assert.equal(command.input.UserPoolId,'us-east-1_5sUT54eCB');
      assert.equal(command.input.Username,phone);
      return {Enabled:true,UserStatus:'CONFIRMED',UserAttributes:[
        {Name:'sub',Value:'driver1'},{Name:'phone_number',Value:phone},{Name:'phone_number_verified',Value:'true'},
      ]};
    }},
  });
  const wave=createStagingDispatchWaveExecutor({db,enableFullCash:true,now:()=>f.time,
    selectDrivers:async()=>['driver1'],sendOffer,context});
  const run={orderId:'order1',assignmentId:first.dispatchJobId,owner:'prod-worker',leaseSeconds:20};
  const created=await wave.run(run);
  assert.equal(created.kind,'FINANCIAL_WAVE_READY');
  await wave.run(run);
  assert.equal(sockets.length,1);
  assert.equal(pushes.length,1);
  assert.equal(firebase.length,1);
  assert.deepEqual(firebase[0].tokens,['test-production-token']);
  assert.equal(sockets[0].connection,'driver1');
  assert.equal(sockets[0].message.eventId,pushes[0].offerId);
  assert.ok(used.includes('wizz-production-OrderConnections'));
  const authenticate=async()=>({driverId:'driver1',subjectId:'driver1'});
  const hydrate=createStagingFinancialOfferHydration({db,enableFullCash:true,now:()=>f.time,authenticate,authorize:async()=>{}});
  assert.deepEqual((await hydrate(pushes[0])).message,sockets[0].message);
  const accept=createStagingDriverOfferAcceptance({db,enableFullCash:true,now:()=>f.time,
    context:context({db,positionMaxAgeSeconds:120,offerTtlSeconds:60}),authenticateDriver:authenticate});
  const request={orderId:'order1',waveNumber:1,offerId:pushes[0].offerId};
  const result=await accept.accept(request);
  assert.equal(result.driverId,'driver1');
  assert.equal(f.job().status,'assigned');
  assert.equal((await accept.accept(request)).replayed,true);
  assert.equal(f.get(stage.orders,key).driverId,'driver1');
  const {createProductionDriverActiveOrder}=require('../dist/productionDriverActiveOrder');
  const readActive=createProductionDriverActiveOrder({db,now:()=>f.time});
  const active=await readActive('driver1');
  assert.equal(active.hasActiveOrder,true);
  assert.equal(active.order.orderId,'order1');
  assert.equal(active.order.financialAssignment.offerId,request.offerId);
  assert.equal(active.order.financialSnapshot,undefined);
  assert.equal((await readActive('driver1','order1')).status,'assigned');
  await assert.rejects(readActive('driver2','order1'),/ORDER_NOT_FOUND/);
  for (const name of [prod.orders, prod.dispatchJobs, prod.policy, prod.branches, prod.deletion]) {
    assert.ok(used.includes(name));
  }
});

test('production worker consumes only a ready transition or its own scheduled event',async()=>{
  const {createDispatchTrigger}=require('../dist/productionDispatchRuntime');
  const streamArn='arn:aws:dynamodb:us-east-1:746727375268:table/wizz-production-Orders/stream/2026-11-23T00:00:00.000';
  const ruleArn='arn:aws:events:us-east-1:746727375268:rule/wizz-production-dispatch-cycle';
  const starts=[];
  const handler=createDispatchTrigger({streamArn,ruleArn,ready:async record=>starts.push(record),tick:async()=>({tick:true})});
  const image=status=>({status:{S:status}});
  const record={eventName:'MODIFY',eventSource:'aws:dynamodb',eventSourceARN:streamArn,
    dynamodb:{Keys:{SK:{S:'META'}},OldImage:image('preparing'),NewImage:image('ready_for_pickup')}};
  assert.deepEqual(await handler({Records:[
    {...record,dynamodb:{...record.dynamodb,NewImage:image('confirmed')}},
    {...record,dynamodb:{...record.dynamodb,OldImage:image('ready_for_pickup')}},
    record,
  ]}),{readyOrders:1});
  assert.deepEqual(starts,[record]);
  await assert.rejects(handler({Records:[{...record,eventSourceARN:streamArn.replace('746727375268','699561669180')}]}),
    /INVALID_PRODUCTION_DISPATCH_TRIGGER/);
  const scheduled={source:'aws.events',account:'746727375268',region:'us-east-1','detail-type':'Scheduled Event'};
  await assert.rejects(handler({...scheduled,resources:[ruleArn+':other']}),/INVALID_PRODUCTION_DISPATCH_TRIGGER/);
  assert.deepEqual(await handler({...scheduled,resources:[ruleArn]}),{tick:true});
});

test('production dispatch grants region and connection reads without allowing standalone order proofs or writes',async()=>{
  const {createHash}=require('node:crypto');
  const {GetCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
  const {createFinanceRollout}=require('../dist/financeRollout');
  const template=require('../../../infrastructure/production/order-financial-runtime.template.json');
  const config='{"accountId":"746727375268","region":"us-east-1","schemaVersion":1,"scopes":[]}';
  const env={
    ...Object.fromEntries(Object.entries(template.Resources.Function.Properties.Environment.Variables)
      .filter(([, value])=>typeof value==='string')),
    ENVIRONMENT:'production',STAGE:'production',AWS_REGION:'us-east-1',
    FINANCE_GENERAL_RELEASE_MODE:'REQUIRED',FINANCE_ROLLOUT_CONFIG:config,
    FINANCE_ROLLOUT_SHA256:createHash('sha256').update(config).digest('hex'),
  };
  const calls=[];
  const db={send:async command=>{calls.push(command.input);return {};}};
  const scoped=createFinanceRollout({db,env,dispatch:true}).db;
  await scoped.send(new GetCommand({TableName:'wizz-production-OrderConnections',Key:{connectionId:'driver1'}}));
  const region={TableName:'wizz-production-Regions',Key:{regionId:'zone1'},ConditionExpression:'attribute_exists(regionId)'};
  await scoped.send(new GetCommand({TableName:region.TableName,Key:region.Key}));
  await assert.rejects(scoped.send(new TransactWriteCommand({TransactItems:[{ConditionCheck:region}]})),
    /FINANCE_ROLLOUT_OUT_OF_SCOPE/);
  await assert.rejects(scoped.send(new TransactWriteCommand({TransactItems:[
    {Put:{TableName:region.TableName,Item:region.Key}},
  ]})),/FINANCE_ROLLOUT_OUT_OF_SCOPE/);
  await assert.rejects(createFinanceRollout({db,env}).db.send(new GetCommand({
    TableName:'wizz-production-OrderConnections',Key:{connectionId:'driver1'},
  })),/FINANCE_ROLLOUT_OUT_OF_SCOPE/);
  assert.equal(calls.length,2);
});
