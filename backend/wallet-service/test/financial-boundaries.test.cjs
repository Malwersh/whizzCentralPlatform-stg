const test=require('node:test'),assert=require('node:assert/strict');
const {handler}=require('../dist/index');
const {docClient}=require('../dist/db');
const {validateAmount}=require('../dist/utils');
const event=(path,method,authorizer)=>({path,httpMethod:method,body:'{}',requestContext:{authorizer}});
test('driver cannot read another wallet or create platform wallet even without gateway enforcement',async()=>{
 docClient.send=async()=>{throw Error('forbidden request reached database');};
 for(const [path,method] of [['/wallet/WALLET#DRIVER#other','GET'],['/wallet/platform','GET'],['/wallet/platform/create','POST'],['/wallet/settlement/order/other','GET']]){
  assert.equal((await handler(event(path,method,{driverId:'driver'}))).statusCode,403);
 }
});
test('legacy settlement refuses a second debit for both service and finance callers',async()=>{
 docClient.send=async()=>{throw Error('second debit reached database');};
 for(const actor of [{serviceId:'service'},{adminId:'finance',financeManager:true}]){
  const r=await handler(event('/wallet/settlement/settle','POST',actor));
  assert.equal(r.statusCode,409);assert.match(r.body,/LEGACY_SETTLEMENT_DISABLED/);
 }
});
test('monetary amounts reject unsafe, nonpositive and fractional numbers',()=>{
 for(const amount of [0,-1,1.5,Infinity,NaN,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>validateAmount(amount));
 validateAmount(25000);
});
test('wallet inventory requires finance role and preserves pagination without leaking notes',async()=>{
 const denied=await handler(event('/wallet/funding/admin/wallets','GET',{adminId:'ordinary'}));assert.equal(denied.statusCode,403);
 let query;docClient.send=async c=>{query=c.input;return {Items:[],LastEvaluatedKey:{walletId:'next',sk:'META'}};};
 const r=await handler(event('/wallet/funding/admin/wallets','GET',{adminId:'finance',financeManager:true}));
 assert.equal(r.statusCode,200);assert.equal(query.Limit,50);assert.ok(!query.ProjectionExpression.includes('notes'));
 const data=JSON.parse(r.body);assert.deepEqual(JSON.parse(Buffer.from(data.nextCursor,'base64url').toString()),{walletId:'next',sk:'META'});
});
test('capture rejects zero, negative, fractional and unsafe amounts before financial writes',async()=>{
 const {HoldService}=require('../dist/holdService');
 docClient.send=async c=>{assert.equal(c.constructor.name,'QueryCommand');return {Items:[{status:'ACTIVE',amount:25000,walletId:'wallet',orderId:'order'}]};};
 for(const actualAmount of [0,-100,0.5,Number.MAX_SAFE_INTEGER+1])await assert.rejects(()=>new HoldService().captureHold({holdId:'hold',actualAmount}));
});
test('ledger endpoint rejects ordinary admin and cross-wallet continuation before database access',async()=>{
 docClient.send=async()=>{throw Error('invalid request reached database');};
 const walletId='WALLET#DRIVER#5458d478-90e1-7098-07fb-7a1c308ea5a2';
 let e=event('/wallet/funding/admin/transactions','GET',{adminId:'ordinary'});e.queryStringParameters={walletId};assert.equal((await handler(e)).statusCode,403);
 e=event('/wallet/funding/admin/transactions','GET',{adminId:'finance',financeManager:true});e.queryStringParameters={walletId,cursor:JSON.stringify({walletId:'other',sk:'ts#1'})};assert.equal((await handler(e)).statusCode,400);
});
