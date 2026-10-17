const test=require('node:test'),assert=require('node:assert/strict');
const {createWorker}=require(process.env.NOTIFICATION_WORKER_FILE||'../notification-worker');
process.env.WALLET_NOTIFICATIONS_TABLE='events';process.env.PUSH_TOKENS_TABLE='tokens';
const item=()=>({eventId:'TOPUP#APPROVED',driverId:'driver',topupId:'TOPUP',type:'wallet_topup_approved',amount:50000,title:'Approved',body:'Balance updated',createdAt:new Date(1700000000000).toISOString(),attempts:1});
function fixture(records,{failure,delivered=[]}={}){
 const writes=[],sends=[];
 const client={send:async command=>{
  const input=command.input;writes.push(input);
  if(command.constructor.name==='UpdateCommand' && input.ReturnValues)return {Attributes:{...item(),deliveredTokenHashes:new Set(delivered)}};
  if(command.constructor.name==='QueryCommand')return {Items:records};
  return {};
 }};
 const worker=createWorker(client,async()=>({send:async message=>{sends.push(message);if(failure)throw failure;}}),()=>1700000000000);
 return {worker,writes,sends};
}
test('only driver devices receive wallet data; completed tokens are persisted before marking SENT',async()=>{
 const f=fixture([{app:'driver',token:'driver-token'},{app:'merchant',token:'other-token'}]);
 await f.worker.processEvent('event');assert.equal(f.sends.length,1);assert.equal(f.sends[0].data.action,'open_wallet');
 assert.equal(f.writes.filter(x=>x.UpdateExpression?.includes('ADD deliveredTokenHashes')).length,1);
 assert.equal(f.writes.at(-1).ExpressionAttributeValues[':status'],'SENT');
});
test('no registered device and transient errors schedule a retry without losing inbox data',async()=>{
 for(const f of [fixture([]),fixture([{app:'driver',token:'token'}],{failure:{code:'messaging/server-unavailable'}})]){
  await f.worker.processEvent('event');assert.equal(f.writes.at(-1).ExpressionAttributeValues[':status'],'PENDING');assert.ok(f.writes.at(-1).ExpressionAttributeValues[':next']>1700000000);
 }
});
test('successful tokens are not sent again on retry',async()=>{
 const hash=require('crypto').createHash('sha256').update('token').digest('hex');
 const f=fixture([{app:'driver',token:'token'}],{delivered:[hash]});await f.worker.processEvent('event');assert.equal(f.sends.length,0);assert.equal(f.writes.at(-1).ExpressionAttributeValues[':status'],'SENT');
});
test('invalid device tokens are removed; finance event remains in the inbox',async()=>{
 const f=fixture([{app:'driver',token:'token'}],{failure:{code:'messaging/registration-token-not-registered'}});await f.worker.processEvent('event');assert.ok(f.writes.some(x=>x.TableName==='tokens' && x.Key?.token==='token'));assert.equal(f.writes.at(-1).ExpressionAttributeValues[':status'],'UNDELIVERABLE');
});
test('a competing lease prevents a second sender',async()=>{
 let calls=0;const worker=createWorker({send:async()=>{throw {name:'ConditionalCheckFailedException'};}},async()=>{calls++;});await worker.processEvent('event');assert.equal(calls,0);
});
test('rejection creates a separate deterministic notification without crediting the wallet',async()=>{
 const {walletNotification}=require('../dist/walletNotifications');const result=walletNotification({...item(),topupId:'TOPUP'},'REJECTED',new Date().toISOString());assert.equal(result.Put.Item.eventId,'TOPUP#REJECTED');assert.equal(result.Put.Item.deliveryStatus,'PENDING');assert.equal(result.Put.ConditionExpression,'attribute_not_exists(eventId)');
});
function codFixture({orderId='order',mode='REQUIRED',deleted=false,changed=false,tombstone=false,readFailure=false,deleteBeforeSend=false}={}){
 const writes=[],sends=[];let driverReads=0;
 const notice={orderId,eventId:'COD_EVENT:synthetic',driverId:'subject1',financialDriverId:'driver1',financialSubjectId:'subject1',branchId:'branch1',recipientApp:'driver',type:'wallet_cod_lifecycle',title:'تحديث المحفظة',body:'افتح المحفظة',createdAt:new Date(1700000000000).toISOString(),attempts:1};
 const client={async send(c){const q=c.input;writes.push(q);
  if(c.constructor.name==='UpdateCommand'&&q.ReturnValues)return {Attributes:notice};
  if(c.constructor.name==='QueryCommand')return {Items:[{app:'driver',token:'own-token'},{app:'merchant',token:'other-token'}]};
  if(c.constructor.name==='GetCommand'){
   assert.equal(q.ConsistentRead,true);if(readFailure)throw Error('read unavailable');
   if(q.TableName===process.env.WALLET_NOTIFICATIONS_TABLE)return {Item:notice};
   if(q.TableName==='WizzOrders')return {Item:{PK:'ORDER#order',SK:'META',orderId:'order',storeId:'branch1',userSub:'customer',financeRollout:require('./helpers/finance-rollout-fixture.cjs').scopePin(process.env,'order')}};
   if(q.TableName==='WhizzDrivers_staging'){driverReads++;return {Item:{driverId:'driver1',cognitoSub:changed?'foreign':'subject1',isDeleted:deleted||deleteBeforeSend&&driverReads>1}};}
   return tombstone?{Item:{pk:q.Key.pk}}:{};
  }
  return {};
 }};
 return {writes,sends,mode,worker:createWorker(client,async()=>({send:async m=>sends.push(m)}),()=>1700000000000)};
}
async function runCod(options={}){const old={...process.env};try{Object.assign(process.env,{...require('./helpers/finance-rollout-fixture.cjs').scopeEnv({orders:[{orderId:'order',branchId:'branch1',customerSubjectId:'customer'}],drivers:[{driverId:'driver1',subjectId:'subject1'}]}),FINANCIAL_COD_NOTIFICATIONS_MODE:options.mode??'REQUIRED',STAGE:options.stage??'staging',AWS_REGION:options.region??'us-east-1',FINANCIAL_COD_ACCOUNT_ID:options.account??'699561669180'});const f=codFixture(options);try{await f.worker.processEvent('COD_EVENT:synthetic');}catch(e){f.error=e;}return f;}finally{process.env=old;}}
test('COD notice has stable event identity, routes only to driver and does not invent a zero amount',async()=>{
 const f=await runCod();assert.equal(f.sends.length,1);assert.equal(f.sends[0].token,'own-token');assert.equal(f.sends[0].data.eventId,'COD_EVENT:synthetic');assert.equal(f.sends[0].data.amount,'');assert.equal(f.sends[0].data.action,'open_wallet');assert.equal(f.writes.at(-1).ExpressionAttributeValues[':status'],'SENT');
});
test('COD push is suppressed after deletion, changed identity or a lifecycle deletion marker',async()=>{
 for(const options of [{deleted:true},{changed:true},{tombstone:true},{deleteBeforeSend:true}]){const f=await runCod(options);assert.equal(f.sends.length,0);assert.equal(f.writes.at(-1).ExpressionAttributeValues[':status'],'SUPPRESSED');}
});
test('disabled COD notices and unavailable authorization reads stay retryable without contacting FCM',async()=>{
 for(const options of [{mode:'OFF'},{readFailure:true}]){const f=await runCod(options);assert.equal(f.sends.length,0);if(options.readFailure){assert.ok(f.error);assert.ok(!f.writes.some(x=>x.UpdateExpression));}else assert.equal(f.writes.at(-1).ExpressionAttributeValues[':status'],'PENDING');}
});

test('COD push cannot run with a foreign account, region or production stage even if its mode is REQUIRED',async()=>{
 for(const options of [{stage:'production'},{region:'us-east-2'},{account:'000000000000'}]){const f=await runCod(options);assert.equal(f.sends.length,0);if(options.account)assert.equal(f.writes.at(-1).ExpressionAttributeValues[':status'],'PENDING');else{assert.ok(f.error);assert.ok(!f.writes.some(x=>x.UpdateExpression));}}
});
async function dispatchNotice({mode='REQUIRED',deleted=false,marker=false}={}){const prior={...process.env},writes=[],sends=[];try{Object.assign(process.env,{...require('./helpers/finance-rollout-fixture.cjs').scopeEnv(),DISPATCH_RESPONSE_NOTIFICATIONS_MODE:mode,FINANCIAL_COD_NOTIFICATIONS_MODE:'OFF',STAGE:'staging',AWS_REGION:'us-east-1',FINANCIAL_COD_ACCOUNT_ID:'699561669180'});const notice={eventId:'DISPATCH_NOTICE:synthetic',type:'dispatch_offer_closed',recipientApp:'driver',driverId:'subject',dispatchDriverId:'driver',dispatchSubjectId:'subject',branchId:'branch',orderId:'order',offerId:'offer',cycleId:'cycle',responseOperationId:'DR:'+'a'.repeat(48)+':EVENT',dispatchNoticeExpiresAt:new Date(1700000060000).toISOString(),title:'انتهى العرض',body:'حدّث العروض',createdAt:new Date(1700000000000).toISOString(),attempts:1};const client={async send(c){const q=c.input;writes.push(q);if(c.constructor.name==='UpdateCommand'&&q.ReturnValues)return {Attributes:notice};if(c.constructor.name==='QueryCommand')return {Items:[{app:'driver',token:'own'},{app:'merchant',token:'foreign'}]};if(c.constructor.name==='GetCommand')return q.TableName===process.env.WALLET_NOTIFICATIONS_TABLE?{Item:notice}:q.TableName==='WizzOrders'?{Item:{PK:'ORDER#order',SK:'META',orderId:'order',storeId:'branch',userSub:'customer',financeRollout:require('./helpers/finance-rollout-fixture.cjs').scopePin(process.env,'order')}}:q.TableName==='WhizzDrivers_staging'?{Item:{driverId:'driver',cognitoSub:'subject',isDeleted:deleted}}:marker?{Item:{pk:q.Key.pk}}:{};return {};}};await createWorker(client,async()=>({send:async m=>sends.push(m)}),()=>1700000000000).processEvent(notice.eventId);return {writes,sends};}finally{process.env=prior;}}
test('dispatch closure uses existing sender with stable remove-offer event and no money payload',async()=>{const f=await dispatchNotice();assert.equal(f.sends.length,1);assert.equal(f.sends[0].data.type,'offer_taken');assert.equal(f.sends[0].data.action,'remove_offer');assert.equal(f.sends[0].data.offerId,'offer');assert.equal(f.sends[0].data.amount,undefined);assert.equal(f.sends[0].data.eventId,'DISPATCH_NOTICE:synthetic');assert.equal(f.writes.at(-1).ExpressionAttributeValues[':status'],'SENT');});
test('dispatch notice gate is independent from COD and deletion suppresses delivery',async()=>{const off=await dispatchNotice({mode:'OFF'});assert.equal(off.sends.length,0);assert.equal(off.writes.at(-1).ExpressionAttributeValues[':status'],'PENDING');for(const option of [{deleted:true},{marker:true}]){const f=await dispatchNotice(option);assert.equal(f.sends.length,0);assert.equal(f.writes.at(-1).ExpressionAttributeValues[':status'],'SUPPRESSED');}});

test('a notice for an order outside the cohort is skipped before taking a lease or contacting the provider',async()=>{const f=await runCod({orderId:'foreign'});assert.equal(f.sends.length,0);assert.equal(f.error,undefined);assert.ok(!f.writes.some(q=>q.UpdateExpression));});
