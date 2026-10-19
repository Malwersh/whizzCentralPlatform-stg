const {test}=require('node:test'),assert=require('node:assert/strict');
const {GetCommand,UpdateCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {createFinanceRollout,readFinanceRollout}=require('../dist/financeRollout');
const {scopeEnv,scopePin}=require('./helpers/finance-rollout-fixture.cjs');
const {quoteHash}=require('../dist/deliveryQuoteRecord');
function fixture({env=scopeEnv(),missing=false}={}){
 const row={PK:'ORDER#order',SK:'META',orderId:'order',storeId:'branch',userSub:'customer',status:'assigned',financeRollout:scopePin(env,'order')},calls=[],transactions=[];
 const raw={async send(c){calls.push(c.input);if(c instanceof GetCommand){if(c.input.TableName==='WizzOrders')return {Item:missing?undefined:structuredClone(row)};return {Item:{operationId:'event',orderId:'order',driverId:'driver'}};}transactions.push(c.input);return {};}};
 const rollout=createFinanceRollout({db:raw,env,now:()=>Date.parse('2026-10-17T00:00:00.000Z')});return {row,raw,calls,transactions,rollout};
}
const rejection=(p,code='FINANCE_ROLLOUT_OUT_OF_SCOPE')=>assert.rejects(p,e=>e.code===code);
test('financial host cursor requires its own enabled server gate and cannot authorize another cursor',async()=>{
 const tx=sk=>new TransactWriteCommand({TransactItems:[{Put:{TableName:'WizzDispatchJobs_staging',Item:{orderId:'SYSTEM#DISPATCH_HOST',SK:sk,kind:'DISPATCH_HOST_CURSOR',version:1}}}]});
 const off=fixture();await rejection(off.rollout.db.send(tx('CURSOR#FINANCIAL')));assert.equal(off.transactions.length,0);
 const on=fixture({env:{...scopeEnv(),DISPATCH_FINANCIAL_HOST_MODE:'REQUIRED'}});await on.rollout.db.send(tx('CURSOR#FINANCIAL'));assert.equal(on.transactions.length,1);
 await rejection(on.rollout.db.send(tx('CURSOR#OTHER')));assert.equal(on.transactions.length,1);
});
test('missing, corrupt, global, wildcard and cross-account configs are rejected before I/O',()=>{
 for(const env of [{}, {...scopeEnv(),FINANCE_ROLLOUT_CONFIG:'invalid'},{...scopeEnv(),AWS_REGION:'other'},{...scopeEnv(),STAGE:'production'},{...scopeEnv(),FINANCE_ROLLOUT_SHA256:'bad'}])assert.throws(()=>createFinanceRollout({db:{send:()=>assert.fail('I/O')},env}),/NOT_CONFIGURED/);
 for(const change of [c=>c.scopes[0].mode='ALL',c=>c.scopes[0].orders[0].orderId='*',c=>c.scopes[0].orders.push(c.scopes[0].orders[0]),c=>c.scopes[0].drivers[0].subjectId='*',c=>c.accountId='other']){
  const env=scopeEnv(),c=JSON.parse(env.FINANCE_ROLLOUT_CONFIG);change(c);env.FINANCE_ROLLOUT_CONFIG=JSON.stringify(c);env.FINANCE_ROLLOUT_SHA256=quoteHash(c);assert.throws(()=>readFinanceRollout(env),/NOT_CONFIGURED/);
 }
});
test('admission requires the exact verified customer/branch pair and explicit order ID',async()=>{
 const f=fixture();assert.throws(()=>f.rollout.admit('foreign','customer'),/OUT_OF_SCOPE/);assert.throws(()=>f.rollout.admit('branch','foreign'),/OUT_OF_SCOPE/);
 f.rollout.admit('branch','customer');await f.rollout.order('order','ADMIT');await rejection(f.rollout.order('foreign'));assert.equal(f.transactions.length,0);
 assert.throws(()=>f.rollout.driver('order','other'),/OUT_OF_SCOPE/);assert.throws(()=>f.rollout.driver('order','driver','other'),/OUT_OF_SCOPE/);f.rollout.driver('order','driver','subject');
});
test('stored customer, conflicting branch aliases or wrong primary key cannot redirect an allowed ID',async()=>{
 for(const change of [r=>r.userSub='other',r=>r.businessId='other',r=>r.storeId='other',r=>r.PK='ORDER#other']){const f=fixture();change(f.row);await rejection(f.rollout.order('order'));assert.equal(f.transactions.length,0);}
});
test('scope identity is merged into the existing order update, preserving one operation per item',async()=>{
 const f=fixture();await f.rollout.order('order');await f.rollout.db.send(new TransactWriteCommand({TransactItems:[{Update:{TableName:'WizzOrders',Key:{PK:'ORDER#order',SK:'META'},UpdateExpression:'SET #s=:s',ConditionExpression:'#s=:old',ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':s':'delivered',':old':'assigned'}}}]}));
 const tx=f.transactions[0];assert.equal(tx.TransactItems.length,1);const u=tx.TransactItems[0].Update;assert.match(u.ConditionExpression,/attribute_not_exists\(#roll3\)/);assert.equal(u.ExpressionAttributeValues[':roll1'],'customer');assert.equal(u.ExpressionAttributeValues[':roll2'],'branch');assert.equal(u.ExpressionAttributeValues[':old'],'assigned');
});
test('event-only financial writes acquire an order fence; cached foreign receipts cannot be written in a catch block',async()=>{
 const f=fixture();await f.rollout.db.send(new GetCommand({TableName:'events',Key:{operationId:'event'},ConsistentRead:true}));
 await f.rollout.db.send(new TransactWriteCommand({TransactItems:[{Update:{TableName:'events',Key:{operationId:'event'},UpdateExpression:'SET #s=:s',ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':s':'done'}}}]}));
 assert.equal(f.transactions[0].TransactItems[1].ConditionCheck.TableName,'WizzOrders');
 await rejection(f.rollout.db.send(new TransactWriteCommand({TransactItems:[{Update:{TableName:'events',Key:{operationId:'unknown'},UpdateExpression:'SET #s=:s'}}]})));
});
test('unbound money, mixed-order writes and plain SDK mutation commands are denied',async()=>{
 const f=fixture();await f.rollout.order('order');
 for(const TransactItems of [[{Put:{TableName:'staging-LedgerEntries',Item:{walletId:'wallet',sk:'entry'}}}],[{Update:{TableName:'WizzOrders',Key:{PK:'ORDER#order',SK:'META'},UpdateExpression:'SET #s=:s'}},{Put:{TableName:'staging-LedgerEntries',Item:{walletId:'wallet',sk:'entry',metadata:{orderId:'foreign'}}}}]])await rejection(f.rollout.db.send(new TransactWriteCommand({TransactItems})));
 await rejection(f.rollout.db.send(new UpdateCommand({TableName:'WizzOrders',Key:{PK:'ORDER#order',SK:'META'},UpdateExpression:'SET #s=:s'})));assert.equal(f.transactions.length,0);
});
test('expiry and DRAIN close admission and sending while preserving existing settlement/return transactions',async()=>{
 for(const env of [scopeEnv({mode:'DRAIN'}),scopeEnv({until:'2026-10-16T00:00:00.000Z'})]){
  const f=fixture({env});assert.throws(()=>f.rollout.admit('branch','customer'),/ADMISSION_CLOSED/);await rejection(f.rollout.order('order','OFFER'),'FINANCE_ROLLOUT_ADMISSION_CLOSED');await f.rollout.order('order','DRAIN');
  await f.rollout.db.send(new TransactWriteCommand({TransactItems:[{Update:{TableName:'WizzOrders',Key:{PK:'ORDER#order',SK:'META'},UpdateExpression:'SET #s=:s',ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':s':'returned'}}}]}));assert.equal(f.transactions.length,1);
 }
});
test('a new order cannot enter after DRAIN even if its ID was reserved before expiry',async()=>{
 const f=fixture({env:scopeEnv({mode:'DRAIN'}),missing:true});f.rollout.customer('branch','customer');
 await rejection(f.rollout.db.send(new TransactWriteCommand({TransactItems:[{Put:{TableName:'WizzOrders',Item:f.row,ConditionExpression:'attribute_not_exists(PK)'}}]})),'FINANCE_ROLLOUT_ADMISSION_CLOSED');assert.equal(f.transactions.length,0);
});
test('a second driver outside the selected order cohort cannot enter a saved wave',async()=>{
 const f=fixture();await f.rollout.order('order');await rejection(f.rollout.db.send(new TransactWriteCommand({TransactItems:[{Put:{TableName:'WizzDispatchJobs_staging',Item:{orderId:'order',SK:'WAVE#1',driverIds:['driver','other']}}}]})));assert.equal(f.transactions.length,0);
});
test('scope configuration is detached and frozen across asynchronous work',async()=>{
 const env=scopeEnv(),f=fixture({env});env.FINANCE_ROLLOUT_CONFIG='invalid';assert.throws(()=>f.rollout.config.scopes[0].orders.push({orderId:'foreign'}));await f.rollout.order('order');assert.equal(f.rollout.containsOrder('foreign'),false);
});

test('initial legacy enrollment pins the scope with its job, while read-only transactions cannot enroll',async()=>{
 const f=fixture();delete f.row.financeRollout;await f.rollout.order('order');
 await rejection(f.rollout.db.send(new TransactWriteCommand({TransactItems:[{ConditionCheck:{TableName:'WizzOrders',Key:{PK:'ORDER#order',SK:'META'},ConditionExpression:'attribute_exists(PK)'}}]})));
 await f.rollout.db.send(new TransactWriteCommand({TransactItems:[{Put:{TableName:'WizzDispatchJobs_staging',Item:{orderId:'order',SK:'METADATA',restaurantId:'branch'},ConditionExpression:'attribute_not_exists(orderId)'}}]}));
 const pinUpdate=f.transactions[0].TransactItems.find(x=>x.Update?.TableName==='WizzOrders').Update;
 assert.match(pinUpdate.ConditionExpression,/attribute_not_exists\(#roll4\)/);assert.equal(pinUpdate.ExpressionAttributeValues[':rollPin'].scopeId,'synthetic-only');
});
test('new order receives the server scope pin; changing membership on another host cannot adopt it',async()=>{
 const f=fixture({missing:true});delete f.row.financeRollout;
 await f.rollout.db.send(new TransactWriteCommand({TransactItems:[{Put:{TableName:'WizzOrders',Item:f.row,ConditionExpression:'attribute_not_exists(PK)'}}]}));
 const saved=f.transactions[0].TransactItems[0].Put.Item;assert.equal(saved.financeRollout.scopeId,'synthetic-only');
 const env=scopeEnv({drivers:[{driverId:'replacement',subjectId:'replacement-subject'}]}),other=createFinanceRollout({env,db:{async send(){return {Item:saved};}}});
 await rejection(other.order('order'));assert.equal(f.row.financeRollout,undefined);
});
test('sending requires a durable enrollment, even when the operator listed an existing order',async()=>{
 const f=fixture();delete f.row.financeRollout;await rejection(f.rollout.order('order','SEND'));await rejection(f.rollout.order('order','NOTIFY'));assert.equal(f.transactions.length,0);
});
test('DRAIN forbids new wave records without blocking expiry of existing work',async()=>{
 const f=fixture({env:scopeEnv({mode:'DRAIN'})});await f.rollout.order('order');
 await rejection(f.rollout.db.send(new TransactWriteCommand({TransactItems:[{Put:{TableName:'WizzDispatchJobs_staging',Item:{orderId:'order',SK:'WAVE#1',kind:'DISPATCH_WAVE',driverIds:['driver']}}}]})),'FINANCE_ROLLOUT_ADMISSION_CLOSED');
});
test('candidate filtering preserves an empty page continuation instead of selecting a foreign driver',async()=>{
 const sdk=require('@aws-sdk/lib-dynamodb'),env=scopeEnv();
 const db={async send(c){return c instanceof GetCommand?{Item:{PK:'ORDER#order',SK:'META',orderId:'order',storeId:'branch',userSub:'customer',financeRollout:scopePin(env,'order')}}:{Items:[{driverId:'other'}],LastEvaluatedKey:{driverId:'other'}};}};
 const r=createFinanceRollout({db,env});await r.order('order');const page=await r.db.send(new sdk.QueryCommand({TableName:'WizzDriverLiveState_staging'}));assert.deepEqual(page.Items,[]);assert.deepEqual(page.LastEvaluatedKey,{driverId:'other'});
});

test('separate SDK copy and renamed classes retain scope checks; plain input objects cannot impersonate a command',async()=>{
 const other=require('../../../node_modules/@aws-sdk/lib-dynamodb');
 class BundledRenamedGet extends other.GetCommand{}
 const env=scopeEnv(),row={PK:'ORDER#order',SK:'META',orderId:'order',storeId:'branch',userSub:'customer',financeRollout:scopePin(env,'order')};let reads=0;
 const r=createFinanceRollout({env,db:{async send(){reads++;return {Item:row};}}});
 await r.db.send(new BundledRenamedGet({TableName:'WizzOrders',Key:{PK:'ORDER#order',SK:'META'},ConsistentRead:true}));assert.equal(reads,1);
 await rejection(r.db.send({input:{TableName:'WizzOrders'},clientCommand:{schema:[9,'com.amazonaws.dynamodb','GetItem']}}));
});

test('a foreign queued event stays immutable even if a consumer catches its denied read',async()=>{
 const env=scopeEnv(),writes=[];
 const r=createFinanceRollout({env,db:{async send(c){if(c instanceof GetCommand)return {Item:{operationId:'foreign-event',orderId:'foreign'}};writes.push(c);return {};}}});
 await rejection(r.db.send(new GetCommand({TableName:'events',Key:{operationId:'foreign-event'},ConsistentRead:true})));
 await rejection(r.db.send(new TransactWriteCommand({TransactItems:[{Update:{TableName:'events',Key:{operationId:'foreign-event'},UpdateExpression:'SET #s=:s'}}]})));assert.equal(writes.length,0);
});
test('the actual minified guard bundle accepts the other SDK representation without relying on class names',async()=>{
 const path=require('node:path'),Module=require('node:module');
 const code=require('esbuild').buildSync({entryPoints:[path.resolve(__dirname,'../src/financeRollout.ts')],platform:'node',target:'node20',bundle:true,minify:true,write:false,logLevel:'silent'}).outputFiles[0].text;
 const compiled=new Module('/private/tmp/finance53-minified.cjs');compiled.filename='/private/tmp/finance53-minified.cjs';compiled.paths=Module._nodeModulePaths(process.cwd());compiled._compile(code,compiled.filename);
 const env=scopeEnv(),row={PK:'ORDER#order',SK:'META',orderId:'order',storeId:'branch',userSub:'customer',financeRollout:scopePin(env,'order')};let reads=0;
 const r=compiled.exports.createFinanceRollout({env,db:{async send(){reads++;return {Item:row};}}});await r.db.send(new GetCommand({TableName:'WizzOrders',Key:{PK:row.PK,SK:'META'},ConsistentRead:true}));assert.equal(reads,1);
});
