'use strict';
const {createHash}=require('node:crypto');
const {isDeepStrictEqual}=require('node:util');
const {GetCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {error}=require('./policy');
const SOURCE='staging-PlatformStaff',ARCHIVE='staging-AccountDeletionFinancialArchive',REQUESTS='staging-AccountDeletion';
const SOURCE_FIELDS=['pk','sk','schemaVersion','version','customerId','orderId','policyPin','allocation','requestDigest','status','createdAt','settledAt','reservedUses','completedUses','digest','legalHold','retentionHold'];
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const hash=v=>createHash('sha256').update(canonical(v)).digest('hex');
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,150}$/.test(v);
const count=v=>Number.isSafeInteger(v)&&v>=0;
function validateKey(key){
 if(!key||Object.keys(key).sort().join(',')!=='pk,sk'||typeof key.pk!=='string'||typeof key.sk!=='string')throw error('FUNDING_ARCHIVE_SCOPE_INVALID');
 if(key.pk.startsWith('DELIVERY_RESERVATION#')){const rest=key.pk.slice(21).replace(/#PROMOTION$/,'');if(!id(rest)||key.sk!=='META')throw error('FUNDING_ARCHIVE_SCOPE_INVALID');}
 else if(key.pk.startsWith('DELIVERY_USAGE#')){if(!id(key.pk.slice(15))||!key.sk.startsWith('CUSTOMER#')||!id(key.sk.slice(9)))throw error('FUNDING_ARCHIVE_SCOPE_INVALID');}
 else throw error('FUNDING_ARCHIVE_SCOPE_INVALID');
}
function money(v){if(!v||v.moneySchemaVersion!==1||v.currency!=='IQD'||v.scale!==1000||!count(v.minorAmount))throw error('FUNDING_ARCHIVE_INVALID');return {moneySchemaVersion:1,currency:'IQD',scale:1000,minorAmount:v.minorAmount};}
function snapshot(row,key,owners){
 if(!row||row.pk!==key.pk||row.sk!==key.sk||row.legalHold===true||row.retentionHold===true)throw error('FUNDING_ARCHIVE_SOURCE_BLOCKED');
 if(Object.keys(row).some(k=>!SOURCE_FIELDS.includes(k))||!count(row.version)||row.version<1||!['string'].includes(typeof row.digest))throw error('FUNDING_ARCHIVE_INVALID');
 const {digest,...body}=row;if(hash(body)!==digest)throw error('FUNDING_ARCHIVE_DIGEST_INVALID');
 const data={schemaVersion:row.schemaVersion,version:row.version,sourceDigest:row.digest};
 if(key.pk.startsWith('DELIVERY_USAGE#')){
  if(!owners.includes(key.sk.slice(9))||row.schemaVersion!==1||!count(row.reservedUses)||!count(row.completedUses))throw error('FUNDING_ARCHIVE_INVALID');
  if(row.reservedUses!==0)throw error('FUNDING_ARCHIVE_PENDING');
  return {...data,kind:'delivery_usage',campaignId:key.pk.slice(15),reservedUses:0,completedUses:row.completedUses};
 }
 if(!owners.includes(row.customerId)||!id(row.orderId)||!['DELIVERY_RESERVATION#'+row.orderId,'DELIVERY_RESERVATION#'+row.orderId+'#PROMOTION'].includes(key.pk)||![1,2].includes(row.schemaVersion))throw error('FUNDING_ARCHIVE_OWNERSHIP_MISMATCH');
 if(row.status==='RESERVED')throw error('FUNDING_ARCHIVE_PENDING');
 if(!['CAPTURED','RELEASED'].includes(row.status))throw error('FUNDING_ARCHIVE_INVALID');
 if(!id(row.policyPin?.policyId)||!Number.isSafeInteger(row.policyPin.version)||row.policyPin.version<1||!/^[a-f0-9]{64}$/.test(row.policyPin.termsHash||''))throw error('FUNDING_ARCHIVE_INVALID');
 if(row.requestDigest!==hash({orderId:row.orderId,customerId:row.customerId,policyPin:row.policyPin,allocation:row.allocation}))throw error('FUNDING_ARCHIVE_DIGEST_INVALID');
 const allocation={schemaVersion:row.allocation?.schemaVersion};if(allocation.schemaVersion!==row.schemaVersion)throw error('FUNDING_ARCHIVE_INVALID');
 for(const k of ['referenceFee','customerFee','subsidy','merchantShare','platformShare'])allocation[k]=money(row.allocation[k]);
 const {referenceFee,customerFee,subsidy,merchantShare,platformShare}=allocation;
 if(BigInt(subsidy.minorAmount)!==BigInt(Math.max(0,referenceFee.minorAmount-customerFee.minorAmount))||BigInt(merchantShare.minorAmount)+BigInt(platformShare.minorAmount)!==BigInt(subsidy.minorAmount))throw error('FUNDING_ARCHIVE_INVALID');
 for(const field of ['createdAt','settledAt'])if(typeof row[field]!=='string'||!Number.isFinite(Date.parse(row[field])))throw error('FUNDING_ARCHIVE_INVALID');
 return {...data,kind:'delivery_funding',orderId:row.orderId,status:row.status,policyPin:{policyId:row.policyPin.policyId,version:row.policyPin.version,termsHash:row.policyPin.termsHash},allocation,createdAt:row.createdAt,settledAt:row.settledAt};
}
// Sources remain immutable: the archive follows the configured financial retention
// policy. Source expiry/anonymization requires a separate lifecycle implementation.
async function validateSources({db,subjectIds,sourceKeys}) {
 if(!db||!Array.isArray(subjectIds)||!subjectIds.length||!subjectIds.every(id)||!Array.isArray(sourceKeys)||sourceKeys.length>500)throw error('FUNDING_ARCHIVE_SCOPE_INVALID');
 const names=Object.fromEntries(SOURCE_FIELDS.map((f,i)=>['#a'+i,f]));
 for(const key of sourceKeys){validateKey(key);const row=(await db.send(new GetCommand({TableName:SOURCE,Key:key,ConsistentRead:true,ProjectionExpression:Object.keys(names).join(','),ExpressionAttributeNames:names}))).Item;snapshot(row,key,subjectIds);}
 return {verified:sourceKeys.length};
}
async function archive({db,r,job,sourceKeys,clock=()=>new Date().toISOString()}){
 if(!db||r?.actorType!=='CUSTOMER'||r.status!=='PROCESSING'||!r.leaseOwner||!Number.isSafeInteger(r.version)||!id(r.requestId)||!id(r.subjectId)||r.pk!=='SUBJECT#CUSTOMER#'+r.subjectId||r.sk!=='REQUEST#'+r.requestId||r.subjectId!==job?.subjectId||r.requestId!==job.requestId||!id(job.policyVersion?.toString())||!Number.isInteger(job.financialYears)||job.financialYears<1||job.financialYears>30||!Array.isArray(job.profileIds)||!Array.isArray(sourceKeys)||sourceKeys.length>500)throw error('FUNDING_ARCHIVE_SCOPE_INVALID');
 const owners=[...new Set([job.subjectId,...job.profileIds])];if(!owners.every(id))throw error('FUNDING_ARCHIVE_SCOPE_INVALID');
 const unique=new Map();for(const k of sourceKeys){validateKey(k);unique.set(canonical(k),k);}
 const prepared=[];
 const names=Object.fromEntries(SOURCE_FIELDS.map((f,i)=>['#a'+i,f]));
 // Validate every record and prior archive before the first write.
 for(const key of unique.values()){
  const row=(await db.send(new GetCommand({TableName:SOURCE,Key:key,ConsistentRead:true,ProjectionExpression:Object.keys(names).join(','),ExpressionAttributeNames:names}))).Item;
  const data=snapshot(row,key,owners),sourceKeyDigest=hash(key),archiveKey={pk:'REQUEST#'+job.requestId,sk:'DELIVERY_FUNDING#'+sourceKeyDigest};
  const existing=(await db.send(new GetCommand({TableName:ARCHIVE,Key:archiveKey,ConsistentRead:true}))).Item;
  const now=existing?.archivedAt||clock(),until=new Date(now);if(!Number.isFinite(until.getTime()))throw error('RETENTION_POLICY_INVALID');
  // Unknown usage creation time: retain from archival time, never expire early.
  if(data.settledAt)until.setTime(Date.parse(data.settledAt));until.setUTCFullYear(until.getUTCFullYear()+job.financialYears);
  const item={...archiveKey,requestId:job.requestId,subjectAlias:'DELETED#'+job.requestId,policyVersion:job.policyVersion,kind:data.kind,sourceTable:SOURCE,sourceKeyDigest,data,archivedAt:now,expiresAt:Math.floor(until.getTime()/1000)};
  if(existing){if(existing.requestId!==job.requestId||existing.sourceTable!==SOURCE||existing.sourceKeyDigest!==sourceKeyDigest||existing.policyVersion!==job.policyVersion||!isDeepStrictEqual(existing.data,data)||!Number.isSafeInteger(existing.expiresAt)||existing.expiresAt<item.expiresAt)throw error('FUNDING_ARCHIVE_CONFLICT');}
  prepared.push({key,row,item,existing});
 }
 for(const {key,row,item,existing} of prepared){
  if(existing)continue;
  const sourceNames={'#version':'version','#digest':'digest','#legal':'legalHold','#hold':'retentionHold'};
  const sourceValues={':version':row.version,':digest':row.digest,':false':false};
  let condition='#version=:version AND #digest=:digest AND (attribute_not_exists(#legal) OR #legal=:false) AND (attribute_not_exists(#hold) OR #hold=:false)';
  if(row.status){sourceNames['#status']='status';sourceValues[':status']=row.status;condition+=' AND #status=:status';}
  else {sourceNames['#reserved']='reservedUses';sourceValues[':zero']=0;condition+=' AND #reserved=:zero';}
  const now=Math.floor(Date.parse(clock())/1000);
  await db.send(new TransactWriteCommand({TransactItems:[
   {ConditionCheck:{TableName:REQUESTS,Key:{pk:r.pk,sk:r.sk},ConditionExpression:'leaseOwner=:owner AND leaseUntil>:now AND #v=:v AND #s=:processing',ExpressionAttributeNames:{'#v':'version','#s':'status'},ExpressionAttributeValues:{':owner':r.leaseOwner,':now':now,':v':r.version,':processing':'PROCESSING'}}},
   {ConditionCheck:{TableName:'WizzUser_users_staging',Key:{userId:job.subjectId},ConditionExpression:'deletionRequestId=:request AND isActive=:no',ExpressionAttributeValues:{':request':job.requestId,':no':false}}},
   {ConditionCheck:{TableName:SOURCE,Key:key,ConditionExpression:condition,ExpressionAttributeNames:sourceNames,ExpressionAttributeValues:sourceValues}},
   {Put:{TableName:ARCHIVE,Item:item,ConditionExpression:'attribute_not_exists(pk)'}}
  ]}));
 }
 return {records:prepared.length,archived:prepared.filter(x=>!x.existing).length,replayed:prepared.filter(x=>x.existing).length};
}
module.exports={archive,validateSources,snapshot,hash,validateKey,SOURCE_FIELDS};
