'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { test } = require('node:test');
const { DynamoDBClient, CreateTableCommand } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand, UpdateCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { lockMerchantBranch } = require('./merchant-branch-lock.cjs');
const { redactMerchantBranchOrder } = require('./merchant-branch-order.cjs');
const { createApi, path } = require('./api.cjs');
const { createEvidence } = require('./evidence.cjs');
const { createDriverFinalization } = require('./driver-finalization.cjs');
const { purgeDriverRegistration } = require('./driver-registration-cleanup.cjs');
const { driverPhoneClosureKey } = require('../../../backend/account-deletion/driver-phone-binding');
const { createDriverDeletionEvidence } = require('./driver-linked-data.cjs');
const { createDriverDeletionWorker, driverSteps } = require('./driver-worker.cjs');
const { createCustomerDeletionWorker } = require('./customer-worker.cjs');
const { customerLock } = require('../../../backend/account-deletion/customer-lock');
const { dynamoStore } = require('../../../backend/account-deletion/store');
const { createDriverOfferCleanup } = require('./driver-offer-cleanup.cjs');
const { redactDriverOrderContact } = require('./driver-order-contact.cjs');
const { archiveDriverWalletRecords } = require('./driver-wallet-archive.cjs');
const { purgeDriverApplicationData } = require('./driver-application-data.cjs');
const { purgeCustomerApplicationData } = require('./customer-application-data.cjs');
const { archiveCustomerOrders, createCustomerOrderCleanup } = require('./customer-order-archive.cjs');
const { purgeCustomerSupport } = require('./customer-support.cjs');
const { captureCustomerIdentity, createCustomerIdentityCleanup, customerSteps } = require('./customer-identity.cjs');
const { closeCustomerWallet } = require('./customer-wallet.cjs');
const { customerPhoneClosureKey } = require('../../../backend/account-deletion/customer-phone-binding');
const { identities } = require('../wallet-identity-bindings.json');

const endpoint = process.env.PRODUCTION_DELETION_LOCAL_DDB;
const merchant = '12345678-0000-4000-8000-000000000001';
const outsider = '12345678-0000-4000-8000-000000000002';
const customer = '12345678-0000-4000-8000-000000000003';
const driver = '12345678-0000-4000-8000-000000000004';
const accountRequest = '12345678-0000-4000-8000-000000000010';
const branchRequest = '12345678-0000-4000-8000-000000000011';
const customerReq = '12345678-0000-4000-8000-000000000012';
const driverReq = '12345678-0000-4000-8000-000000000013';
const branch = 'branch-test';
const suffix = name => 'wizz-production-'+name;
const schema = {
  AccountDeletion:['pk','sk'], PlatformStaff:['pk','sk'], OfferJourney:['pk','sk'], Merchants:['businessId'], MerchantPlatform:['pk','sk'],
  Products:['productId'], GlobalProducts:['globalProductId'], WorkingHours:['businessId','weekday'],
  BusinessSubcategories:['subcategoryId'], MenuCategories:['categoryId'], MerchantDiscounts:['discountId'], MerchantOtpSessions:['id'], MerchantFinancialSessions:['pk','sk'],
  Customers:['userId'], Drivers:['driverId'], DriverLiveState:['driverId'], OrderConnections:['connectionId'], Wallets:['walletId','sk'], Holds:['orderId','sk'],
  Orders:['PK','SK'], TopupRequests:['topupId','sk'], IdempotencyKeys:['idempotencyKey','sk'],
  WalletLifecycle:['operationId'], DispatchJobs:['orderId','SK'], WaveOffers:['orderId','SK'],
  DriverPerformanceSnapshots:['pk','sk'], OrderRatings:['pk'], LedgerEntries:['walletId','sk'], AuditLog:['datePartition','sk'], Addresses:['addressId'], Favorites:['favoriteId'], PushDeviceTokens:['token'], DeliveryQuotes:['pk','sk'],
  AccountDeletionFinancialArchive:['pk','sk'],
  SupportChatSessions:['sessionId'], SupportChatMessages:['sessionId','messageKey'], SupportAttachments:['attachmentId'],
  SupportMessageReceipts:['receiptId'], SupportConnections:['connectionId'], WalletNotifications:['eventId'],
  DriverOtpSessions:['id'], CustomerPhoneAuth:['id'], CustomerPhoneLink:['id'],
};

test('production deletion intake reuses the staging contract with isolated account, branch and financial scope', {
  skip: !endpoint && 'requires disposable DynamoDB',
}, async () => {
  assert.match(endpoint, /^http:\/\/127\.0\.0\.1:\d+$/);
  const client = new DynamoDBClient({ endpoint, region:'us-east-1', maxAttempts:1,
    credentials:{accessKeyId:'localfixture',secretAccessKey:'local-only'} });
  const db = DynamoDBDocumentClient.from(client,{marshallOptions:{removeUndefinedValues:true}});
  await Promise.all(Object.entries(schema).map(([name,keys])=>client.send(new CreateTableCommand({
    TableName:suffix(name), BillingMode:'PAY_PER_REQUEST',
    KeySchema:keys.map((AttributeName,index)=>({AttributeName,KeyType:index===0?'HASH':'RANGE'})),
    AttributeDefinitions:keys.map(AttributeName=>({AttributeName,AttributeType:'S'})),
  }))));
  let time = Date.parse('2026-11-26T08:00:00Z');
  const put = (name,Item) => db.send(new PutCommand({TableName:suffix(name),Item}));
  const get = async (name,Key) => (await db.send(new GetCommand({TableName:suffix(name),Key,ConsistentRead:true}))).Item;
  const policyVersion = '12345678-0000-4000-8000-000000000015';
  const policy = { pk:'OPERATIONAL_SETTINGS#ACCOUNT_DELETION', sk:'CURRENT', policyVersion,
    approvedAt:new Date(time).toISOString(), approvedBy:'fixture', mandatoryWaitingDays:0,
    values:{financialRetentionYears:7,documentRetentionDays:0,locationRetentionDays:0,supportRetentionDays:0} };
  await Promise.all([
    put('PlatformStaff',policy),
    put('PlatformStaff',{...policy,sk:'VERSION#'+policyVersion}),
    put('Customers',{userId:customer,cognitoSub:customer}),
    put('Drivers',{driverId:driver,status:'PENDING_PROFILE'}),
    put('Merchants',{businessId:branch,ownerId:merchant,cognitoUserId:merchant,businessName:'فرع اختبار',acceptingOrders:true}),
    put('MerchantPlatform',{pk:'PERSON#'+merchant,sk:'PROFILE',subjectId:merchant}),
    put('Orders',{PK:'ORDER#paid',SK:'META',orderId:'paid',storeId:branch,userSub:customer,status:'delivered'}),
    put('Holds',{orderId:'paid',sk:'MERCHANT_PAYABLE',walletId:'WALLET#MERCHANT#'+branch,
      branchId:branch,status:'LOCKED_PENDING_SETTLEMENT'}),
  ]);
  const token = (type,sub,stage='production') => {
    const {poolId,clientId} = identities[type];
    const claims = {sub,token_use:'access',client_id:clientId,
      iss:'https://cognito-idp.us-east-1.amazonaws.com/'+(stage==='production'?poolId:'us-east-1_test')};
    return 'test.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.signature';
  };
  const freshCustomer='12345678-0000-4000-8000-000000000031';
  const freshPhone='+9647000000031';
  const cognito = { async send({input}) {
    const {sub} = JSON.parse(Buffer.from(input.AccessToken.split('.')[1],'base64url'));
    return {Username:sub,UserAttributes:[{Name:'sub',Value:sub},
      {Name:'phone_number',Value:sub===freshCustomer?freshPhone:'+9647000000000'},{Name:'phone_number_verified',Value:'true'}]};
  }};
  const messages = [];
  const api = createApi({db,cognito,clock:()=>time,executionTypes:new Set(['MERCHANT','CUSTOMER']),
    inspect:createEvidence({ db, deliveryFundingArchiveEnabled:true, clock:()=>time }),
    secret:async()=>({hmacKey:'local-only-key',apiKey:'test-credential'}),
    deliver:async(_key,_phone,code)=>messages.push(code)});
  const call = async (auth,operation,{input,query,expected=200,stage='production'}={}) => {
    const result = await api({resource:path,path:'/deletion/'+operation,requestContext:{stage},
      httpMethod:input?'POST':'GET',headers:auth?{authorization:'Bearer '+auth}:{},
      queryStringParameters:query,body:input?JSON.stringify(input):undefined});
    assert.equal(result.statusCode,expected,result.body);
    return JSON.parse(result.body);
  };
  const canary = createApi({
    db,cognito,clock:()=>time,executionTypes:new Set(['CUSTOMER']),
    allowIntake:actor=>actor.sub===freshCustomer,
    secret:()=>assert.fail('an excluded account must not read OTP credentials'),
    deliver:()=>assert.fail('an excluded account must not send a verification code'),
  });
  const excluded=await canary({resource:path,path:'/deletion/send',requestContext:{stage:'production'},
    httpMethod:'POST',headers:{authorization:'Bearer '+token('customer',customer)},
    body:JSON.stringify({requestId:customerReq})});
  assert.equal(excluded.statusCode,503);
  const assetAuth=token('customer',freshCustomer);
  await put('Customers',{userId:freshCustomer,cognitoSub:freshCustomer,profileImageUrl:'fixture-image'});
  const assetPreview=await call(assetAuth,'eligibility');
  assert.ok(assetPreview.blockers.some(item=>item.code==='EXTERNAL_ASSET_ACCESS_REQUIRED'));
  await put('Customers',{userId:freshCustomer,cognitoSub:freshCustomer,retentionHold:true});
  const heldPreview=await call(assetAuth,'eligibility');
  assert.ok(heldPreview.blockers.some(item=>item.action==='REVIEW_PROFILE_RETENTION'));
  await db.send(new DeleteCommand({TableName:suffix('Customers'),Key:{userId:freshCustomer}}));
  const owner = token('merchant',merchant);
  await call(token('merchant',merchant,'staging'),'status',{expected:401});
  await call(owner,'status',{stage:'staging',expected:404});
  await call(token('merchant',outsider),'eligibility',{query:{scope:'BUSINESS',businessId:branch},expected:403});
  await put('PlatformStaff',{...policy,mandatoryWaitingDays:1});
  await call(owner,'eligibility',{expected:503});
  await put('PlatformStaff',policy);
  const ownerPreview = await call(owner,'eligibility');
  assert.equal(ownerPreview.blockers[0].code,'OWNED_BUSINESSES');
  assert.equal(ownerPreview.businesses[0].blockers[0].code,'ACTIVE_HOLDS');
  const ownerBranch=await get('Merchants',{businessId:branch});
  await put('Merchants',{...ownerBranch,legalHold:true,orderIntakeTransferExpiresAt:time+60000});
  const guardedBranch=await call(owner,'eligibility',{query:{scope:'BUSINESS',businessId:branch}});
  assert.ok(guardedBranch.blockers.some(blocker=>blocker.code==='DOCUMENTED_RETENTION_HOLD'));
  assert.ok(guardedBranch.blockers.some(blocker=>blocker.code==='OWNERSHIP_TRANSFER_IN_PROGRESS'));
  await put('Merchants',ownerBranch);
  const ownerProfile=await get('MerchantPlatform',{pk:'PERSON#'+merchant,sk:'PROFILE'});
  await put('MerchantPlatform',{...ownerProfile,retentionHold:true});
  assert.ok((await call(owner,'eligibility')).blockers.some(blocker=>blocker.code==='DOCUMENTED_RETENTION_HOLD'));
  await put('MerchantPlatform',ownerProfile);
  const driverPreview = await call(token('driver',driver),'eligibility');
  assert.equal(driverPreview.executionReady,false);
  const upload={pk:'ACCOUNT_OPERATION#DRIVER#'+driver,sk:'UPLOAD#test',subjectId:driver,
    kind:'DOCUMENT_UPLOAD',expiresAt:Math.floor(time/1000)+60};
  await put('AccountDeletion',upload);
  const uploading=await call(token('driver',driver),'eligibility');
  assert.ok(uploading.pendingPayments.some(item=>item.status==='DOCUMENT_UPLOAD_PENDING'));
  await put('AccountDeletion',{...upload,expiresAt:Math.floor(time/1000)});
  const expired=await call(token('driver',driver),'eligibility');
  assert.ok(!expired.pendingPayments.some(item=>item.status==='DOCUMENT_UPLOAD_PENDING'));
  await call(token('driver',driver),'send',{input:{requestId:driverReq},expected:503});
  assert.equal(messages.length,0);
  const pending = await call(owner,'send',{input:{requestId:accountRequest}});
  assert.equal(await get('Merchants',{businessId:branch}).then(row=>row.orderIntakeDeletionRequestId),undefined);
  await call(owner,'request',{input:{requestId:branchRequest,challengeId:pending.challengeId,code:messages[0]},expected:400});
  const saved = await call(owner,'request',{input:{requestId:accountRequest,challengeId:pending.challengeId,code:messages[0]}});
  assert.equal(saved.status,'PENDING_SETTLEMENT');
  assert.equal((await get('Merchants',{businessId:branch})).orderIntakeDeletionRequestId,accountRequest);
  assert.equal((await call(null,'receipt',{input:{receiptToken:saved.receiptToken}})).request.status,'PENDING_SETTLEMENT');
  time+=61000;
  const input = {requestId:branchRequest,scope:{kind:'BUSINESS',businessId:branch}};
  const scoped = await call(owner,'send',{input});
  const closure = await call(owner,'request',{input:{...input,challengeId:scoped.challengeId,code:messages[1]}});
  assert.equal(closure.status,'PENDING_SETTLEMENT');
  assert.equal(closure.blockers[0].code,'ACTIVE_HOLDS');
  assert.equal((await get('Merchants',{businessId:branch})).orderIntakeDeletionRequestId,branchRequest);

  const endUser = token('customer',customer);
  const heldSession={sessionId:'hold-preview',userType:'customer',userId:customer,customerId:customer,legalHold:true};
  await put('SupportChatSessions',heldSession);
  const supportBlockers = (await call(endUser,'eligibility')).blockers;
  assert.ok(supportBlockers.some(blocker=>blocker.code==='DOCUMENTED_RETENTION_HOLD'&&blocker.action==='REVIEW_SUPPORT_RETENTION'));
  await db.send(new DeleteCommand({TableName:suffix('SupportChatSessions'),Key:{sessionId:heldSession.sessionId}}));
  const reservation={pk:'BENEFIT_ORDER#paid',sk:'GOODS',target:'GOODS',sub:customer,orderId:'paid',
    campaignId:'campaign-test',amountMinor:1000,version:1,status:'RESERVED'};
  await put('OfferJourney',reservation);
  const hasOffer=await call(endUser,'eligibility');
  assert.ok(hasOffer.pendingPayments.some(row=>row.status==='BENEFIT_RESERVATION_PENDING'));
  await db.send(new DeleteCommand({TableName:suffix('OfferJourney'),Key:{pk:reservation.pk,sk:reservation.sk}}));
  const proof = await call(endUser,'send',{input:{requestId:customerReq}});
  const customerDeletion = await call(endUser,'request',{input:{requestId:customerReq,challengeId:proof.challengeId,code:messages[2]}});
  assert.equal(customerDeletion.status,'READY');
  assert.equal(customerDeletion.blockers.length,0);
  assert.equal((await call(endUser,'status')).request.status,'READY');
  assert.equal((await call(token('merchant',outsider),'status')).request,null);
  assert.equal((await get('Orders',{PK:'ORDER#paid',SK:'META'})).userSub,customer);

  const actor={type:'CUSTOMER',sub:customer};
  const store=dynamoStore({db,table:suffix('AccountDeletion'),environment:'production',clock:()=>Math.floor(time/1000)});
  const initial=await store.get(actor,customerReq);
  const request=await store.acquireLease(initial);
  const scope=await createEvidence({db})(actor,request.scope);
  const phone='+9647000000000';
  let currentIdentity={Username:customer,UserStatus:'CONFIRMED',Enabled:true,UserAttributes:[
    {Name:'sub',Value:customer},{Name:'phone_number',Value:phone},{Name:'phone_number_verified',Value:'true'},
  ]};
  const identityActions=[];
  const identityClient={async send(command) {
    assert.equal(command.input.UserPoolId,identities.customer.poolId);
    assert.equal(command.input.Username,customer);
    if (!currentIdentity) throw Object.assign(Error('test identity unavailable'),{name:'UserNotFoundException'});
    const action=command.constructor.name;
    if(action==='AdminGetUserCommand')return currentIdentity;
    identityActions.push(action);
    if(action==='AdminDisableUserCommand')currentIdentity.Enabled=false;
    if(action==='AdminDeleteUserCommand')currentIdentity=null;
    return {};
  }};
  const identity=await captureCustomerIdentity({db,cognito:identityClient,subjectId:customer,profileIds:scope.profileIds});
  const manifest={requestId:customerReq,subjectId:customer,profileIds:scope.profileIds,wallets:scope.wallets,
    walletIds:scope.walletIds,policyVersion,financialYears:7,identity};
  const lock=customerLock({db,table:suffix('AccountDeletion'),environment:'production',verifiedMutationGuards:true,
    clock:()=>Math.floor(time/1000)});
  const walletId='WALLET#CUSTOMER#'+customer;
  const wallet={walletId,sk:'META',ownerId:customer,ownerType:'CUSTOMER',currency:'IQD',
    status:'ACTIVE',version:1,availableBalance:200,lockedBalance:0};
  await put('Wallets',wallet);
  await assert.rejects(lock(request,scope,manifest),{name:'TransactionCanceledException'});
  assert.equal((await get('Customers',{userId:customer})).deletionRequestId,undefined);
  assert.equal(await get('AccountDeletion',{pk:'ACCOUNT_LIFECYCLE#CUSTOMER#'+customer,sk:'META'}),undefined);
  await put('Wallets',{...wallet,availableBalance:0,version:2});
  const cleared=await createEvidence({db})(actor,request.scope);
  const phoneKey=customerPhoneClosureKey(phone);
  await put('AccountDeletion',{...phoneKey,subjectId:outsider,requestId:driverReq,lockedAt:Math.floor(time/1000)});
  await assert.rejects(lock(request,cleared,{...manifest,wallets:cleared.wallets}),{name:'TransactionCanceledException'});
  assert.equal((await get('AccountDeletion',phoneKey)).subjectId,outsider);
  assert.equal((await get('Customers',{userId:customer})).deletionRequestId,undefined);
  await db.send(new DeleteCommand({TableName:suffix('AccountDeletion'),Key:phoneKey}));
  await lock(request,cleared,{...manifest,wallets:cleared.wallets});
  assert.equal((await get('Customers',{userId:customer})).deletionRequestId,customerReq);
  assert.equal((await get('Wallets',{walletId,sk:'META'})).deletionRequestId,customerReq);
  const locked = await store.get(actor,customerReq);
  assert.equal(locked.status,'PROCESSING');
  assert.equal((await get('AccountDeletion',phoneKey)).subjectId,customer);
  const address = { addressId:'mine',userId:customer,address:'private' };
  const heldFavorite = { favoriteId:'mine',userId:customer,retentionHold:true };
  const rate = { pk:'CUSTOMER#'+customer,sk:'RATE#STOREFRONT_PREVIEW',subjectId:customer,digest:'rate' };
  const quote = { ...rate,sk:'QUOTE#paid',digest:'quote',consumption:{orderId:'paid'} };
  await Promise.all([
    put('Addresses',address),
    put('Addresses',{ addressId:'other',userId:outsider }),
    put('Favorites',heldFavorite),
    put('PushDeviceTokens',{ token:'mine',subjectId:customer,app:'user' }),
    put('PushDeviceTokens',{ token:'another-app',subjectId:customer,app:'driver' }),
    put('DeliveryQuotes',rate),
    put('DeliveryQuotes',quote),
  ]);
  const cleanup = (r,client=db) => purgeCustomerApplicationData({db:client,request:r,job:locked.job,clock:()=>time});
  await assert.rejects(cleanup(locked),{code:'DOCUMENTED_RETENTION_HOLD'});
  const quoteKey = {pk:quote.pk,sk:quote.sk};
  assert.ok(await get('DeliveryQuotes',quoteKey));
  await put('Favorites',{...heldFavorite,retentionHold:false});
  const updatedQuote = { ...quote,consumption:{orderId:'after-inventory'} };
  const changedConsumption = {async send(command) {
    if (command.input.TransactItems?.some(item=>item.Delete?.Key.sk===quote.sk)) {
      await put('DeliveryQuotes',updatedQuote);
    }
    return db.send(command);
  }};
  await assert.rejects(cleanup(locked,changedConsumption),{name:'TransactionCanceledException'});
  assert.deepEqual(await get('DeliveryQuotes',quoteKey),updatedQuote);
  let interrupted = false;
  const interruptAfterQuotes = {async send(command) {
    if (command.input.TransactItems?.some(item=>item.Delete?.TableName===suffix('Addresses'))) {
      interrupted=true;
      throw Error('test interruption');
    }
    return db.send(command);
  }};
  await assert.rejects(cleanup(locked,interruptAfterQuotes),/test interruption/);
  assert.ok(interrupted);
  assert.equal(await get('DeliveryQuotes',quoteKey),undefined);
  assert.ok(await get('Addresses',{addressId:'mine'}));
  await store.releaseLease(locked);
  await assert.rejects(cleanup(locked),{name:'TransactionCanceledException'});
  const resumed = await store.acquireLease(await store.get(actor,customerReq));
  await cleanup(resumed);
  await cleanup(resumed);
  assert.equal(await get('Addresses',{addressId:'mine'}),undefined);
  assert.equal(await get('Favorites',{favoriteId:'mine'}),undefined);
  assert.equal(await get('PushDeviceTokens',{token:'mine'}),undefined);
  assert.ok(await get('Addresses',{addressId:'other'}));
  assert.ok(await get('PushDeviceTokens',{token:'another-app'}));
  const orderKey={PK:'ORDER#paid',SK:'META'};
  const order={...await get('Orders',orderKey),createdAt:'2026-11-21T10:00:00Z',
    customerPhone:'not-for-archive',deliveryAddress:{text:'not-for-archive'},
    pricing:{goodsSubtotal:4000,deliveryFee:1000,serviceFee:100,total:5100,freeText:'not-for-archive'},
    financialSnapshot:{schemaVersion:3,digest:'cash-digest',
      order:{customerPoint:{latitude:12,longitude:25},allocation:{
        customerTotal:{currency:'IQD',moneySchemaVersion:1,scale:1000,minorAmount:5100},
      }}}};
  await put('Orders',order);
  const archive = (r,client=db) => archiveCustomerOrders({db:client,request:r,job:locked.job,clock:()=>time});
  const archiveKey = {pk:'REQUEST#'+customerReq,sk:'ORDER#'+JSON.stringify(orderKey)};
  await put('Orders',{...order,customerId:'12345678-0000-4000-8000-000000000099'});
  await assert.rejects(archive(resumed),/INVALID_CLEANUP_SCOPE/);
  assert.equal(await get('AccountDeletionFinancialArchive',archiveKey),undefined);
  await put('Orders',order);
  const lateHold={async send(command) {
    if (command.input.TransactItems) await put('Orders',{...order,legalHold:true});
    return db.send(command);
  }};
  await assert.rejects(archive(resumed,lateHold),{name:'TransactionCanceledException'});
  assert.equal(await get('AccountDeletionFinancialArchive',archiveKey),undefined);
  await put('Orders',order);
  await archive(resumed);
  const snapshot=await get('AccountDeletionFinancialArchive',archiveKey);
  assert.equal(snapshot.data.pricing.goodsSubtotal,4000);
  assert.equal(snapshot.data.pricing.serviceFee,100);
  assert.equal(snapshot.data.codFinancialEvidence.snapshot.allocation.customerTotal.minorAmount,5100);
  assert.equal(new Date(snapshot.expiresAt*1000).getUTCFullYear(),2033);
  assert.doesNotMatch(JSON.stringify(snapshot),/not-for-archive|customerPoint|latitude|customerPhone/);
  time+=1000;
  await archive(resumed);
  assert.deepEqual(await get('AccountDeletionFinancialArchive',archiveKey),snapshot);
  assert.deepEqual(await get('Orders',orderKey),order);
  const orderCleanup=createCustomerOrderCleanup({
    preserveMerchantSettlementEvidence:async()=>{},
    readMerchantAccrualEvidence:async()=>({order,payable:{}}),
  });
  const redact=()=>orderCleanup.redact({db,request:resumed,job:resumed.job,clock:()=>time});
  await assert.rejects(redact(),{code:'FINANCIAL_ARCHIVE_SOURCE_REQUIRED'});
  assert.deepEqual(await get('Orders',orderKey),order);
  const legacyKey={PK:'ORDER#legacy',SK:'META'};
  const {financialSnapshot:_snapshot,...legacy}=order;
  await put('Orders',{...legacy,...legacyKey,orderId:'legacy'});
  await archive(resumed);
  await db.send(new DeleteCommand({TableName:suffix('Orders'),Key:orderKey}));
  await redact();
  await redact();
  const redacted=await get('Orders',legacyKey);
  assert.equal(redacted.accountDeletionRequestId,customerReq);
  assert.equal(redacted.userSub,undefined);
  assert.equal(redacted.customerPhone,undefined);
  assert.equal(redacted.deliveryAddress,undefined);
  assert.equal(redacted.pricing.freeText,undefined);
  assert.equal(redacted.pricing.total,5100);

  const {proof:financialFixture}=require('../../../backend/wallet-service/test/helpers/merchant-accrual-fixture.cjs');
  const {input:financial}=await financialFixture({orderId:'financial-order'});
  const financialKey={PK:financial.order.PK,SK:financial.order.SK};
  await Promise.all([
    put('Orders',{...financial.order,createdAt:'2026-10-15T11:55:00.000Z',userId:customer,userSub:customer,customerPhone:'private-phone',
      deliveryAddress:{text:'private-address'}}),
    put('Holds',financial.outcome),
    put('Holds',financial.payable),
    put('WaveOffers',financial.acceptedOffer),
  ]);
  const cancellationFixture=require('../../../backend/wallet-service/test/helpers/cancellation-compensation-249-fixture.cjs');
  const cancelled=await cancellationFixture();
  await cancelled.approve({driverFareIqd:0,merchantCompensationIqd:0,assessment:{
    requester:'UNKNOWN',channel:'SUPPORT',reference:'مراجعة إثبات عدم الاستحقاق',
    foodState:'NOT_STARTED',foodLossIqd:0,foodLossReference:'',driverEffortReference:'',
  }});
  await cancelled.execute();
  const closureRequest={...cancelled.common('CLOSE'),confirmClosure:true};
  assert.equal((await cancelled.service(closureRequest)).status,'RESOLVED');
  const cancelledKey={PK:'ORDER#order1',SK:'META'};
  const cancelledOrder=cancelled.f.get('WizzOrders',cancelledKey);
  await put('Orders',{...cancelledOrder,userSub:customer,deliveryAddress:{text:'private-cancellation-address'}});
  for (const [key,row] of cancelled.f.rows) {
    if (row.orderId!=='order1') continue;
    if (key.startsWith('staging-Holds|')) await put('Holds',row);
    if (key.startsWith('WaveOffers_staging|')) await put('WaveOffers',row);
  }
  const settlement=require('../../../backend/wallet-service/dist/merchantSettlementPreview');
  const template=require('../order-financial-runtime.template.json');
  const previousEnv=process.env;
  process.env={
    ...Object.fromEntries(Object.entries(template.Resources.Function.Properties.Environment.Variables)
      .filter(([,value])=>typeof value==='string')),
    ENVIRONMENT:'production',STAGE:'production',AWS_REGION:'us-east-1',
  };
  try {
    const {accrual:before}=await settlement.readMerchantAccrualEvidence(db,'branch1','financial-order');
    const realCleanup=createCustomerOrderCleanup(settlement);
    await realCleanup.archive({db,request:resumed,job:resumed.job,clock:()=>time});
    const args={db,request:resumed,job:resumed.job,clock:()=>time};
    const offerKey={orderId:financial.acceptedOffer.orderId,SK:financial.acceptedOffer.SK};
    await put('WaveOffers',{...financial.acceptedOffer,retentionHold:true});
    await assert.rejects(realCleanup.preflight(args),{code:'DOCUMENTED_RETENTION_HOLD'});
    await assert.rejects(realCleanup.redact(args),{code:'DOCUMENTED_RETENTION_HOLD'});
    assert.equal((await get('Orders',financialKey)).customerPhone,'private-phone');
    await put('WaveOffers',financial.acceptedOffer);
    await realCleanup.preflight(args);
    await realCleanup.redact(args);
    await realCleanup.redact(args);
    const result=await get('Orders',financialKey);
    const offer=await get('WaveOffers',offerKey);
    assert.equal(offer.financialOffer,undefined);
    assert.equal(offer.driverId,financial.acceptedOffer.driverId);
    assert.equal(offer.responseStatus,financial.acceptedOffer.responseStatus);
    assert.equal(result.customerPhone,undefined);
    assert.equal(result.deliveryAddress,undefined);
    assert.equal(result.financialSnapshot,undefined);
    assert.equal(result.financialAcceptance,undefined);
    assert.equal(result.accountDeletionRequestId,customerReq);
    const {accrual:after}=await settlement.readMerchantAccrualEvidence(db,'branch1','financial-order');
    assert.deepEqual(after,before);
    const cleanCancellation=await get('Orders',cancelledKey);
    assert.equal(cleanCancellation.deliveryAddress,undefined);
    assert.equal(cleanCancellation.financialSnapshot,undefined);
    assert.equal(cleanCancellation.accountDeletionRequestId,customerReq);
    assert.equal(await get('Holds',{orderId:'order1',sk:'MERCHANT_PAYABLE'}),undefined);
    const journal=await get('Holds',{orderId:'order1',sk:'EXCEPTION_ENTITLEMENTS'});
    assert.equal(journal.merchantCompensationIqd,0);
    const cancelledOffer=await get('WaveOffers',{orderId:'order1',SK:'FINANCIAL#driver1#WAVE#1'});
    assert.equal(cancelledOffer.financialOffer,undefined);
    assert.equal(cancelledOffer.driverId,'driver1');
    cancelled.f.put('WizzOrders',cleanCancellation);
    assert.equal((await cancelled.service(closureRequest)).replayed,true);

  } finally {
    process.env=previousEnv;
  }



  const sid = 'customer-support-test';
  const imageId = '12345678-0000-4000-8000-000000000091';
  const imageKey = 'support-images/'+createHash('sha256').update(sid).digest('hex')+'/'+imageId;
  const orphanKey = imageKey.replace(/91$/,'92');
  const foreignImage = imageKey.replace(/^support-images\/[^/]+/,'support-images/foreign');
  const images = new Set([imageKey,orphanKey,foreignImage]);
  const ownSupport = {sessionId:sid,userId:customer,customerId:customer,userType:'customer'};
  const attachment = {attachmentId:imageId,sessionId:sid,key:imageKey,status:'PUBLISHED',userType:'customer',subjectId:customer};
  await Promise.all([
    put('SupportChatSessions',ownSupport),
    put('SupportChatSessions',{...ownSupport,sessionId:'foreign',userId:outsider,customerId:outsider}),
    put('SupportChatMessages',{sessionId:sid,messageKey:'message',messageId:'one',text:'private'}),
    put('SupportMessageReceipts',{receiptId:'one',sessionId:sid,messageId:'one'}),
    put('SupportAttachments',{...attachment,retentionHold:true}),
    put('SupportConnections',{connectionId:'customer=',userId:customer,authSubject:customer,userType:'customer',sessionId:sid}),
    put('SupportConnections',{connectionId:'agent=',userId:'agent',authSubject:'agent',userType:'agent',sessionId:sid}),
    put('WalletNotifications',{eventId:'support-notice',sessionId:sid,driverId:customer,recipientApp:'user',type:'support_reply'}),
    put('WalletNotifications',{eventId:'different-notice',sessionId:sid,driverId:customer,recipientApp:'user',type:'transfer_received'}),
  ]);
  const s3 = {async send(command) {
    const { Bucket, ExpectedBucketOwner, Key, Prefix, IfMatch } = command.input;
    assert.equal(Bucket,'wizz-production-support-attachments-746727375268-us-east-1');
    assert.equal(ExpectedBucketOwner,'746727375268');
    if (command.constructor.name==='GetBucketVersioningCommand') return {};
    if (command.constructor.name==='ListObjectsV2Command') return {
      Contents:[...images].filter(key=>key.startsWith(Prefix)).map(key=>({Key:key,ETag:'"old"'})),
    };
    assert.equal(IfMatch,'"old"');
    if (images.has(Key) && Key===orphanKey && images.has(foreignImage) && failOnce) {
      failOnce=false;
      throw Error('temporary S3 failure');
    }
    images.delete(Key);
    return {};
  }};
  let failOnce = true;
  const disconnected = [];
  const socket = {async send(command) { disconnected.push(command.input.ConnectionId); }};
  const supportCleanup = r => purgeCustomerSupport({ db,s3,socket,request:r,job:locked.job,clock:()=>time });
  await assert.rejects(supportCleanup(resumed),{code:'SUPPORT_WRITES_DRAINING'});
  time+=61000;
  await assert.rejects(supportCleanup(resumed),{code:'DOCUMENTED_RETENTION_HOLD'});
  assert.equal(images.size,3);
  await put('SupportAttachments',{...attachment,retentionHold:false});
  await assert.rejects(supportCleanup(resumed),/temporary S3 failure/);
  assert.ok(await get('SupportChatSessions',{sessionId:sid}));
  assert.equal(images.has(imageKey),false);
  await supportCleanup(resumed);
  await supportCleanup(resumed);
  assert.deepEqual([...images],[foreignImage]);
  assert.deepEqual(disconnected,['customer=']);
  assert.equal(await get('SupportChatSessions',{sessionId:sid}),undefined);
  assert.equal(await get('SupportChatMessages',{sessionId:sid,messageKey:'message'}),undefined);
  assert.equal(await get('SupportMessageReceipts',{receiptId:'one'}),undefined);
  assert.equal(await get('SupportAttachments',{attachmentId:imageId}),undefined);
  assert.equal(await get('WalletNotifications',{eventId:'support-notice'}),undefined);
  assert.ok(await get('WalletNotifications',{eventId:'different-notice'}));
  assert.ok(await get('SupportChatSessions',{sessionId:'foreign'}));
  assert.equal((await get('SupportConnections',{connectionId:'agent='})).sessionId,undefined);

  const cleanupIdentity=createCustomerIdentityCleanup({db,cognito:identityClient,clock:()=>time});
  const authPointer={id:'ACTIVE#'+phone,sessionId:'old-challenge',expiresAt:1800000000};
  await Promise.all([
    put('CustomerPhoneAuth',authPointer),
    put('CustomerPhoneAuth',{id:'old-challenge',phone,purpose:'customer-phone-otp',digest:'old'}),
    put('CustomerPhoneAuth',{id:'old-proof',username:customer,purpose:'login-proof',digest:'proof'}),
    put('CustomerPhoneAuth',{id:'LOGIN#'+customer,proofId:'old-proof'}),
    put('CustomerPhoneAuth',{id:'PROVISION#'+phone,sub:customer,username:customer}),
    put('CustomerPhoneAuth',{id:'foreign-proof',username:outsider,purpose:'login-proof',digest:'foreign'}),
    put('CustomerPhoneLink',{id:'old-link',subjectId:customer,phone}),
    put('CustomerPhoneLink',{id:'foreign-link',subjectId:outsider,phone}),
  ]);
  await assert.rejects(cleanupIdentity.finish(resumed,resumed.job),{code:'CLEANUP_INCOMPLETE'});
  await cleanupIdentity.disable(resumed,resumed.job);
  assert.deepEqual(identityActions,['AdminDisableUserCommand','AdminUserGlobalSignOutCommand']);
  await cleanupIdentity.purgeVerification(resumed,resumed.job);
  for(const id of [authPointer.id,'old-challenge','old-proof','LOGIN#'+customer,'PROVISION#'+phone])assert.equal(await get('CustomerPhoneAuth',{id}),undefined);
  assert.equal(await get('CustomerPhoneLink',{id:'old-link'}),undefined);
  assert.ok(await get('CustomerPhoneLink',{id:'foreign-link'}));
  assert.ok(await get('CustomerPhoneAuth',{id:'foreign-proof'}));
  const walletKey={walletId,sk:'META'};
  const lockedWallet=await get('Wallets',walletKey);
  const closeWallet = (client=db) => closeCustomerWallet({db:client,request:resumed,job:resumed.job,clock:()=>time});
  const lateBalance={async send(command) {
    if(command.input.TransactItems?.some(item=>item.Update?.TableName===suffix('Wallets'))) {
      await put('Wallets',{...lockedWallet,lockedBalance:500,version:lockedWallet.version+1});
    }
    return db.send(command);
  }};
  await assert.rejects(closeWallet(lateBalance),{name:'TransactionCanceledException'});
  assert.equal((await get('Wallets',walletKey)).lockedBalance,500);
  await put('Wallets',{...lockedWallet,version:lockedWallet.version+2});
  await closeWallet();
  const closedWallet=await get('Wallets',walletKey);
  assert.equal(closedWallet.status,'CLOSED');
  assert.equal(closedWallet.availableBalance,0);
  assert.equal(closedWallet.lockedBalance,0);
  await closeWallet();
  assert.deepEqual(await get('Wallets',walletKey),closedWallet);
  for(const step of customerSteps.filter(step=>step!=='identityClosure'))await store.completeStep(resumed,step,new Date(time).toISOString());
  await put('Wallets',{...closedWallet,retentionHold:true});
  await assert.rejects(cleanupIdentity.finish(resumed,resumed.job),{code:'WALLET_CLOSURE_BLOCKED'});
  assert.ok(currentIdentity);
  await put('Wallets',closedWallet);
  const interruptedIdentity=createCustomerIdentityCleanup({cognito:identityClient,clock:()=>time,db:{async send(command) {
    if(command.input.TransactItems?.some(item=>item.Put?.Item.sk==='IDENTITY_COMPLETE#'+customerReq)){
      assert.equal(currentIdentity,null);
      throw Error('test interruption after identity deletion');
    }
    return db.send(command);
  }}});
  await assert.rejects(interruptedIdentity.finish(resumed,resumed.job),/test interruption after identity deletion/);
  assert.ok(await get('AccountDeletion',phoneKey));
  assert.ok(await get('Customers',{userId:customer}));
  const workerConfig={db,cognito:identityClient,s3,socket,clock:()=>time,verifiedMutationGuards:true};
  const unavailable=createCustomerDeletionWorker(workerConfig);
  await assert.rejects(unavailable(customer,customerReq),{code:'WORKER_NOT_ENABLED'});
  await store.releaseLease(resumed);
  const worker=createCustomerDeletionWorker({...workerConfig,orderCleanup:{
    archive:()=>assert.fail('completed archive step must not rerun'),
    redact:()=>assert.fail('completed redaction step must not rerun'),
  }});
  assert.equal((await worker(customer,customerReq)).status,'COMPLETED');
  assert.equal((await worker(customer,customerReq)).status,'COMPLETED');
  assert.equal(await get('AccountDeletion',phoneKey),undefined);
  assert.equal(await get('Customers',{userId:customer}),undefined);
  await put('CustomerPhoneAuth',{...authPointer,sessionId:'new-account'});
  await cleanupIdentity.purgeVerification(resumed,resumed.job);
  await cleanupIdentity.finish(resumed,resumed.job);
  assert.equal((await get('CustomerPhoneAuth',{id:authPointer.id})).sessionId,'new-account');
  assert.deepEqual(identityActions,['AdminDisableUserCommand','AdminUserGlobalSignOutCommand','AdminDeleteUserCommand']);

  const freshRequest='12345678-0000-4000-8000-000000000032';
  await put('Customers',{userId:freshCustomer,cognitoSub:freshCustomer});
  await put('Addresses',{addressId:'fresh-address',userId:freshCustomer});
  const funding=require('../../../backend/account-deletion/customer-delivery-funding-archive');
  const usage={pk:'DELIVERY_USAGE#fixture-campaign',sk:'CUSTOMER#'+freshCustomer,
    schemaVersion:1,version:1,reservedUses:0,completedUses:1};
  await put('PlatformStaff',{...usage,digest:funding.hash(usage)});
  const freshAuth=token('customer',freshCustomer);
  const freshChallenge=await call(freshAuth,'send',{input:{requestId:freshRequest}});
  const freshIntake=await call(freshAuth,'request',{input:{
    requestId:freshRequest,challengeId:freshChallenge.challengeId,code:messages.at(-1),
  }});
  assert.equal(freshIntake.status,'READY');
  let freshIdentity={Username:freshCustomer,Enabled:true,UserStatus:'CONFIRMED',UserAttributes:[
    {Name:'sub',Value:freshCustomer},{Name:'phone_number',Value:freshPhone},
    {Name:'phone_number_verified',Value:'true'},
  ]};
  const freshIdentityClient={async send(command) {
    assert.equal(command.input.Username,freshCustomer);
    switch (command.constructor.name) {
      case 'AdminGetUserCommand':
        if (!freshIdentity) throw Object.assign(Error(),{name:'UserNotFoundException'});
        return freshIdentity;
      case 'AdminDisableUserCommand':
        freshIdentity.Enabled=false;
        return {};
      case 'AdminUserGlobalSignOutCommand':
        return {};
      case 'AdminDeleteUserCommand':
        freshIdentity=null;
        return {};
      default:
        assert.fail('Unexpected Cognito operation');
    }
  }};
  const fullWorker=createCustomerDeletionWorker({
    ...workerConfig,cognito:freshIdentityClient,settlement,deliveryFundingArchiveEnabled:true,
  });
  const {runDeletionSweep}=require('../../../backend/account-deletion/scheduler');
  const sweepFresh=()=>runDeletionSweep({db,table:suffix('AccountDeletion'),environment:'production',
    enabledTypes:['CUSTOMER'],processRequest:r=>fullWorker(r.subjectId,r.requestId)});
  const firstSweep=await sweepFresh();
  assert.equal(firstSweep.failed,1);
  assert.equal((await call(freshAuth,'status')).request.status,'RETRY_REQUIRED');
  time+=61000;
  const sweep=await sweepFresh();
  assert.equal(sweep.failed,0);
  assert.equal(sweep.processed,1);
  assert.equal((await call(null,'receipt',{input:{receiptToken:freshIntake.receiptToken}})).request.status,'COMPLETED');
  assert.equal(await get('Customers',{userId:freshCustomer}),undefined);
  assert.equal(await get('Addresses',{addressId:'fresh-address'}),undefined);
  const fundingArchive=await get('AccountDeletionFinancialArchive',{
    pk:'REQUEST#'+freshRequest,sk:'DELIVERY_FUNDING#'+funding.hash({pk:usage.pk,sk:usage.sk}),
  });
  assert.equal(fundingArchive.data.completedUses,1);
  assert.equal(fundingArchive.sourceTable,suffix('PlatformStaff'));

  assert.equal(freshIdentity,null);

  const driverDataRequest={
    pk:'SUBJECT#DRIVER#'+driver,sk:'REQUEST#'+driverReq,actorType:'DRIVER',status:'PROCESSING',
    subjectId:driver,requestId:driverReq,scope:{kind:'ACCOUNT',id:driver},version:1,policyVersion,
    requiredSteps:driverSteps,leaseOwner:'driver-cleanup-test',leaseUntil:Math.floor(time/1000)+180,
  };
  const driverWalletId='WALLET#DRIVER#'+driver;
  const driverDataJob={subjectId:driver,requestId:driverReq,profileIds:[driver],walletIds:[driverWalletId],policyVersion,financialYears:7};
  const driverLive={driverId:driver,currentOrderId:null,activeOrdersCount:0};
  const driverToken={token:'driver-cleanup-token',subjectId:driver,app:'driver'};
  await Promise.all([
    put('AccountDeletion',driverDataRequest),
    put('AccountDeletion',{pk:'ACCOUNT_LIFECYCLE#DRIVER#'+driver,sk:'META',requestId:driverReq,state:'CLOSING'}),
    put('DriverLiveState',{...driverLive,currentOrderId:'assigned-order',activeOrdersCount:1}),
    put('PushDeviceTokens',driverToken),
    put('PushDeviceTokens',{token:'same-subject-customer',subjectId:driver,app:'user'}),
    put('WalletNotifications',{eventId:'driver-notice',driverId:driver,recipientApp:'driver'}),
    put('OrderConnections',{connectionId:'driver-connection=',audience:'DRIVER#'+driver,
      scope:{role:'driver',subjectId:driver}}),
    put('OrderConnections',{connectionId:'customer-connection=',audience:'CUSTOMER#'+driver,
      scope:{role:'customer',subjectId:driver}}),
    put('WalletNotifications',{eventId:'same-subject-merchant',driverId:driver,recipientApp:'merchant'}),
  ]);
  const driverDisconnections=[];
  const orderSocket={async send(command) {
    driverDisconnections.push(command.input.ConnectionId);
    await db.send(new DeleteCommand({TableName:suffix('OrderConnections'),Key:{connectionId:command.input.ConnectionId}}));
    throw Object.assign(Error('already gone'),{name:'GoneException'});
  }};
  const runDriverData=(dbClient=db)=>purgeDriverApplicationData({
    db:dbClient,orderSocket,request:driverDataRequest,job:driverDataJob,clock:()=>time,
  });
  await assert.rejects(runDriverData(),{code:'ACTIVE_ORDER_AFTER_LOCK'});
  await put('DriverLiveState',driverLive);
  const changedToken={async send(command) {
    if(command.input.TransactItems) await put('PushDeviceTokens',{...driverToken,app:'user'});
    return db.send(command);
  }};
  await assert.rejects(runDriverData(changedToken),{name:'TransactionCanceledException'});
  assert.ok(await get('WalletNotifications',{eventId:'driver-notice'}));
  assert.ok(await get('DriverLiveState',{driverId:driver}));
  await put('PushDeviceTokens',driverToken);
  await runDriverData();
  await runDriverData();
  assert.equal(await get('DriverLiveState',{driverId:driver}),undefined);
  assert.equal(await get('PushDeviceTokens',{token:driverToken.token}),undefined);
  assert.equal(await get('WalletNotifications',{eventId:'driver-notice'}),undefined);
  assert.ok(await get('PushDeviceTokens',{token:'same-subject-customer'}));
  assert.ok(await get('WalletNotifications',{eventId:'same-subject-merchant'}));
  assert.deepEqual(driverDisconnections,['driver-connection=']);
  assert.equal(await get('OrderConnections',{connectionId:'driver-connection='}),undefined);
  assert.ok(await get('OrderConnections',{connectionId:'customer-connection='}));

  const ledger={walletId:driverWalletId,sk:'2026-11-26T08:00:00Z#LOCKED#entry1',
    transactionId:'entry1',type:'DEBIT',category:'ORDER_EXCEPTION_FINANCIAL',amount:-400,
    balanceBefore:400,balanceAfter:0,currency:'IQD',createdAt:'2026-11-26T08:00:00Z',
    metadata:{financialSchemaVersion:5,orderId:'financial-order',phone:'do-not-archive'}};
  const topup={topupId:'driver-topup',sk:'META',walletId:driverWalletId,driverId:driver,
    amount:2000,status:'PENDING',method:'CASH',currency:'IQD',createdAt:'2026-11-26T08:00:00Z',
    transferReference:'do-not-archive',evidenceRef:'receipts/private',phone:'do-not-archive'};
  await Promise.all([put('LedgerEntries',ledger),put('TopupRequests',topup)]);
  const driverArchive=(dbClient=db)=>archiveDriverWalletRecords({
    db:dbClient,request:driverDataRequest,job:driverDataJob,clock:()=>time,
  });
  const ledgerSourceKey={walletId:ledger.walletId,sk:ledger.sk};
  const driverLedgerArchiveKey={pk:'REQUEST#'+driverReq,sk:'LEDGER#'+JSON.stringify(ledgerSourceKey)};
  await assert.rejects(driverArchive(),{code:'SETTLEMENT_REQUIRED'});
  assert.equal(await get('AccountDeletionFinancialArchive',driverLedgerArchiveKey),undefined);
  await put('TopupRequests',{...topup,status:'APPROVED'});
  const lateLedgerHold={async send(command) {
    if(command.input.TransactItems) await put('LedgerEntries',{...ledger,retentionHold:true});
    return db.send(command);
  }};
  await assert.rejects(driverArchive(lateLedgerHold),{name:'TransactionCanceledException'});
  assert.equal(await get('AccountDeletionFinancialArchive',driverLedgerArchiveKey),undefined);
  await put('LedgerEntries',ledger);
  await driverArchive();
  const savedDriverLedger=await get('AccountDeletionFinancialArchive',driverLedgerArchiveKey);
  assert.equal(savedDriverLedger.data.amount,-400);
  assert.equal(savedDriverLedger.data.orderId,'financial-order');
  assert.equal(savedDriverLedger.data.financialSchemaVersion,5);
  assert.equal(new Date(savedDriverLedger.expiresAt*1000).getUTCFullYear(),2033);
  assert.deepEqual(await get('LedgerEntries',ledgerSourceKey),ledger);
  const driverTopupArchiveKey={pk:'REQUEST#'+driverReq,sk:'TOPUP#'+JSON.stringify({topupId:topup.topupId,sk:'META'})};
  const savedDriverTopup=await get('AccountDeletionFinancialArchive',driverTopupArchiveKey);
  assert.equal(savedDriverTopup.data.amount,2000);
  assert.doesNotMatch(JSON.stringify([savedDriverLedger,savedDriverTopup]),/do-not-archive|receipts\/private/);
  time+=1000;
  await driverArchive();
  assert.deepEqual(await get('AccountDeletionFinancialArchive',driverLedgerArchiveKey),savedDriverLedger);

  const driverAudit={datePartition:'date#20261126',sk:'2026-11-26T08:00:00Z#driver-audit',
    actorId:driver,actorIdentityEvidence:'VERIFIED_DRIVER_AT_ACTION',
    actorSnapshot:{driverId:driver,name:'private audit name'},action:'DRIVER_PAYOUT_REQUESTED',
    references:{walletId:driverWalletId,orderId:'financial-order'},reason:'private audit memo'};
  await put('AuditLog',driverAudit);
  const staffAudit={...driverAudit,sk:driverAudit.sk+'#staff',actorId:'finance-employee',
    actorIdentityEvidence:'VERIFIED_STAFF_AT_ACTION',
    actorSnapshot:{employeeId:'finance-employee',name:'retain staff name'},reason:'retain staff audit memo'};
  await put('AuditLog',staffAudit);
  await driverArchive();
  const auditSourceKey={datePartition:driverAudit.datePartition,sk:driverAudit.sk};
  const savedAudit=await get('AccountDeletionFinancialArchive',{
    pk:'REQUEST#'+driverReq,sk:'AUDIT#'+JSON.stringify(auditSourceKey),
  });
  assert.equal(savedAudit.data.orderId,'financial-order');
  assert.equal(savedAudit.data.walletId,driverWalletId);
  assert.doesNotMatch(JSON.stringify(savedAudit),/private audit/);
  const redactedAudit=await get('AuditLog',auditSourceKey);
  assert.deepEqual(redactedAudit.actorSnapshot,{driverId:driver});
  assert.equal(redactedAudit.reason,undefined);
  assert.deepEqual(redactedAudit.references,driverAudit.references);
  assert.deepEqual(await get('AuditLog',{datePartition:staffAudit.datePartition,sk:staffAudit.sk}),staffAudit);
  await driverArchive();
  assert.deepEqual(await get('AuditLog',auditSourceKey),redactedAudit);


  const sharedKey={PK:'ORDER#driver-shared-order',SK:'META'};
  const sharedOrder={...sharedKey,orderId:'driver-shared-order',driverId:driver,
    assignedDriverId:driver,driverName:'private-driver-name',driverPhone:'private-driver-phone',
    driverLocation:{latitude:1,longitude:2},userSub:outsider,customerPhone:'other-party-phone',
    storeId:'branch1',merchantId:'merchant1',status:'delivered',total:3400,createdAt:'2026-11-26T08:00:00Z',
    financialSnapshot:{digest:'fixture-evidence'},financialAcceptance:{offerId:'retained-offer'}};
  const redactDriverContact=()=>redactDriverOrderContact({
    db,request:driverDataRequest,job:driverDataJob,clock:()=>time,
  });
  await put('Orders',{...sharedOrder,status:'assigned'});
  await assert.rejects(redactDriverContact(),{code:'ACTIVE_ORDER_AFTER_LOCK'});
  await put('Orders',{...sharedOrder,assignedDriverId:outsider});
  await assert.rejects(redactDriverContact(),{code:'INVALID_CLEANUP_SCOPE'});
  await put('Orders',sharedOrder);
  await redactDriverContact();
  await redactDriverContact();
  const cleanedShared=await get('Orders',sharedKey);
  assert.equal(cleanedShared.driverName,undefined);
  assert.equal(cleanedShared.driverPhone,undefined);
  assert.equal(cleanedShared.driverLocation,undefined);
  assert.equal(cleanedShared.customerPhone,sharedOrder.customerPhone);
  assert.equal(cleanedShared.driverId,driver);
  assert.deepEqual(cleanedShared.financialSnapshot,sharedOrder.financialSnapshot);
  assert.deepEqual(cleanedShared.financialAcceptance,sharedOrder.financialAcceptance);
  const sharedArchive=await get('AccountDeletionFinancialArchive',{
    pk:'REQUEST#'+driverReq,sk:'DRIVER_ORDER#'+JSON.stringify(sharedKey),
  });
  assert.equal(sharedArchive.data.total,3400);
  assert.doesNotMatch(JSON.stringify(sharedArchive),/private-driver|other-party-phone|fixture-evidence/);

  await put('Orders',{...cleanedShared,orderStatus:'delivered'});
  const sharedOffer={orderId:sharedOrder.orderId,SK:'FINANCIAL#'+driver+'#WAVE#1',driverId:driver,
    responseStatus:'financial_accepted',financialOffer:{source:{driver:{point:{latitude:1,longitude:2}}}}};
  const foreignOffer={...sharedOffer,SK:'FINANCIAL#'+outsider+'#WAVE#1',driverId:outsider};
  const sharedPayable={orderId:sharedOrder.orderId,sk:'MERCHANT_PAYABLE',amount:1700,
    status:'LOCKED_PENDING_SETTLEMENT',settlementEvidence:{digest:'fixture-settlement-proof'}};
  const sharedOutcome={orderId:sharedOrder.orderId,sk:'FINANCIAL_OUTCOME',operationId:'driver-shared-proof'};
  await Promise.all([
    put('WaveOffers',sharedOffer),put('WaveOffers',foreignOffer),put('Holds',sharedPayable),put('Holds',sharedOutcome),
  ]);
  const offerCleanup=createDriverOfferCleanup({
    async preserveMerchantSettlementEvidence(_db,branchId,orderId){
      assert.equal(branchId,'branch1');assert.equal(orderId,sharedOrder.orderId);
    },
    async readMerchantAccrualEvidence(){
      return {order:await get('Orders',sharedKey),payable:await get('Holds',{orderId:sharedOrder.orderId,sk:'MERCHANT_PAYABLE'}),
        outcomeKey:{orderId:sharedOrder.orderId,sk:'FINANCIAL_OUTCOME'},outcome:sharedOutcome};
    },
  });
  const offerArgs={db,request:driverDataRequest,job:driverDataJob,clock:()=>time};
  await offerCleanup.preflight(offerArgs);
  await put('Holds',{...sharedPayable,settlementEvidence:null});
  await assert.rejects(offerCleanup.redact(offerArgs),{code:'FINANCIAL_ARCHIVE_SOURCE_REQUIRED'});
  await put('Holds',sharedPayable);
  await offerCleanup.redact(offerArgs);
  await offerCleanup.redact(offerArgs);
  const ownOfferKey={orderId:sharedOffer.orderId,SK:sharedOffer.SK};
  assert.equal((await get('WaveOffers',ownOfferKey)).financialOffer,undefined);
  assert.equal((await get('WaveOffers',ownOfferKey)).responseStatus,'financial_accepted');
  assert.deepEqual(await get('WaveOffers',{orderId:foreignOffer.orderId,SK:foreignOffer.SK}),foreignOffer);
  assert.deepEqual(await get('Holds',{orderId:sharedOrder.orderId,sk:'MERCHANT_PAYABLE'}),sharedPayable);

  const {quoteHash}=require('../../../backend/wallet-service/dist/deliveryQuoteRecord');
  const cancelledDriverOrderId='driver-cancelled-zero';
  const returnedDriverOrderId='driver-returned-paid';
  const legacyDriverOrderId='driver-expired-legacy';
  const cancellationCaseId='driver-cancelled-case';
  const returnCaseId='driver-returned-case';
  const when='2026-11-26T08:00:00Z';
  const financialClosure={actorId:'staff-fixture',closedAt:when};
  const zeroJournalBody={orderId:cancelledDriverOrderId,sk:'EXCEPTION_ENTITLEMENTS',
    kind:'ORDER_EXCEPTION_ENTITLEMENTS_JOURNAL',state:'POSTED',branchId:'branch1',caseId:cancellationCaseId,
    operationId:'cancel-exception',merchantCompensationIqd:0,
    cancellationCompensation:{cancellationOperationId:'cancel-operation'}};
  const zeroJournal={...zeroJournalBody,digest:quoteHash(zeroJournalBody)};
  const paidDriverOrder={PK:'ORDER#'+returnedDriverOrderId,SK:'META',orderId:returnedDriverOrderId,
    driverId:driver,status:'returned',orderStatus:'returned',returnCaseId,storeId:'branch1'};
  const returnPayable={orderId:returnedDriverOrderId,sk:'MERCHANT_PAYABLE',status:'PAID',
    settlementEvidence:{digest:'return-proof-fixture'}};
  const returnOutcome={orderId:returnedDriverOrderId,sk:'EXCEPTION_ENTITLEMENTS',operationId:'return-operation'};
  const cancelledDriverOffer={orderId:cancelledDriverOrderId,SK:sharedOffer.SK,driverId:driver,
    responseStatus:'financial_accepted',isWinner:true,financialOffer:sharedOffer.financialOffer};
  const returnedDriverOffer={...cancelledDriverOffer,orderId:returnedDriverOrderId};
  const expiredDriverOffer={orderId:legacyDriverOrderId,SK:'LEGACY#'+driver,driverId:driver,
    responseStatus:'expired',isWinner:false,legacyPresentation:{address:'private-legacy-address'},
    legacyPresentationDigest:'keep-legacy-digest'};
  const cancellationCase={orderId:cancelledDriverOrderId,sk:'CUSTOMER_CANCELLATION',kind:'CUSTOMER_CANCELLATION',
    caseId:cancellationCaseId,state:'CANCELLED',settlementStatus:'RESOLVED',financialClosure,
    merchantCompensation:{paymentStatus:'ZERO_APPROVED'},entitlementsPosted:{
      operationId:zeroJournal.operationId,journalDigest:zeroJournal.digest,merchantCompensationIqd:0,
    }};
  await Promise.all([
    put('Orders',{PK:'ORDER#'+cancelledDriverOrderId,SK:'META',orderId:cancelledDriverOrderId,driverId:driver,
      status:'cancelled',orderStatus:'cancelled',storeId:'branch1',financialOutcome:'cancel-operation'}),
    put('Orders',paidDriverOrder),
    put('Orders',{PK:'ORDER#'+legacyDriverOrderId,SK:'META',orderId:legacyDriverOrderId,driverId:outsider,
      status:'delivered',orderStatus:'delivered',storeId:'branch1'}),
    put('Holds',cancellationCase),put('Holds',zeroJournal),
    put('Holds',{orderId:returnedDriverOrderId,sk:'RETURN#1',kind:'COD_RETURN_CASE',returnId:returnCaseId,
      taskCompletion:{returnId:returnCaseId},exceptionResolution:{status:'RESOLVED'},financialClosure}),
    put('Holds',returnPayable),put('Holds',returnOutcome),
    put('WaveOffers',cancelledDriverOffer),put('WaveOffers',returnedDriverOffer),put('WaveOffers',expiredDriverOffer),
  ]);
  const historicOffers=createDriverOfferCleanup({
    verifyZeroMerchantException:settlement.verifyZeroMerchantException,
    async preserveMerchantSettlementEvidence(_db,branchId,orderId) {
      assert.equal(branchId,'branch1');assert.equal(orderId,returnedDriverOrderId);
    },
    async readMerchantAccrualEvidence(_db,branchId,orderId) {
      assert.equal(branchId,'branch1');assert.equal(orderId,returnedDriverOrderId);
      return {order:paidDriverOrder,payable:await get('Holds',{orderId,sk:'MERCHANT_PAYABLE'}),
        outcome: returnOutcome,outcomeKey:{orderId,sk:'EXCEPTION_ENTITLEMENTS'}};
    },
  });
  await put('Holds',{...cancellationCase,correctionReview:{status:'PENDING'}});
  await assert.rejects(historicOffers.preflight(offerArgs),{code:'ORDER_EXCEPTION_CLOSURE_REQUIRED'});
  await put('Holds',cancellationCase);
  await put('Holds',{...returnPayable,status:'LOCKED_PENDING_SETTLEMENT'});
  await assert.rejects(historicOffers.preflight(offerArgs),{code:'ORDER_EXCEPTION_CLOSURE_REQUIRED'});
  await put('Holds',returnPayable);
  await put('WaveOffers',{...expiredDriverOffer,responseStatus:'accepted',isWinner:true});
  await assert.rejects(historicOffers.preflight(offerArgs),{code:'DRIVER_OFFER_SETTLEMENT_CLOSURE_REQUIRED'});
  await put('WaveOffers',expiredDriverOffer);
  await historicOffers.preflight(offerArgs);
  await historicOffers.redact(offerArgs);
  await historicOffers.redact(offerArgs);
  for (const offer of [cancelledDriverOffer,returnedDriverOffer,expiredDriverOffer]) {
    const row=await get('WaveOffers',{orderId:offer.orderId,SK:offer.SK});
    assert.equal(row.financialOffer,undefined);
    assert.equal(row.legacyPresentation,undefined);
    assert.equal(row.responseStatus,offer.responseStatus);
    assert.equal(row.legacyPresentationDigest,offer.legacyPresentationDigest);
  }
  assert.deepEqual(await get('Holds',{orderId:cancelledDriverOrderId,sk:'EXCEPTION_ENTITLEMENTS'}),zeroJournal);
  assert.deepEqual(await get('Holds',{orderId:returnedDriverOrderId,sk:'MERCHANT_PAYABLE'}),returnPayable);

  const pinnedId='driver-old-captured',pinnedKey={PK:'ORDER#'+pinnedId,SK:'META'};
  const acceptedAt='2026-11-26T08:00:00Z',capturedAt='2026-11-26T08:10:00Z';
  const pinnedReceipt={kind:'PINNED_LEGACY_ACCEPTANCE',success:true,orderId:pinnedId,offerId:'pinned-old-offer',
    driverId:driver,subjectId:driver,acceptedAt,assignmentAttempt:1,holdId:'pinned-hold',
    holdStatus:'ACTIVE',holdAmount:1200,acceptanceAttemptId:'legacy-attempt'};
  const pinnedOffer={orderId:pinnedId,SK:'LEGACY#'+driver,driverId:driver,driverSubjectId:driver,
    responseStatus:'accepted',isWinner:true,offerId:pinnedReceipt.offerId,dispatchReceipt:pinnedReceipt,
    dispatchCycleId:'cycle1',legacyTermsDigest:'a'.repeat(64),waveNumber:1,responseAt:acceptedAt,
    holdRequiredAmount:1200,legacyPresentation:{driverPosition:{latitude:1,longitude:2}}};
  const pinnedHold={orderId:pinnedId,sk:'HOLD',holdId:'pinned-hold',walletId:driverWalletId,
    amount:1200,capturedAmount:1000,capturedAt,status:'CAPTURED',
    metadata:{pinnedDispatchAttemptId:pinnedReceipt.acceptanceAttemptId}};
  const legaRow={transactionId:'legacy-txn',relatedEntityId:pinnedHold.holdId,relatedEntityType:'HOLD',
    balance:0,createdAt:capturedAt,metadata:{orderId:pinnedId,holdId:pinnedHold.holdId}};
  const legacyDebit={...legaRow,walletId:driverWalletId,sk:'ts#'+capturedAt+'#legacy-txn#0',
    type:'HOLD_CAPTURED',amount:-1200};
  const legacyCredit={...legaRow,walletId:'WALLET#PLATFORM',sk:'ts#'+capturedAt+'#legacy-txn#1',
    type:'SETTLEMENT_RECEIVED',amount:1000};
  const legacyRemainder={...legacyCredit,walletId:driverWalletId,type:'HOLD_PARTIAL_RELEASE',amount:200};
  const pinnedOfferKey={orderId:pinnedId,SK:pinnedOffer.SK};
  await Promise.all([
    put('Orders',{...pinnedKey,orderId:pinnedId,driverId:driver,status:'delivered',orderStatus:'delivered',
      assignmentAttemptCounter:1,assignmentWaveNumber:1,holdId:pinnedHold.holdId,holdAmount:1200,
      holdStatus:'CAPTURED',dispatchAcceptance:pinnedReceipt,storeId:'branch1'}),
    put('WaveOffers',pinnedOffer),put('Holds',pinnedHold),
    put('DispatchJobs',{orderId:pinnedId,SK:'DISPATCH_ACCEPTANCE#legacy-attempt',kind:'LEGACY_ACCEPTANCE_ATTEMPT',
      state:'ASSIGNED',attemptId:'legacy-attempt',driverId:driver,subjectId:driver,offerId:pinnedOffer.offerId,
      cycleId:pinnedOffer.dispatchCycleId,offerDigest:pinnedOffer.legacyTermsDigest,amount:1200,
      holdId:pinnedHold.holdId,receipt:pinnedReceipt}),
    put('WalletLifecycle',{operationId:pinnedHold.holdId,orderId:pinnedId,walletId:driverWalletId,
      amount:1200,status:'COMPLETED',result:'CAPTURED'}),
    put('LedgerEntries',legacyDebit),put('LedgerEntries',legacyRemainder),
  ]);
  await assert.rejects(historicOffers.preflight(offerArgs),{code:'LEGACY_DRIVER_SETTLEMENT_PROOF_REQUIRED'});
  assert.ok((await get('WaveOffers',pinnedOfferKey)).legacyPresentation);
  await put('LedgerEntries',legacyCredit);
  await historicOffers.preflight(offerArgs);
  await historicOffers.redact(offerArgs);
  await historicOffers.redact(offerArgs);
  const keptPinned=await get('WaveOffers',pinnedOfferKey);
  assert.equal(keptPinned.legacyPresentation,undefined);
  assert.deepEqual(keptPinned.dispatchReceipt,pinnedReceipt);
  assert.equal(keptPinned.legacyTermsDigest,pinnedOffer.legacyTermsDigest);
  assert.deepEqual(await get('Holds',{orderId:pinnedId,sk:'HOLD'}),pinnedHold);
  await driverArchive();
  const legacyLedgerArchive=await get('AccountDeletionFinancialArchive',{
    pk:'REQUEST#'+driverReq,sk:'LEDGER#'+JSON.stringify({walletId:driverWalletId,sk:legacyDebit.sk}),
  });
  assert.equal(legacyLedgerArchive.data.balance,0);
  assert.equal(legacyLedgerArchive.data.orderId,pinnedId);

  const driverProfile={driverId:driver,cognitoSub:driver,deletionRequestId:driverReq,status:'SUSPENDED'};
  const finishedJob={...driverDataJob,username:driver,pool:identities.driver.poolId,wallets:[],phone:'+9647800000071'};
  const driverIdentityDelete=[];
  let absent=false;
  const driverFinalization=createDriverFinalization({
    db,poolId:identities.driver.poolId,driverSteps,clock:()=>time,
    readIdentity:async()=> {
      if(absent) throw Object.assign(Error('already gone'),{name:'UserNotFoundException'});
      return {username:driver,phone:finishedJob.phone,enabled:false};
    },
    cognito:{async send(command) {
      assert.equal(command.constructor.name,'AdminDeleteUserCommand');
      driverIdentityDelete.push(command.input);
      absent=true;
      throw Error('interrupted after Cognito deletion');
    }},
  });
  const finalize={request:driverDataRequest,job:finishedJob};
  await put('Drivers',driverProfile);
  await assert.rejects(driverFinalization.profileClosure(finalize),{code:'CLEANUP_INCOMPLETE'});
  for(const step of driverSteps.slice(0,driverSteps.indexOf('profileClosure'))) {
    await store.completeStep(driverDataRequest,step,new Date(time).toISOString());
  }
  await driverFinalization.profileClosure(finalize);
  await driverFinalization.profileClosure(finalize);
  assert.equal(await get('Drivers',{driverId:driver}),undefined);
  await store.completeStep(driverDataRequest,'profileClosure',new Date(time).toISOString());
  await assert.rejects(driverFinalization.identityClosure(finalize),{code:'DRIVER_ENROLLMENT_CLEANUP_REQUIRED'});
  const enrollmentKey=driverPhoneClosureKey(finishedJob.phone);
  const registrationMarker={...enrollmentKey,subjectId:driver,requestId:driverReq,lockedAt:Math.floor(time/1000)};
  await put('AccountDeletion',registrationMarker);
  await put('DriverOtpSessions',{id:'driver-registration-otp',phone:finishedJob.phone,purpose:'registration-otp'});
  await put('DriverOtpSessions',{id:'ACTIVE#'+finishedJob.phone,sessionId:'driver-registration-otp'});
  await put('DriverOtpSessions',{id:'driver-login-proof',username:driver,purpose:'login-proof'});
  await put('DriverOtpSessions',{id:'LOGIN#'+driver,proofId:'driver-login-proof'});
  await put('DriverOtpSessions',{id:'unrelated-proof',username:outsider,purpose:'login-proof'});
  const enrollmentGuard=purgeDriverRegistration;
  await assert.rejects(driverFinalization.identityClosure({...finalize,enrollmentGuard}),{code:'DRIVER_ENROLLMENT_WRITES_DRAINING'});
  time+=61000;
  await assert.rejects(driverFinalization.identityClosure({...finalize,enrollmentGuard}),/interrupted after Cognito deletion/);
  assert.ok(await get('AccountDeletion',enrollmentKey));
  assert.equal(await get('DriverOtpSessions',{id:'driver-registration-otp'}),undefined);
  assert.equal(await get('DriverOtpSessions',{id:'driver-login-proof'}),undefined);
  await driverFinalization.identityClosure({...finalize,enrollmentGuard});
  await driverFinalization.identityClosure({...finalize,enrollmentGuard});
  assert.equal(await get('AccountDeletion',enrollmentKey),undefined);
  assert.ok(await get('DriverOtpSessions',{id:'unrelated-proof'}));
  assert.deepEqual(driverIdentityDelete,[{UserPoolId:identities.driver.poolId,Username:driver}]);

  const transfer={idempotencyKey:'TRANSFER#driver-transfer',sk:'META',transferId:'driver-transfer',
    sourceWalletId:driverWalletId,recipientWalletId:'WALLET#CUSTOMER#'+outsider,amount:1000,status:'PENDING_APPROVAL',
    currency:'IQD',createdAt:'2026-11-26T08:00:00Z',requestedBy:driver,reason:'private transfer note'};
  await put('IdempotencyKeys',transfer);
  const transferSourceKey={idempotencyKey:transfer.idempotencyKey,sk:transfer.sk};
  const transferArchiveKey={pk:'REQUEST#'+driverReq,sk:'TRANSFER#'+JSON.stringify(transferSourceKey)};
  await assert.rejects(driverArchive(),{code:'SETTLEMENT_REQUIRED'});
  assert.equal(await get('AccountDeletionFinancialArchive',transferArchiveKey),undefined);
  const completedTransfer={...transfer,status:'COMPLETED'};
  await put('IdempotencyKeys',completedTransfer);
  await driverArchive();
  const savedTransfer=await get('AccountDeletionFinancialArchive',transferArchiveKey);
  assert.equal(savedTransfer.data.amount,1000);
  assert.equal(savedTransfer.data.recipientWalletId,transfer.recipientWalletId);
  assert.equal(savedTransfer.data.reason,undefined);
  assert.equal(savedTransfer.data.requestedBy,undefined);
  assert.deepEqual(await get('IdempotencyKeys',transferSourceKey),completedTransfer);

  const freshDriver='12345678-0000-4000-8000-000000000081';
  const freshDriverRequest='12345678-0000-4000-8000-000000000082';
  const freshDriverPhone='+9647800000081';
  await put('Drivers',{driverId:freshDriver,cognitoSub:freshDriver,status:'APPROVED'});
  await put('DriverPerformanceSnapshots',{pk:'DRIVER#'+freshDriver,sk:'STATE',driverId:freshDriver});
  let driverCode;
  const driverIntake=createApi({
    db,clock:()=>time,allowedTypes:['DRIVER'],executionTypes:new Set(['DRIVER']),
    inspect:createDriverDeletionEvidence({db,clock:()=>time}),
    cognito:{async send() { return {Username:freshDriver,UserAttributes:[
      {Name:'sub',Value:freshDriver},{Name:'phone_number',Value:freshDriverPhone},
      {Name:'phone_number_verified',Value:'true'},
    ]}; }},
    secret:async()=>({hmacKey:'driver-local-key',apiKey:'local-test'}),
    deliver:async(_key,_phone,code)=>{driverCode=code;},
  });
  const driverCall=async(operation,input,auth=true)=>{
    const response=await driverIntake({resource:path,path:'/deletion/'+operation,requestContext:{stage:'production'},
      httpMethod:input?'POST':'GET',headers:auth?{authorization:'Bearer '+token('driver',freshDriver)}:{},
      body:input?JSON.stringify(input):undefined});
    assert.equal(response.statusCode,200,response.body);
    return JSON.parse(response.body);
  };
  await put('OrderRatings',{pk:'ORDER#requires-review',driverId:freshDriver});
  assert.ok((await driverCall('eligibility')).blockers.some(item=>item.code==='DRIVER_RATING_RETENTION_REVIEW_REQUIRED'));
  await db.send(new DeleteCommand({TableName:suffix('OrderRatings'),Key:{pk:'ORDER#requires-review'}}));
  await put('SupportChatSessions',{sessionId:'driver-review-test',userType:'driver',userId:freshDriver});
  assert.ok((await driverCall('eligibility')).blockers.some(item=>item.code==='DRIVER_SUPPORT_RETENTION_REVIEW_REQUIRED'));
  await put('SupportChatSessions',{sessionId:'driver-review-test',userType:'driver',userId:freshDriver,legalHold:true});
  assert.ok((await driverCall('eligibility')).blockers.some(item=>item.code==='DOCUMENTED_RETENTION_HOLD'));
  await db.send(new DeleteCommand({TableName:suffix('SupportChatSessions'),Key:{sessionId:'driver-review-test'}}));
  const driverChallenge=await driverCall('send',{requestId:freshDriverRequest});
  const driverRequest=await driverCall('request',{requestId:freshDriverRequest,challengeId:driverChallenge.challengeId,code:driverCode});
  assert.equal(driverRequest.status,'READY');
  const newDriverOtp={id:'new-driver-login-proof',username:freshDriver,purpose:'login-proof'};
  await put('DriverOtpSessions',newDriverOtp);
  let driverEnabled=true,driverExists=true;
  const driverWorker=createDriverDeletionWorker({
    db,settlement,verifiedMutationGuards:true,verifiedEnrollmentGuards:true,clock:()=>time,
    s3:{send:async()=>({})},orderSocket:{send:()=>assert.fail('no connection exists')},
    cognito:{async send(command) {
      assert.equal(command.input.Username,freshDriver);
      const name=command.constructor.name;
      if(name==='AdminGetUserCommand') {
        if(!driverExists)throw Object.assign(Error(),{name:'UserNotFoundException'});
        return {Username:freshDriver,Enabled:driverEnabled,UserStatus:'CONFIRMED',UserAttributes:[
          {Name:'sub',Value:freshDriver},{Name:'phone_number',Value:freshDriverPhone},
          {Name:'phone_number_verified',Value:'true'},
        ]};
      }
      if(name==='AdminDisableUserCommand')driverEnabled=false;
      if(name==='AdminDeleteUserCommand')driverExists=false;
      return {};
    }},
  });
  const sweepDriver=(processRequest=r=>driverWorker(r.subjectId,r.requestId))=>runDeletionSweep({
    db,table:suffix('AccountDeletion'),environment:'production',enabledTypes:['DRIVER'],processRequest,
  });
  let overlappingSweep;
  assert.equal((await sweepDriver(async r=>{
    overlappingSweep=await sweepDriver(()=>assert.fail('overlapping sweep must skip processing'));
    return driverWorker(r.subjectId,r.requestId);
  })).failed,1);
  assert.deepEqual(overlappingSweep,{processed:0,failed:0,skipped:0,pages:0});
  time+=61000;
  const driverSweep=await sweepDriver();
  assert.equal(driverSweep.processed,1);
  assert.equal(driverSweep.failed,0);
  assert.equal((await driverCall('receipt',{receiptToken:driverRequest.receiptToken},false)).request.status,'COMPLETED');
  assert.equal(driverExists,false);
  assert.equal(await get('Drivers',{driverId:freshDriver}),undefined);
  assert.equal(await get('DriverPerformanceSnapshots',{pk:'DRIVER#'+freshDriver,sk:'STATE'}),undefined);
  assert.equal(await get('DriverOtpSessions',{id:newDriverOtp.id}),undefined);

  const otherOwner = token('merchant',outsider);
  const closingBranch = 'closing-branch';
  const openBranch = 'open-branch';
  const firstClosure = '12345678-0000-4000-8000-000000000017';
  const laterDeletion = '12345678-0000-4000-8000-000000000018';
  for (const businessId of [closingBranch,openBranch]) {
    await put('Merchants',{businessId,ownerId:outsider,cognitoUserId:outsider,acceptingOrders:true});
  }
  const closeInput = {requestId:firstClosure,scope:{kind:'BUSINESS',businessId:closingBranch}};
  const closeProof = await call(otherOwner,'send',{input:closeInput});
  await call(otherOwner,'request',{input:{...closeInput,challengeId:closeProof.challengeId,code:messages.at(-1)}});
  time+=61000;
  const deletionProof = await call(otherOwner,'send',{input:{requestId:laterDeletion}});
  const submission = {requestId:laterDeletion,challengeId:deletionProof.challengeId,code:messages.at(-1)};
  const currentBranch = await get('Merchants',{businessId:closingBranch});
  await put('Merchants',{...currentBranch,orderIntakeDeletionRequestId:'other-request'});
  await call(otherOwner,'request',{input:submission,expected:409});
  assert.equal((await get('Merchants',{businessId:openBranch})).orderIntakeDeletionRequestId,undefined);
  await put('Merchants',currentBranch);
  const deletionAfterClosure = await call(otherOwner,'request',{input:submission});
  assert.equal(deletionAfterClosure.status,'PENDING_SETTLEMENT');
  assert.equal((await get('Merchants',{businessId:closingBranch})).orderIntakeDeletionRequestId,firstClosure);
  assert.equal((await get('Merchants',{businessId:openBranch})).orderIntakeDeletionRequestId,laterDeletion);
  {
    const branchStore=dynamoStore({db,table:suffix('AccountDeletion'),environment:'production',clock:()=>Math.floor(time/1000)});
    const branchActor={type:'MERCHANT',sub:outsider};
    const {merchantSteps}=require('./merchant-steps.cjs');
    const received=await branchStore.get(branchActor,firstClosure);
    const ownerDeletion=await branchStore.get(branchActor,laterDeletion);
    assert.deepEqual(received.requiredSteps,merchantSteps(received.scope));
    assert.deepEqual(ownerDeletion.requiredSteps,merchantSteps(ownerDeletion.scope));
    assert.ok(!received.requiredSteps.includes('identityClosure'));
    const branchRequestLease=await branchStore.acquireLease(received);
    const evidence=await createEvidence({db,clock:()=>time})(branchActor,branchRequestLease.scope);
    const manifest={businessId:closingBranch,subjectId:outsider,requestId:firstClosure};
    await lockMerchantBranch({db,request:branchRequestLease,evidence,manifest,clock:()=>time});
    const locked=await branchStore.get(branchActor,firstClosure);
    assert.equal(locked.status,'PROCESSING');
    assert.equal((await get('Merchants',{businessId:closingBranch})).acceptingOrders,false);
    assert.equal((await get('Merchants',{businessId:openBranch})).acceptingOrders,true);
    const walletKey={walletId:'WALLET#MERCHANT#'+closingBranch,sk:'META'};
    assert.equal((await get('Wallets',walletKey)).status,'SUSPENDED');
    const member={pk:'BRANCH#'+closingBranch,sk:'MEMBER#'+merchant,ownerId:outsider,subjectId:merchant,businessId:closingBranch,version:1};
    const pointer={...member,pk:'PERSON#'+merchant,sk:'MEMBER#'+closingBranch};
    const financial={pk:member.pk,sk:'SETTLEMENT_SCHEDULE#CURRENT',version:1,enabled:true};
    const sibling={...member,pk:'BRANCH#'+openBranch,businessId:openBranch};
    await Promise.all([member,pointer,financial,sibling].map(row=>put('MerchantPlatform',row)));
    await require('../../../backend/account-deletion/merchant-staff-cleanup').purge({
      db,r:locked,job:locked.job,environment:'production',requestTable:suffix('AccountDeletion'),clock:()=>time,
    });
    for(const row of [member,pointer])assert.equal(await get('MerchantPlatform',{pk:row.pk,sk:row.sk}),undefined);
    for(const row of [financial,sibling])assert.deepEqual(await get('MerchantPlatform',{pk:row.pk,sk:row.sk}),row);
    const draftId='12345678-0000-4000-8000-000000000094';
    const draft={pk:'PERSON#'+outsider,sk:'DRAFT#'+draftId,subjectId:outsider,draftId,businessId:closingBranch};
    const otherDraft={...draft,sk:'DRAFT#other',draftId:'other',businessId:openBranch};
    await put('Merchants',{...await get('Merchants',{businessId:closingBranch}),onboardingDraftId:draftId});
    await Promise.all([draft,otherDraft].map(row=>put('MerchantPlatform',row)));
    const files=[];
    const s3={async send(command){
      if(command.constructor.name==='ListObjectVersionsCommand'){
        assert.equal(command.input.Bucket,'wizz-production-merchant-onboarding-746727375268');
        assert.equal(command.input.Prefix,'persons/'+outsider+'/drafts/'+draftId+'/');
        return {Versions:[{Key:command.input.Prefix+'document',VersionId:'v1'}]};
      }
      files.push(...command.input.Delete.Objects);
      return {};
    }};
    await require('../../../backend/account-deletion/merchant-onboarding-assets').purge({
      db,s3,r:locked,job:locked.job,environment:'production',requestTable:suffix('AccountDeletion'),draftId,now:()=>time,
    });
    assert.equal(files.length,1);
    assert.equal(await get('MerchantPlatform',{pk:draft.pk,sk:draft.sk}),undefined);
    assert.deepEqual(await get('MerchantPlatform',{pk:otherDraft.pk,sk:otherDraft.sk}),otherDraft);
    const closureOrder={PK:'ORDER#closure-order',SK:'META',orderId:'closure-order',storeId:closingBranch,
      status:'delivered',merchantPhone:'private-phone',businessAddress:'private-address',customerPhone:'customer',total:2500};
    const payable={orderId:closureOrder.orderId,sk:'MERCHANT_PAYABLE',status:'PAID',amount:2500};
    const outcome={orderId:closureOrder.orderId,sk:'FINANCIAL_OUTCOME',kind:'COD',amount:2500};
    await Promise.all([put('Orders',closureOrder),put('Holds',payable),put('Holds',outcome)]);
    const cleanup={
      db,request:locked,orderId:closureOrder.orderId,clock:()=>time,
      settlement:{async readMerchantAccrualEvidence(){
        return {order:closureOrder,payable:{...payable,status:'LOCKED_PENDING_SETTLEMENT'},outcome,
          outcomeKey:{orderId:outcome.orderId,sk:outcome.sk},accrual:{branchId:closingBranch,orderId:closureOrder.orderId}};
      }},
    };
    await assert.rejects(redactMerchantBranchOrder(cleanup),{code:'SETTLEMENT_REQUIRED'});
    const readUnpaid=cleanup.settlement.readMerchantAccrualEvidence;
    cleanup.settlement.readMerchantAccrualEvidence=async()=>({...await readUnpaid(),payable});
    await redactMerchantBranchOrder(cleanup);
    await redactMerchantBranchOrder(cleanup);
    const redacted=await get('Orders',{PK:closureOrder.PK,SK:closureOrder.SK});
    assert.equal(redacted.merchantPhone,undefined);
    assert.equal(redacted.businessAddress,undefined);
    assert.equal(redacted.customerPhone,closureOrder.customerPhone);
    assert.equal(redacted.total,closureOrder.total);
    assert.deepEqual(await get('Holds',{orderId:payable.orderId,sk:payable.sk}),payable);
    assert.deepEqual(await get('Holds',{orderId:outcome.orderId,sk:outcome.sk}),outcome);
    const {finalizeMerchantBranch}=require('./merchant-branch-finalization.cjs');
    await assert.rejects(finalizeMerchantBranch({db,request:locked,clock:()=>time}),{name:'TransactionCanceledException'});
    for(const step of ['branchAssets','branchMemberships','branchOrders','branchData']) {
      await branchStore.completeStep(locked,step,new Date(time).toISOString());
    }
    await finalizeMerchantBranch({db,request:locked,clock:()=>time});
    await finalizeMerchantBranch({db,request:locked,clock:()=>time});
    const closed=await get('Merchants',{businessId:closingBranch});
    assert.equal(closed.lifecycleStatus,'closed');
    assert.equal(closed.ownerId,undefined);
    assert.equal((await get('Wallets',walletKey)).status,'CLOSED');
    assert.equal((await get('Merchants',{businessId:openBranch})).ownerId,outsider);

  }
  {
    // Create an ordinary paid settlement using the same payout flow as the finance suite.
    const {setup}=require('../../../backend/wallet-service/test/helpers/merchant-cashbox-250-fixture.cjs');
    const paid=await setup();
    let result=(await paid.service.act(paid.request())).payout;
    paid.role('STAFF');
    result=(await paid.act(result,'APPROVE_PAYOUT')).payout;
    result=(await paid.act(result,'BEGIN_PAYOUT')).payout;
    const amount=result.amount.minorAmount/1000;
    result=(await paid.act(result,'RECORD_PAYOUT_EXECUTION',{cashboxId:'CASH-DESK-01',actualAmount:amount,destinationConfirmed:true})).payout;
    paid.role('OWNER');
    result=(await paid.act(result,'ACK_PAYOUT_RECEIPT',{accepted:true,receivedAmount:amount})).payout;
    paid.role('STAFF');
    result=(await paid.act(result,'RECONCILE_PAYOUT')).payout;
    assert.equal(result.status,'PAID');

    const bindings={'WizzOrders':'Orders','staging-Holds':'Holds','WaveOffers_staging':'WaveOffers',
      'staging-MerchantPlatform':'MerchantPlatform'};
    for(const [key,row] of paid.f.rows){
      const name=bindings[key.split('|')[0]];
      if(name&&(row.orderId==='order1'||row.pk==='MERCHANT_PAYOUT_PAID#'+result.payoutId)){
        await put(name,name==='Orders'?{...row,merchantPhone:'branch-phone',businessAddress:'branch-address'}:row);
      }
    }
    const requestId='12345678-0000-4000-8000-000000000095';
    const request={pk:'SUBJECT#MERCHANT#'+outsider,sk:'REQUEST#'+requestId,requestId,subjectId:outsider,
      actorType:'MERCHANT',scope:{kind:'BUSINESS',id:'branch1'},status:'PROCESSING',
      job:{requestId,subjectId:outsider,businessId:'branch1'},leaseOwner:'fixture-lease',version:1,leaseUntil:Math.floor(time/1000)+180};
    await put('AccountDeletion',request);
    await put('Merchants',{businessId:'branch1',ownerId:outsider,cognitoUserId:outsider,deletionRequestId:requestId});
    const payoutJournalKey={pk:'MERCHANT_PAYOUT_PAID#'+result.payoutId,sk:'META'};
    const journal=await get('MerchantPlatform',payoutJournalKey);
    const savedEnv=process.env;
    process.env={...Object.fromEntries(Object.entries(template.Resources.Function.Properties.Environment.Variables)
      .filter(([,value])=>typeof value==='string')),ENVIRONMENT:'production',STAGE:'production',AWS_REGION:'us-east-1'};
    try {
      const before=await settlement.readMerchantAccrualEvidence(db,'branch1','order1');
      assert.equal(before.payable.status,'PAID');
      await redactMerchantBranchOrder({db,settlement,request,orderId:'order1',clock:()=>time});
      const after=await settlement.readMerchantAccrualEvidence(db,'branch1','order1');
      assert.equal(after.order.merchantPhone,undefined);
      assert.equal(after.order.businessAddress,undefined);
      assert.deepEqual(after.accrual,before.accrual);
      assert.deepEqual(after.payable,before.payable);
      assert.deepEqual(await get('MerchantPlatform',payoutJournalKey),journal);
    } finally {
      process.env=savedEnv;
    }
  }

  {
    time+=61000;
    const subjectId='12345678-0000-4000-8000-000000000091';
    const requestId='12345678-0000-4000-8000-000000000092';
    const ownerToken=token('merchant',subjectId);
    const profileKey={pk:'PERSON#'+subjectId,sk:'PROFILE'};
    await put('MerchantPlatform',{...profileKey,subjectId,displayName:'Local owner'});
    await put('MerchantOtpSessions',{id:'owner-otp',subject:subjectId,poolId:'us-east-1_2sKZ4fGbZ'});
    await put('MerchantOtpSessions',{id:'foreign-otp',subject:merchant,poolId:'us-east-1_2sKZ4fGbZ'});
    const localDraft={pk:profileKey.pk,sk:'DRAFT#local',subjectId};
    await put('MerchantPlatform',localDraft);
    const sessionKey={pk:'MERCHANT_FINANCIAL_SESSION#'+'a'.repeat(64),sk:'SESSION'};
    await put('MerchantFinancialSessions',{...sessionKey,kind:'MERCHANT_FINANCIAL_SESSION',subjectId});
    const receiptKey={pk:'MERCHANT_PAYOUT#example',sk:'RECORD'};
    await put('MerchantPlatform',{...receiptKey,subjectId,amount:5000});
    const challenge=await call(ownerToken,'send',{input:{requestId}});
    const intake=await call(ownerToken,'request',{input:{requestId,challengeId:challenge.challengeId,code:messages.at(-1)}});
    assert.equal(intake.status,'READY');
    const merchantStore=dynamoStore({db,table:suffix('AccountDeletion'),environment:'production',clock:()=>Math.floor(time/1000)});
    const request=await merchantStore.get({type:'MERCHANT',sub:subjectId},requestId);
    const {createMerchantDeletionWorker}=require('./merchant-worker.cjs');
    let present=true,enabled=true,failOnce=true;
    const worker=createMerchantDeletionWorker({db,clock:()=>time,settlement,verifiedMutationGuards:true,verifiedEnrollmentGuards:true,
      s3:{async send(){
        if(failOnce){failOnce=false;throw Error('simulated interruption');}
        return {};
      }},cognito:{async send(command){
        assert.equal(command.input.Username,subjectId);
        const operation=command.constructor.name;
        if(!present)throw Object.assign(Error(),{name:'UserNotFoundException'});
        if(operation==='AdminGetUserCommand')return {Username:subjectId,Enabled:enabled,UserStatus:'CONFIRMED',
          UserAttributes:[{Name:'sub',Value:subjectId},{Name:'phone_number',Value:'+9647800000091'},
            {Name:'phone_number_verified',Value:'true'}]};
        if(operation==='AdminDisableUserCommand')enabled=false;
        if(operation==='AdminDeleteUserCommand')present=false;
        return {};
      }},
    });
    await assert.rejects(worker.process(request),{code:'CLEANUP_RETRY_REQUIRED'});
    assert.equal(enabled,false);
    assert.equal(present,true);
    assert.ok(await get('MerchantPlatform',profileKey));
    const phoneKey=require('../phone-auth/merchant-phone-binding.cjs').merchantPhoneClosureKey('+9647800000091');
    assert.ok(await get('AccountDeletion',phoneKey));
    const enrollment=require('../phone-auth/merchant-enrollment-store.cjs').createStore({
      db,GetCommand,UpdateCommand,TransactWriteCommand,now:()=>Math.floor(time/1000),
    });
    const phone='+9647800000091';
    const {POOL,PURPOSE}=require('../phone-auth/merchant-enrollment.cjs');
    const newChallenge={id:'new-owner-phone-challenge',poolId:POOL,purpose:PURPOSE,phone,expiresAt:Math.floor(time/1000)+300};
    await assert.rejects(enrollment.assertPhoneOpen(phone),/ACCOUNT_CLOSING/);
    await assert.rejects(enrollment.reserve(newChallenge,{sourceIp:'127.0.0.1'}),{name:'TransactionCanceledException'});
    assert.equal(await get('MerchantOtpSessions',{id:newChallenge.id}),undefined);
    await assert.rejects(worker.process(request),{code:'CLEANUP_RETRY_REQUIRED'});
    assert.equal(present,true);
    time+=361000;
    const result=await worker.process(request);
    assert.equal(await get('AccountDeletion',phoneKey),undefined);
    await enrollment.assertPhoneOpen(phone);
    await enrollment.reserve({...newChallenge,expiresAt:Math.floor(time/1000)+300},{sourceIp:'127.0.0.1'});
    assert.equal(result.status,'COMPLETED');
    assert.equal(present,false);
    assert.equal(await get('MerchantPlatform',profileKey),undefined);
    assert.equal(await get('MerchantPlatform',{pk:localDraft.pk,sk:localDraft.sk}),undefined);
    assert.equal(await get('MerchantOtpSessions',{id:'owner-otp'}),undefined);
    assert.ok(await get('MerchantOtpSessions',{id:'foreign-otp'}));
    assert.equal(await get('MerchantFinancialSessions',sessionKey),undefined);
    assert.equal((await get('MerchantPlatform',receiptKey)).amount,5000);
    assert.equal((await call(null,'receipt',{input:{receiptToken:intake.receiptToken}})).request.status,'COMPLETED');
  }

  {
    time+=61000;
    const businessId='branch-e2e';
    const requestId='12345678-0000-4000-8000-000000000097';
    const input={requestId,scope:{kind:'BUSINESS',businessId}};
    await put('Merchants',{businessId,ownerId:merchant,cognitoUserId:merchant,acceptingOrders:true});
    const posKey={pk:'MERCHANT_POS#'+businessId,sk:'SETTINGS'};
    const siblingPosKey={pk:'MERCHANT_POS#sibling',sk:'SETTINGS'};
    await put('MerchantPlatform',{...posKey,businessId,ownerId:merchant,apiKey:'local-key'});
    await put('MerchantPlatform',{...siblingPosKey,businessId:'sibling',ownerId:merchant,apiKey:'sibling-key'});
    await put('Products',{productId:'branch-only-product',businessId});
    await put('Products',{productId:'sibling-product',businessId:'sibling'});
    await put('WorkingHours',{businessId,weekday:"monday"});
    await put('BusinessSubcategories',{subcategoryId:'branch-category',businessId});
    const menuCategory={categoryId:'branch-menu',businessId};
    await put('MenuCategories',menuCategory);
    const grantKey={idempotencyKey:'MERCHANT_FINANCE#'+businessId+'#'+outsider,sk:'META'};
    await put('IdempotencyKeys',{...grantKey,ownerId:merchant,memberId:outsider});
    const challenge=await call(owner,'send',{input});
    const intake=await call(owner,'request',{input:{...input,challengeId:challenge.challengeId,code:messages.at(-1)}});
    assert.equal(intake.status,'READY');
    const merchantStore=dynamoStore({db,table:suffix('AccountDeletion'),environment:'production',clock:()=>Math.floor(time/1000)});
    const request=await merchantStore.get({type:'MERCHANT',sub:merchant},requestId);
    const {createMerchantDeletionWorker}=require('./merchant-worker.cjs');
    const worker=createMerchantDeletionWorker({db,clock:()=>time,settlement,verifiedMutationGuards:true,verifiedEnrollmentGuards:true,
      s3:{send:async()=>({})},cognito:{send:async()=>assert.fail('branch closure must not access Cognito')},
    });
    assert.equal((await worker.process(request)).status,'COMPLETED');
    assert.equal(await get('MerchantPlatform',posKey),undefined);
    assert.equal((await get('MerchantPlatform',siblingPosKey)).apiKey,'sibling-key');
    assert.equal(await get('Products',{productId:'branch-only-product'}),undefined);
    assert.ok(await get('Products',{productId:'sibling-product'}));
    assert.equal(await get('WorkingHours',{businessId,weekday:"monday"}),undefined);
    assert.equal(await get('BusinessSubcategories',{subcategoryId:'branch-category'}),undefined);
    assert.equal(await get('MenuCategories',{categoryId:menuCategory.categoryId}),undefined);
    assert.equal(await get('IdempotencyKeys',grantKey),undefined);
    assert.equal((await get('Merchants',{businessId})).lifecycleStatus,'closed');
    assert.equal((await call(null,'receipt',{input:{receiptToken:intake.receiptToken}})).request.status,'COMPLETED');
  }

});
