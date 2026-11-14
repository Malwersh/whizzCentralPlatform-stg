'use strict';
const {createHash}=require('node:crypto');
const {GetCommand}=require('@aws-sdk/lib-dynamodb');
async function merchantFinancialDeviceAllowed(db,item,record,now){
 if(item.recipientApp!=='merchant')return true;
 if(record.subjectId!==item.driverId||record.app!=='merchant'||!record.token||!Number.isFinite(record.ttl)||record.ttl<=Math.floor(now/1000))return false;
 const get=async(TableName,Key)=>(await db.send(new GetCommand({TableName,Key,ConsistentRead:true}))).Item;
 // Re-read registration: a token may have changed accounts since discovery.
 const live=await get(process.env.PUSH_TOKENS_TABLE,{token:record.token});
 if(live?.subjectId!==item.driverId||live.app!=='merchant'||!Number.isFinite(live.ttl)||live.ttl<=Math.floor(now/1000))return false;
 const p=await get('staging-MerchantPlatform',{pk:'MERCHANT_FINANCIAL_PUSH#'+item.driverId,sk:createHash('sha256').update(record.token).digest('hex')});
 if(p?.enabled!==true||p.subjectId!==item.driverId||!p.branchId)return false;
 if(item.type==='merchant_exception_financial_updated'&&(item.branchId!==p.branchId||!/^EXCEPTION_FINANCIAL_NOTICE#[a-f0-9]{64}$/.test(item.eventId||'')))return false;
 if(item.type==='merchant_payout_updated'){
  if(item.branchId!==p.branchId||!/^MPO:[a-f0-9]{48}$/.test(item.payoutId||''))return false;
  const payout=await get('staging-MerchantPlatform',{pk:'MERCHANT_PAYOUT#'+p.branchId,sk:item.payoutId});
  if(!payout||payout.ownerId!==item.driverId||payout.branchId!==p.branchId||payout.version!==item.payoutVersion||payout.status!==item.payoutStatus)return false;
 }
 const b=await get('WhizzMerchants_Businesses',{businessId:p.branchId});
 if(!b||b.ownerId!==item.driverId||b.cognitoUserId!==item.driverId||b.status!=='approved'||b.isDeleted===true||b.deletedAt!=null||b.deletionRequestId!=null)return false;
 for(const pk of ['ACCOUNT_LIFECYCLE#MERCHANT#'+item.driverId,'BUSINESS_LIFECYCLE#MERCHANT#'+p.branchId])if(await get('staging-AccountDeletion',{pk,sk:'META'}))return false;
 return true;
}
module.exports={merchantFinancialDeviceAllowed};
