'use strict';

const {GetCommand,QueryCommand,ScanCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {planCommit}=require('./ownership-transfer-commit');
const {createPreflight}=require('./merchant-ownership-preflight');
const {destinationKey:proofDestinationKey,decisionKey,isVerified,isApproved}=require('./merchant-ownership-settlement');

const PLATFORM='staging-MerchantPlatform';
const BRANCHES='WhizzMerchants_Businesses';
const WALLETS='staging-Wallets';
const fail=(code,status=409)=>{throw Object.assign(new Error(code),{status});};

function createExecution({Get=GetCommand,Query=QueryCommand,Scan=ScanCommand,Write=TransactWriteCommand}={}){
 const readLivePreflight=createPreflight({Get,Query,Scan});
 return async function execute(ctx,actor,request,reason,now){
  const get=async(TableName,Key)=>(await ctx.db.send(new Get({TableName,Key,ConsistentRead:true}))).Item;
  const scopeKey='ORGANIZATION#'+request.organizationId;
  const fenceKey={pk:scopeKey,sk:'OWNERSHIP_TRANSFER_FENCE'};
  const fence=await get(PLATFORM,fenceKey);
  if(!fence||fence.kind!=='OWNERSHIP_TRANSFER_FENCE'||fence.status!=='FROZEN'||
     fence.requestId!==request.requestId||fence.scopeDigest!==request.digest||
     fence.organizationId!==request.organizationId||fence.expiresAt<=now||
     !Number.isSafeInteger(fence.expiresAt)||!Number.isSafeInteger(fence.version)||
     (ctx.ownershipLeaseId
      ? fence.leaseId!==ctx.ownershipLeaseId
      : fence.leaseId||fence.branchInventoryFrozen!==true||fence.financeWritesFrozen!==true||
        fence.accessWritesFrozen!==true||fence.offlineDevicesRevoked!==true)){
   fail('TRANSFER_MUTATION_FENCE_REQUIRED');
  }
  const proofKey={pk:scopeKey,sk:'OWNERSHIP_TRANSFER_FINANCE#'+request.requestId};
  const accessKey={pk:scopeKey,sk:'OWNERSHIP_TRANSFER_ACCESS#'+request.requestId};
  const destinationKey=proofDestinationKey(request),settlementKey=decisionKey(request);
  const recipientKey={pk:'PERSON#'+request.recipientId,sk:'PROFILE'};
  const [organization,recipient,destination,settlement]=await Promise.all([
   get(PLATFORM,{pk:'PERSON#'+request.ownerId,sk:scopeKey}),
   get(PLATFORM,recipientKey),get(PLATFORM,destinationKey),get(PLATFORM,settlementKey),
  ]);
  if(recipient?.subjectId!==request.recipientId||!Number.isSafeInteger(recipient.version)||recipient.version<1){
   fail('TRANSFER_RECIPIENT_PROFILE_REQUIRED');
  }
  if(!isVerified(request,recipient,destination,now))fail('TRANSFER_DESTINATION_VERIFICATION_REQUIRED');
  if(!isApproved(request,recipient,destination,settlement))fail('TRANSFER_SETTLEMENT_APPROVAL_REQUIRED');
  if(!Array.isArray(request.branchIds)||!request.branchIds.length||request.branchIds.length>94){
   fail('INVALID_TRANSFER_SCOPE');
  }
  const financeRevisions=await Promise.all(request.branchIds.map(async businessId=>{
   const Key={pk:'MERCHANT_PAYOUT#OWNERSHIP_REVISION#'+businessId,sk:'META'};
   const current=await get(PLATFORM,Key);
   if(current&&(!Number.isSafeInteger(current.revision)||current.revision<1)){
    fail('TRANSFER_FINANCE_REVISION_INVALID');
   }
   return {ConditionCheck:{
    TableName:PLATFORM,Key,
    ConditionExpression:current?'revision=:revision':'attribute_not_exists(pk)',
    ...(current?{ExpressionAttributeValues:{':revision':current.revision}}:{}),
   }};
  }));
  const branches=[];
  const walletUpdates=[];
  for(const businessId of request.branchIds){
   const [branch,wallet]=await Promise.all([
    get(BRANCHES,{businessId}),get(WALLETS,{walletId:'WALLET#MERCHANT#'+businessId,sk:'META'}),
   ]);
   if(!branch||!wallet||wallet.ownerType!=='MERCHANT'||wallet.ownerId!==businessId||
      wallet.availableBalance!==0||wallet.lockedBalance!==0||
      !Number.isSafeInteger(wallet.version)||wallet.version<1||wallet.version>=Number.MAX_SAFE_INTEGER||wallet.status!=='ACTIVE'){
    fail('TRANSFER_FINANCIAL_BLOCKERS');
   }
   branches.push(branch);
   walletUpdates.push({Update:{
    TableName:WALLETS,Key:{walletId:wallet.walletId,sk:'META'},
    UpdateExpression:'SET #v=:next',
    ConditionExpression:'#v=:version AND #s=:active AND ownerId=:branch AND ownerType=:merchant AND availableBalance=:zero AND lockedBalance=:zero',
    ExpressionAttributeNames:{'#v':'version','#s':'status'},
    ExpressionAttributeValues:{':version':wallet.version,':next':wallet.version+1,':active':'ACTIVE',':branch':businessId,':merchant':'MERCHANT',':zero':0},
   }});
  }

  const live=await readLivePreflight(ctx.db,request,now);
  const blockers=live.branches.flatMap(branch=>branch.blockers.map(issue=>issue.code));
  if(blockers.includes('BRANCH_SCOPE_CHANGED'))fail('TRANSFER_SCOPE_CHANGED');
  if(blockers.some(code=>['ACTIVE_MEMBERSHIPS','ACTIVE_DEVICES','PENDING_STAFF_INVITATIONS','PENDING_DEVICE_PAIRING','ACTIVE_FINANCIAL_GRANTS'].includes(code))){
   fail('TRANSFER_ACTIVE_ACCESS');
  }
  if(blockers.length)fail('TRANSFER_FINANCIAL_BLOCKERS');

  const branchChecks=branches.map((branch,index)=>({
   businessId:branch.businessId,availableBalance:0,lockedBalance:0,unsettledCount:0,openOrdersCount:0,
   walletVersion:walletUpdates[index].Update.ExpressionAttributeValues[':version'],
   payoutRevision:financeRevisions[index].ConditionCheck.ExpressionAttributeValues?.[':revision']??null,
  }));
  const evidenceBase={
   requestId:request.requestId,scopeDigest:request.digest,fenceVersion:fence.version,
   reviewerId:actor.employeeId,checkedAt:live.checkedAt,status:'VERIFIED',version:1,
  };
  const finance={
   ...proofKey,...evidenceBase,kind:'OWNERSHIP_TRANSFER_FINANCE',branchChecks,
   settlementOwnerId:settlement.recipientId,settlementDestinationApproved:true,
   settlementDecisionVersion:settlement.version,destinationProofVersion:destination.version,
  };
  const access={
   ...accessKey,...evidenceBase,kind:'OWNERSHIP_TRANSFER_ACCESS',
   branchIds:branches.map(branch=>branch.businessId),activeAccessCount:0,
  };
  const saveEvidence=Item=>({Put:{TableName:PLATFORM,Item,ConditionExpression:'attribute_not_exists(pk)'}});

  const brands=[];
  let cursor;
  do{
   const page=await ctx.db.send(new Query({
    TableName:PLATFORM,ConsistentRead:true,ExclusiveStartKey:cursor,
    KeyConditionExpression:'pk=:owner AND begins_with(sk,:brand)',
    ExpressionAttributeValues:{':owner':'PERSON#'+request.ownerId,':brand':'BRAND#'},
   }));
   brands.push(...(page.Items||[]).filter(item=>item.organizationId===request.organizationId));
   if(brands.length>45)fail('TRANSFER_SCOPE_EXCEEDS_TRANSACTION_LIMIT');
   cursor=page.LastEvaluatedKey;
  }while(cursor);

  const accountRequests=[request.ownerId,request.recipientId].map(subjectId=>({ConditionCheck:{
   TableName:'staging-AccountDeletion',
   Key:{pk:'SUBJECT#MERCHANT#'+subjectId,sk:'ACTIVE#ACCOUNT#'+subjectId},
   ConditionExpression:'attribute_not_exists(pk)',
  }}));
  const commitTime=ctx.ownershipClock?ctx.ownershipClock():now;
  const {TransactItems}=planCommit({
   environment:'staging',request,reviewer:{sub:actor.employeeId,reverified:true,canReviewOwnership:true},
   organization,brands,branches,finance,recipient,now:commitTime,
   fence:{...fence,guards:[
    ctx.guard(actor),saveEvidence(finance),saveEvidence(access),
    {ConditionCheck:{
     TableName:PLATFORM,Key:recipientKey,
     ConditionExpression:'subjectId=:recipient AND #v=:version',
     ExpressionAttributeNames:{'#v':'version'},
     ExpressionAttributeValues:{':recipient':request.recipientId,':version':recipient.version},
    }},
    {ConditionCheck:{
     TableName:PLATFORM,Key:destinationKey,
     ConditionExpression:'requestId=:request AND recipientId=:recipient AND scopeDigest=:digest AND profileVersion=:profileVersion AND #v=:version AND #s=:verified AND expiresAt>:now',
     ExpressionAttributeNames:{'#v':'version','#s':'status'},
     ExpressionAttributeValues:{':request':request.requestId,':recipient':request.recipientId,':digest':request.digest,':profileVersion':recipient.version,':version':destination.version,':verified':'VERIFIED',':now':now},
    }},
    {ConditionCheck:{
     TableName:PLATFORM,Key:settlementKey,
     ConditionExpression:'requestId=:request AND recipientId=:recipient AND scopeDigest=:digest AND profileVersion=:profile AND proofVersion=:proof AND #v=:version AND #s=:approved',
     ExpressionAttributeNames:{'#v':'version','#s':'status'},
     ExpressionAttributeValues:{':request':request.requestId,':recipient':request.recipientId,':digest':request.digest,':profile':recipient.version,':proof':destination.version,':version':settlement.version,':approved':'APPROVED'},
    }},
    ...accountRequests,...walletUpdates,...financeRevisions,
    ctx.audit(actor.employeeId,'MERCHANT_OWNERSHIP_TRANSFER_APPROVED',
     {status:request.status},{status:'COMPLETED',reason,branchIds:request.branchIds},request.requestId),
   ]},
  });
  try{
   await ctx.db.send(new Write({TransactItems}));
  }catch(error){
   if(error.name==='TransactionCanceledException')fail('VERSION_OR_STATE_CONFLICT');
   throw error;
  }
  return {...request,status:'COMPLETED',version:request.version+1};
 };
}

module.exports={execute:createExecution(),createExecution};
