'use strict';

const assert=require('node:assert/strict');
const {resolve}=require('node:path');
const root=resolve(__dirname,'../../../..');
const central=resolve(root,'backend/staff-service');
const merchant=resolve(root,'../whizzMerchants-stg/backend/functions/auth');
const {DynamoDBClient,CreateTableCommand}=require(resolve(central,'node_modules/@aws-sdk/client-dynamodb'));
const sdk=require(resolve(central,'node_modules/@aws-sdk/lib-dynamodb'));
const {createTransferStore}=require(resolve(merchant,'ownership-transfer-store'));
const {createExecution}=require(resolve(central,'merchant-ownership-execution'));
const {createLock}=require(resolve(central,'merchant-ownership-lock'));
const {createSettlementDecision}=require(resolve(central,'merchant-ownership-settlement'));

const port=Number(process.env.OWNERSHIP_TEST_DYNAMODB_PORT);
assert.ok(Number.isInteger(port)&&port>=1024&&port<=65535,'Set OWNERSHIP_TEST_DYNAMODB_PORT for a fresh local DynamoDB instance');
const low=new DynamoDBClient({endpoint:'http://127.0.0.1:'+port,region:'us-east-1',credentials:{accessKeyId:'localonly',secretAccessKey:'localonly'}});
const db=sdk.DynamoDBDocumentClient.from(low,{marshallOptions:{removeUndefinedValues:true}});
const platform='staging-MerchantPlatform',branches='WhizzMerchants_Businesses',wallets='staging-Wallets',deletion='staging-AccountDeletion',staff='staging-PlatformStaff';
const owner='synthetic-old-owner',recipient='synthetic-new-owner',organizationId='synthetic-organization';
const now=Date.now();
const ids=['synthetic-branch-a','synthetic-branch-b'];
const pk='ORGANIZATION#'+organizationId;
const accountKey={pk:'PERSON#'+recipient,sk:'PROFILE'};
const requestKey={pk,sk:'OWNERSHIP_TRANSFER'};
const get=async(TableName,Key)=>(await db.send(new sdk.GetCommand({TableName,Key,ConsistentRead:true}))).Item;
const put=(TableName,Item)=>db.send(new sdk.PutCommand({TableName,Item}));
const update=(TableName,Key,UpdateExpression,ExpressionAttributeNames,ExpressionAttributeValues)=>db.send(new sdk.UpdateCommand({TableName,Key,UpdateExpression,ExpressionAttributeNames,ExpressionAttributeValues}));
const walletKey=branch=>({walletId:'WALLET#MERCHANT#'+branch,sk:'META'});
async function main(){
 for(const [TableName,keys] of [[platform,['pk','sk']],[deletion,['pk','sk']],[staff,['pk','sk']],[branches,['businessId']],[wallets,['walletId','sk']],['staging-IdempotencyKeys',['idempotencyKey','sk']],['WizzOrders',['PK','SK']],['staging-Holds',['orderId','sk']],['staging-TopupRequests',['topupId']]]){
  await low.send(new CreateTableCommand({TableName,BillingMode:'PAY_PER_REQUEST',KeySchema:keys.map((AttributeName,index)=>({AttributeName,KeyType:index?'RANGE':'HASH'})),AttributeDefinitions:keys.map(AttributeName=>({AttributeName,AttributeType:'S'}))}));
 }
 const org={pk:'PERSON#'+owner,sk:pk,subjectId:owner,organizationId,version:1};
 await put(platform,org);
 await put(platform,{pk:org.pk,sk:'BRAND#synthetic-brand',subjectId:owner,organizationId,brandId:'synthetic-brand',version:1});
 await put(platform,{...accountKey,subjectId:recipient,name:'Synthetic recipient',version:1});
 for(const businessId of ids){
  await put(branches,{businessId,organizationId,brandId:'synthetic-brand',ownerId:owner,cognitoUserId:owner,status:'approved',updatedAt:new Date(now).toISOString(),version:1,acceptingOrders:true});
  await put(wallets,{...walletKey(businessId),ownerId:businessId,ownerType:'MERCHANT',availableBalance:0,lockedBalance:0,status:'ACTIVE',version:1});
 }
 const store=createTransferStore({db,...sdk,environment:'staging',clock:()=>now});
 let request=await store.startForOrganization({actor:{sub:owner,reverified:true},recipientId:recipient,requestId:'synthetic-request',organizationId});
 assert.deepEqual(request.branchIds,ids);
 for(const businessId of ids){
  assert.equal((await get(branches,{businessId})).orderIntakeTransferRequestId,request.requestId);
 }
 request=await store.accept({actor:{sub:recipient,reverified:true},organizationId,requestId:request.requestId,expectedDigest:request.digest,agreementVersion:'test-v1'});
 const ready={pk,scopeDigest:request.digest,requestId:request.requestId,status:'READY',version:1};
 const destinationKey={pk,sk:'OWNERSHIP_TRANSFER_DESTINATION#'+request.requestId};
 await put(platform,{...ready,...destinationKey,kind:'OWNERSHIP_TRANSFER_DESTINATION',status:'VERIFIED',recipientId:recipient,profileVersion:1,expiresAt:request.expiresAt});
 const person={pk:'EMPLOYEE#synthetic-reviewer',sk:'PROFILE'};
 await put(staff,{...person,status:'ACTIVE',version:1});
 const ctx={
  db,guard:()=>({ConditionCheck:{TableName:staff,Key:person,ConditionExpression:'#s=:active AND #v=:version',ExpressionAttributeNames:{'#s':'status','#v':'version'},ExpressionAttributeValues:{':active':'ACTIVE',':version':1}}}),
  audit:(_id,action)=>({Put:{TableName:staff,Item:{pk:'AUDIT#synthetic',sk:action.endsWith('_SETTLEMENT_APPROVED')?'DESTINATION':'APPROVED'},ConditionExpression:'attribute_not_exists(pk)'}}),
 };
 const reviewer={employeeId:'synthetic-reviewer'};
 const commit=createExecution();
 const execute=(ctx,reviewer,request,reason,at)=>createLock({clock:()=>at})(ctx,reviewer,request,reason,commit);
 const isFinalCommit=command=>command instanceof sdk.TransactWriteCommand&&
  command.input.TransactItems.some(item=>item.Update?.Key?.sk==='OWNERSHIP_TRANSFER');
 const approveSettlement=createSettlementDecision();
 await assert.rejects(execute(ctx,reviewer,request,'Synthetic review',now+10),/TRANSFER_SETTLEMENT_APPROVAL_REQUIRED/);
 assert.equal((await approveSettlement(ctx,reviewer,request,'Synthetic finance review',now+20)).status,'APPROVED');

 const invite={pk:'BRANCH#'+ids[0],sk:'INVITE#synthetic'};
 await put(platform,{...invite,status:'PENDING',expiresAt:Math.floor(now/1000)+600});
 await assert.rejects(execute(ctx,reviewer,request,'Synthetic review',now+50),/TRANSFER_ACTIVE_ACCESS/);
 assert.equal(await get(platform,{pk,sk:'OWNERSHIP_TRANSFER_FENCE'}),undefined);
 for(const id of ids){
  assert.equal(await get(deletion,{pk:'BUSINESS_LIFECYCLE#MERCHANT#'+id,sk:'META'}),undefined);
 }

 await update(platform,invite,'SET #s=:cancelled',{'#s':'status'},{':cancelled':'CANCELLED'});
 const latePayout={pk:'MERCHANT_PAYOUT#'+ids[0],sk:'PAYOUT#late'};
 await put(platform,{...latePayout,kind:'MERCHANT_PAYOUT',status:'PENDING_APPROVAL'});
 await assert.rejects(execute(ctx,reviewer,request,'Synthetic review',now+60),/TRANSFER_FINANCIAL_BLOCKERS/);
 await update(platform,latePayout,'SET #s=:final',{'#s':'status'},{':final':'FAILED'});
 let intercepted=false;
 const raceDb={send:async command=>{
  if(isFinalCommit(command)){
   intercepted=true;
   await update(wallets,walletKey(ids[1]),'SET availableBalance=:amount, #v=:version',{'#v':'version'},{':amount':1,':version':2});
  }
  return db.send(command);
 }};
 await assert.rejects(execute({...ctx,db:raceDb},reviewer,request,'Synthetic review',now+100),/VERSION_OR_STATE_CONFLICT/);
 assert.equal(intercepted,true);
 assert.equal((await get(platform,requestKey)).status,'AWAITING_REVIEW');
 for(const businessId of ids)assert.equal((await get(branches,{businessId})).ownerId,owner);
 assert.equal(await get(staff,{pk:'AUDIT#synthetic',sk:'APPROVED'}),undefined);
 await update(wallets,walletKey(ids[1]),'SET availableBalance=:amount, #v=:version',{'#v':'version'},{':amount':0,':version':3});
 const pendingTransferKey={idempotencyKey:'TRANSFER#synthetic-late',sk:'META'};
 let transferScanned=false;
 const transferRaceDb={send:async command=>{
  const result=await db.send(command);
  if(!transferScanned&&command instanceof sdk.ScanCommand&&command.input.TableName==='staging-IdempotencyKeys'){
   transferScanned=true;
   await db.send(new sdk.TransactWriteCommand({TransactItems:[
    {Put:{TableName:'staging-IdempotencyKeys',Item:{...pendingTransferKey,
     transferId:'synthetic-late',recipientWalletId:walletKey(ids[0]).walletId,status:'PENDING_APPROVAL'}}},
    {Update:{TableName:wallets,Key:walletKey(ids[0]),UpdateExpression:'SET #v=:new',
     ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':new':2}}},
   ]}));
  }
  return result;
 }};
 await assert.rejects(execute({...ctx,db:transferRaceDb},reviewer,request,'Synthetic review',now+120),/VERSION_OR_STATE_CONFLICT/);
 assert.equal(transferScanned,true);
 assert.equal((await get(platform,requestKey)).status,'AWAITING_REVIEW');
 await update('staging-IdempotencyKeys',pendingTransferKey,'SET #s=:done',{'#s':'status'},{':done':'CANCELLED'});
 const payoutRaceDb={send:async command=>{
  if(isFinalCommit(command)){
   await db.send(new sdk.TransactWriteCommand({TransactItems:[
    {Put:{TableName:platform,Item:{...latePayout,kind:'MERCHANT_PAYOUT',status:'PENDING_APPROVAL'}}},
    {Put:{TableName:platform,Item:{pk:'MERCHANT_PAYOUT#OWNERSHIP_REVISION#'+ids[0],sk:'META',revision:1}}},
   ]}));
  }
  return db.send(command);
 }};
 await assert.rejects(execute({...ctx,db:payoutRaceDb},reviewer,request,'Synthetic review',now+125),/VERSION_OR_STATE_CONFLICT/);
 assert.equal((await get(platform,requestKey)).status,'AWAITING_REVIEW');
 await update(platform,latePayout,'SET #s=:final',{'#s':'status'},{':final':'FAILED'});
 const recipientRaceDb={send:async command=>{
  if(isFinalCommit(command)){
   await update(platform,accountKey,'SET #name=:name, #v=:version',{'#name':'name','#v':'version'},{':name':'Changed recipient',':version':2});
  }
  return db.send(command);
 }};
 await assert.rejects(execute({...ctx,db:recipientRaceDb},reviewer,request,'Synthetic review',now+150),/VERSION_OR_STATE_CONFLICT/);
 assert.equal((await get(platform,requestKey)).status,'AWAITING_REVIEW');
 await assert.rejects(execute(ctx,reviewer,request,'Synthetic review',now+175),/TRANSFER_DESTINATION_VERIFICATION_REQUIRED/);
 await update(platform,destinationKey,'SET profileVersion=:profileVersion, #v=:version',{'#v':'version'},{':profileVersion':2,':version':2});
 await assert.rejects(execute(ctx,reviewer,request,'Synthetic review',now+180),/TRANSFER_SETTLEMENT_APPROVAL_REQUIRED/);
 // The second approval uses its own audit entry, as the real audit path keys by decision version.
 const reapproval={...ctx,audit:()=>({Put:{TableName:staff,Item:{pk:'AUDIT#synthetic',sk:'DESTINATION#2'},ConditionExpression:'attribute_not_exists(pk)'}})};
 await approveSettlement(reapproval,reviewer,request,'Synthetic reapproval',now+190);

 assert.equal((await execute(ctx,reviewer,request,'Synthetic review',now+200)).status,'COMPLETED');
 assert.equal((await get(platform,requestKey)).status,'COMPLETED');
 assert.equal(await get(platform,{pk,sk:'OWNERSHIP_TRANSFER_FENCE'}),undefined);
 for(const id of ids){
  assert.equal(await get(deletion,{pk:'BUSINESS_LIFECYCLE#MERCHANT#'+id,sk:'META'}),undefined);
 }

 const finance=await get(platform,{pk,sk:'OWNERSHIP_TRANSFER_FINANCE#'+request.requestId});
 const access=await get(platform,{pk,sk:'OWNERSHIP_TRANSFER_ACCESS#'+request.requestId});
 assert.equal(finance.settlementDecisionVersion,2);
 assert.equal(finance.branchChecks.length,2);
 assert.equal(finance.branchChecks[0].walletVersion,2);
 assert.equal(access.activeAccessCount,0);
 assert.deepEqual(access.branchIds,ids);

 assert.equal(await get(platform,{pk:org.pk,sk:org.sk}),undefined);
 assert.equal((await get(platform,{pk:'PERSON#'+recipient,sk:org.sk})).subjectId,recipient);
 for(const businessId of ids){
  const branch=await get(branches,{businessId});
  assert.equal(branch.ownerId,recipient);
  assert.equal(branch.cognitoUserId,recipient);
  assert.equal(branch.orderIntakeTransferRequestId,undefined);
  assert.equal(branch.acceptingOrders,true);
  const wallet=await get(wallets,walletKey(businessId));
  assert.equal(wallet.availableBalance,0);
  assert.equal(wallet.lockedBalance,0);
  assert.equal(wallet.version,businessId===ids[0]?3:4);
 }
 assert.ok(await get(staff,{pk:'AUDIT#synthetic',sk:'APPROVED'}));
 console.log('PASS real DynamoDB Local: start, accept, concurrent-wallet, transfer, payout and recipient-profile rollback, atomic commit, audit, pause removal.');
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>low.destroy());
