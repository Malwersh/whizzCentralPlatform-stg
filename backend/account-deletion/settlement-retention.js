"use strict";
const {GetCommand,QueryCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {error}=require('./policy');
const {exact}=require('./cod-retention');
const {digest}=require('./commercial-retention');
const P='staging-MerchantPlatform',B='WhizzMerchants_Businesses',L='staging-AccountDeletion',A='staging-AccountDeletionFinancialArchive';
const held=x=>x?.legalHold===true||x?.retentionHold===true;
const id=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_:#.-]{0,149}$/.test(x);
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(x);
function validate(row,branchId){
 const partition='MERCHANT_SETTLEMENT#'+branchId;
 const fields={
  MERCHANT_SETTLEMENT_BATCH:'pk sk schemaVersion kind batchId branchId requestId requestHash previewId period summary lineCount lineDigests status coverage createdAt createdBy payoutAuthorized walletMutationPerformed retentionClass batchDigest',
  MERCHANT_SETTLEMENT_LINE:'pk sk schemaVersion kind batchId branchId orderId accrual lineDigest',
  MERCHANT_SETTLEMENT_LOOKUP:'pk sk schemaVersion kind branchId batchId headerSk batchDigest createdAt retentionClass',
  MERCHANT_SETTLEMENT_REQUEST:'pk sk schemaVersion kind status requestId branchId actorId requestHash batchId batchDigest createdAt retentionClass'
 };
 const allowed=fields[row.kind]?.split(' ');
 const privateData=value=>value&&typeof value==='object'&&Object.entries(value).some(([key,v])=>/phone|email|address|customerName|latitude|longitude|photo|instructions/i.test(key)||privateData(v));
 if(!allowed||Object.keys(row).some(k=>!allowed.includes(k)&&!['legalHold','retentionHold'].includes(k))||privateData(row)||Buffer.byteLength(JSON.stringify(row))>300000)throw error('SETTLEMENT_RETENTION_SCOPE_INVALID');
 if(row.branchId!==branchId||row.schemaVersion!==1||Object.keys(row).some(k=>['expiresAt','ttl','customer','customerPhone','customerName','address'].includes(k)))throw error('SETTLEMENT_RETENTION_SCOPE_INVALID');
 if(row.pk===partition){
  if(!/^MSB:[a-f0-9]{48}$/.test(row.batchId||''))throw error('SETTLEMENT_RETENTION_SCOPE_INVALID');
  if(row.kind==='MERCHANT_SETTLEMENT_BATCH'){
   const {pk,sk,batchDigest,...body}=row;
   if(sk!=='BATCH#'+row.createdAt+'#'+row.batchId||digest(body)!==batchDigest||row.status!=='FROZEN_PENDING_REVIEW'||row.payoutAuthorized!==false||row.walletMutationPerformed!==false||row.retentionClass!=='FINANCIAL_SETTLEMENT')throw error('SETTLEMENT_RETENTION_PROOF_INVALID');
  }else if(row.kind==='MERCHANT_SETTLEMENT_LINE'){
   const {pk,sk,lineDigest,...body}=row;
   if(!id(row.orderId)||sk!=='LINE#'+row.batchId+'#'+row.orderId||digest(body)!==lineDigest||row.accrual?.branchId!==branchId||row.accrual?.orderId!==row.orderId)throw error('SETTLEMENT_RETENTION_PROOF_INVALID');
  }else if(row.kind==='MERCHANT_SETTLEMENT_LOOKUP'){
   if(row.sk!=='INDEX#'+row.batchId)throw error('SETTLEMENT_RETENTION_PROOF_INVALID');
  }else throw error('SETTLEMENT_RETENTION_SCOPE_INVALID');
 }else if(row.pk==='BRANCH#'+branchId&&row.kind==='MERCHANT_SETTLEMENT_REQUEST'&&uuid(row.requestId)&&row.sk==='SETTLEMENT_REQUEST#'+row.requestId&&row.status==='COMMITTED'){
  if(!/^MSB:[a-f0-9]{48}$/.test(row.batchId||''))throw error('SETTLEMENT_RETENTION_SCOPE_INVALID');
 }else throw error('SETTLEMENT_RETENTION_SCOPE_INVALID');
}
/** Copy immutable statement evidence before destructive merchant cleanup. No source deletion,
 * TTL or payout. Purge is deliberately held until an approved settlement purge adapter exists. */
async function settlementRetention({db,r,job,requestTable=L,archiveTable=A,clock=()=>new Date().toISOString(),maxPages=30}){
 if(requestTable!==L||archiveTable!==A||r.status!=='PROCESSING'||r.actorType!=='MERCHANT'||r.scope?.kind!=='BUSINESS'||!id(job.businessId)||!id(r.subjectId)||!uuid(r.requestId)||r.requestId!==job.requestId||r.subjectId!==job.subjectId||r.scope.id!==job.businessId||r.pk!=='SUBJECT#MERCHANT#'+r.subjectId||r.sk!=='REQUEST#'+r.requestId||!r.leaseOwner||!Number.isSafeInteger(r.version))throw error('INVALID_CLEANUP_SCOPE');
 if(!Number.isInteger(job.financialYears)||job.financialYears<1||job.financialYears>30||!Number.isSafeInteger(job.policyVersion)||!Number.isSafeInteger(maxPages)||maxPages<1)throw error('RETENTION_POLICY_INVALID');
 if(held(r))throw error('DOCUMENTED_RETENTION_HOLD');
 const get=async(t,k)=>(await db.send(new GetCommand({TableName:t,Key:k,ConsistentRead:true}))).Item;
 async function query(pk,prefix){let cursor;const rows=[];for(let page=0;page<maxPages;page++){
  const out=await db.send(new QueryCommand({TableName:P,KeyConditionExpression:'pk=:pk'+(prefix?' AND begins_with(sk,:prefix)':''),ExpressionAttributeValues:{':pk':pk,...(prefix?{':prefix':prefix}:{})},ConsistentRead:true,Limit:100,...(cursor?{ExclusiveStartKey:cursor}:{})}));
  rows.push(...out.Items||[]);cursor=out.LastEvaluatedKey;if(!cursor)return rows;
 }throw error('SETTLEMENT_INVENTORY_INCOMPLETE');}
 const rows=[...await query('MERCHANT_SETTLEMENT#'+job.businessId),...await query('BRANCH#'+job.businessId,'SETTLEMENT_REQUEST#')];
 const scheduleItems=await require('./settlement-schedule-inventory').settlementScheduleInventory({db,branchId:job.businessId,ownerId:r.subjectId,maxPages});
 if(!rows.length&&!scheduleItems.length)return {archived:0,sourceDeleted:false};
 const branch=await get(B,{businessId:job.businessId}),lifeKey={pk:'BUSINESS_LIFECYCLE#MERCHANT#'+job.businessId,sk:'META'},life=await get(L,lifeKey);
 if(!branch||branch.ownerId!==r.subjectId||branch.cognitoUserId!==r.subjectId||branch.deletionRequestId!==r.requestId||life?.requestId!==r.requestId||life.subjectId!==r.subjectId||life.businessId!==job.businessId)throw error('PROFILE_GENERATION_CHANGED');
 if(held(branch)||held(life)||rows.some(held))throw error('DOCUMENTED_RETENTION_HOLD');
 const headers=new Map(),lines=new Map(),lookups=new Map(),requests=new Map(),seen=new Set();
 for(const row of rows){validate(row,job.businessId);if(seen.has(row.pk+'|'+row.sk))throw error('SETTLEMENT_RETENTION_PROOF_INVALID');seen.add(row.pk+'|'+row.sk);
  const map=row.kind==='MERCHANT_SETTLEMENT_BATCH'?headers:row.kind==='MERCHANT_SETTLEMENT_LINE'?lines:row.kind==='MERCHANT_SETTLEMENT_LOOKUP'?lookups:requests;
  map.set(row.kind==='MERCHANT_SETTLEMENT_LINE'?row.batchId+'#'+row.orderId:row.batchId,row);
 }
 for(const [batchId,h]of headers){const lookup=lookups.get(batchId),request=requests.get(batchId);
  if(!lookup||!request||lookup.headerSk!==h.sk||lookup.batchDigest!==h.batchDigest||request.batchDigest!==h.batchDigest||request.requestId!==h.requestId||request.requestHash!==h.requestHash||request.actorId!==h.createdBy||!Array.isArray(h.lineDigests)||h.lineCount!==h.lineDigests.length||h.lineCount<1||h.lineCount>15)throw error('SETTLEMENT_RETENTION_PROOF_INVALID');
  const orderIds=new Set();for(const ref of h.lineDigests){if(orderIds.has(ref.orderId)||lines.get(batchId+'#'+ref.orderId)?.lineDigest!==ref.digest)throw error('SETTLEMENT_RETENTION_PROOF_INVALID');orderIds.add(ref.orderId);}
 }
 if(lookups.size!==headers.size||requests.size!==headers.size||lines.size!==[...headers.values()].reduce((n,h)=>n+h.lineCount,0)||[...lines.values()].some(l=>!headers.has(l.batchId)))throw error('SETTLEMENT_RETENTION_PROOF_INVALID');
 const inventory=[];
 for(const {row,table} of [...rows.map(row=>({row,table:P})),...scheduleItems]){const key={pk:row.pk,sk:row.sk},archiveKey={pk:'REQUEST#'+r.requestId,sk:'MERCHANT_SETTLEMENT#'+JSON.stringify(key)},old=await get(A,archiveKey),sourceDigest=digest(row);
  if(old&&(held(old)||old.kind!=='merchant_settlement'||old.requestId!==r.requestId||old.sourceTable!==table||digest(old.sourceKey)!==digest(key)||old.sourceDigest!==sourceDigest||digest(old.data)!==sourceDigest||old.scopeOwnerId!==r.subjectId||old.scopeBusinessId!==job.businessId||old.purgeBlocked!==true||old.expiresAt!==undefined))throw error(held(old)?'DOCUMENTED_RETENTION_HOLD':'ARCHIVE_CONFLICT');
  inventory.push({row,table,key,archiveKey,old,sourceDigest});
 }
 let archived=0;
 for(const item of inventory){const now=clock(),until=new Date(now);if(!Number.isFinite(until.getTime()))throw error('RETENTION_POLICY_INVALID');until.setUTCFullYear(until.getUTCFullYear()+job.financialYears);
  const archive={...item.archiveKey,kind:'merchant_settlement',retentionSchemaVersion:1,requestId:r.requestId,subjectAlias:'DELETED#'+r.requestId,scopeOwnerId:r.subjectId,scopeBusinessId:job.businessId,policyVersion:job.policyVersion,archivedAt:now,minimumRetainUntil:Math.floor(until.getTime()/1000),purgeBlocked:true,sourceTable:item.table,sourceKey:item.key,sourceDigest:item.sourceDigest,data:item.row};
  await db.send(new TransactWriteCommand({TransactItems:[
   {ConditionCheck:{TableName:L,Key:{pk:r.pk,sk:r.sk},ConditionExpression:'leaseOwner=:owner AND #v=:v AND leaseUntil>:now AND #s=:s AND (attribute_not_exists(legalHold) OR legalHold=:no) AND (attribute_not_exists(retentionHold) OR retentionHold=:no)',ExpressionAttributeNames:{'#v':'version','#s':'status'},ExpressionAttributeValues:{':owner':r.leaseOwner,':v':r.version,':now':Math.floor(Date.parse(now)/1000),':s':'PROCESSING',':no':false}}},
   {ConditionCheck:{TableName:B,Key:{businessId:job.businessId},...exact(branch)}},
   {ConditionCheck:{TableName:L,Key:lifeKey,...exact(life)}},
   {ConditionCheck:{TableName:item.table,Key:item.key,...exact(item.row)}},
   item.old?{ConditionCheck:{TableName:A,Key:item.archiveKey,...exact(item.old)}}:{Put:{TableName:A,Item:archive,ConditionExpression:'attribute_not_exists(pk)'}}
  ]}));if(!item.old)archived++;
 }
 return {archived,sourceDeleted:false};
}
module.exports={settlementRetention,validate};
