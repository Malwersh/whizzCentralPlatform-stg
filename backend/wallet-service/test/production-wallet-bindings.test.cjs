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
const { financialOrderTables, financialDispatchTables } = require('../dist/walletBindings');

function configuredOrderTables() {
 return {
  ...configured(), ORDERS_TABLE: 'wizz-production-Orders',
  WALLETS_TABLE: 'wizz-production-Wallets', HOLDS_TABLE: 'wizz-production-Holds',
  LEDGER_TABLE: 'wizz-production-LedgerEntries', AUDIT_LOG_TABLE: 'wizz-production-AuditLog',
  WALLET_LIFECYCLE_TABLE: 'wizz-production-WalletLifecycle',
  STAFF_TABLE: 'wizz-production-PlatformStaff', OFFER_JOURNEY_TABLE: 'wizz-production-OfferJourney',
  DISPATCH_JOBS_TABLE: 'wizz-production-DispatchJobs', DRIVER_LIVE_STATE_TABLE: 'wizz-production-DriverLiveState',
  WAVE_OFFERS_TABLE: 'wizz-production-WaveOffers', DELIVERY_QUOTES_TABLE: 'wizz-production-DeliveryQuotes',
  DRIVERS_TABLE: 'wizz-production-Drivers',
  MERCHANTS_TABLE: 'wizz-production-Merchants', ACCOUNT_DELETION_TABLE: 'wizz-production-AccountDeletion'
 };
}

test('order settlement requires explicit distinct production tables even with STAGE alone', () => {
 const env = {...configuredOrderTables(), STAGE: 'production'};
 delete env.ENVIRONMENT;
 assert.equal(financialOrderTables(env).orders, env.ORDERS_TABLE);
 assert.equal(financialOrderTables(env).offerJourney, env.OFFER_JOURNEY_TABLE);
 assert.throws(() => financialOrderTables({...env, ENVIRONMENT: 'staging'}), /ENVIRONMENT_CONFLICT/);
 assert.throws(() => financialOrderTables({...env, OFFER_JOURNEY_TABLE: undefined}), /OFFER_JOURNEY_TABLE/);
 assert.throws(() => financialOrderTables({...env, STAFF_TABLE: 'staging-PlatformStaff'}), /STAFF_TABLE/);
 assert.throws(() => financialOrderTables({...env, STAFF_TABLE: env.ORDERS_TABLE}), /DISTINCT_ORDER_FINANCIAL_TABLES/);
 assert.throws(() => financialDispatchTables({...env, WAVE_OFFERS_TABLE: undefined}), /WAVE_OFFERS_TABLE/);
 assert.throws(() => financialDispatchTables({...env, DRIVERS_TABLE: env.MERCHANTS_TABLE}), /DISTINCT_DISPATCH_TABLES/);
 assert.throws(() => financialDispatchTables({...env, WAVE_OFFERS_TABLE: env.TOPUP_REQUESTS_TABLE}), /DISTINCT_DISPATCH_TABLES/);
});

test('full-cash release reads and plans promotional settlement only against production tables', async () => {
 const { GetCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
 const { verifyFullCashAssignment } = require('../dist/fullCashOffer');
 const { prepareCodRelease } = require('../dist/financialRelease');
 const fixture = await require('./helpers/full-cash-lifecycle-matrix-fixture.cjs')();
 const order = fixture.get('WizzOrders', {PK: 'ORDER#order1', SK: 'META'});
 const savedOffer = fixture.get('WaveOffers_staging', {orderId: 'order1', SK: 'FINANCIAL#driver1#WAVE#1'});
 const verified = verifyFullCashAssignment(order, savedOffer, 'driver1');
 const offer = {...verified.baseOffer, digest: verified.digest, allocation: verified.settlement.allocation};
 const env = configuredOrderTables();
 const sources = financialOrderTables({ENVIRONMENT: 'staging'});
 const destinations = financialOrderTables(env);
 const fixtureTables = new Map(Object.keys(sources).map(role => [destinations[role], sources[role]]));
 const reads = [];
 const db = {
  async send(command) {
   assert(command instanceof GetCommand, 'planning never writes before the caller commits');
   const source = fixtureTables.get(command.input.TableName);
   assert(source, 'every read must use a resolved production binding');
   reads.push(command.input.TableName);
   return fixture.db.send(new GetCommand({...command.input, TableName: source}));
  }
 };
 const previous = process.env;
 try {
  process.env = {...env};
  const plan = await prepareCodRelease(db, order, offer, new Date(fixture.time).toISOString(), 'CR:production-test', true, true, undefined, true);
  assert(reads.includes(destinations.staff), 'campaign reservation is read from production');
  assert(reads.includes(destinations.lifecycle), 'hold lifecycle is read from production');
  assert.equal(plan.journalLines.reduce((total, row) => total + row.delta, 0), 0);
  const operations = plan.operations.map(operation => {
   const [[action, spec]] = Object.entries(operation);
   const source = fixtureTables.get(spec.TableName);
   assert(source, 'every transaction operation must use a resolved production binding');
   return {[action]: {...spec, TableName: source}};
  });
  await fixture.db.send(new TransactWriteCommand({TransactItems: operations}));
  assert.equal(fixture.get('staging-Holds', {orderId: 'order1', sk: 'HOLD'}).status, 'RELEASED');
  assert.equal(fixture.get('staging-Wallets', {walletId: 'WALLET#DRIVER#driver1', sk: 'META'}).lockedBalance, 0);
  await assert.rejects(() => prepareCodRelease(db, order, offer, new Date(fixture.time).toISOString(), 'CR:production-test', true, true, undefined, true), /FULL_CASH_RELEASE_CONFLICT/);
 } finally {
  process.env = previous;
 }
});

for (const operation of ['unassign', 'cancelBeforePickup']) {
 test(`full-cash ${operation} commits once using only production tables`, async () => {
  const { GetCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
  const { createStagingCodReassignment } = require('../dist/codReassignment');
  const fixture = await require('./helpers/full-cash-lifecycle-matrix-fixture.cjs')();
  const env = configuredOrderTables();
  const stageTables = financialDispatchTables({ENVIRONMENT: 'staging'});
  const productionTables = financialDispatchTables(env);
  const mapped = new Map(Object.keys(stageTables).map(role => [productionTables[role], stageTables[role]]));
  function fixtureTable(productionName) {
   assert(mapped.has(productionName), `unexpected table ${productionName}`);
   return mapped.get(productionName);
  }
  let commits = 0;
  const db = {async send(command) {
   if (command instanceof GetCommand) {
    return fixture.db.send(new GetCommand({...command.input, TableName: fixtureTable(command.input.TableName)}));
   }
   assert(command instanceof TransactWriteCommand);
   commits++;
   const items = command.input.TransactItems.map(item => {
    const [[action, row]] = Object.entries(item);
    return {[action]: {...row, TableName: fixtureTable(row.TableName)}};
   });
   return fixture.db.send(new TransactWriteCommand({...command.input, TransactItems: items}));
  }};
  const orderKey = {PK: 'ORDER#order1', SK: 'META'};
  const order = fixture.get(stageTables.orders, orderKey);
  const cancel = operation === 'cancelBeforePickup';
  const actor = cancel ? {kind: 'MERCHANT_OWNER', subjectId: 'owner1'} : {kind: 'DRIVER', subjectId: 'driver1'};
  const request = {
   orderId: 'order1', offerId: order.financialAcceptance.offerId, attempt: 1, cashCollected: false,
   ...(cancel ? {branchId: 'branch1', goodsRetainedByBranch: true} : {reason: 'VehicleIssue'})
  };
  const previous = process.env;
  try {
   process.env = {...env};
   const api = createStagingCodReassignment({
    db, now: () => fixture.time, enableFullCash: true, enableDeliveryFunding: true,
    reassignmentWindowSeconds: 60, authenticate: async () => actor
   });
   assert.equal((await api[operation](request)).success, true);
   const first = fixture.get(stageTables.orders, orderKey);
   assert.equal(first.status, cancel ? 'cancelled' : 'ready_for_pickup');
   assert.equal(fixture.get(stageTables.jobs, {orderId: 'order1', SK: 'METADATA'}).status, cancel ? 'cancelled' : 'searching');
   assert.equal(fixture.get(stageTables.wallets, {walletId: 'WALLET#DRIVER#driver1', sk: 'META'}).lockedBalance, 0);
   assert.equal((await api[operation](request)).replayed, true);
   assert.equal(commits, 1);
  } finally {
   process.env = previous;
  }
 });
}

for (const hostMode of ['SCOPED','GENERAL']) test(`the ${hostMode} production Lambda authenticates a driver and commits unassignment once`, async () => {
 const { DynamoDBDocumentClient, GetCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
 const { CognitoIdentityProviderClient } = require('@aws-sdk/client-cognito-identity-provider');
 const { financialAcceptanceHandler } = require('../dist/driverFinancialRuntime');
 const { quoteHash } = require('../dist/deliveryQuoteRecord');
 const { scopePin } = require('./helpers/finance-rollout-fixture.cjs');
 const { identities } = require('../../../infrastructure/production/wallet-identity-bindings.json');
 const fixture = await require('./helpers/full-cash-lifecycle-matrix-fixture.cjs')();
 const general = hostMode==='GENERAL';
 const rollout = {schemaVersion:1,accountId:'746727375268',region:'us-east-1',scopes:general?[]:[{
  id:'production-test',version:1,mode:'SCOPED',admitUntil:'2099-01-01T00:00:00.000Z',
  orders:[{orderId:'order1',branchId:'branch1',customerSubjectId:'customer'}],drivers:[{driverId:'driver1',subjectId:'driver1'}]
 }]};
 const env = {
  ...configuredOrderTables(), FINANCE_ROLLOUT_CONFIG:JSON.stringify(rollout),
  FINANCE_ROLLOUT_SHA256:quoteHash(rollout), FINANCIAL_ORDER_HOST_MODE:hostMode,
  FINANCE_GENERAL_RELEASE_MODE:general?'REQUIRED':'OFF',
  FINANCIAL_DISPATCH_MODE:'REQUIRED', FINANCIAL_SETTLEMENT_MODEL:'FULL_CASH_AT_DELIVERY_V1',
  FINANCIAL_DELIVERY_FUNDING_MODE:'REQUIRED', FINANCIAL_COD_ASSIGNMENTS_MODE:'REQUIRED',
  FINANCIAL_OFFER_TTL_SECONDS:'60', FINANCIAL_POSITION_MAX_AGE_SECONDS:'120',
  DELIVERY_OPERATIONS_MODE:'CENTRAL'
 };
 for (const [role, binding] of Object.entries(identities)) {
  env[role.toUpperCase()+'_USER_POOL_ID'] = binding.poolId;
  env[role.toUpperCase()+'_CLIENT_ID'] = binding.clientId;
 }
 const sources = financialDispatchTables({});
 const targets = financialDispatchTables(env);
 const operationsKey = {pk:'OPERATIONAL_SETTINGS#DELIVERY_OPERATIONS',sk:'CURRENT'};
 fixture.put(sources.staff,{...operationsKey,version:1,values:{
  quoteMaxPerCustomerPerMinute:5,driverOfferTtlSeconds:60,driverPositionMaxAgeSeconds:120,
  reassignmentWindowSeconds:180,maximumWaves:4,
 }});
 const orderKey = {PK:'ORDER#order1',SK:'META'};
 const order = fixture.get(sources.orders,orderKey);
 const pin = release => ({schemaVersion:2,scopeId:release,version:1,
  digest:quoteHash({release,version:1,orders:[{orderId:'order1',branchId:'branch1',customerSubjectId:'customer'}]})});
 const approvedScope = general ? pin('GENERAL_PRODUCTION_FULL_CASH_V1') : scopePin(env,'order1');
 Object.assign(order,{userSub:'customer',financeRollout:approvedScope});
 const mapped = new Map(Object.keys(sources).map(role => [targets[role],sources[role]]));
 function fixtureTable(name) {
  assert(mapped.has(name), 'unexpected table '+name);
  return mapped.get(name);
 }
 const subject = {Name:'sub',Value:'driver1'};
 const token = pool => 'x.'+Buffer.from(JSON.stringify({
  iss:'https://cognito-idp.us-east-1.amazonaws.com/'+pool,
  token_use:'access',client_id:identities.driver.clientId,sub:'driver1'
 })).toString('base64url')+'.x';
 const accessToken = token(identities.driver.poolId);
 const event = {action:'unassign_financial',accessToken,body:{
  orderId:'order1',offerId:order.financialAcceptance.offerId,attempt:1,cashCollected:false,reason:'VehicleIssue'
 }};
 let commits = 0, identityCalls = 0;
 const previous = process.env;
 const dbSend = DynamoDBDocumentClient.prototype.send;
 const cognitoSend = CognitoIdentityProviderClient.prototype.send;
 try {
  process.env = {...env};
  DynamoDBDocumentClient.prototype.send = async command => {
   if (command instanceof GetCommand) {
    return fixture.db.send(new GetCommand({...command.input,TableName:fixtureTable(command.input.TableName)}));
   }
   assert(command instanceof TransactWriteCommand);
   commits++;
   assert.ok(command.input.TransactItems.some(item =>
    item.ConditionCheck?.TableName===targets.staff &&
    item.ConditionCheck.Key.pk===operationsKey.pk &&
    item.ConditionCheck.ExpressionAttributeValues[':v']===1));
   const items = command.input.TransactItems.map(item => {
    const [[action,row]] = Object.entries(item);
    return {[action]:{...row,TableName:fixtureTable(row.TableName)}};
   });
   return fixture.db.send(new TransactWriteCommand({...command.input,TransactItems:items}));
  };
  CognitoIdentityProviderClient.prototype.send = async command => {
   identityCalls++;
   const Username = '+9647800000000';
   if (command.input.AccessToken) {
    assert.equal(command.input.AccessToken, accessToken);
    return {Username,UserAttributes:[subject]};
   }
   assert.equal(command.input.UserPoolId, identities.driver.poolId);
   assert.equal(command.input.Username, Username);
   return {Enabled:true,UserStatus:'CONFIRMED',Username,UserAttributes:[subject]};
  };
  assert.equal((await financialAcceptanceHandler({...event,accessToken:token('us-east-1_RGTqUXF5C')})).statusCode, 401);
  assert.equal(identityCalls, 0);
  if (general) {
   process.env.FINANCIAL_ORDER_HOST_MODE='SCOPED';
   assert.equal((await financialAcceptanceHandler(event)).statusCode,503);
   process.env.FINANCIAL_ORDER_HOST_MODE=hostMode;
   delete order.financeRollout;
   assert.equal((await financialAcceptanceHandler(event)).statusCode,403);
   order.financeRollout=pin('GENERAL_STAGING_FULL_CASH_V1');
   assert.equal((await financialAcceptanceHandler(event)).statusCode,403);
   order.financeRollout=approvedScope;
   assert.equal(commits,0);
  }
  const result = await financialAcceptanceHandler(event);
  assert.equal(result.statusCode, 200, JSON.stringify(result));
  assert.equal(fixture.get(sources.wallets,{walletId:'WALLET#DRIVER#driver1',sk:'META'}).lockedBalance, 0);
  assert.equal((await financialAcceptanceHandler(event)).result.replayed, true);
  assert.equal(commits, 1);
 } finally {
  process.env = previous;
  DynamoDBDocumentClient.prototype.send = dbSend;
  CognitoIdentityProviderClient.prototype.send = cognitoSend;
 }
});

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
