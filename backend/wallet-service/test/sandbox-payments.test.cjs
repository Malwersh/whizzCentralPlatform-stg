const test=require('node:test');const assert=require('node:assert/strict');
process.env.ENVIRONMENT='staging';process.env.SANDBOX_PAYMENTS_TABLE='staging-SandboxPayments';process.env.WALLET_NOTIFICATIONS_TABLE='staging-WalletNotifications';
const {docClient}=require('../dist/db');const payments=require('../dist/sandboxPayments');
const driver='34d8e408-1021-7076-6055-7325644f97cb';const id='00000000-0000-4000-8000-000000000001';
const config={driverIds:[driver],zaincash:true,qi:true};
const payment={pk:`DRIVER#${driver}`,sk:`PAYMENT#${id}`,driverId:driver,requestId:id,provider:'qi',amount:25000,paymentId:'provider-id',state:'PENDING'};
function reads(command){if(command.input.Key?.pk==='SETTINGS')return {Item:config};return {Item:payment};}
test('server denies sandbox access for ordinary drivers and production',async()=>{
 docClient.send=async c=>reads(c);
 await assert.rejects(()=>payments.sandboxOverview('another-driver'),e=>e.statusCode===403);
 process.env.ENVIRONMENT='production';await assert.rejects(()=>payments.sandboxOverview(driver));process.env.ENVIRONMENT='staging';
});
test('retries preserve session and reject changed amount without provider creation',async()=>{
 docClient.send=async c=>reads(c);
 payments.adapters.create=async()=>{throw Error('must not create twice');};
 assert.equal((await payments.createSandboxPayment(driver,{provider:'qi',amount:25000,requestId:id})).paymentId,'provider-id');
 await assert.rejects(()=>payments.createSandboxPayment(driver,{provider:'qi',amount:30000,requestId:id}),e=>e.statusCode===409);
});
test('forged amount or reference cannot settle',async()=>{
 let writes=0;docClient.send=async c=>{if(c.constructor.name==='GetCommand')return reads(c);writes++;return {};};
 for(const change of [{amount:30000},{requestId:'other'},{currency:'USD'},{paymentId:'other'}]){
  payments.adapters.inquire=async()=>({paymentId:'provider-id',requestId:id,amount:25000,currency:'IQD',status:'SUCCESS',...change});
  await assert.rejects(()=>payments.checkSandboxPayment(driver,id),e=>e.code==='PAYMENT_MISMATCH');
 }
 assert.equal(writes,0);
});
test('confirmed payment atomically credits isolated balance and balanced test ledger only',async()=>{
 let transaction;docClient.send=async c=>{if(c.constructor.name==='GetCommand')return reads(c);transaction=c.input;return {};};
 payments.adapters.inquire=async()=>({paymentId:'provider-id',requestId:id,amount:25000,currency:'IQD',status:'SUCCESS'});
 assert.equal((await payments.checkSandboxPayment(driver,id)).state,'SUCCESS');
 const items=transaction.TransactItems;
 assert.ok(items.every(i=>(i.Put||i.Update).TableName==='staging-SandboxPayments'||i.Put?.TableName==='staging-WalletNotifications'));
 assert.equal(items.filter(i=>i.Put?.Item.sk?.startsWith('LEDGER#')).reduce((sum,i)=>sum+i.Put.Item.amount,0),0);
 assert.equal(items.find(i=>i.Update?.Key.sk==='BALANCE').Update.ExpressionAttributeValues[':amount'],25000);
 assert.equal(items.find(i=>i.Put?.Item.eventId).Put.Item.type,'wallet_sandbox_payment_succeeded');
});
test('settled retry never inquires or credits again',async()=>{
 docClient.send=async c=>c.input.Key.pk==='SETTINGS'?{Item:config}:{Item:{...payment,state:'SUCCESS'}};
 payments.adapters.inquire=async()=>{throw Error('must not call');};
 assert.equal((await payments.checkSandboxPayment(driver,id)).state,'SUCCESS');
});

test('an uncertain creation is retained and client retry cannot call the provider twice',async()=>{
 let stored;let creates=0;
 docClient.send=async command=>{
  const {Key}=command.input;
  if(command.constructor.name==='GetCommand')return Key.pk==='SETTINGS'?{Item:config}:{Item:stored};
  if(command.constructor.name==='PutCommand'){stored=command.input.Item;return {};}
  if(command.constructor.name==='UpdateCommand'){stored={...stored,state:'CREATION_UNCERTAIN'};return {};}
  throw Error('unexpected write');
 };
 payments.adapters.create=async()=>{creates++;throw Error('provider timeout');};
 const input={provider:'qi',amount:25000,requestId:id};
 await assert.rejects(()=>payments.createSandboxPayment(driver,input),/provider timeout/);
 assert.equal((await payments.createSandboxPayment(driver,input)).state,'CREATION_UNCERTAIN');
 assert.equal(creates,1);
});
test('another transaction settling concurrently returns the already-confirmed record',async()=>{
 let settled=false;
 docClient.send=async command=>{
  if(command.constructor.name==='GetCommand')return command.input.Key.pk==='SETTINGS'?{Item:config}:{Item:{...payment,state:settled?'SUCCESS':'PENDING'}};
  settled=true;const error=Error('conditional conflict');error.name='TransactionCanceledException';throw error;
 };
 payments.adapters.inquire=async()=>({paymentId:'provider-id',requestId:id,amount:25000,currency:'IQD',status:'SUCCESS'});
 assert.equal((await payments.checkSandboxPayment(driver,id)).state,'SUCCESS');
});
test('a spoofed callback SUCCESS cannot settle while authenticated inquiry is pending',async()=>{
 const pid='11111111-1111-4111-8111-111111111111';let settled=false;
 docClient.send=async command=>{
  if(command.constructor.name==='TransactWriteCommand'){settled=true;return {};}
  if(command.constructor.name==='UpdateCommand')return {};
  if(command.input.Key.pk==='SETTINGS')return {Item:config};
  if(command.input.Key.pk==='PROVIDER_LOOKUP#qi')return {Item:{driverId:driver,requestId:id}};
  return {Item:{...payment,paymentId:pid}};
 };
 payments.adapters.inquire=async()=>({paymentId:pid,requestId:id,amount:25000,currency:'IQD',status:'CREATED'});
 await payments.sandboxNotification({paymentId:pid,status:'SUCCESS',amount:999999,driverId:'forged'});
 assert.equal(settled,false);
});
test('unknown callback payment is acknowledged without provider requests',async()=>{
 docClient.send=async()=>({});payments.adapters.inquire=async()=>{throw Error('must not call');};
 assert.equal((await payments.sandboxNotification({paymentId:'11111111-1111-4111-8111-111111111111'})).accepted,true);
});
