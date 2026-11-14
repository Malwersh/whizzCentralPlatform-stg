'use strict';
const {GetCommand,QueryCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {createHash}=require('node:crypto');
const {error}=require('./policy');
const {exact}=require('./cod-retention');
const P='staging-MerchantPlatform',S='staging-PlatformStaff',B='WhizzMerchants_Businesses',L='staging-AccountDeletion',W='staging-Wallets';
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
const digest=v=>createHash('sha256').update(JSON.stringify(stable(v))).digest('hex');
const held=v=>v?.legalHold===true||v?.retentionHold===true;
const id=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_:#.-]{0,149}$/.test(v);
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
const dataOf=row=>Object.fromEntries(Object.entries(row).filter(([k])=>!['legalHold','retentionHold'].includes(k)));
const contractKey=key=>/^COMMERCIAL_AGREEMENT#[A-Za-z0-9][A-Za-z0-9_:#.-]{0,149}$/.test(key.pk||'')&&/^(?:DRAFT(?:_VERSION#\d+)?|CURRENT|VERSION#\d+|CONSENT#\d+|ACCEPTANCE#\d+|DISCLOSURE#\d+)$/.test(key.sk||'');
const fundingKey=key=>/^DISCOUNT_FUNDING#[A-Za-z0-9][A-Za-z0-9_:#.-]{0,149}$/.test(key.pk||'')&&/^(?:DRAFT(?:_VERSION#\d+)?|CURRENT|VERSION#\d+|CONSENT#\d+|NOTICE#\d+)$/.test(key.sk||'');
const sharingKey=key=>/^BRANCH#[A-Za-z0-9][A-Za-z0-9_:#.-]{0,149}$/.test(key.pk||'')&&/^COMMERCIAL_SHARING#(?:MERCHANT|PLATFORM)#[A-Za-z0-9][A-Za-z0-9_:#.-]{0,149}$/.test(key.sk||'');
const kindFor=(table,key)=>table===P&&sharingKey(key)?'commercial_sharing':table===P&&contractKey(key)?'commercial_agreement':table===S&&fundingKey(key)?'commercial_funding':table===S&&/^COMMERCIAL_AGREEMENT#[A-Za-z0-9][A-Za-z0-9_:#.-]{0,149}$/.test(key.pk||'')&&/^APPROVAL#\d+$/.test(key.sk||'')?'commercial_approval':table===S&&key.pk==='AUDIT'&&/^\d{4}-\d{2}-\d{2}T[^#]+#[a-f0-9-]{36}$/i.test(key.sk||'')?'commercial_audit':null;
function validateRecord(table,row){
 const kind=kindFor(table,row);if(!kind)throw error('COMMERCIAL_RECORD_SCOPE_INVALID');
 let allowed;
 if(kind==='commercial_sharing')allowed=['pk','sk','ownerId','businessId','policyId','policyVersion','policyDigest'];
 else if(['commercial_agreement','commercial_funding'].includes(kind)&&/^DRAFT(?:_VERSION#\d+)?$/.test(row.sk))allowed=['pk','sk','id','kind','version','baseVersion','ownerId','organizationId','businessIds','requestedBy','values','fundingPolicies','hash','createdAt','reason','publishedVersion','directPublicationAuthorized','authorizedStaffVersion'];
 else if(kind==='commercial_agreement'){
  if(row.sk==='CURRENT')allowed=['pk','sk','version','termsHash','status'];
  else if(/^VERSION#\d+$/.test(row.sk))allowed=['pk','sk','schemaVersion','terms','otherCharges','allowedFundingPolicyIds','fundingPolicySnapshots','termsHash'];
  else if(/^CONSENT#\d+$/.test(row.sk))allowed=['pk','sk','subjectId','hash','acceptedAt','businessIds'];
  else if(/^ACCEPTANCE#\d+$/.test(row.sk))allowed=['pk','sk','subjectId','termsHash','acceptedAt','status'];
  else if(/^DISCLOSURE#\d+$/.test(row.sk))allowed=['pk','sk','termsHash','values','businessIds','fundingPolicies'];
 }else if(kind==='commercial_approval')allowed=['pk','sk','staffId','termsHash','approvedAt','status'];
 else if(kind==='commercial_funding'&&/^NOTICE#\d+$/.test(row.sk))allowed=['pk','sk','ownerId','businessId','draftVersion','draftHash','eventId','status','createdAt','expiresAt','attempts','nextAttemptAt','leaseUntil','sentTokenHashes'];
 else if(kind==='commercial_funding'&&/^CONSENT#\d+$/.test(row.sk))allowed=['pk','sk','subjectId','hash','acceptedAt','businessIds','acceptedRole','ownerId'];
 else if(kind==='commercial_funding'&&(row.sk==='CURRENT'||/^VERSION#\d+$/.test(row.sk)))allowed=['pk','sk','schemaVersion','id','version','status','campaignId','campaignVersion','source','merchantId','branchId','target','effectiveFrom','effectiveTo','merchantNumerator','denominator','rounding','merchantShareFinalRounding','approvedBy','approvedAt','acceptedBy','acceptedAt'];
 else if(kind==='commercial_audit'&&/^\d{4}-\d{2}-\d{2}T[^#]+#[a-f0-9-]{36}$/i.test(row.sk)&&String(row.action||'').startsWith('COMMERCIAL_'))allowed=['pk','sk','actorId','action','before','after'];
 if(!allowed||Object.keys(row).some(k=>!allowed.includes(k)&&!['legalHold','retentionHold'].includes(k)))throw error('COMMERCIAL_RECORD_SCOPE_INVALID');
 if(Buffer.byteLength(JSON.stringify(row))>250000)throw error('COMMERCIAL_RECORD_TOO_LARGE');return kind;
}
function scopeValid(owner,ids){return id(owner)&&Array.isArray(ids)&&ids.length>0&&ids.length<=10&&ids.every(id)&&new Set(ids).size===ids.length;}
function archiveKey(requestId,kind,key){return {pk:'REQUEST#'+requestId,sk:kind.toUpperCase()+'#'+JSON.stringify({pk:key.pk,sk:key.sk})};}
async function commercialRetention({db,r,job,requestTable=L,archiveTable='staging-AccountDeletionFinancialArchive',clock=()=>new Date().toISOString(),maxPages=30}){
 if(r.status!=='PROCESSING'||r.actorType!=='MERCHANT'||r.scope?.kind!=='BUSINESS'||!uuid(r.requestId)||r.requestId!==job.requestId||r.subjectId!==job.subjectId||r.scope.id!==job.businessId||!id(job.businessId)||!id(r.subjectId)||!r.leaseOwner||!Number.isSafeInteger(r.version)||r.pk!=='SUBJECT#MERCHANT#'+r.subjectId||r.sk!=='REQUEST#'+r.requestId)throw error('INVALID_CLEANUP_SCOPE');
 if(!Number.isInteger(job.financialYears)||job.financialYears<1||job.financialYears>30||!Number.isSafeInteger(job.policyVersion))throw error('RETENTION_POLICY_INVALID');
 if(held(r))throw error('DOCUMENTED_RETENTION_HOLD');
 const get=async(table,key)=>(await db.send(new GetCommand({TableName:table,Key:key,ConsistentRead:true}))).Item;
 async function query(table,pk,prefix=''){const rows=[];let cursor,pages=0;do{if(++pages>maxPages)throw error('COMMERCIAL_INVENTORY_INCOMPLETE');const p=await db.send(new QueryCommand({TableName:table,KeyConditionExpression:'pk=:pk'+(prefix?' AND begins_with(sk,:prefix)':''),ExpressionAttributeValues:{':pk':pk,...(prefix?{':prefix':prefix}:{})},ConsistentRead:true,Limit:100,...(cursor?{ExclusiveStartKey:cursor}:{})}));rows.push(...p.Items||[]);cursor=p.LastEvaluatedKey;}while(cursor);return rows;}
 const branch=await get(B,{businessId:job.businessId}),rows=(await query(P,'BRANCH#'+job.businessId,'COMMERCIAL')).filter(x=>x.sk.startsWith('COMMERCIAL#')||x.sk.startsWith('COMMERCIAL_REQUEST#')||x.sk.startsWith('COMMERCIAL_SHARING#'));
 const refs=new Map();for(const row of rows){if(row.ownerId!==r.subjectId||row.businessId!==job.businessId)throw error('COMMERCIAL_RECORD_SCOPE_INVALID');if(row.sk.startsWith('COMMERCIAL#')){if(!['AGREEMENT','FUNDING'].includes(row.kind)||row.recordPk!==(row.kind==='AGREEMENT'?'COMMERCIAL_AGREEMENT#':'DISCOUNT_FUNDING#')+row.sk.split('#').slice(2).join('#'))throw error('COMMERCIAL_RECORD_SCOPE_INVALID');refs.set(row.recordPk,{kind:row.kind,pk:row.recordPk});}}
 if(branch?.commercialAgreementId){if(!id(branch.commercialAgreementId))throw error('COMMERCIAL_RECORD_SCOPE_INVALID');refs.set('COMMERCIAL_AGREEMENT#'+branch.commercialAgreementId,{kind:'AGREEMENT',pk:'COMMERCIAL_AGREEMENT#'+branch.commercialAgreementId});}
 if(!rows.length&&!refs.size)return {archived:0,auditsMoved:0};
 if(!branch||branch.ownerId!==r.subjectId||branch.cognitoUserId!==r.subjectId||branch.deletionRequestId!==r.requestId)throw error('PROFILE_GENERATION_CHANGED');
 if(held(branch))throw error('DOCUMENTED_RETENTION_HOLD');
 const lifeKey={pk:'BUSINESS_LIFECYCLE#MERCHANT#'+job.businessId,sk:'META'},life=await get(requestTable,lifeKey);if(!life||life.requestId!==r.requestId||life.subjectId!==r.subjectId)throw error('COMMERCIAL_CLOSURE_REQUIRED');if(held(life))throw error('DOCUMENTED_RETENTION_HOLD');
 const items=[],scopes=new Map();
 for(const row of rows.filter(x=>x.sk.startsWith('COMMERCIAL_SHARING#'))){if(held(row))throw error('DOCUMENTED_RETENTION_HOLD');validateRecord(P,row);if(!id(row.policyId))throw error('COMMERCIAL_RECORD_SCOPE_INVALID');refs.set('DISCOUNT_FUNDING#'+row.policyId,{kind:'FUNDING',pk:'DISCOUNT_FUNDING#'+row.policyId});items.push({table:P,row,kind:'commercial_sharing',businessIds:[job.businessId]});}
 for(const ref of refs.values()){
  const table=ref.kind==='AGREEMENT'?P:S,canonical=await query(table,ref.pk),draft=canonical.find(x=>x.sk==='DRAFT');
  if(!draft||draft.ownerId!==r.subjectId||!scopeValid(draft.ownerId,draft.businessIds)||!draft.businessIds.includes(job.businessId)||draft.organizationId!==branch.organizationId)throw error('COMMERCIAL_SCOPE_INVENTORY_REQUIRED');
  const ids=[...draft.businessIds].sort();scopes.set(ref.pk,ids);
  for(const row of canonical){if(held(row))throw error('DOCUMENTED_RETENTION_HOLD');const kind=validateRecord(table,row);items.push({table,row,kind,businessIds:ids});}
  if(ref.kind==='AGREEMENT')for(const row of await query(S,ref.pk)){if(held(row))throw error('DOCUMENTED_RETENTION_HOLD');const kind=validateRecord(S,row);items.push({table:S,row,kind,businessIds:ids});}
 }
 const previous=new Map((await query(archiveTable,'REQUEST#'+r.requestId,'COMMERCIAL_')).map(row=>[row.sk,row]));
 for(const marker of rows.filter(x=>x.sk.startsWith('COMMERCIAL_REQUEST#'))){
  if(!['AGREEMENT','FUNDING'].includes(marker.kind)||!id(marker.result?.id))throw error('COMMERCIAL_AUDIT_INDEX_REQUIRED');
  const k=marker.auditKey,ref=(marker.kind==='FUNDING'?'DISCOUNT_FUNDING#':'COMMERCIAL_AGREEMENT#')+marker.result?.id;
  if(!k||k.pk!=='AUDIT'||typeof k.sk!=='string'||!scopes.has(ref))throw error('COMMERCIAL_AUDIT_INDEX_REQUIRED');
  const row=await get(S,k),a=previous.get(archiveKey(r.requestId,'commercial_audit',k).sk);
  if(!row){if(!a||a.requestId!==r.requestId||a.kind!=='commercial_audit'||a.sourceTable!==S||digest(a.sourceKey)!==digest(k)||a.retentionSchemaVersion!==1||a.sourceDigest!==digest(a.data)||a.scopeOwnerId!==r.subjectId||JSON.stringify(a.scopeBusinessIds)!==JSON.stringify(scopes.get(ref))||held(a))throw error('COMMERCIAL_AUDIT_SOURCE_REQUIRED');continue;}
  if(row.before?.businessId!==job.businessId||row.before?.id!==marker.result.id||(row.actorId?.startsWith('OWNER#')&&row.actorId!=='OWNER#'+r.subjectId))throw error('COMMERCIAL_RECORD_SCOPE_INVALID');
  if(held(row))throw error('DOCUMENTED_RETENTION_HOLD');items.push({table:S,row,kind:validateRecord(S,row),businessIds:scopes.get(ref)});
 }
 // Full hold/conflict inventory before moving any audit event. Immutable agreement rows remain usable by siblings.
 for(const item of items){const key={pk:item.row.pk,sk:item.row.sk},old=previous.get(archiveKey(r.requestId,item.kind,key).sk);if(old&&(held(old)||old.requestId!==r.requestId||old.retentionSchemaVersion!==1||old.kind!==item.kind||old.sourceTable!==item.table||digest(old.sourceKey)!==digest(key)||old.sourceDigest!==digest(old.data)||old.sourceDigest!==digest(dataOf(item.row))||old.scopeOwnerId!==r.subjectId||JSON.stringify(old.scopeBusinessIds)!==JSON.stringify(item.businessIds)))throw error(held(old)?'DOCUMENTED_RETENTION_HOLD':'ARCHIVE_CONFLICT');}
 const lease=()=>({ConditionCheck:{TableName:requestTable,Key:{pk:r.pk,sk:r.sk},ConditionExpression:'leaseOwner=:owner AND #v=:v AND leaseUntil>:now AND #s=:s',ExpressionAttributeNames:{'#v':'version','#s':'status'},ExpressionAttributeValues:{':owner':r.leaseOwner,':v':r.version,':now':Math.floor(Date.parse(clock())/1000),':s':'PROCESSING'}}});
 const guards=()=>[lease(),{ConditionCheck:{TableName:B,Key:{businessId:job.businessId},...exact(branch)}},{ConditionCheck:{TableName:requestTable,Key:lifeKey,...exact(life)}}];
 let archived=0,auditsMoved=0;
 for(const item of items){const key={pk:item.row.pk,sk:item.row.sk},aKey=archiveKey(r.requestId,item.kind,key),old=previous.get(aKey.sk);if(old&&item.kind!=='commercial_audit')continue;
  const now=clock(),until=new Date(now);until.setUTCFullYear(until.getUTCFullYear()+job.financialYears);const data=dataOf(item.row);
  const record={...aKey,requestId:r.requestId,subjectAlias:'DELETED#'+r.requestId,kind:item.kind,retentionSchemaVersion:1,policyVersion:job.policyVersion,archivedAt:now,expiresAt:Math.floor(until.getTime()/1000),sourceTable:item.table,sourceKey:key,sourceDigest:digest(data),scopeOwnerId:r.subjectId,scopeBusinessIds:item.businessIds,data};
  const sourceOp=item.kind==='commercial_audit'?{Delete:{TableName:item.table,Key:key,...exact(item.row)}}:{ConditionCheck:{TableName:item.table,Key:key,...exact(item.row)}};
  await db.send(new TransactWriteCommand({TransactItems:[...guards(),sourceOp,old?{ConditionCheck:{TableName:archiveTable,Key:aKey,...exact(old)}}:{Put:{TableName:archiveTable,Item:record,ConditionExpression:'attribute_not_exists(pk)'}}]}));
  if(!old)archived++;if(item.kind==='commercial_audit')auditsMoved++;
 }
 await db.send(new TransactWriteCommand({TransactItems:guards()}));return {archived,auditsMoved};
}
/** Canonical financial contracts are never extended with retention metadata. Purge only after every scoped branch fully closed. */
async function commercialPurgeGuards({db,group,source,requestTable=L}){
 const a=group.archives[0];if(a.retentionSchemaVersion!==1||!scopeValid(a.scopeOwnerId,a.scopeBusinessIds)||a.scopeBusinessIds.some((id,i)=>i&&id<=a.scopeBusinessIds[i-1]))throw error('PURGE_SCOPE_INVALID');
 if(group.archives.some(x=>x.retentionSchemaVersion!==1||x.scopeOwnerId!==a.scopeOwnerId||JSON.stringify(x.scopeBusinessIds)!==JSON.stringify(a.scopeBusinessIds)||x.sourceDigest!==digest(x.data)||kindFor(group.table,x.sourceKey)!==x.kind))throw error('PURGE_SCOPE_INVALID');
 if(source&&(!group.archives.some(x=>x.sourceDigest===digest(dataOf(source)))||validateRecord(group.table,source)!==a.kind))return null;
 const get=async(t,k)=>(await db.send(new GetCommand({TableName:t,Key:k,ConsistentRead:true}))).Item,guards=[];
 for(const businessId of a.scopeBusinessIds){const bk={businessId},b=await get(B,bk);if(b)return null;
  const lk={pk:'BUSINESS_LIFECYCLE#MERCHANT#'+businessId,sk:'META'},l=await get(requestTable,lk);if(!l||l.subjectId!==a.scopeOwnerId||l.businessId!==businessId||!uuid(l.requestId)||held(l))return null;
  const rk={pk:'SUBJECT#MERCHANT#'+a.scopeOwnerId,sk:'REQUEST#'+l.requestId},r=await get(requestTable,rk);if(!r||r.status!=='COMPLETED'||r.actorType!=='MERCHANT'||r.subjectId!==a.scopeOwnerId||r.scope?.kind!=='BUSINESS'||r.scope.id!==businessId||r.requestId!==l.requestId||held(r))return null;
  const wk={walletId:'WALLET#MERCHANT#'+businessId,sk:'META'},w=await get(W,wk);if(!w||w.status!=='CLOSED'||w.ownerType!=='MERCHANT'||w.ownerId!==businessId||w.deletionRequestId!==l.requestId||w.availableBalance!==0||w.lockedBalance!==0||held(w))return null;
  guards.push({ConditionCheck:{TableName:B,Key:bk,ConditionExpression:'attribute_not_exists(businessId)'}},{ConditionCheck:{TableName:requestTable,Key:lk,...exact(l)}},{ConditionCheck:{TableName:requestTable,Key:rk,...exact(r)}},{ConditionCheck:{TableName:W,Key:wk,...exact(w)}});
 }return guards;
}
module.exports={commercialRetention,commercialPurgeGuards,kindFor,digest,dataOf,validateRecord};
