const test = require('node:test');
const assert = require('node:assert/strict');
const { walletBindings } = require('../dist/walletBindings');
const fields = ['WALLETS_TABLE','LEDGER_TABLE','HOLDS_TABLE','TOPUP_REQUESTS_TABLE','AUDIT_LOG_TABLE','IDEMPOTENCY_KEYS_TABLE'];
function configured() {
 const env = { ENVIRONMENT:'production', AWS_REGION:'us-east-1' };
 for (const field of fields) env[field] = 'wizz-production-' + field;
 return env;
}
test('development defaults and region remain unchanged', () => {
 const b = walletBindings({}); assert.equal(b.tables.WALLETS,'dev-Wallets'); assert.equal(b.region,'me-south-1');
});
test('staging explicit bindings remain unchanged', () => {
 const env={ENVIRONMENT:'staging', AWS_REGION:'us-east-1', WALLETS_TABLE:'staging-Wallets'};
 assert.equal(walletBindings(env).tables.WALLETS,'staging-Wallets');
});
test('production requires each financial table', () => {
 for(const field of fields) {const env=configured(); delete env[field]; assert.throws(()=>walletBindings(env), /WALLET_BINDING_NOT_CONFIGURED/);}
});
test('production rejects staging, legacy, whitespace and missing-value strings', () => {
 for(const value of ['staging-Wallets','dev-Wallets','null','undefined',' wizz-production-Wallets',''])
 assert.throws(()=>walletBindings({...configured(),WALLETS_TABLE:value}));
});
test('production cannot share a table between financial roles', () => {
 const env=configured(); env.LEDGER_TABLE=env.WALLETS_TABLE; assert.throws(()=>walletBindings(env), /DISTINCT_FINANCIAL_TABLES/);
});
test('either environment variable enforces production isolation', () => {
 const env=configured(); delete env.ENVIRONMENT; env.PLATFORM_ENVIRONMENT='production';
 assert.equal(walletBindings(env).tables.WALLETS, env.WALLETS_TABLE);
 assert.throws(()=>walletBindings({...env,ENVIRONMENT:'staging'}), /ENVIRONMENT_CONFLICT/);
});
test('production requires the deployment region', () => {
 for(const region of [undefined,'me-south-1']) assert.throws(()=>walletBindings({...configured(),AWS_REGION:region}), /AWS_REGION/);
});
test('prod alias uses explicit production bindings', () => {
 const env={...configured(),ENVIRONMENT:'prod'}; assert.equal(walletBindings(env).tables.HOLDS,env.HOLDS_TABLE);
});
const {merchantFinancialBindings}=require('../dist/walletBindings');
const {walletOrderTable}=require('../dist/walletBindings');
test('order condition retains the staging binding and legacy non-production default',()=>{
 assert.equal(walletOrderTable({}),'WizzOrders');
 assert.equal(walletOrderTable({ENVIRONMENT:'staging',ORDERS_TABLE:'WizzOrders_staging'}),'WizzOrders_staging');
});
test('production order condition requires an isolated explicit order table',()=>{
 assert.equal(walletOrderTable({...configured(),ORDERS_TABLE:'wizz-production-Orders'}),'wizz-production-Orders');
 for(const value of [undefined,'','WizzOrders','WizzOrders_staging','staging-Orders',configured().HOLDS_TABLE]) {
  assert.throws(()=>walletOrderTable({...configured(),ORDERS_TABLE:value}), /ORDERS_TABLE/);
 }
});
test('owner verification retains staging stores',()=>{
 assert.deepEqual(merchantFinancialBindings({ENVIRONMENT:'staging'}),{merchants:'WhizzMerchants_Businesses',deletion:'staging-AccountDeletion',sessions:'staging-MerchantPlatform'});
});
test('production owner verification requires all three isolated stores',()=>{
 const env={...configured(),MERCHANTS_TABLE:'wizz-production-Merchants',ACCOUNT_DELETION_TABLE:'wizz-production-AccountDeletion',MERCHANT_PLATFORM_TABLE:'wizz-production-MerchantPlatform'};
 assert.equal(merchantFinancialBindings(env).sessions,env.MERCHANT_PLATFORM_TABLE);
 for(const field of ['MERCHANTS_TABLE','ACCOUNT_DELETION_TABLE','MERCHANT_PLATFORM_TABLE']){
  const missing={...env};delete missing[field];assert.throws(()=>merchantFinancialBindings(missing));
  assert.throws(()=>merchantFinancialBindings({...env,[field]:'staging-MerchantPlatform'}));
 }
 assert.throws(()=>merchantFinancialBindings({...env,MERCHANT_PLATFORM_TABLE:env.MERCHANTS_TABLE}));
});
const {walletLifecycleTable}=require('../dist/walletBindings');
test('non-production lifecycle remains optional and preserves its configured table',()=>{
 assert.equal(walletLifecycleTable({}),undefined);
 assert.equal(walletLifecycleTable({ENVIRONMENT:'staging',WALLET_LIFECYCLE_TABLE:'staging-WalletLifecycle'}),'staging-WalletLifecycle');
});
test('production lifecycle requires its own production table',()=>{
 const env={...configured(),ORDERS_TABLE:'wizz-production-Orders'};
 assert.equal(walletLifecycleTable({...env,WALLET_LIFECYCLE_TABLE:'wizz-production-WalletLifecycle'}),'wizz-production-WalletLifecycle');
 for(const table of [undefined,'','staging-WalletLifecycle',env.ORDERS_TABLE,env.HOLDS_TABLE]) {
  assert.throws(()=>walletLifecycleTable({...env,WALLET_LIFECYCLE_TABLE:table}),/WALLET_LIFECYCLE_TABLE/);
 }
});
test('both lifecycle operations refuse to omit production monitoring',()=>{
 const {lifecycleJob,lifecycleCompletion}=require('../dist/lifecycleJob');
 const saved={...process.env};
 try {
  Object.assign(process.env,configured());delete process.env.WALLET_LIFECYCLE_TABLE;
  assert.throws(()=>lifecycleJob({holdId:'hold'}),/WALLET_LIFECYCLE_TABLE/);
  assert.throws(()=>lifecycleCompletion({holdId:'hold'},'RELEASED'),/WALLET_LIFECYCLE_TABLE/);
  process.env.WALLET_LIFECYCLE_TABLE='wizz-production-WalletLifecycle';
  assert.equal(lifecycleJob({holdId:'hold'})[0].Put.TableName,process.env.WALLET_LIFECYCLE_TABLE);
  assert.equal(lifecycleCompletion({holdId:'hold'},'RELEASED')[0].Update.TableName,process.env.WALLET_LIFECYCLE_TABLE);
 } finally {
  for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];
  Object.assign(process.env,saved);
 }
});

const {walletNotificationTable}=require('../dist/walletBindings');
test('notification binding preserves staging and rejects missing or aliased production outboxes',()=>{
 assert.equal(walletNotificationTable({ENVIRONMENT:'staging',WALLET_NOTIFICATIONS_TABLE:'staging-WalletNotifications'}),'staging-WalletNotifications');
 const env={...configured(),ORDERS_TABLE:'wizz-production-Orders',WALLET_LIFECYCLE_TABLE:'wizz-production-WalletLifecycle'};
 assert.equal(walletNotificationTable({...env,WALLET_NOTIFICATIONS_TABLE:'wizz-production-WalletNotifications'}),'wizz-production-WalletNotifications');
 for(const table of [undefined,'','staging-WalletNotifications',env.ORDERS_TABLE,env.WALLET_LIFECYCLE_TABLE,...fields.map(f=>env[f])])
  assert.throws(()=>walletNotificationTable({...env,WALLET_NOTIFICATIONS_TABLE:table}),/WALLET_NOTIFICATIONS_TABLE/);
});
test('topup notification refuses invalid production binding before constructing a transaction',()=>{
 const {walletNotification}=require('../dist/walletNotifications');const saved={...process.env};
 try {
  Object.assign(process.env,configured());delete process.env.WALLET_NOTIFICATIONS_TABLE;
  assert.throws(()=>walletNotification({topupId:'topup',driverId:'driver',amount:25000},'APPROVED','2026-11-17T00:00:00Z'),/WALLET_NOTIFICATIONS_TABLE/);
  process.env.WALLET_NOTIFICATIONS_TABLE='wizz-production-WalletNotifications';
  const result=walletNotification({topupId:'topup',driverId:'driver',amount:25000},'APPROVED','2026-11-17T00:00:00Z');
  assert.equal(result.Put.TableName,process.env.WALLET_NOTIFICATIONS_TABLE);
  assert.equal(result.Put.Item.eventId,'topup#APPROVED');
  assert.equal(result.Put.ConditionExpression,'attribute_not_exists(eventId)');
 } finally {for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];Object.assign(process.env,saved);}
});

const {fundingReceiptBindings}=require('../dist/walletBindings');
test('receipt production bindings reject missing deletion fence and foreign asset stores',()=>{
 const env={...configured(),ACCOUNT_DELETION_TABLE:'wizz-production-AccountDeletion',FUNDING_RECEIPTS_BUCKET:'wizz-production-funding-receipts-746727375268-us-east-1'};
 assert.equal(fundingReceiptBindings(env).deletion,env.ACCOUNT_DELETION_TABLE);
 for(const value of [undefined,'staging-AccountDeletion',env.WALLETS_TABLE])assert.throws(()=>fundingReceiptBindings({...env,ACCOUNT_DELETION_TABLE:value}),/ACCOUNT_DELETION_TABLE/);
 for(const value of [undefined,'staging-receipts','wizz-production-receipts-699561669180'])assert.throws(()=>fundingReceiptBindings({...env,FUNDING_RECEIPTS_BUCKET:value}),/FUNDING_RECEIPTS_BUCKET/);
 assert.equal(fundingReceiptBindings({ENVIRONMENT:'staging',ACCOUNT_DELETION_TABLE:'staging-AccountDeletion',FUNDING_RECEIPTS_BUCKET:'staging-receipts'}).bucket,'staging-receipts');
 assert.throws(()=>fundingReceiptBindings({ENVIRONMENT:'dev',ACCOUNT_DELETION_TABLE:'staging-AccountDeletion'}),/INVALID_LIFECYCLE_CONFIGURATION/);
});
test('production receipt upload fails before reads without fence; valid fence remains atomic',async()=>{
 const saved={...process.env};const {docClient}=require('../dist/db');const send=docClient.send;const funding=require('../dist/fundingService');let reads=0,tx;
 try{
  Object.assign(process.env,configured());delete process.env.ACCOUNT_DELETION_TABLE;
  docClient.send=async()=>{reads++;return {};};
  await assert.rejects(funding.receiptUpload('driver',{contentType:'image/jpeg',size:100}),/ACCOUNT_DELETION_TABLE/);assert.equal(reads,0);
  process.env.ACCOUNT_DELETION_TABLE='wizz-production-AccountDeletion';process.env.FUNDING_RECEIPTS_BUCKET='wizz-production-funding-receipts-746727375268-us-east-1';
  docClient.send=async c=>{if(c.constructor.name==='GetCommand')return {Item:{status:'ACTIVE',version:2}};tx=c.input;throw new Error('STOP_BEFORE_S3');};
  await assert.rejects(funding.receiptUpload('driver',{contentType:'image/jpeg',size:100}),/STOP_BEFORE_S3/);
  assert.equal(tx.TransactItems.length,3);
  const fence=tx.TransactItems.find(x=>x.ConditionCheck).ConditionCheck;
  assert.equal(fence.TableName,process.env.ACCOUNT_DELETION_TABLE);assert.equal(fence.Key.pk,'ACCOUNT_LIFECYCLE#DRIVER#driver');assert.equal(fence.ConditionExpression,'attribute_not_exists(pk)');
  assert.match(tx.TransactItems.find(x=>x.Put).Put.Item.assetKey,/^receipts\/driver\//);
  assert.equal(tx.TransactItems[0].Update.UpdateExpression,'SET #v = #v + :one');
 }finally{docClient.send=send;for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);}
});

test('production funding has no test recipient fallback and preserves saved configuration',async()=>{
 const saved={...process.env};const {docClient}=require('../dist/db');const send=docClient.send;const funding=require('../dist/fundingService');
 try{
  Object.assign(process.env,configured());
  docClient.send=async()=>({});
  const empty=await funding.getFundingConfig();
  assert.equal(empty.manual.enabled,false);assert.equal(empty.manual.phone,'');assert.equal(empty.manual.name,'');
  assert.equal(empty.zaincash.enabled,false);assert.equal(empty.card.enabled,false);
  const stored={version:3,manual:{enabled:true,phone:'07712345678',name:'مستلم معتمد'},zaincash:{enabled:false},card:{enabled:false}};
  docClient.send=async c=>c.input.Key?.idempotencyKey==='CONFIG#FUNDING'?{Item:{config:stored}}:{};
  const loaded=await funding.getFundingConfig();assert.equal(loaded.version,3);assert.equal(loaded.manual.phone,stored.manual.phone);assert.equal(loaded.manual.name,stored.manual.name);assert.equal(loaded.manual.enabled,true);
  process.env.ENVIRONMENT='staging';delete process.env.PLATFORM_ENVIRONMENT;docClient.send=async()=>({});
  assert.equal((await funding.getFundingConfig()).manual.phone,'07800868280');
 }finally{docClient.send=send;for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);}
});
