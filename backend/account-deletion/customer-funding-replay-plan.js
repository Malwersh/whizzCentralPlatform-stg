'use strict';
const {isDeepStrictEqual}=require('node:util');
const {snapshot,hash,validateKey}=require('./customer-delivery-funding-archive');
const {classify}=require('./customer-delivery-funding-retention');
const {exact}=require('./cod-retention');
const {error}=require('./policy');
// Preparation only. No database writes, no closure assertion and no purge authority.
// The caller must independently prove settlement/case closure before using guards.
function prepareReplay({source,key,archives,now,complete=false}) {
 validateKey(key);
 if(!Number.isSafeInteger(now)||now<0||complete!==true||!Array.isArray(archives)||!archives.length)throw error('FUNDING_REPLAY_INVENTORY_REQUIRED');
 if(!key.pk.startsWith('DELIVERY_RESERVATION#'))throw error('FUNDING_REPLAY_USAGE_LIFECYCLE_REQUIRED');
 const data=snapshot(source,key,[source?.customerId]);
 if(Date.parse(data.settledAt)>now*1000)throw error('FUNDING_REPLAY_TIME_INVALID');
 const seen=new Set();
 for(const a of archives){
  const reason=classify(a,now);
  if(a.sourceKeyDigest!==hash(key)||reason!=='SOURCE_LIFECYCLE_REVIEW_REQUIRED'||a.kind!=='delivery_funding'||Date.parse(a.archivedAt)>now*1000||a.expiresAt*1000<Date.parse(data.settledAt)||!isDeepStrictEqual(a.data,data)||seen.has(a.pk+'|'+a.sk))throw error('FUNDING_REPLAY_ARCHIVE_CONFLICT');
  seen.add(a.pk+'|'+a.sk);
 }
 // Reserve space for independent order, liability and case closure conditions.
 if(archives.length>90)throw error('FUNDING_REPLAY_TRANSACTION_LIMIT');
 const body={pk:key.pk,sk:key.sk,kind:'DELIVERY_FUNDING_REPLAY',schemaVersion:1,version:source.version+1,orderId:source.orderId,status:source.status,requestDigest:source.requestDigest,fundingDigest:hash({policyPin:source.policyPin,allocation:source.allocation}),sourceDigest:source.digest,closedAt:new Date(now*1000).toISOString()};
 if(!Number.isSafeInteger(body.version))throw error('FUNDING_REPLAY_VERSION_INVALID');
 return {closureRequired:true,deleteEligible:false,marker:{...body,digest:hash(body)},sourceCondition:exact(source),archiveConditions:archives.map(a=>({ConditionCheck:{TableName:'staging-AccountDeletionFinancialArchive',Key:{pk:a.pk,sk:a.sk},...exact(a)}}))};
}
module.exports={prepareReplay};
