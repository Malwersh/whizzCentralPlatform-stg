'use strict';
// Explicit, bounded DynamoDB integration only. No deployment, OTP, notification or shared platform wallet.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs');
const walletRequire=require('node:module').createRequire(require.resolve('../backend/wallet-service/dist/codReturn'));
const {DynamoDBClient}=walletRequire('@aws-sdk/client-dynamodb');
const {DynamoDBDocumentClient,GetCommand,PutCommand,DeleteCommand,TransactWriteCommand}=walletRequire('@aws-sdk/lib-dynamodb');
const {STSClient,GetCallerIdentityCommand}=require('@aws-sdk/client-sts');
const {input,route}=require('../backend/wallet-service/test/helpers/driver-offer-fixture.cjs');
const {buildDriverOffer,prepareDriverOfferAcceptance}=require('../backend/wallet-service/dist/driverOffer');
const {prepareDriverOfferFinancialSnapshot}=require('../backend/wallet-service/dist/driverOfferOrderReader');
const {createStagingCodReturn}=require('../backend/wallet-service/dist/codReturn');
const {createStagingCodReassignment}=require('../backend/wallet-service/dist/codReassignment');
const {quoteHash}=require('../backend/wallet-service/dist/deliveryQuoteRecord');
if(!process.argv.includes('--execute-synthetic')||process.env.AWS_PROFILE!=='Wizz_stg_UserApp'||process.env.AWS_REGION!=='us-east-1')throw Error('EXPLICIT_STAGING_PROFILE_REQUIRED');
const db=DynamoDBDocumentClient.from(new DynamoDBClient({region:'us-east-1'}));
const tables={o:'WizzOrders',b:'WhizzMerchants_Businesses',d:'WhizzDrivers_staging',live:'WizzDriverLiveState_staging',wallet:'staging-Wallets',h:'staging-Holds',jobs:'WizzDispatchJobs_staging',offers:'WaveOffers_staging',lc:'staging-WalletLifecycle',audit:'staging-AuditLog',ledger:'staging-LedgerEntries'};
function key(t,r){if(t===tables.o)return {PK:r.PK,SK:r.SK};if(t===tables.b)return {businessId:r.businessId};if([tables.d,tables.live].includes(t))return {driverId:r.driverId};if([tables.wallet,tables.ledger].includes(t))return {walletId:r.walletId,sk:r.sk};if(t===tables.h)return {orderId:r.orderId,sk:r.sk};if([tables.jobs,tables.offers].includes(t))return {orderId:r.orderId,SK:r.SK};if(t===tables.lc)return {operationId:r.operationId};if(t===tables.audit)return {datePartition:r.datePartition,sk:r.sk};throw Error('UNREVIEWED_TABLE');}
async function scenario(mode){
 const id='cod23_'+crypto.randomBytes(10).toString('hex'),driver=id+'_driver',owner=id+'_owner',branch=id+'_branch',org=id+'_org',walletId='WALLET#DRIVER#'+driver;
 const at=new Date().toISOString(),end=new Date(Date.now()+120000).toISOString(),source=input('3000');
 Object.assign(source,{offerId:'FINO:'+id,at});source.driver.id=driver;source.driver.subjectId=driver;source.driver.observedAt=at;source.driver.expiresAt=end;
 Object.assign(source.assignment,{id:id+'_dispatch',expiresAt:end});Object.assign(source.order,{orderId:id,branchId:branch,merchantId:org,snapshotId:id+'_snapshot'});
 for(const r of [source.pickupRoute,source.deliveryRoute])Object.assign(r.route,{measuredAt:at,expiresAt:end});
 const offer=buildDriverOffer(source),terms=prepareDriverOfferAcceptance({offer,offerId:offer.offerId,driverId:driver,subjectId:driver,assignmentId:source.assignment.id,assignmentVersion:1,order:source.order,at,policy:{version:1,enabledRuleVersions:[{id:offer.calculation.rule.id,version:offer.calculation.rule.version,hash:offer.ruleHash}]}}).acceptedTerms;
 const H=terms.driverWalletHold.minorAmount/1000,holdId='FH:'+id;
 const rows=[
 [tables.o,{PK:'ORDER#'+id,SK:'META',orderId:id,storeId:branch,merchantId:org,status:mode==='return'?'picked_up':'assigned',orderStatus:'assigned',driverId:driver,assignmentAttemptCounter:1,assignmentWaveNumber:1,financialSnapshot:prepareDriverOfferFinancialSnapshot(source.order),financialAcceptance:terms,holdId,holdStatus:'ACTIVE',holdAmount:H}],
 [tables.b,{businessId:branch,ownerId:owner,cognitoUserId:owner,organizationId:org,status:'approved'}],
 [tables.d,{driverId:driver,cognitoSub:driver,status:'APPROVED',vehicleType:'BIKE'}],
 [tables.live,{driverId:driver,status:'busy',isActive:true,isSearching:false,currentOrderId:id,activeOrdersCount:1}],
 [tables.wallet,{walletId,sk:'META',ownerType:'DRIVER',ownerId:driver,currency:'IQD',status:'ACTIVE',availableBalance:20000-H,lockedBalance:H,version:2}],
 [tables.h,{orderId:id,sk:'HOLD',holdId,walletId,amount:H,status:'ACTIVE',financialSchemaVersion:2,metadata:{assignmentAttempt:1,offerId:offer.offerId,offerDigest:offer.digest},createdAt:at,updatedAt:at}],
 [tables.jobs,{orderId:id,SK:'METADATA',dispatchJobId:source.assignment.id,restaurantId:branch,status:'assigned',assignedDriverId:driver,currentWaveNumber:1,financialDispatch:true,expiresAt:end}],
 [tables.offers,{orderId:id,SK:'FINANCIAL#'+driver+'#WAVE#1',kind:'FINANCIAL_DRIVER_OFFER',schemaVersion:2,waveNumber:1,offerId:offer.offerId,driverId:driver,financialOffer:offer,acceptedTerms:terms,responseStatus:'financial_accepted',isWinner:true}],
 [tables.lc,{operationId:holdId,orderId:id,walletId,amount:H,financialSchemaVersion:2,status:'REVIEW_REQUIRED'}]
 ];
 const touched=new Map(),seen=(t,k)=>t+'|'+JSON.stringify(k);
 function scoped(t,k,item,mutation=false){
  if(t==='staging-AccountDeletion'){assert.equal(mutation,false);assert.ok([`ACCOUNT_LIFECYCLE#DRIVER#${driver}`,`ACCOUNT_LIFECYCLE#MERCHANT#${owner}`,`BUSINESS_LIFECYCLE#MERCHANT#${branch}`].includes(k.pk));return;}
  if(t===tables.wallet||t===tables.ledger)assert.equal(k.walletId,walletId,'shared/nonfixture wallet prohibited');
  else if(t===tables.o)assert.equal(k.PK,'ORDER#'+id);
  else if(t===tables.b)assert.equal(k.businessId,branch);
  else if([tables.d,tables.live].includes(t))assert.equal(k.driverId,driver);
  else if([tables.h,tables.jobs,tables.offers].includes(t))assert.equal(k.orderId,id);
  else if([tables.audit,tables.lc].includes(t)){if(item)assert.equal(item.orderId,id);else assert.ok([...touched.values()].some(x=>x.t===t&&JSON.stringify(x.k)===JSON.stringify(k)),'unregistered audit/lifecycle key');}
  else throw Error('UNREVIEWED_TABLE');
 }
 const client={async send(c){
  if(c instanceof GetCommand){scoped(c.input.TableName,c.input.Key,null,false);return db.send(c);}
  assert.ok(c instanceof TransactWriteCommand);
  for(const op of c.input.TransactItems){const q=op.Put??op.Update??op.ConditionCheck,t=q.TableName,k=op.Put?key(t,q.Item):q.Key;scoped(t,k,op.Put?.Item,!!(op.Put||op.Update));if(op.Put||op.Update)touched.set(seen(t,k),{t,k});}
  return db.send(c);
 }};
 let result;
 try{
  for(const [t,row] of rows){row.testFixture=id;const k=key(t,row);scoped(t,k,row,true);const existing=(await db.send(new GetCommand({TableName:t,Key:k,ConsistentRead:true}))).Item;assert.equal(existing,undefined,'fixture key already exists');await db.send(new PutCommand({TableName:t,Item:row,ConditionExpression:'attribute_not_exists(#p)',ExpressionAttributeNames:{'#p':Object.keys(k)[0]}}));touched.set(seen(t,k),{t,k});}
  const selectors={orderId:id,offerId:offer.offerId,attempt:1};
  const returns=(actor)=>createStagingCodReturn({db:client,authenticate:async()=>actor});
  if(mode==='return'){
   const r=await returns({kind:'DRIVER',subjectId:driver}).requestReturn({...selectors,reason:'CUSTOMER_REFUSED',cashCollected:false});
   await returns({kind:'DRIVER',subjectId:driver}).arriveReturn({...selectors,returnId:r.returnId});
   const view=await returns({kind:'MERCHANT_OWNER',subjectId:owner}).readReturn({...selectors,branchId:branch});
   const body={...selectors,branchId:branch,returnId:r.returnId,expectedVersion:view.version,allItemsReceived:true,condition:'INTACT',driverResponsibility:'NONE',cashCollected:false};
   const [a,b]=await Promise.all([returns({kind:'MERCHANT_OWNER',subjectId:owner}).confirmReceipt(body),returns({kind:'MERCHANT_OWNER',subjectId:owner}).confirmReceipt(body)]);
   assert.equal(a.success,true);assert.equal(b.success,true);assert.equal((await returns({kind:'MERCHANT_OWNER',subjectId:owner}).confirmReceipt(body)).replayed,true);
  }else{
   const actor=mode==='cancel'?{kind:'MERCHANT_OWNER',subjectId:owner}:{kind:'DRIVER',subjectId:driver};
   const service=createStagingCodReassignment({db:client,authenticate:async()=>actor,reassignmentWindowSeconds:120});
   const body=mode==='cancel'?{...selectors,branchId:branch,goodsRetainedByBranch:true,cashCollected:false}:{...selectors,cashCollected:false,reason:'VehicleIssue'};
   const run=()=>mode==='cancel'?service.cancelBeforePickup(body):service.unassign(body);await run();assert.equal((await run()).replayed,true);
  }
  const w=(await db.send(new GetCommand({TableName:tables.wallet,Key:{walletId,sk:'META'},ConsistentRead:true}))).Item;
  assert.equal(w.availableBalance,20000);assert.equal(w.lockedBalance,0);assert.equal(w.version,3);
  const order=(await db.send(new GetCommand({TableName:tables.o,Key:{PK:'ORDER#'+id,SK:'META'},ConsistentRead:true}))).Item;
  assert.equal(order.status,{return:'returned',cancel:'cancelled',unassign:'ready_for_pickup'}[mode]);
  result={mode,passed:true,syntheticOnly:true,authentication:'INJECTED_FIXTURE_NOT_COGNITO',sharedWalletAccess:false};
 }finally{
  let deleted=0;
  for(const {t,k} of [...touched.values()].reverse()){
   const row=(await db.send(new GetCommand({TableName:t,Key:k,ConsistentRead:true}))).Item;if(!row)continue;
   const field=t===tables.wallet?'walletId':t===tables.ledger?'relatedEntityId':t===tables.b?'businessId':[tables.d,tables.live].includes(t)?'driverId':'orderId';
   const expected=t===tables.wallet?walletId:t===tables.b?branch:[tables.d,tables.live].includes(t)?driver:id;assert.equal(row[field],expected,'cleanup refused foreign record');
   await db.send(new DeleteCommand({TableName:t,Key:k,ConditionExpression:'#own=:own',ExpressionAttributeNames:{'#own':field},ExpressionAttributeValues:{':own':expected}}));deleted++;
  }
  for(const {t,k} of touched.values())assert.equal((await db.send(new GetCommand({TableName:t,Key:k,ConsistentRead:true}))).Item,undefined);
  if(result)result.cleanedRecords=deleted;
  console.log(JSON.stringify({mode,cleanupVerified:true,deleted}));
 }
 return result;
}
(async()=>{
 const who=await new STSClient({region:'us-east-1'}).send(new GetCallerIdentityCommand({}));assert.equal(who.Account,'699561669180');
 const results=[];for(const mode of ['return','cancel','unassign'])results.push(await scenario(mode));
 fs.writeFileSync('/private/tmp/cod23-staging-result.json',JSON.stringify({at:new Date().toISOString(),account:who.Account,region:'us-east-1',results,scope:'REAL_DYNAMODB_ONLY_NOT_GATEWAY_OR_LIVE_AUTH'},null,2)+'\n');console.log(JSON.stringify(results));
})().catch(e=>{console.error(e.name+': '+e.message);process.exitCode=1;});
