const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const {fixture}=require('./delivery-quote-fixture.cjs');
const sdk=require('@aws-sdk/lib-dynamodb');
const runtime=require('../../dist/deliveryQuoteOrder');
const handlerPath=process.env.QUOTE_ORDER_HANDLER_FILE||path.resolve(__dirname,'../../../../../wizzuser-stg/backend/src/functions/create-order/index.js');
const {accountGuard}=require(path.join(path.dirname(handlerPath),'account-guard'));
async function setup(mode='REQUIRED',free=false,{cashDenomination=false}={}){
 const f=fixture();const cashMoney=require('../../dist/money');f.policy.values.deliveryRules[0].base=cashMoney.parseIqd('3000');f.policy.values.deliveryRules[0].perKm=cashMoney.parseIqd('0');if(free){const {parseIqd}=require('../../dist/money');f.policy.values.deliveryRules[0].base=parseIqd('0');f.policy.values.deliveryRules[0].perKm=parseIqd('0');}
 if(cashDenomination)f.policy.values.deliveryRules[0].base=require('../../dist/money').parseIqd('400');
 const quote=await f.create();f.orderQueries=0;f.externalCalls=0;
 f.products=new Map([['p1',{productId:'p1',businessId:'b1',name:'Test',price:3500,categoryId:'cat1',isAvailable:true}]]);
 f.category={categoryId:'cat1',isActive:true};
 f.journey=new Map();
 f.inventory=new Map();
 f.extraPut=p=>{if(p.TableName==='staging-MerchantPlatform'&&p.Item.sk?.startsWith('INVENTORY_RESERVATION#')){f.inventory.set(p.Item.pk+'|'+p.Item.sk,structuredClone(p.Item));return true;}if(p.TableName!=='staging-WizzOfferJourney')return false;f.journey.set(p.Item.pk+'|'+p.Item.sk,structuredClone(p.Item));return true;};
 f.extraLookup=(table,key)=>table==='staging-MerchantPlatform'&&key?.sk?.startsWith('INVENTORY_RESERVATION#')?(f.inventory.get(key.pk+'|'+key.sk)??null):table==='staging-WizzOfferJourney'?f.journey.get(key.pk+'|'+key.sk):table==='WhizzMerchants_Products'?f.products.get(key.productId):table==='WhizzMerchants_Categories'?f.category:
  table==='WhizzMerchants_Discounts'?f.discountRow:table==='WizzCentral_Platform_Discounts'?f.promoRow:(f.commercialRecords?.get(table+'|'+JSON.stringify(key))??(table==='staging-PlatformStaff'&&key?.pk==='OPERATIONAL_SETTINGS#CASH_ROUNDING'?null:undefined));
 f.extraUpdate=u=>{const row=f.extraLookup(u.TableName,u.Key);for(const field of u.UpdateExpression.slice(4).split(', ')){
  const [n,v]=field.split('=');const name=n.trim(),value=v.trim();row[u.ExpressionAttributeNames[name]||name]=u.ExpressionAttributeValues[value];}
  f.discountUpdates=(f.discountUpdates||0)+1;};
 const db={send:async c=>{
  if(c.input.TableName==='staging-MerchantPlatform'&&c.input.Key?.sk?.startsWith('INVENTORY_RESERVATION#'))return {Item:structuredClone(f.extraLookup(c.input.TableName,c.input.Key))};
  if(c.input.TableName==='staging-PlatformStaff'&&c.input.Key?.pk==='OPERATIONAL_SETTINGS#CASH_ROUNDING')return {Item:structuredClone(f.extraLookup(c.input.TableName,c.input.Key))};
  if(f.deliveryIndexes&&c instanceof sdk.QueryCommand&&c.input.TableName==='staging-MerchantPlatform')return {Items:structuredClone(f.deliveryIndexes)};
  if(f.deliveryIndexes&&c.input.TableName==='staging-PlatformStaff'&&c.input.Key?.pk!=='OPERATIONAL_SETTINGS#DELIVERY_PRICING')return {Item:structuredClone(f.extraLookup(c.input.TableName,c.input.Key))};
  if(f.commercialRecords&&c.input.TableName==='staging-MerchantPlatform'&&!c.input.Key?.pk?.startsWith('PERSON#'))return {Item:structuredClone(f.extraLookup(c.input.TableName,c.input.Key))};
  if(c.input.TableName==='staging-WizzOfferJourney')return {Item:f.extraLookup(c.input.TableName,c.input.Key)};
  if(c.input.TableName==='WizzOrders'&&!c.input.Key&&c.constructor.name==='ScanCommand')return {Items:[...f.orders.values()]};
  if(f.commercialRecords?.has(c.input.TableName+'|'+JSON.stringify(c.input.Key)))return {Item:structuredClone(f.extraLookup(c.input.TableName,c.input.Key))};
  if(['WhizzMerchants_Products','WhizzMerchants_Categories'].includes(c.input.TableName))return {Item:structuredClone(f.extraLookup(c.input.TableName,c.input.Key))};
  if(c.input.TableName==='WhizzMerchants_Discounts'){
   return {Item:f.discountRow};
  }
  if(c.input.TableName==='WizzCentral_Platform_Discounts'){
   if(c.input.IndexName)return {Items:f.promoRow?[f.promoRow]:[]};
   return {Item:f.promoRow};
  }
if(c instanceof sdk.QueryCommand&&c.input.TableName==='WizzOrders'){f.orderQueries++;return {Items:[...f.orders.values()]};}return f.db.send(c);}};
 const env={...require('./finance-rollout-fixture.cjs').scopeEnv({orders:[{orderId:require('./finance-rollout-fixture.cjs').orderId(),branchId:'b1',customerSubjectId:'sub1'}]}),USERS_TABLE:'WizzUser_users_staging',USER_POOL_ID:'us-east-1_TpyyrVkEE',USER_POOL_CLIENT_ID:'staging-client',AWS_REGION:'us-east-1',DELIVERY_QUOTE_MODE:mode};
 const exports={};
 const shared={};
 const FakeDate=class extends Date{constructor(...args){super(...(args.length?args:[f.time]));}static now(){return f.time;}};
 function loadShared(name){
  if(shared[name])return shared[name];
  const module={exports:{}};
  vm.runInNewContext(fs.readFileSync(path.resolve(path.dirname(handlerPath),'../shared',name+'.js'),'utf8'),{
   module,exports:module.exports,Buffer,Date:FakeDate,process:{env},AbortSignal,
   fetch:async()=>({ok:true,json:async()=>({Username:'username',UserAttributes:[{Name:'sub',Value:'sub1'}]})}),
   require:n=>n==='@aws-sdk/lib-dynamodb'?sdk:n==='../create-order/account-guard'?{accountGuard}:n.startsWith('../create-order/quote-runtime/')?require('../../dist/'+n.split('/').at(-1)):n.startsWith('./')?loadShared(n.slice(2)):require(n)
  });
  return shared[name]=module.exports;
 }
 const modules={
  './point-invoice-321':require(path.join(path.dirname(handlerPath),'point-invoice-321')),
  './checkout-pricing-reads':require('../../../../../wizzuser-stg/backend/src/functions/create-order/checkout-pricing-reads'),
  '../shared/branch-minimum-order':loadShared('branch-minimum-order'),
  '../shared/discount-contract':loadShared('discount-contract'),
  '../shared/platform-benefits':loadShared('platform-benefits'),
  '../shared/offer-context':loadShared('offer-context'),
  '../shared/offer-eligibility':loadShared('offer-eligibility'),
  '../shared/offer-attribution':loadShared('offer-attribution'),
  '../shared/legacy-order-policy':require('../../../../../wizzuser-stg/backend/src/functions/shared/legacy-order-policy'),
  '@aws-sdk/client-dynamodb':{DynamoDBClient:class{}},'@aws-sdk/lib-dynamodb':{...sdk,DynamoDBDocumentClient:{from:()=>db}},
  './quote-runtime/financeRollout':{createFinanceRollout:o=>require('../../dist/financeRollout').createFinanceRollout({...o,env,now:()=>f.time})},
  './account-guard':{accountGuard},'./quote-runtime/deliveryQuoteOrder':{...runtime,createStagingQuoteOrder:o=>runtime.createStagingQuoteOrder({...o,now:()=>f.time})},
  'aws-sdk':{CognitoIdentityServiceProvider:class{getUser(){return {promise:async()=>({Username:'username',UserAttributes:[{Name:'sub',Value:'sub1'}]})};}}},
  '../delivery-quotes/runtime':{GetUserCommand:class{},CognitoIdentityProviderClient:class{async send(){return {Username:'username',UserAttributes:[{Name:'sub',Value:'sub1'}]};}}},
  '../shared/customer-order-view':require('../../../../../wizzuser-stg/backend/src/functions/shared/customer-order-view'),
  '../shared/discount-reservation':loadShared('discount-reservation'),
  './quote-runtime/orderCommercialSource':{...require('../../dist/orderCommercialSource'),createStagingCommercialSource:o=>require('../../dist/orderCommercialSource').createStagingCommercialSource({...o,now:()=>f.time})},
  './quote-runtime/deliveryPromotionSelection':{createStagingDeliveryPromotionSelection:o=>require('../../dist/deliveryPromotionSelection').createStagingDeliveryPromotionSelection({...o,now:()=>f.time})},
  './quote-runtime/deliveryPromotionCustomer':require('../../dist/deliveryPromotionCustomer'),
  './quote-runtime/money':require('../../dist/money'),
  './quote-runtime/orderExceptionPolicy':require('../../dist/orderExceptionPolicy'),
  './quote-runtime/orderGoodsPricing':require('../../dist/orderGoodsPricing'),
  './quote-runtime/productInventory':require('../../dist/productInventory'),
  '../shared/discount-engine':fs.existsSync(path.resolve(path.dirname(handlerPath),'../shared/discount-engine.js'))?require(path.resolve(path.dirname(handlerPath),'../shared/discount-engine.js')):{},
  uuid:{v4:()=>require('node:crypto').randomUUID()},https:{request:()=>{f.externalCalls++;throw Error('external call prohibited');}}
 };
 vm.runInNewContext(fs.readFileSync(handlerPath,'utf8')+'\nexports.__readOnlyTestRun=handleOrder321;',{exports,require:n=>{if(n.startsWith('../shared/')&&/^\.\.\/shared\/[a-z0-9-]+$/.test(n))return modules[n]??loadShared(n.slice('../shared/'.length));if(!(n in modules))throw Error('unexpected require '+n);return modules[n];},process:{env},Buffer,Date:class extends Date{constructor(...args){super(...(args.length?args:[f.time]));}static now(){return f.time;}},console:{log(){},error(){},warn(){}}});
 const claims={sub:'sub1',iss:'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_TpyyrVkEE',client_id:'staging-client',token_use:'access'};
 const token='header.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.signature';
 f.runReadOnlyTest=exports.__readOnlyTestRun;f.token=token;
 f.body={userId:'u1',storeId:'b1',storeName:'Synthetic',storeAddress:'Test',deliveryAddress:{id:'a1',latitude:31.925,longitude:44.457,fullAddress:'Test'},paymentMethod:'cod',items:[{id:'p1',name:'Test',price:3500,quantity:1}],quoteId:quote.quoteId,idempotencyKey:'abcdefab-1234-4123-8123-123456789abc',deliveryFee:999999};
 f.invoke=async (patch={})=>{const r=await exports.handler({httpMethod:'POST',resource:patch.action==='preview_commercial'?'/orders/commercial-preview':'/orders',headers:{Authorization:'Bearer '+token},body:JSON.stringify({...f.body,...patch})});return {...r,json:JSON.parse(r.body)};};
 f.enableCommercial=()=>{
  const source=require('./commercial-source-fixture.cjs').fixture('org1','owner1');source.funded();
  f.commercialRecords=source.records;
  for(const key of [...f.commercialRecords.keys()])if(key.startsWith('WhizzMerchants_')||key.includes('PERSON#')||key.startsWith('WizzCentral_Regions'))f.commercialRecords.delete(key);
  f.branch.commercialAgreementId='a1';f.branch.commercialAgreementVersion=1;
  const offerPut=f.extraPut;
  f.extraPut=p=>{if(offerPut(p))return true;if(['staging-Holds','staging-LedgerEntries','staging-AuditLog'].includes(p.TableName)){
   const r=p.Item,key=p.TableName==='staging-Holds'?{orderId:r.orderId,sk:r.sk}:p.TableName==='staging-LedgerEntries'?{walletId:r.walletId,sk:r.sk}:{datePartition:r.datePartition,sk:r.sk};
   f.commercialRecords.set(p.TableName+'|'+JSON.stringify(key),structuredClone(r));return true;
  }return false;};
  f.env.COMMERCIAL_PRICING_MODE='REQUIRED';
 };
 f.enableDeliveryPromotions=(funding='MERCHANT',audience='ALL')=>{
  f.enableCommercial();
  const {parseIqd:m}=require('../../dist/money');
  const policy=structuredClone(require('./delivery-promotion-fixture.cjs').fixture().policy);
  Object.assign(policy,{id:'delivery',merchantId:'org1',branchId:'b1',origin:funding,funding:{kind:funding},effectiveFrom:'2026-10-01T00:00:00.000Z'});
  policy.eligibility.minimumGoods=m('0');policy.eligibility.audience=audience;
  Object.assign(policy.limits,{merchantPerOrder:m(funding==='MERCHANT'?'5000':'0'),merchantBudget:m(funding==='MERCHANT'?'100000':'0'),platformPerOrder:m(funding==='PLATFORM'?'5000':'0'),platformBudget:m(funding==='PLATFORM'?'100000':'0')});
  const hash=require('../../dist/deliveryFundingPolicy').readDeliveryFundingPolicy(policy).termsHash;
  const put=(table,key,row)=>f.commercialRecords.set(table+'|'+JSON.stringify(key),structuredClone({...key,...row}));
  const record={schemaVersion:1,id:policy.id,version:1,status:'ACTIVE',policy,termsHash:hash,approvedBy:'editor',approvedAt:'2026-10-01T01:00:00.000Z',acceptedBy:'owner1',acceptedAt:'2026-10-01T02:00:00.000Z',activatedAt:'2026-10-01T02:00:00.000Z',activationMode:'STAFF_SEND_MERCHANT_ACCEPT'};
  for(const sk of ['CURRENT','VERSION#1'])put('staging-PlatformStaff',{pk:'DELIVERY_FUNDING#delivery',sk},record);
  const budget=require('../../dist/deliveryCampaignBudget').deliveryCampaignBudgetInitialization(policy).Put.Item;
  put('staging-PlatformStaff',{pk:budget.pk,sk:budget.sk},budget);
  put('staging-PlatformStaff',{pk:'EMPLOYEE#editor',sk:'PROFILE'},{employeeId:'editor',status:'ACTIVE',version:1,roles:['commercial_editor'],scope:{allRegions:true}});
  f.branch.deliveryOfferRevision=1;
  f.deliveryIndexes=[{pk:'BRANCH#b1',sk:'COMMERCIAL#DELIVERY#delivery',recordPk:'DELIVERY_FUNDING#delivery',kind:'DELIVERY',ownerId:'owner1',businessId:'b1'}];
  const lookup=f.extraLookup;
  f.extraLookup=(t,k)=>lookup(t,k)??(t==='staging-PlatformStaff'&&k?.pk!=='OPERATIONAL_SETTINGS#DELIVERY_PRICING'?null:undefined);
  const priorPut=f.extraPut;
  f.extraPut=p=>{if(p.TableName==='staging-PlatformStaff'){put(p.TableName,{pk:p.Item.pk,sk:p.Item.sk},p.Item);return true;}return priorPut(p);};
  f.env.DELIVERY_PROMOTION_MODE='REQUIRED';return policy;
 };
 f.env=env;f.adapterDb=db;return f;
}

module.exports={setup};
