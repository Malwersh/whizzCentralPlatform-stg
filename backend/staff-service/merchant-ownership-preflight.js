'use strict';

const {GetCommand,QueryCommand,ScanCommand}=require('@aws-sdk/lib-dynamodb');
const {branchAccess}=require('./merchant-ownership-access');
const stagingTables={platform:'staging-MerchantPlatform',businesses:'WhizzMerchants_Businesses',
 orders:'WizzOrders',holds:'staging-Holds',topups:'staging-TopupRequests',
 transfers:'staging-IdempotencyKeys',wallets:'staging-Wallets'};
const terminalOrders=new Set([
 'delivered','completed','returned','rejected','refunded','expired','cancelled','canceled',
 'canceled_by_user','canceled_by_customer','canceled_by_store','canceled_by_restaurant',
 'canceled_by_driver','canceled_by_system',
]);
const terminalTopups=new Set(['APPROVED','POSTED','COMPLETED','REJECTED','CANCELLED','CANCELED']);
const terminalTransfers=new Set(['COMPLETED','REJECTED','CANCELLED','CANCELED']);
const fail=code=>{throw Object.assign(new Error(code),{status:409});};

function settledCorrectionPosition(row){
 const amounts=['creditIqd','debtIqd','creditPaidIqd','debtRecoveredIqd'];
 return amounts.every(field=>Number.isSafeInteger(row[field])&&row[field]>=0)&&
  row.creditIqd===row.creditPaidIqd&&row.debtIqd===row.debtRecoveredIqd&&
  (row.creditReservedIqd??0)===0&&(row.debtReservedIqd??0)===0;
}

function createPreflight({Get=GetCommand,Query=QueryCommand,Scan=ScanCommand,maxPages=30,tables=stagingTables,production=false}={}){
 return async function preflight(db,request,now){
  const ids=request.branchIds;
  if(!Array.isArray(ids)||!ids.length||ids.length>94||
     new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(id))){
   fail('INVALID_TRANSFER_SCOPE');
  }
  if(request.status!=='AWAITING_REVIEW'||!Number.isSafeInteger(request.expiresAt)||request.expiresAt<=now){
   fail('VERSION_OR_STATE_CONFLICT');
  }
 async function pages(Command,input,limit=100){
   const rows=[];
   let cursor;
   for(let page=0;page<maxPages;page++){
    const result=await db.send(new Command({...input,Limit:limit,ConsistentRead:true,ExclusiveStartKey:cursor}));
    rows.push(...(result.Items||[]));
    cursor=result.LastEvaluatedKey;
    if(!cursor)return rows;
   }
   fail('TRANSFER_INVENTORY_INCOMPLETE');
  }
  const get=async(TableName,Key,ProjectionExpression)=>
   (await db.send(new Get({TableName,Key,ProjectionExpression,ConsistentRead:true,
     ...(ProjectionExpression.includes('#status')?{ExpressionAttributeNames:{'#status':'status'}}:{})}))).Item;
  const walletOwners=new Map(ids.map(id=>['WALLET#MERCHANT#'+id,id]));
  const matchValues=values=>Object.fromEntries(values.map((value,index)=>[':scope'+index,value]));
  const branchValues=matchValues(ids),walletValues=matchValues([...walletOwners.keys()]);
  const inSet=(field,values)=>field+' IN ('+Object.keys(values).join(',')+')';
  const summary=new Map(ids.map(businessId=>[businessId,{businessId,blockers:[]}]));
  const count=(branchId,code)=>{
   const branch=summary.get(branchId);
   if(!branch)return;
   const existing=branch.blockers.find(item=>item.code===code);
   if(existing)existing.count++;
   else branch.blockers.push({code,count:1});
  };

  const [orders,holds,topups,transfers]=await Promise.all([
   pages(Scan,{TableName:tables.orders,ProjectionExpression:'PK, SK, storeId, businessId, restaurantId, #status, orderStatus',
    FilterExpression:['storeId','businessId','restaurantId'].map(field=>inSet(field,branchValues)).join(' OR '),
    ExpressionAttributeValues:branchValues,ExpressionAttributeNames:{'#status':'status'}},1000),
   ...[[tables.holds,'orderId'],[tables.topups,'topupId']].map(([TableName,key])=>pages(Scan,{
    TableName,ProjectionExpression:key+', sk, walletId, #status',FilterExpression:inSet('walletId',walletValues),
    ExpressionAttributeValues:walletValues,ExpressionAttributeNames:{'#status':'status'},
   },1000)),
   pages(Scan,{TableName:tables.transfers,ProjectionExpression:'idempotencyKey, sk, transferId, sourceWalletId, recipientWalletId, #status, #enabled, ownerId',ExpressionAttributeNames:{'#status':'status','#enabled':'enabled'}},1000),
  ]);
  for(const order of orders){
   if(terminalOrders.has(String(order.status||order.orderStatus||'').toLowerCase()))continue;
   for(const branchId of new Set([order.storeId,order.businessId,order.restaurantId]))count(branchId,'ACTIVE_ORDERS');
  }
  for(const hold of holds){
   if(hold.status==='ACTIVE'||production&&hold.status==='LOCKED_PENDING_SETTLEMENT'){
    count(walletOwners.get(hold.walletId),'ACTIVE_HOLDS');
   }
  }
  for(const topup of topups)if(!terminalTopups.has(topup.status))count(walletOwners.get(topup.walletId),'PENDING_TOPUPS');
  for(const transfer of transfers){
   if(transfer.idempotencyKey?.startsWith('MERCHANT_FINANCE#')&&transfer.enabled===true){
    count(transfer.idempotencyKey.split('#')[1],'ACTIVE_FINANCIAL_GRANTS');
   }
   if(!transfer.transferId||terminalTransfers.has(transfer.status))continue;
   for(const walletId of new Set([transfer.sourceWalletId,transfer.recipientWalletId]))count(walletOwners.get(walletId),'PENDING_TRANSFERS');
  }

  const partition=(pk,projection)=>pages(Query,{
   TableName:tables.platform,KeyConditionExpression:'pk=:pk',ExpressionAttributeValues:{':pk':pk},
   ProjectionExpression:projection+', #status',ExpressionAttributeNames:{'#status':'status'},
  });
  for(const businessId of ids){
   const target=summary.get(businessId);
   const [branch,wallet,access,payouts,corrections]=await Promise.all([
    get(tables.businesses,{businessId},'businessId, businessName, ownerId, cognitoUserId, organizationId, orderIntakeTransferRequestId, orderIntakeTransferExpiresAt'),
    get(tables.wallets,{walletId:'WALLET#MERCHANT#'+businessId,sk:'META'},'walletId, ownerId, ownerType, availableBalance, lockedBalance'+(production?', version, #status':'')),
    partition('BRANCH#'+businessId,'sk, ownerId, expiresAt'),
    partition('MERCHANT_PAYOUT#'+businessId,'sk, kind'),
    partition('MERCHANT_CORRECTIONS#'+businessId,'sk, kind'+
     (production?', ownerId, branchId, version, creditIqd, debtIqd, creditPaidIqd, debtRecoveredIqd, creditReservedIqd, debtReservedIqd':'')),
   ]);
   if(!branch||branch.ownerId!==request.ownerId||branch.cognitoUserId!==request.ownerId||
      branch.organizationId!==request.organizationId||branch.orderIntakeTransferRequestId!==request.requestId||
      branch.orderIntakeTransferExpiresAt!==request.expiresAt){
    count(businessId,'BRANCH_SCOPE_CHANGED');
   }
   target.name=typeof branch?.businessName==='string'?branch.businessName:businessId;
   if(!wallet&&production){
    if(target.blockers.some(blocker=>blocker.code==='ACTIVE_HOLDS'))count(businessId,'WALLET_EVIDENCE_UNAVAILABLE');
   }else if(!wallet||production&&(wallet.status!=='ACTIVE'||!Number.isSafeInteger(wallet.version)||wallet.version<1||wallet.version>=Number.MAX_SAFE_INTEGER)||wallet.ownerId!==businessId||wallet.ownerType!=='MERCHANT'||
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
    if(production&&item.sk==='POSITION'&&(item.kind!=='MERCHANT_CORRECTION_POSITION'||
       item.ownerId!==request.ownerId||item.branchId!==businessId||!Number.isSafeInteger(item.version)||
       item.version<0||item.version>=Number.MAX_SAFE_INTEGER||!settledCorrectionPosition(item)))count(businessId,'PENDING_CORRECTIONS');
    if(item.status==='PENDING_APPROVAL'||item.kind==='MERCHANT_CORRECTION_RESERVATION'&&item.status==='ACTIVE')count(businessId,'PENDING_CORRECTIONS');
   }
  }
  return {branches:[...summary.values()],checkedAt:now};
 };
}

module.exports={preflight:createPreflight(),createPreflight,settledCorrectionPosition};
