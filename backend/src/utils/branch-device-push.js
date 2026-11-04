'use strict';
const {GetCommand}=require('@aws-sdk/lib-dynamodb');
const {createHash}=require('node:crypto');
async function allowed(db,row,now=Math.floor(Date.now()/1000)){
 if(!row.branchDeviceId&&!String(row.subjectId||'').startsWith('BRANCH_DEVICE#'))return true;
 if(typeof row.fcmToken!=='string'||row.token!=='BRANCH_DEVICE#'+row.branchDeviceId||!row.businessId||!row.branchDeviceId||row.subjectId!=='BRANCH_DEVICE#'+row.branchDeviceId||row.app!=='merchant')return false;
 const get=async(table,key)=>{
  const fields=table==='staging-MerchantPlatform'?['pk','sk','businessId','ownerId','deviceId','version','status','expiresAt','deviceVersion','tokenHash']:table==='WhizzMerchants_Businesses'?['ownerId','cognitoUserId','deletionRequestId']:['pk'];
  return (await db.send(new GetCommand({TableName:table,Key:key,ConsistentRead:true,ProjectionExpression:fields.map((_,i)=>'#f'+i).join(','),ExpressionAttributeNames:Object.fromEntries(fields.map((k,i)=>['#f'+i,k]))}))).Item;
 };
 const d=await get('staging-MerchantPlatform',{pk:'BRANCH#'+row.businessId,sk:'DEVICE#'+row.branchDeviceId});
 if(!d||d.businessId!==row.businessId||d.deviceId!==row.branchDeviceId||d.status!=='ACTIVE'||d.version!==row.branchDeviceVersion||d.expiresAt<=now)return false;
 const binding=await get('staging-MerchantPlatform',{pk:d.pk,sk:'DEVICE_PUSH#'+d.deviceId});
 if(!binding||binding.deviceVersion!==d.version||binding.ownerId!==d.ownerId||binding.tokenHash!==createHash('sha256').update(row.fcmToken).digest('hex'))return false;
 const b=await get('WhizzMerchants_Businesses',{businessId:d.businessId});
 if(!b||b.ownerId!==d.ownerId||b.cognitoUserId!==d.ownerId||b.deletionRequestId)return false;
 for(const pk of ['BUSINESS_LIFECYCLE#MERCHANT#'+d.businessId,'ACCOUNT_LIFECYCLE#MERCHANT#'+d.ownerId])if(await get('staging-AccountDeletion',{pk,sk:'META'}))return false;
 return true;
}
function deviceMessage(message,tokens){return {...message,tokens,notification:{title:message.notification.title,body:'افتح جهاز الفرع لمتابعة الطلب.'},data:Object.fromEntries(['type','action','businessId','businessName','orderId','orderNumber','updatedAt'].filter(k=>message.data[k]!==undefined).map(k=>[k,message.data[k]]))};}
module.exports={allowed,deviceMessage};
