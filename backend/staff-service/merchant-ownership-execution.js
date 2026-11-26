'use strict';

const {GetCommand,QueryCommand,ScanCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {planCommit}=require('./ownership-transfer-commit');
const {createPreflight,settledCorrectionPosition}=require('./merchant-ownership-preflight');
const {destinationKey:proofDestinationKey,decisionKey,isVerified,isApproved}=require('./merchant-ownership-settlement');

const PLATFORM='staging-MerchantPlatform';
const BRANCHES='WhizzMerchants_Businesses';
const WALLETS='staging-Wallets';
const fail=(code,status=409)=>{throw Object.assign(new Error(code),{status});};

function createExecution({Get=GetCommand,Query=QueryCommand,Scan=ScanCommand,Write=TransactWriteCommand, environment='staging', tables, completionWrites=()=>[]}={}){
 const platform=tables?.platform??PLATFORM;
 const businesses=tables?.businesses??BRANCHES;
 const wallets=tables?.wallets??WALLETS;
 const deletion=tables?.deletion??'staging-AccountDeletion';
 const production=environment==='production';
 const readLivePreflight=createPreflight({Get,Query,Scan,tables,production});
 return async function execute(ctx,actor,request,reason,now){
  const get=async(TableName,Key)=>(await ctx.db.send(new Get({TableName,Key,ConsistentRead:true}))).Item;
  const scopeKey='ORGANIZATION#'+request.organizationId;
  const fenceKey={pk:scopeKey,sk:'OWNERSHIP_TRANSFER_FENCE'};
  const fence=await get(platform,fenceKey);
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
   get(platform,{pk:'PERSON#'+request.ownerId,sk:scopeKey}),
   get(platform,recipientKey),get(platform,destinationKey),get(platform,settlementKey),
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
   const current=await get(platform,Key);
   if(current&&(!Number.isSafeInteger(current.revision)||current.revision<1)){
    fail('TRANSFER_FINANCE_REVISION_INVALID');
   }
   return {ConditionCheck:{
    TableName:platform,Key,
    ConditionExpression:current?'revision=:revision':'attribute_not_exists(pk)',
    ...(current?{ExpressionAttributeValues:{':revision':current.revision}}:{}),
   }};
  }));
  const branches=[];
  const walletUpdates=[];
  const walletVersions=[];
  const correctionGuards=[];
  for(const businessId of request.branchIds){
   const [branch,wallet]=await Promise.all([
    get(businesses,{businessId}),get(wallets,{walletId:'WALLET#MERCHANT#'+businessId,sk:'META'}),
   ]);
   if(production){
    const Key={pk:'MERCHANT_CORRECTIONS#'+businessId,sk:'POSITION'};
    const current=await get(platform,Key);
    if(current){
     if(current.kind!=='MERCHANT_CORRECTION_POSITION'||current.branchId!==businessId||
        current.ownerId!==request.ownerId||!settledCorrectionPosition(current)||
        !Number.isSafeInteger(current.version)||current.version<0||current.version>=Number.MAX_SAFE_INTEGER){
      fail('TRANSFER_FINANCIAL_BLOCKERS');
     }
     correctionGuards.push({Update:{TableName:platform,Key,
      UpdateExpression:'SET ownerId=:next, #v=:nextVersion, updatedAt=:at',
      ConditionExpression:'ownerId=:owner AND #v=:version',
      ExpressionAttributeNames:{'#v':'version'},
      ExpressionAttributeValues:{':next':request.recipientId,':nextVersion':current.version+1,
       ':at':new Date(now).toISOString(),':owner':request.ownerId,':version':current.version},
     }});
    }else{
     correctionGuards.push({ConditionCheck:{TableName:platform,Key,ConditionExpression:'attribute_not_exists(pk)'}});
    }
   }
   if(!branch)fail('TRANSFER_SCOPE_CHANGED');
   branches.push(branch);
   if(!wallet&&production){
    walletVersions.push(null);
    walletUpdates.push({ConditionCheck:{TableName:wallets,
     Key:{walletId:'WALLET#MERCHANT#'+businessId,sk:'META'},ConditionExpression:'attribute_not_exists(walletId)'}});
    continue;
   }
   if(!wallet||wallet.ownerType!=='MERCHANT'||wallet.ownerId!==businessId||
      wallet.availableBalance!==0||wallet.lockedBalance!==0||
      !Number.isSafeInteger(wallet.version)||wallet.version<1||wallet.version>=Number.MAX_SAFE_INTEGER||wallet.status!=='ACTIVE'){
    fail('TRANSFER_FINANCIAL_BLOCKERS');
   }
   walletVersions.push(wallet.version);
   walletUpdates.push({Update:{
    TableName:wallets,Key:{walletId:wallet.walletId,sk:'META'},
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
   walletVersion:walletVersions[index],
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
  const saveEvidence=Item=>({Put:{TableName:platform,Item,ConditionExpression:'attribute_not_exists(pk)'}});

  const brands=[];
  let cursor;
  do{
   const page=await ctx.db.send(new Query({
    TableName:platform,ConsistentRead:true,ExclusiveStartKey:cursor,
    KeyConditionExpression:'pk=:owner AND begins_with(sk,:brand)',
    ExpressionAttributeValues:{':owner':'PERSON#'+request.ownerId,':brand':'BRAND#'},
   }));
   brands.push(...(page.Items||[]).filter(item=>item.organizationId===request.organizationId));
   if(brands.length>45)fail('TRANSFER_SCOPE_EXCEEDS_TRANSACTION_LIMIT');
   cursor=page.LastEvaluatedKey;
  }while(cursor);

  const accountRequests=[request.ownerId,request.recipientId].map(subjectId=>({ConditionCheck:{
   TableName:deletion,
   Key:{pk:'SUBJECT#MERCHANT#'+subjectId,sk:'ACTIVE#ACCOUNT#'+subjectId},
   ConditionExpression:'attribute_not_exists(pk)',
  }}));
  const commitTime=ctx.ownershipClock?ctx.ownershipClock():now;
  const {TransactItems}=planCommit({
   environment,request,reviewer:{sub:actor.employeeId,reverified:true,canReviewOwnership:true},
   organization,brands,branches,finance,recipient,now:commitTime,
   fence:{...fence,guards:[
    ctx.guard(actor),saveEvidence(finance),saveEvidence(access),
    {ConditionCheck:{
     TableName:platform,Key:recipientKey,
     ConditionExpression:'subjectId=:recipient AND #v=:version',
     ExpressionAttributeNames:{'#v':'version'},
     ExpressionAttributeValues:{':recipient':request.recipientId,':version':recipient.version},
    }},
    {ConditionCheck:{
     TableName:platform,Key:destinationKey,
     ConditionExpression:'requestId=:request AND recipientId=:recipient AND scopeDigest=:digest AND profileVersion=:profileVersion AND #v=:version AND #s=:verified AND expiresAt>:now',
     ExpressionAttributeNames:{'#v':'version','#s':'status'},
     ExpressionAttributeValues:{':request':request.requestId,':recipient':request.recipientId,':digest':request.digest,':profileVersion':recipient.version,':version':destination.version,':verified':'VERIFIED',':now':commitTime},
    }},
    {ConditionCheck:{
     TableName:platform,Key:settlementKey,
     ConditionExpression:'requestId=:request AND recipientId=:recipient AND scopeDigest=:digest AND profileVersion=:profile AND proofVersion=:proof AND #v=:version AND #s=:approved',
     ExpressionAttributeNames:{'#v':'version','#s':'status'},
     ExpressionAttributeValues:{':request':request.requestId,':recipient':request.recipientId,':digest':request.digest,':profile':recipient.version,':proof':destination.version,':version':settlement.version,':approved':'APPROVED'},
    }},
    ...accountRequests,...walletUpdates,...financeRevisions,...correctionGuards,
    ...completionWrites(request,commitTime),
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
