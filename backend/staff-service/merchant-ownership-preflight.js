'use strict';

const {GetCommand,QueryCommand,ScanCommand}=require('@aws-sdk/lib-dynamodb');
const {branchAccess}=require('./merchant-ownership-access');
const PLATFORM='staging-MerchantPlatform';
const BRANCHES='WhizzMerchants_Businesses';
const terminalOrders=new Set([
 'delivered','completed','returned','rejected','refunded','cancelled','canceled',
 'canceled_by_user','canceled_by_customer','canceled_by_store','canceled_by_restaurant',
 'canceled_by_driver','canceled_by_system',
]);
const terminalTopups=new Set(['APPROVED','POSTED','COMPLETED','REJECTED','CANCELLED','CANCELED']);
const terminalTransfers=new Set(['COMPLETED','REJECTED','CANCELLED','CANCELED']);
const fail=code=>{throw Object.assign(new Error(code),{status:409});};

function createPreflight({Get=GetCommand,Query=QueryCommand,Scan=ScanCommand,maxPages=30}={}){
 return async function preflight(db,request,now){
  const ids=request.branchIds;
  if(!Array.isArray(ids)||!ids.length||ids.length>94||
     new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(id))){
   fail('INVALID_TRANSFER_SCOPE');
  }
  if(request.status!=='AWAITING_REVIEW'||!Number.isSafeInteger(request.expiresAt)||request.expiresAt<=now){
   fail('VERSION_OR_STATE_CONFLICT');
  }
  async function pages(Command,input){
   const rows=[];
   let cursor;
   for(let page=0;page<maxPages;page++){
    const result=await db.send(new Command({...input,Limit:100,ConsistentRead:true,ExclusiveStartKey:cursor}));
    rows.push(...(result.Items||[]));
    cursor=result.LastEvaluatedKey;
    if(!cursor)return rows;
   }
   fail('TRANSFER_INVENTORY_INCOMPLETE');
  }
  const get=async(TableName,Key,ProjectionExpression)=>
   (await db.send(new Get({TableName,Key,ProjectionExpression,ConsistentRead:true}))).Item;
  const walletOwners=new Map(ids.map(id=>['WALLET#MERCHANT#'+id,id]));
  const summary=new Map(ids.map(businessId=>[businessId,{businessId,blockers:[]}]));
  const count=(branchId,code)=>{
   const branch=summary.get(branchId);
   if(!branch)return;
   const existing=branch.blockers.find(item=>item.code===code);
   if(existing)existing.count++;
   else branch.blockers.push({code,count:1});
  };

  const [orders,holds,topups,transfers]=await Promise.all([
   pages(Scan,{TableName:'WizzOrders',ProjectionExpression:'storeId, businessId, restaurantId, #status, orderStatus',ExpressionAttributeNames:{'#status':'status'}}),
   pages(Scan,{TableName:'staging-Holds',ProjectionExpression:'walletId, #status',ExpressionAttributeNames:{'#status':'status'}}),
   pages(Scan,{TableName:'staging-TopupRequests',ProjectionExpression:'walletId, #status',ExpressionAttributeNames:{'#status':'status'}}),
   pages(Scan,{TableName:'staging-IdempotencyKeys',ProjectionExpression:'idempotencyKey, transferId, sourceWalletId, recipientWalletId, #status, #enabled, ownerId',ExpressionAttributeNames:{'#status':'status','#enabled':'enabled'}}),
  ]);
  for(const order of orders){
   if(terminalOrders.has(String(order.status||order.orderStatus||'').toLowerCase()))continue;
   for(const branchId of new Set([order.storeId,order.businessId,order.restaurantId]))count(branchId,'ACTIVE_ORDERS');
  }
  for(const hold of holds)if(hold.status==='ACTIVE')count(walletOwners.get(hold.walletId),'ACTIVE_HOLDS');
  for(const topup of topups)if(!terminalTopups.has(topup.status))count(walletOwners.get(topup.walletId),'PENDING_TOPUPS');
  for(const transfer of transfers){
   if(transfer.idempotencyKey?.startsWith('MERCHANT_FINANCE#')&&transfer.enabled===true){
    count(transfer.idempotencyKey.split('#')[1],'ACTIVE_FINANCIAL_GRANTS');
   }
   if(!transfer.transferId||terminalTransfers.has(transfer.status))continue;
   for(const walletId of new Set([transfer.sourceWalletId,transfer.recipientWalletId]))count(walletOwners.get(walletId),'PENDING_TRANSFERS');
  }

  const partition=(pk,projection)=>pages(Query,{
   TableName:PLATFORM,KeyConditionExpression:'pk=:pk',ExpressionAttributeValues:{':pk':pk},
   ProjectionExpression:projection+', #status',ExpressionAttributeNames:{'#status':'status'},
  });
  for(const businessId of ids){
   const target=summary.get(businessId);
   const [branch,wallet,access,payouts,corrections]=await Promise.all([
    get(BRANCHES,{businessId},'businessId, businessName, ownerId, cognitoUserId, organizationId, orderIntakeTransferRequestId, orderIntakeTransferExpiresAt'),
    get('staging-Wallets',{walletId:'WALLET#MERCHANT#'+businessId,sk:'META'},'walletId, ownerId, ownerType, availableBalance, lockedBalance'),
    partition('BRANCH#'+businessId,'sk, ownerId, expiresAt'),
    partition('MERCHANT_PAYOUT#'+businessId,'sk, kind'),
    partition('MERCHANT_CORRECTIONS#'+businessId,'sk, kind'),
   ]);
   if(!branch||branch.ownerId!==request.ownerId||branch.cognitoUserId!==request.ownerId||
      branch.organizationId!==request.organizationId||branch.orderIntakeTransferRequestId!==request.requestId||
      branch.orderIntakeTransferExpiresAt!==request.expiresAt){
    count(businessId,'BRANCH_SCOPE_CHANGED');
   }
   target.name=typeof branch?.businessName==='string'?branch.businessName:businessId;
   if(!wallet||wallet.ownerId!==businessId||wallet.ownerType!=='MERCHANT'||
      !Number.isSafeInteger(wallet.availableBalance)||!Number.isSafeInteger(wallet.lockedBalance)){
    count(businessId,'WALLET_EVIDENCE_UNAVAILABLE');
   }else{
    if(wallet.availableBalance!==0)target.blockers.push({code:'WALLET_BALANCE',amount:wallet.availableBalance});
    if(wallet.lockedBalance!==0)target.blockers.push({code:'WALLET_LOCKED',amount:wallet.lockedBalance});
   }
   target.blockers.push(...branchAccess(access,now));
   for(const item of payouts){
    if(item.kind==='MERCHANT_PAYOUT'&&!['COMPLETED','PAID','REJECTED','CANCELLED','CANCELED','EXPIRED','FAILED','FAILED_NOT_PAID'].includes(item.status))count(businessId,'PENDING_PAYOUTS');
   }
   for(const item of corrections){
    if(item.status==='PENDING_APPROVAL'||item.kind==='MERCHANT_CORRECTION_RESERVATION'&&item.status==='ACTIVE')count(businessId,'PENDING_CORRECTIONS');
   }
  }
  return {branches:[...summary.values()],checkedAt:now};
 };
}

module.exports={preflight:createPreflight(),createPreflight};
