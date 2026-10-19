const {test}=require('node:test'),assert=require('node:assert/strict');
const {GetCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {createStagingDriverOfferContext}=require('../../dist/driverOfferContext');
const {createStagingDriverFinancialWave}=require('../../dist/driverFinancialWave');
const {createStagingDriverOfferAcceptance}=require('../../dist/driverOfferAcceptance');
const {prepareDriverOfferFinancialSnapshot:envelope}=require('../../dist/driverOfferOrderReader');
const {input,at,route}=require('./driver-offer-fixture.cjs');
const {quoteCanonical}=require('../../dist/deliveryQuoteRecord');
const clone=structuredClone;
function setup(earning='3000',transform=()=>{},orderId='order1',flowOptions={}){
 const rows=new Map(),calls=[],sent=[],source=input(earning);let time=Date.parse(at);
 source.order.orderId=orderId;transform(source);
 const keys=(table,r)=> table==='WizzOrders'?{PK:r.PK,SK:r.SK}:table==='WizzDispatchJobs_staging'||table==='WaveOffers_staging'?{orderId:r.orderId,SK:r.SK}:
  table==='staging-Wallets'||table==='staging-LedgerEntries'?{walletId:r.walletId,sk:r.sk}:table==='staging-Holds'?{orderId:r.orderId,sk:r.sk}:
  table==='staging-WalletNotifications'?{eventId:r.eventId}:table==='WizzDriverPerformanceMetrics_staging'?{PK:r.PK,SK:r.SK}:table==='staging-AuditLog'?{datePartition:r.datePartition,sk:r.sk}:table==='staging-WalletLifecycle'?{operationId:r.operationId}:
  table==='WhizzMerchants_Businesses'?{businessId:r.businessId}:['WhizzDrivers_staging','WizzDriverLiveState_staging'].includes(table)?{driverId:r.driverId}:{pk:r.pk,sk:r.sk};
 const k=(t,key)=>t+'|'+quoteCanonical(key),put=(t,r)=>rows.set(k(t,keys(t,r)),clone(r)),get=(t,key)=>rows.get(k(t,key));
 put('WizzOrders',{PK:'ORDER#'+orderId,SK:'META',orderId,storeId:'branch1',merchantId:'merchant1',status:'ready_for_pickup',financialSnapshot:flowOptions.deliveryFunding?require('../../dist/deliveryFundedOffer').prepareDeliveryFundedFinancialSnapshot({order:source.order,deliveryFunding:flowOptions.deliveryFunding}):envelope(source.order)});
 put('WizzDispatchJobs_staging',{orderId,SK:'METADATA',dispatchJobId:'dispatch1',restaurantId:'branch1',status:'searching',currentWaveNumber:0,expiresAt:source.assignment.expiresAt});
 put('WhizzMerchants_Businesses',{businessId:'branch1',ownerId:'owner1',cognitoUserId:'owner1',organizationId:'merchant1',status:'approved'});
 put('staging-PlatformStaff',{pk:'OPERATIONAL_SETTINGS#DELIVERY_PRICING',sk:'CURRENT',version:1,values:{deliveryRules:[],driverRules:source.policy.rules}});
 for(const driverId of ['driver1','driver2']){
  put('WhizzDrivers_staging',{driverId,cognitoSub:driverId,status:'APPROVED',vehicleType:'BIKE'});
  put('WizzDriverLiveState_staging',{driverId,status:'available',isActive:true,isSearching:true,lat:31.91,lng:44.45,locationUpdatedAt:at,connectionId:driverId});
  put('staging-Wallets',{walletId:'WALLET#DRIVER#'+driverId,sk:'META',ownerType:'DRIVER',ownerId:driverId,status:'ACTIVE',currency:'IQD',availableBalance:20000,lockedBalance:0,version:1});
 }
 const f={rows,calls,sent,put,get,failSend:false,loseAcceptance:false,beforeCommit:null,get time(){return time;},set time(v){time=v;}};
 function check(q,row){
  if(!q.ConditionExpression)return true;
  return q.ConditionExpression.split(/ AND /).every(term=>{
   const absence=term.trim().match(/^attribute_not_exists\(([^)]+)\)$/);
   const field=v=>q.ExpressionAttributeNames?.[v]??v;
   if(absence)return row?.[field(absence[1])]===undefined;
   const m=term.trim().match(/^(#[A-Za-z0-9_]+)\s*=\s*(:[A-Za-z0-9_]+)$/);
   assert.ok(m,'unsupported condition '+term);return quoteCanonical(row?.[field(m[1])])===quoteCanonical(q.ExpressionAttributeValues[m[2]]);
  });
 }
 const db={async send(c){calls.push(c);
  if(c instanceof GetCommand){const q=c.input,row=get(q.TableName,q.Key);if(!row)return {};if(!q.ProjectionExpression)return {Item:clone(row)};
   return {Item:clone(Object.fromEntries(Object.entries(row).filter(([field])=>Object.values(q.ExpressionAttributeNames).includes(field))))};}
  assert.ok(c instanceof TransactWriteCommand);
  const tx=c.input.TransactItems;
  assert.equal(new Set(tx.map(o=>{const v=o.Put??o.Update??o.ConditionCheck;return k(v.TableName,o.Put?keys(v.TableName,v.Item):v.Key);})).size,tx.length,'duplicate transaction target');
  if(f.beforeCommit){const before=f.beforeCommit;f.beforeCommit=null;before(tx);}
  for(const op of tx){const q=op.Put??op.Update??op.ConditionCheck;const key=op.Put?keys(q.TableName,q.Item):q.Key;
   if(!check(q,get(q.TableName,key))){const e=Error('condition rejected');e.name='TransactionCanceledException';throw e;}}
  for(const op of tx){if(op.Put)put(op.Put.TableName,op.Put.Item);
   if(op.Update){const q=op.Update,row=clone(get(q.TableName,q.Key)??q.Key);
    assert.ok(q.UpdateExpression.startsWith('SET '));
    const [sets,removes]=q.UpdateExpression.slice(4).split(/ REMOVE /);
    for(const term of sets.split(',')){const [name,value]=term.trim().split('=');row[q.ExpressionAttributeNames[name.trim()]??name.trim()]=clone(q.ExpressionAttributeValues[value.trim()]);}
    for(const field of (removes??'').split(',').map(v=>v.trim()).filter(Boolean))delete row[q.ExpressionAttributeNames[field]??field];
    put(q.TableName,row);
   }}
  if(f.loseReturnConfirmation&&tx.some(o=>o.Put?.Item.action==='COD_RETURN_CONFIRMED'))throw Error('return response lost');
  if(f.loseCompletion&&tx.some(o=>o.Put?.Item.action==='COD_ORDER_COMPLETED'))throw Error('completion response lost');
  if(f.loseAcceptance&&tx.some(o=>o.Put?.Item.action==='FINANCIAL_DRIVER_OFFER_ACCEPTED'))throw Error('response lost');
  return {};
 }};
 f.db=db;
 const context=createStagingDriverOfferContext({db,cognito:{async send(c){return {Enabled:true,Username:c.input.Username,UserStatus:'CONFIRMED',UserAttributes:[{Name:'sub',Value:c.input.Username}]};}},
  router:{async getRoute(a,b){return route('route',a,b);}},positionMaxAgeSeconds:120,offerTtlSeconds:60,now:()=>time,enableDeliveryFunding:flowOptions.enableDeliveryFunding});
 f.context=context;
 f.wave=createStagingDriverFinancialWave({db,context,enableDeliveryFunding:flowOptions.enableDeliveryFunding,now:()=>time,sendOffer:async(driverId,message)=>{if(f.failSend)throw Error('network');sent.push({driverId,message});}});
 f.run=(ids=['driver1','driver2'])=>f.wave.run({orderId,branchId:'branch1',waveNumber:1,driverIds:ids});
 f.decline=(driverId='driver1')=>createStagingDriverOfferAcceptance({db,context,enableDeliveryFunding:flowOptions.enableDeliveryFunding,now:()=>time,authenticateDriver:async()=>({driverId,subjectId:driverId})})
  .decline({orderId,waveNumber:1,offerId:sent.find(v=>v.driverId===driverId).message.offer.offerId});
 f.accept=(driverId='driver1',extra={})=>createStagingDriverOfferAcceptance({db,context,enableDeliveryFunding:flowOptions.enableDeliveryFunding,now:()=>time,authenticateDriver:async()=>({driverId,subjectId:driverId})})
  .accept({orderId,waveNumber:1,offerId:sent.find(v=>v.driverId===driverId).message.offer.offerId,...extra});
 return f;
}

module.exports={setup};
