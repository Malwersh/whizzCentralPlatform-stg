'use strict';
const {createHash}=require('node:crypto');
const {GetCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const fail=()=>{throw Object.assign(Error('PAYOUT_FINANCIAL_NOTIFICATION_DEVICE_INVALID'),{code:'PAYOUT_FINANCIAL_NOTIFICATION_DEVICE_INVALID',status:403});};
// No raw push token is retained in the preference. Token ownership is re-read.
async function notificationDevice(ctx,owner,gate){
 const b=gate.body;
 const reading=b.action==='FINANCIAL_NOTIFICATION_DEVICE_STATUS';
 if(Object.keys(b).some(k=>!['action','branchId','pushToken','enabled'].includes(k))||(!reading&&typeof b.enabled!=='boolean')||typeof b.pushToken!=='string'||!b.pushToken.length||b.pushToken.length>4096)fail();
 const record=(await ctx.db.send(new GetCommand({TableName:ctx.pushTokensTable||'WizzCentral_PushDeviceTokens_staging',Key:{token:b.pushToken},ConsistentRead:true}))).Item;
 if(!record||record.subjectId!==owner.subjectId||record.app!=='merchant'||!Number.isFinite(record.ttl)||record.ttl<=Math.floor(Date.now()/1000))fail();
 const hash=createHash('sha256').update(b.pushToken).digest('hex');
 if(reading){const p=(await gate.db.send(new GetCommand({TableName:'staging-MerchantPlatform',Key:{pk:'MERCHANT_FINANCIAL_PUSH#'+owner.subjectId,sk:hash},ConsistentRead:true}))).Item;return {enabled:p?.enabled===true&&p.subjectId===owner.subjectId&&p.branchId===b.branchId};}
 await gate.db.send(new TransactWriteCommand({TransactItems:[
  {ConditionCheck:{TableName:ctx.pushTokensTable||'WizzCentral_PushDeviceTokens_staging',Key:{token:b.pushToken},ConditionExpression:'subjectId=:subject AND app=:app AND #ttl>:now',ExpressionAttributeNames:{'#ttl':'ttl'},ExpressionAttributeValues:{':subject':owner.subjectId,':app':'merchant',':now':Math.floor(Date.now()/1000)}}},
  {Put:{TableName:'staging-MerchantPlatform',Item:{pk:'MERCHANT_FINANCIAL_PUSH#'+owner.subjectId,sk:hash,subjectId:owner.subjectId,branchId:b.branchId,enabled:b.enabled,updatedAt:new Date().toISOString()}}}
 ]}));
 return {enabled:b.enabled};
}
module.exports={notificationDevice};
