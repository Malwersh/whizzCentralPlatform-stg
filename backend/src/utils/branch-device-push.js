'use strict';
const {GetCommand,QueryCommand}=require('@aws-sdk/lib-dynamodb');
const {createHash}=require('node:crypto');
async function allowed(db,row,now=Math.floor(Date.now()/1000),tables={}){
 const {merchants='WhizzMerchants_Businesses',platform='staging-MerchantPlatform',deletion='staging-AccountDeletion',orders}=tables;
 if(!row.branchDeviceId&&!String(row.subjectId||'').startsWith('BRANCH_DEVICE#'))return true;
 if(typeof row.fcmToken!=='string'||row.token!=='BRANCH_DEVICE#'+row.branchDeviceId||!row.businessId||!row.branchDeviceId||row.subjectId!=='BRANCH_DEVICE#'+row.branchDeviceId||row.app!=='merchant')return false;
 const get=async(table,key)=>{
  const fields=table===platform?['pk','sk','businessId','ownerId','deviceId','version','status','expiresAt','deviceVersion','tokenHash']:table===merchants?['ownerId','cognitoUserId','deletionRequestId',...(orders?['status','isDeleted','deletedAt']:[])]:['pk'];
  return (await db.send(new GetCommand({TableName:table,Key:key,ConsistentRead:true,ProjectionExpression:fields.map((_,i)=>'#f'+i).join(','),ExpressionAttributeNames:Object.fromEntries(fields.map((k,i)=>['#f'+i,k]))}))).Item;
 };
 const d=await get(platform,{pk:'BRANCH#'+row.businessId,sk:'DEVICE#'+row.branchDeviceId});
 if(!d||d.businessId!==row.businessId||d.deviceId!==row.branchDeviceId||d.status!=='ACTIVE'||d.version!==row.branchDeviceVersion||d.expiresAt<=now)return false;
 const binding=await get(platform,{pk:d.pk,sk:'DEVICE_PUSH#'+d.deviceId});
 if(!binding||binding.deviceVersion!==d.version||binding.ownerId!==d.ownerId||binding.tokenHash!==createHash('sha256').update(row.fcmToken).digest('hex'))return false;
 const b=await get(merchants,{businessId:d.businessId});
 if(!b||b.ownerId!==d.ownerId||b.cognitoUserId!==d.ownerId||b.deletionRequestId||(orders&&(b.status!=='approved'||b.deletedAt||b.isDeleted===true)))return false;
 for(const pk of ['BUSINESS_LIFECYCLE#MERCHANT#'+d.businessId,'ACCOUNT_LIFECYCLE#MERCHANT#'+d.ownerId])if(await get(deletion,{pk,sk:'META'}))return false;
 return true;
}
function deviceMessage(message,tokens){return {...message,tokens,notification:{title:message.notification.title,body:'افتح جهاز الفرع لمتابعة الطلب.'},data:Object.fromEntries(['type','action','businessId','businessName','orderId','orderNumber','updatedAt','eventId','status','cancellationState','cancellationVersion','cancellationRequestId','caseId'].filter(k=>message.data[k]!==undefined).map(k=>[k,message.data[k]]))};}

async function merchantOrderTargets(db,table,businessId){
 const {Item:branch}=await db.send(new GetCommand({
  TableName:'WhizzMerchants_Businesses',Key:{businessId},ConsistentRead:true,
  ProjectionExpression:'ownerId, cognitoUserId, deletionRequestId',
 }));
 if(!branch?.ownerId||branch.ownerId!==branch.cognitoUserId||branch.deletionRequestId)return {items:[],ownerId:null};
 const ownerId=branch.ownerId;
 async function registrations(field,value){
  const items=[];
  let cursor;
  do{
   const page=await db.send(new QueryCommand({
    TableName:table,IndexName:field==='businessId'?'BusinessIdIndex':'SubjectIdIndex',
    KeyConditionExpression:field+'=:scope',ExpressionAttributeValues:{':scope':value},
    ExclusiveStartKey:cursor,
   }));
   items.push(...(page.Items||[]));
   cursor=page.LastEvaluatedKey;
  }while(cursor);
  return items;
 }
 const scoped=await registrations('businessId',businessId);
 const candidates=scoped.filter(row=>row.app==='merchant'&&(row.branchDeviceId||row.subjectId===ownerId));
 if(!candidates.some(row=>!row.branchDeviceId)){
  candidates.push(...(await registrations('subjectId',ownerId)).filter(row=>!row.branchDeviceId));
 }
 const items=[];
 for(const candidate of candidates){
  if(!candidate.token)continue;
  const {Item:current}=await db.send(new GetCommand({
   TableName:table,Key:{token:candidate.token},ConsistentRead:true,
  }));
  if(current?.app!=='merchant'||current.disabled||current.isDeleted)continue;
  if(current.branchDeviceId){
   if(current.businessId===businessId)items.push(current);
  }else if(current.subjectId===ownerId){
   items.push(current);
  }
 }
 return {items,ownerId};
}

module.exports={allowed,deviceMessage,merchantOrderTargets};
