'use strict';

const {GetCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const PLATFORM='staging-MerchantPlatform';
const fail=(code,status=409)=>{throw Object.assign(new Error(code),{status});};
const destinationKey=request=>({pk:'ORGANIZATION#'+request.organizationId,sk:'OWNERSHIP_TRANSFER_DESTINATION#'+request.requestId});
const decisionKey=request=>({pk:'ORGANIZATION#'+request.organizationId,sk:'OWNERSHIP_TRANSFER_SETTLEMENT#'+request.requestId});

function isVerified(request,profile,proof,now){
 return profile?.subjectId===request.recipientId&&Number.isSafeInteger(profile.version)&&profile.version>0&&
  proof?.kind==='OWNERSHIP_TRANSFER_DESTINATION'&&proof.status==='VERIFIED'&&proof.requestId===request.requestId&&
  proof.recipientId===request.recipientId&&proof.scopeDigest===request.digest&&proof.profileVersion===profile.version&&
  Number.isSafeInteger(proof.version)&&proof.version>0&&Number.isSafeInteger(proof.expiresAt)&&proof.expiresAt>now;
}

function isApproved(request,profile,proof,decision){
 return decision?.kind==='OWNERSHIP_TRANSFER_SETTLEMENT'&&decision.status==='APPROVED'&&
  decision.requestId===request.requestId&&decision.recipientId===request.recipientId&&decision.scopeDigest===request.digest&&
  decision.profileVersion===profile.version&&decision.proofVersion===proof.version&&Number.isSafeInteger(decision.version)&&decision.version>0;
}

async function settlementStatus(db,request,now,Get=GetCommand){
 const get=async Key=>(await db.send(new Get({TableName:PLATFORM,Key,ConsistentRead:true}))).Item;
 const [profile,proof,decision]=await Promise.all([
  get({pk:'PERSON#'+request.recipientId,sk:'PROFILE'}),get(destinationKey(request)),get(decisionKey(request)),
 ]);
 if(!isVerified(request,profile,proof,now))return {status:'VERIFICATION_REQUIRED'};
 const status=isApproved(request,profile,proof,decision)?'APPROVED':'REVIEW_REQUIRED';
 return {
  status,
  maskedPhone:typeof profile.phoneNumber==='string'?'••••'+profile.phoneNumber.slice(-4):null,
 };
}

function createSettlementDecision({Get=GetCommand,Write=TransactWriteCommand}={}){
 return async function settlementDecision(ctx,actor,request,reason,now){
  const get=async Key=>(await ctx.db.send(new Get({TableName:PLATFORM,Key,ConsistentRead:true}))).Item;
  const profileKey={pk:'PERSON#'+request.recipientId,sk:'PROFILE'};
  const key=decisionKey(request),proofKey=destinationKey(request);
  const [profile,proof,previous]=await Promise.all([get(profileKey),get(proofKey),get(key)]);
  if(!isVerified(request,profile,proof,now))fail('TRANSFER_DESTINATION_VERIFICATION_REQUIRED');
  if(isApproved(request,profile,proof,previous))return {status:'APPROVED',decidedAt:previous.decidedAt};
  if(previous&&(!Number.isSafeInteger(previous.version)||previous.version<1||previous.version>=Number.MAX_SAFE_INTEGER)){
   fail('TRANSFER_SETTLEMENT_EVIDENCE_INVALID');
  }
  const record={
   ...key,kind:'OWNERSHIP_TRANSFER_SETTLEMENT',status:'APPROVED',requestId:request.requestId,
   recipientId:request.recipientId,scopeDigest:request.digest,profileVersion:profile.version,proofVersion:proof.version,
   version:(previous?.version??0)+1,decidedAt:now,decidedBy:actor.employeeId,
  };
  try{
   await ctx.db.send(new Write({TransactItems:[
    ctx.guard(actor),
    {ConditionCheck:{
     TableName:PLATFORM,Key:{pk:key.pk,sk:'OWNERSHIP_TRANSFER'},
     ConditionExpression:'requestId=:request AND digest=:digest AND recipientId=:recipient AND #v=:version AND #s=:review AND expiresAt>:now',
     ExpressionAttributeNames:{'#v':'version','#s':'status'},
     ExpressionAttributeValues:{':request':request.requestId,':digest':request.digest,':recipient':request.recipientId,':version':request.version,':review':'AWAITING_REVIEW',':now':now},
    }},
    {ConditionCheck:{
     TableName:PLATFORM,Key:profileKey,ConditionExpression:'subjectId=:recipient AND #v=:version',
     ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':recipient':request.recipientId,':version':profile.version},
    }},
    {ConditionCheck:{
     TableName:PLATFORM,Key:proofKey,
     ConditionExpression:'recipientId=:recipient AND scopeDigest=:digest AND profileVersion=:profile AND #v=:version AND #s=:verified AND expiresAt>:now',
     ExpressionAttributeNames:{'#v':'version','#s':'status'},
     ExpressionAttributeValues:{':recipient':request.recipientId,':digest':request.digest,':profile':profile.version,':version':proof.version,':verified':'VERIFIED',':now':now},
    }},
    {Put:{
     TableName:PLATFORM,Item:record,ConditionExpression:previous?'#v=:version':'attribute_not_exists(pk)',
     ...(previous?{ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':version':previous.version}}:{}),
    }},
    ctx.audit(actor.employeeId,'MERCHANT_OWNERSHIP_SETTLEMENT_APPROVED',null,
     {organizationId:request.organizationId,requestId:request.requestId,profileVersion:profile.version,proofVersion:proof.version,reason},
     request.requestId+'#DESTINATION#'+record.version),
   ]}));
  }catch(error){
   if(error.name==='TransactionCanceledException')fail('VERSION_OR_STATE_CONFLICT');
   throw error;
  }
  return {status:'APPROVED',decidedAt:now};
 };
}

module.exports={createSettlementDecision,settlementDecision:createSettlementDecision(),destinationKey,decisionKey,isVerified,isApproved,settlementStatus};
