'use strict';

const {randomUUID}=require('node:crypto');
const {GetCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');

const PLATFORM='staging-MerchantPlatform';
const BRANCHES='WhizzMerchants_Businesses';
const LIFECYCLE='staging-AccountDeletion';
const fail=code=>{throw Object.assign(new Error(code),{status:409});};

function createLock({Get=GetCommand,Write=TransactWriteCommand,clock=Date.now,leaseId=randomUUID, tables={platform:PLATFORM,businesses:BRANCHES,deletion:LIFECYCLE}}={}){
 async function write(db,items){
  await db.send(new Write({TransactItems:items}));
 }
 return async function withLock(ctx,actor,request,reason,execute){
  const now=clock();
  const ids=request.branchIds;
  if(request.status!=='AWAITING_REVIEW'||request.expiresAt<=now||
     !Array.isArray(ids)||!ids.length||ids.length>40||
     new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(id))){
   fail('INVALID_TRANSFER_SCOPE');
  }
  if(request.ownerId===request.recipientId)fail('INVALID_TRANSFER_SCOPE');
  const organization='ORGANIZATION#'+request.organizationId;
  const token=leaseId();
  const fenceKey={pk:organization,sk:'OWNERSHIP_TRANSFER_FENCE'};
  const expiresAt=Math.min(request.expiresAt,now+120000);
  const cleanupAt=Math.ceil(expiresAt/1000);
  const markers=ids.map(id=>({pk:'BUSINESS_LIFECYCLE#MERCHANT#'+id,sk:'META'}));
  const clear=(TableName,Key)=>({Delete:{
   TableName,Key,ConditionExpression:'leaseId=:lease AND requestId=:request',
   ExpressionAttributeValues:{':lease':token,':request':request.requestId},
  }});
  const read=async(TableName,Key)=>(await ctx.db.send(new Get({TableName,Key,ConsistentRead:true}))).Item;
  const prior=await read(tables.platform,fenceKey);
  if(prior?.leaseId&&prior.expiresAt>now)fail('TRANSFER_APPROVAL_IN_PROGRESS');
  // Expired transfer leases are replaced only if their exact state is still present.
  if(prior&&!prior.leaseId)fail('TRANSFER_MUTATION_FENCE_REQUIRED');
  const expiryFence=prior
   ? {ConditionExpression:'leaseId=:previous AND expiresAt<=:now',ExpressionAttributeValues:{':previous':prior.leaseId,':now':now}}
   : {ConditionExpression:'attribute_not_exists(pk)'};
  const locks=await Promise.all(markers.map(key=>read(tables.deletion,key)));
  const items=[
   ctx.guard(actor),
   {ConditionCheck:{
    TableName:tables.platform,Key:{pk:organization,sk:'OWNERSHIP_TRANSFER'},
    ConditionExpression:'requestId=:request AND digest=:digest AND #v=:version AND #s=:pending AND expiresAt>:now',
    ExpressionAttributeNames:{'#v':'version','#s':'status'},
    ExpressionAttributeValues:{':request':request.requestId,':digest':request.digest,':version':request.version,':pending':'AWAITING_REVIEW',':now':now},
   }},
   {Put:{
    TableName:tables.platform,
    Item:{...fenceKey,kind:'OWNERSHIP_TRANSFER_FENCE',status:'FROZEN',leaseId:token,requestId:request.requestId,
     organizationId:request.organizationId,scopeDigest:request.digest,version:(prior?.version??0)+1,expiresAt},
    ...expiryFence,
   }},
  ];
  for(const [index,id] of ids.entries()){
   const previous=locks[index];
   if(previous&&(previous.kind!=='OWNERSHIP_TRANSFER_APPROVAL_LOCK'||previous.requestId!==prior?.requestId||
      previous.leaseId!==prior?.leaseId||previous.expiresAt>Math.floor(now/1000)))fail('TRANSFER_BRANCH_ALREADY_LOCKED');
   items.push(
    {ConditionCheck:{
     TableName:tables.businesses,Key:{businessId:id},
     ConditionExpression:'ownerId=:owner AND cognitoUserId=:owner AND organizationId=:org AND orderIntakeTransferRequestId=:request AND orderIntakeTransferExpiresAt>:now AND attribute_not_exists(deletionRequestId) AND attribute_not_exists(orderIntakeDeletionRequestId)',
     ExpressionAttributeValues:{':owner':request.ownerId,':org':request.organizationId,':request':request.requestId,':now':now},
    }},
    {Put:{
     TableName:tables.deletion,Item:{...markers[index],kind:'OWNERSHIP_TRANSFER_APPROVAL_LOCK',
      leaseId:token,requestId:request.requestId,businessId:id,expiresAt:cleanupAt},
     ConditionExpression:previous?'leaseId=:previous AND requestId=:request':'attribute_not_exists(pk)',
     ...(previous?{ExpressionAttributeValues:{':previous':previous.leaseId,':request':previous.requestId}}:{}),
    }},
   );
  }
  try{await write(ctx.db,items);}
  catch(error){if(error.name==='TransactionCanceledException')fail('VERSION_OR_STATE_CONFLICT');throw error;}
  try{
   return await execute({...ctx,ownershipLeaseId:token,ownershipClock:clock},actor,request,reason,clock());
  }finally{
   try{
    const keys=[[tables.platform,fenceKey],...markers.map(key=>[tables.deletion,key])];
    const owned=(await Promise.all(keys.map(async ([TableName,Key])=>
     (await read(TableName,Key))?.leaseId===token?clear(TableName,Key):null))).filter(Boolean);
    if(owned.length)await write(ctx.db,owned);
   }catch(error){
    console.warn('OWNERSHIP_APPROVAL_LOCK_CLEANUP', {name:error.name});
   }
  }
 };
}

module.exports={createLock};
