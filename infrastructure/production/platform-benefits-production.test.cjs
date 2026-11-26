'use strict';

const assert = require('node:assert/strict');
const {test} = require('node:test');
const {randomUUID} = require('node:crypto');
const {join} = require('node:path');
const build = process.env.WIZZ_BENEFITS_BUILD;
const template = require(join(build,'platform-benefits.template.json'));
const {identities:{admin,customer}} = require('./wallet-identity-bindings.json');
for (const [key,value] of Object.entries(template.Resources.CustomerFunction.Properties.Environment.Variables))
  if (typeof value === 'string') process.env[key] = value;
process.env.AWS_REGION = 'us-east-1';
const {createHandler:createAdmin,tables} = require(join(build,'admin.cjs'));
const {createHandler:createCustomer} = require(join(build,'customer.cjs'));

const ids = {
  employee:'11111111-1111-4111-8111-111111111111',
  recipient:'22222222-2222-4222-8222-222222222222',
  other:'33333333-3333-4333-8333-333333333333',
};
const hints = {orders:'wizz-production-Orders', products:'wizz-production-Products', menu:'wizz-production-MenuCategories',
  platform:'wizz-production-MerchantPlatform', addresses:'wizz-production-Addresses', journey:tables.grants,
  customers:tables.customers, deletion:tables.deletion, discounts:'wizz-production-MerchantDiscounts'};
const phone = '+9647900000123';
const apiId = 'aaaaaaaaaa';
const at = Date.now();
const time = ms => new Date(at+ms).toISOString();
const request = action => ({action,id:'voucher-fixture',requestId:randomUUID()});

function fixture() {
  const keyByTable = {
    [tables.customers]:['userId'], [tables.campaigns]:['discountId'], [tables.grants]:['pk','sk'],
    [tables.staff]:['pk','sk'], [tables.deletion]:['pk','sk'], [hints.products]:['productId'],
    [hints.menu]:['categoryId'], [hints.discounts]:['discountId'],
  };
  const records = new Map(), transactions = [], calls = [];
  const key = (table,item) => JSON.stringify([table,...(keyByTable[table] ?? Object.keys(item).sort()).map(k=>item[k])]);
  const put = (table,item) => records.set(key(table,item),structuredClone(item));
  const get = (table,item) => structuredClone(records.get(key(table,item)));
  const all = table => [...records].filter(([k])=>JSON.parse(k)[0]===table).map(([,row])=>structuredClone(row));
  for (const userId of [ids.recipient,ids.other]) {
    put(tables.customers,{userId,cognitoSub:userId,phone:userId===ids.recipient?phone:'+9647900000124',
      phoneVerified:true,isActive:true,name:'زبون الاختبار',createdAt:time(-86400000)});
    put(tables.grants,{pk:'USER#'+userId,sk:'ORDERS',count:0,lastAt:at,version:1});
  }
  put(tables.staff,{pk:'EMPLOYEE#'+ids.employee,sk:'PROFILE',employeeId:ids.employee,
    status:'ACTIVE',version:1,roles:['bootstrap_admin'],scope:{allRegions:true}});
  put(hints.products,{productId:'product',businessId:'branch',price:5000,categoryId:'cat',isAvailable:true});
  put(hints.menu,{categoryId:'cat',businessId:'branch',isActive:true});
  const db = {send:async command => {
    const input = command.input;
    if (!input.TransactItems) assert.match(input.TableName,/^wizz-production-/);
    calls.push(input);
    if (command.constructor.name==='GetCommand') return {Item:get(input.TableName,input.Key)};
    if (command.constructor.name==='ScanCommand') return {Items:all(input.TableName)};
    if (command.constructor.name==='QueryCommand') {
      if (input.IndexName==='code-index') return {Items:all(tables.campaigns).filter(row=>
        row.code===input.ExpressionAttributeValues[':c'])};
      if (input.IndexName==='BusinessIdIndex') return {Items:all(hints.discounts).filter(row=>
        row.businessId===input.ExpressionAttributeValues[':b'])};
      assert.equal(input.IndexName,'phone-index');
      return {Items:all(tables.customers).filter(row=>row.phone===input.ExpressionAttributeValues[':phone'])
        .map(({userId})=>({userId}))};
    }
    if (command.constructor.name==='TransactWriteCommand') {
      transactions.push(input.TransactItems);
      for (const {Put:op} of input.TransactItems) if (op) put(op.TableName,op.Item);
      return {};
    }
    throw Error(command.constructor.name);
  }};
  const adminHandler = createAdmin({db,apiId,now:()=>at,verifyStaff:async value=>{
    assert.equal(value,'staff-token');
    return {sub:ids.employee,username:'staff',iss:'https://cognito-idp.us-east-1.amazonaws.com/'+admin.poolId,
      client_id:admin.clientId,token_use:'access',exp:Math.floor(at/1000)+600,auth_time:Math.floor(at/1000)-3600};
  },getStaff:async Username=>({Username,Enabled:true,UserStatus:'CONFIRMED',
    UserAttributes:[{Name:'sub',Value:ids.employee}],UserMFASettingList:['SOFTWARE_TOKEN_MFA']})});
  const userHandler = createCustomer({db,tables:hints,apiId,verify:async value=>{
    const [,payload] = value.split('.');
    return JSON.parse(Buffer.from(payload,'base64url'));
  }});
  const token = sub => 'e30.'+Buffer.from(JSON.stringify({sub,
    iss:'https://cognito-idp.us-east-1.amazonaws.com/'+customer.poolId,client_id:customer.clientId,token_use:'access',
  })).toString('base64url')+'.fixture';
  const event = (resource,method,account,query,input) => ({resource,httpMethod:method,
    requestContext:{apiId,stage:'production'},headers:account?{Authorization:'Bearer '+account}:{},queryStringParameters:query,
    body:input?JSON.stringify(input):undefined});
  const parse = result => ({status:result.statusCode,body:JSON.parse(result.body)});
  return {put,get,transactions,calls,
    admin:async (method,query,input) => parse(await adminHandler(event('/staff/benefits',method,'staff-token',query,input))),
    publicCampaigns:async () => parse(await userHandler(event('/promo-codes/active','GET',null,{}))),
    publicPreview:async () => parse(await userHandler(event('/promo-codes/validate','POST',null,{},{
      userId:'guest',storeId:'branch',code:'SAVE10',items:[{id:'product',quantity:1,price:1}],orderTotal:1,deliveryFee:1000,
    }))),
    restaurantDiscounts:async () => parse(await userHandler({
      ...event('/business/{businessId}/discounts','GET',null,{itemIds:'product'}),
      pathParameters:{businessId:'branch'},
    })),
    restaurantPrice:async (value,account) => parse(await userHandler(event('/promo-codes/apply','POST',
      account?token(account):null,{},{
        businessId:'branch',userId:null,discountId:'restaurant-fixture',
        items:[{id:'product',quantity:1,price:1}],orderTotal:1,deliveryFee:1000,...value,
      }))),
    feed:async (sub,requested=sub) => parse(await userHandler(event('/promo-codes/active','GET',token(sub),{benefits:'1',userId:requested}))),
    price:async sub => parse(await userHandler(event('/promo-codes/validate','POST',token(sub),{},{
      userId:sub,storeId:'branch',platformDiscountId:'voucher-fixture',code:'',items:[{id:'product',quantity:1,price:1}],
      orderTotal:1,deliveryFee:1000,
    }))),
  };
}

async function published(f) {
  const draft=await f.admin('POST',{}, {...request('CREATE'),values:{
    title:'قسيمة اختبار',description:'قسيمة واحدة لصاحب الشكوى',startDate:time(-60000),endDate:time(3600000),
    benefit:{schemaVersion:1,kind:'GOODS_AMOUNT',amountIqd:1500,usesPerCustomer:1,maximumPerOrderIqd:1500,
      minimumGoodsIqd:0,maximumRoadMeters:10000,grantMode:'DIRECT',audience:'ALL',branchIds:[],regionIds:[],
      customerIds:[ids.recipient],allowGoodsStacking:false},
  }});
  assert.equal(draft.status,200,JSON.stringify(draft));
  const publish=await f.admin('POST',{}, {...request('PUBLISH'),baseRevision:draft.body.revision});
  assert.equal(publish.status,200,JSON.stringify(publish));
  return publish.body.revision;
}

test('staff looks up a verified customer by the exact normalized phone and fences deletion on grant',async()=>{
  const f=fixture();
  const found=await f.admin('GET',{view:'customers',phone:'٠٧٩٠٠٠٠٠١٢٣'});
  assert.equal(found.status,200,JSON.stringify(found));
  assert.deepEqual(found.body.customers.map(row=>row.id),[ids.recipient]);
  assert.equal(f.calls.find(row=>row.IndexName==='phone-index').ExpressionAttributeValues[':phone'],phone);
  const revision=await published(f);
  const grant={...request('GRANT'),baseRevision:revision,userSub:ids.recipient,uses:1,reason:'اعتماد استحقاق قسيمة الاختبار'};
  const receipt=await f.admin('POST',{},grant);
  assert.equal(receipt.status,200,JSON.stringify(receipt));
  const tx=f.transactions.at(-1);
  assert(tx.some(op=>op.ConditionCheck?.TableName===tables.deletion));
  assert(tx.some(op=>op.Put?.TableName===tables.grants && op.Put.Item.sk==='BENEFIT#voucher-fixture'));
  assert(tx.every(op=>/wizz-production-/.test((op.Put??op.ConditionCheck).TableName)));
  assert.equal((await f.admin('POST',{},grant)).body.replayed,true);
  assert.equal(f.transactions.length,3);
  f.put(tables.deletion,{pk:'ACCOUNT_LIFECYCLE#CUSTOMER#'+ids.recipient,sk:'META'});
  assert.equal((await f.admin('POST',{}, {...grant,requestId:randomUUID()})).body.error,'BENEFIT_ACCOUNT_UNAVAILABLE');
});

test('published personal voucher is visible and priceable only for its recipient using server prices',async()=>{
  const f=fixture();
  const revision=await published(f);
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async (_url,request)=>{
    const {AccessToken}=JSON.parse(request.body);
    const {sub}=JSON.parse(Buffer.from(AccessToken.split('.')[1],'base64url'));
    return new Response(JSON.stringify({Username:sub,UserAttributes:[{Name:'sub',Value:sub}]}));
  };
  try {
    assert.deepEqual((await f.feed(ids.recipient)).body.benefits,[]);
    assert.equal((await f.feed(ids.other,ids.recipient)).status,403);
    await f.admin('POST',{}, {...request('GRANT'),baseRevision:revision,userSub:ids.recipient,
      uses:1,reason:'اعتماد استحقاق قسيمة الاختبار'});
    const listed=(await f.feed(ids.recipient)).body.benefits;
    assert.equal(listed[0].remaining,1);
    assert.deepEqual((await f.feed(ids.other)).body.benefits,[]);
    const value=await f.price(ids.recipient);
    assert.equal(value.status,200,JSON.stringify(value));
    assert.equal(value.body.discountAmount,1500);
    assert.equal(value.body.finalTotal,4500);
    assert.equal((await f.price(ids.other)).status,409);
    assert.equal(f.transactions.length,3);
    const paused=await f.admin('POST',{}, {...request('PAUSE'),baseRevision:revision});
    assert.equal(paused.status,200);
    assert.deepEqual((await f.feed(ids.recipient)).body.benefits,[]);
  } finally {globalThis.fetch=originalFetch;}
});

test('public campaigns omit private targeting and preview a percentage against the real catalog prices',async()=>{
  const f=fixture();
  const promo={discountId:'percent-fixture',code:'SAVE10',title:'عشرة بالمئة',type:'percentage',value:10,
    status:'active',isActive:true,version:1,usage:0,currentUsage:0,usageLimit:2,limit:2,
    maxDiscountAmount:1500,maxDiscount:1500,startDate:time(-60000),endDate:time(3600000),customerSegments:['all']};
  f.put(tables.campaigns,promo);
  const listing=await f.publicCampaigns();
  assert.equal(listing.status,200,JSON.stringify(listing));
  assert.deepEqual(listing.body.promos.map(row=>row.code),['SAVE10']);
  const price=await f.publicPreview();
  assert.equal(price.status,200,JSON.stringify(price));
  assert.equal(price.body.discountAmount,500);
  assert.equal(price.body.finalTotal,5500);
  f.put(tables.campaigns,{...promo,customerSegments:['registered']});
  assert.deepEqual((await f.publicCampaigns()).body.promos,[]);
  assert.equal((await f.publicPreview()).status,409);
  assert.equal(f.transactions.length,0);
});

test('merchant offers are branch-scoped, use current catalog prices and never reserve or consume usage in preview',async()=>{
  const f=fixture();
  const discount={discountId:'restaurant-fixture',businessId:'branch',title:'عرض المطعم',
    type:'percentage',value:20,status:'active',version:1,usage_count:0,usage_limit:3,
    valid_from:time(-60000),valid_to:time(3600000),calculationMode:'perItem',
    applicability:'specificItems',applicable_item_ids:['product']};
  f.put(hints.discounts,discount);
  f.put(hints.discounts,{...discount,discountId:'other-fixture',businessId:'other'});
  const list=await f.restaurantDiscounts();
  assert.equal(list.status,200,JSON.stringify(list));
  assert.deepEqual(list.body.discounts.map(row=>row.discountId),['restaurant-fixture']);
  assert.deepEqual(list.body.discounts[0].itemPrices,[
    {productId:'product',originalUnitFils:5000000,savingUnitFils:1000000,netUnitFils:4000000},
  ]);
  const price=await f.restaurantPrice();
  assert.equal(price.status,200,JSON.stringify(price));
  assert.equal(price.body.discountAmount,1000);
  assert.equal(price.body.finalTotal,5000);
  assert.equal(price.body.previewOnly,true);
  const unavailable = await f.restaurantPrice({items:[{id:'unknown-product',quantity:1}]});
  assert.equal(unavailable.status,409);
  assert.equal(unavailable.body.message,'GOODS_UNAVAILABLE');
  assert.equal((await f.restaurantPrice({storeId:'other'})).status,400);
  assert.equal((await f.restaurantPrice({discountId:'other-fixture'})).status,409);
  assert.equal((await f.restaurantPrice({userId:ids.recipient})).status,401);
  assert.equal((await f.restaurantPrice({userId:ids.recipient},ids.other)).status,403);
  f.put(hints.discounts,{...discount,status:'inactive'});
  assert.deepEqual((await f.restaurantDiscounts()).body.discounts,[]);
  assert.equal((await f.restaurantPrice()).status,409);
  assert.equal(f.get(hints.discounts,{discountId:'restaurant-fixture'}).usage_count,0);
  assert.equal(f.transactions.length,0);
});
