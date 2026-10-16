const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const {fixture}=require('./delivery-quote-fixture.cjs');
const sdk=require('@aws-sdk/lib-dynamodb');
const runtime=require('../../dist/deliveryQuoteOrder');
const handlerPath=process.env.QUOTE_ORDER_HANDLER_FILE||path.resolve(__dirname,'../../../../../wizzuser-stg/backend/src/functions/create-order/index.js');
const {accountGuard}=require(path.join(path.dirname(handlerPath),'account-guard'));
async function setup(mode='REQUIRED',free=false){
 const f=fixture();if(free){const {parseIqd}=require('../../dist/money');f.policy.values.deliveryRules[0].base=parseIqd('0');f.policy.values.deliveryRules[0].perKm=parseIqd('0');}
 const quote=await f.create();f.orderQueries=0;f.externalCalls=0;
 f.products=new Map([['p1',{productId:'p1',businessId:'b1',name:'Test',price:3500,categoryId:'cat1',isAvailable:true}]]);
 f.category={categoryId:'cat1',isActive:true};
 f.extraLookup=(table,key)=>table==='WhizzMerchants_Products'?f.products.get(key.productId):table==='WhizzMerchants_Categories'?f.category:
  table==='WhizzMerchants_Discounts'?f.discountRow:table==='WizzCentral_Platform_Discounts'?f.promoRow:f.commercialRecords?.get(table+'|'+JSON.stringify(key));
 f.extraUpdate=u=>{const row=f.extraLookup(u.TableName,u.Key);for(const field of u.UpdateExpression.slice(4).split(', ')){
  const [n,v]=field.split('=');const name=n.trim(),value=v.trim();row[u.ExpressionAttributeNames[name]||name]=u.ExpressionAttributeValues[value];}
  f.discountUpdates=(f.discountUpdates||0)+1;};
 const db={send:async c=>{
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
 const env={USERS_TABLE:'WizzUser_users_staging',USER_POOL_ID:'us-east-1_TpyyrVkEE',USER_POOL_CLIENT_ID:'staging-client',AWS_REGION:'us-east-1',DELIVERY_QUOTE_MODE:mode};
 const exports={};
 const modules={
  '@aws-sdk/client-dynamodb':{DynamoDBClient:class{}},'@aws-sdk/lib-dynamodb':{...sdk,DynamoDBDocumentClient:{from:()=>db}},
  './account-guard':{accountGuard},'./quote-runtime/deliveryQuoteOrder':{...runtime,createStagingQuoteOrder:o=>runtime.createStagingQuoteOrder({...o,now:()=>f.time})},
  'aws-sdk':{CognitoIdentityServiceProvider:class{getUser(){return {promise:async()=>({Username:'username',UserAttributes:[{Name:'sub',Value:'sub1'}]})};}}},
  '../delivery-quotes/runtime':{GetUserCommand:class{},CognitoIdentityProviderClient:class{async send(){return {Username:'username',UserAttributes:[{Name:'sub',Value:'sub1'}]};}}},
  '../shared/customer-order-view':require('../../../../../wizzuser-stg/backend/src/functions/shared/customer-order-view'),
  '../shared/discount-reservation':require('../../../../../wizzuser-stg/backend/src/functions/shared/discount-reservation'),
  './quote-runtime/orderCommercialSource':{...require('../../dist/orderCommercialSource'),createStagingCommercialSource:o=>require('../../dist/orderCommercialSource').createStagingCommercialSource({...o,now:()=>f.time})},
  './quote-runtime/money':require('../../dist/money'),
  './quote-runtime/orderGoodsPricing':require('../../dist/orderGoodsPricing'),
  '../shared/discount-engine':fs.existsSync(path.resolve(path.dirname(handlerPath),'../shared/discount-engine.js'))?require(path.resolve(path.dirname(handlerPath),'../shared/discount-engine.js')):{},
  uuid:{v4:()=>require('node:crypto').randomUUID()},https:{request:()=>{f.externalCalls++;throw Error('external call prohibited');}}
 };
 vm.runInNewContext(fs.readFileSync(handlerPath,'utf8'),{exports,require:n=>{if(!(n in modules))throw Error('unexpected require '+n);return modules[n];},process:{env},Buffer,Date:class extends Date{constructor(...args){super(...(args.length?args:[f.time]));}static now(){return f.time;}},console:{log(){},error(){},warn(){}}});
 const claims={sub:'sub1',iss:'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_TpyyrVkEE',client_id:'staging-client',token_use:'access'};
 const token='header.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.signature';
 f.body={userId:'u1',storeId:'b1',storeName:'Synthetic',storeAddress:'Test',deliveryAddress:{id:'a1',latitude:31.925,longitude:44.457,fullAddress:'Test'},paymentMethod:'cod',items:[{id:'p1',name:'Test',price:3500,quantity:1}],quoteId:quote.quoteId,idempotencyKey:'abcdefab-1234-4123-8123-123456789abc',deliveryFee:999999};
 f.invoke=async (patch={})=>{const r=await exports.handler({httpMethod:'POST',resource:patch.action==='preview_commercial'?'/orders/commercial-preview':'/orders',headers:{Authorization:'Bearer '+token},body:JSON.stringify({...f.body,...patch})});return {...r,json:JSON.parse(r.body)};};
 f.enableCommercial=()=>{
  const source=require('./commercial-source-fixture.cjs').fixture('org1','owner1');
  f.commercialRecords=source.records;
  for(const key of [...f.commercialRecords.keys()])if(key.startsWith('WhizzMerchants_')||key.includes('PERSON#')||key.startsWith('WizzCentral_Regions'))f.commercialRecords.delete(key);
  f.branch.commercialAgreementId='a1';f.branch.commercialAgreementVersion=1;
  f.extraPut=p=>{if(['staging-Holds','staging-LedgerEntries','staging-AuditLog'].includes(p.TableName)){
   const r=p.Item,key=p.TableName==='staging-Holds'?{orderId:r.orderId,sk:r.sk}:p.TableName==='staging-LedgerEntries'?{walletId:r.walletId,sk:r.sk}:{datePartition:r.datePartition,sk:r.sk};
   f.commercialRecords.set(p.TableName+'|'+JSON.stringify(key),structuredClone(r));return true;
  }return false;};
  f.env.COMMERCIAL_PRICING_MODE='REQUIRED';
 };
 f.env=env;return f;
}

module.exports={setup};
