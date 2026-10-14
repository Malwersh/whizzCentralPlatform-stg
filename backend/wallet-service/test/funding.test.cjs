const test=require('node:test');const assert=require('node:assert/strict');
const {docClient}=require('../dist/db');
const {TopupService}=require('../dist/topupService');
const funding=require('../dist/fundingService');
const service=new TopupService();
const request={driverId:'driver-id',amount:25000,method:'MANUAL_VERIFICATION',evidenceRef:'receipts/driver-id/uuid.jpg',transferReference:'REF1234',idempotencyKey:'12345678-1234-1234-1234-123456789012'};
test('manual topups reject low amounts, missing evidence, invalid method and missing retry key',async()=>{
 for(const change of [{amount:24999},{amount:25000.1},{evidenceRef:undefined},{method:'CASH_AGENT'},{idempotencyKey:undefined},{transferReference:undefined}]) await assert.rejects(()=>service.createTopupRequest({...request,...change}));
});
test('retry returns the original request and prevents changes under the same key',async()=>{
 docClient.send=async()=>({Item:{result:{topupRequest:request,success:true}}});
 assert.equal((await service.createTopupRequest(request)).success,true);
 await assert.rejects(()=>service.createTopupRequest({...request,amount:30000}),/بيانات مختلفة/);
});
test('new request reserves transfer reference and receipt atomically without increasing balance',async()=>{
 let transaction;let reads=0;
 docClient.send=async command=>{
  if(command.constructor.name==='GetCommand')return ++reads===1?{}:{Item:{walletId:'WALLET#DRIVER#driver-id',status:'ACTIVE',version:1}};
  transaction=command.input;return {};
 };
 const result=await service.createTopupRequest(request);
 assert.equal(result.topupRequest.status,'PENDING');
 const items=transaction.TransactItems;
 assert.equal(items.filter(x=>x.Put?.TableName.includes('Idempotency')).length,3);
 const fence=items.find(x=>x.Update?.Key.walletId).Update;
 assert.match(fence.ConditionExpression,/attribute_not_exists\(deletionRequestId\)/);
 assert.equal(fence.UpdateExpression,'SET #v = #v + :one');
 assert.equal(fence.UpdateExpression.includes('availableBalance'),false);
});
test('configuration cannot enable payment providers before integration',async()=>{
 let write;
 docClient.send=async command=>command.constructor.name==='GetCommand'?{}:(write=command.input,{});
 const result=await funding.saveFundingConfig({version:0,manual:{phone:'07800868280',name:'اسم المستلم',enabled:true},card:{enabled:true},zaincash:{enabled:true}},'admin');
 assert.equal(result.card.enabled,false);assert.equal(result.zaincash.enabled,false);assert.equal(result.manual.minimum,25000);
 assert.equal(write.TransactItems.length,2);
});
test('finance endpoints reject ordinary admins and drivers before accessing the database', async()=>{
 const {handler}=require('../dist/index');
 for(const authorizer of [{adminId:'admin'},{driverId:'driver',financeManager:'true'},{}]){
  const result=await handler({path:'/wallet/topup/requests',httpMethod:'GET',requestContext:{authorizer}});
  assert.equal(result.statusCode,403);
 }
});
test('receipt upload rejects oversized or non-image uploads before calling S3',async()=>{
 await assert.rejects(()=>funding.receiptUpload('driver',{contentType:'application/pdf',size:100}),/JPG/);
 await assert.rejects(()=>funding.receiptUpload('driver',{contentType:'image/jpeg',size:5*1024*1024}),/ميجابايت/);
});
test('approval atomically records credit, ledger, status, retry key and daily limit with wallet version guards',async()=>{
 let tx;
 docClient.send=async command=>{
  if(command.constructor.name==='TransactWriteCommand'){tx=command.input;return {};}
  const key=command.input.Key;
  if(key?.topupId)return {Item:{...request,topupId:'topup',walletId:'WALLET#DRIVER#driver-id',createdById:'driver-id',status:'PENDING'}};
  if(key?.walletId)return {Item:{walletId:key.walletId,availableBalance:0,version:1,status:'ACTIVE'}};
  return {};
 };
 const result=await service.approveTopupRequest({topupId:'topup',approvedById:'manager',approvedByRole:'finance_manager'});
 assert.equal(result.newBalance,25000);
 const items=tx.TransactItems;
 const wallets=items.filter(x=>x.Update?.TableName===require('../dist/db').TABLES.WALLETS);
 assert.equal(wallets.length,2);
 for(const w of wallets)assert.match(w.Update.ConditionExpression,/#version = :expectedVersion/);
 const driverWallet=wallets.find(w=>w.Update.Key.walletId==='WALLET#DRIVER#driver-id').Update;
 assert.match(driverWallet.ConditionExpression,/#s = :active AND attribute_not_exists\(deletionRequestId\)/);
 assert.equal(items.filter(x=>x.Put?.TableName===require('../dist/db').TABLES.LEDGER).length,2);
 assert.match(items.find(x=>x.Update?.Key.idempotencyKey?.startsWith('FINANCE_DAILY#')).Update.ConditionExpression,/approvedAmount <= :remaining/);
 assert.equal(items.find(x=>x.Put?.Item.eventId)?.Put.Item.type,'wallet_topup_approved');
 assert.equal(items.find(x=>x.Update?.Key.topupId).Update.ExpressionAttributeValues[':pending'],'PENDING');
});
test('approved, rejected and self-created requests cannot be credited',async()=>{
 for(const change of [{status:'APPROVED'},{status:'REJECTED'},{createdById:'manager'}]){
  docClient.send=async command=>command.input.Key?.topupId?{Item:{...request,status:'PENDING',createdById:'driver-id',...change}}:{};
  await assert.rejects(()=>service.approveTopupRequest({topupId:'topup',approvedById:'manager',approvedByRole:'finance_manager'}));
 }
});
test('closing or closed driver wallet cannot be credited by a finance approval',async()=>{
 for(const status of ['SUSPENDED','CLOSED']){
  let wrote=false;
  docClient.send=async c=>{if(c.constructor.name==='TransactWriteCommand'){wrote=true;return {};}
   if(c.input.Key?.topupId)return {Item:{...request,topupId:'topup',walletId:'WALLET#DRIVER#driver-id',createdById:'driver-id',status:'PENDING'}};
   if(c.input.Key?.walletId)return {Item:{walletId:c.input.Key.walletId,status,availableBalance:0,version:1}};return {};
  };
  await assert.rejects(()=>service.approveTopupRequest({topupId:'topup',approvedById:'manager',approvedByRole:'finance_manager'}),e=>e.code==='ACCOUNT_CLOSING');
  assert.equal(wrote,false);
 }
});
test('topup creation rejects a wallet with a deletion marker before storing an intent',async()=>{
 let wrote=false;
 docClient.send=async c=>{if(c.constructor.name==='TransactWriteCommand'){wrote=true;return {};}return c.input.Key?.walletId?{Item:{walletId:c.input.Key.walletId,status:'ACTIVE',version:1,deletionRequestId:'request'}}:{};};
 await assert.rejects(()=>service.createTopupRequest(request),e=>e.code==='ACCOUNT_CLOSING');assert.equal(wrote,false);
});
