'use strict';
// Frozen translation of the operations supported by the legacy device bridge.
// Unimplemented legacy rights are retained for review, never activated later automatically.
const {createHash}=require('node:crypto');
const roles={MANAGER:['branch.read','branch.hours.write','menu.read','menu.write','menu.import','orders.read','orders.manage'],RECEPTION:['branch.read','menu.read','orders.read','orders.manage'],FINANCE:['branch.read','finance.read'],REPORT_READER:['branch.read','reports.read']};
const extras=new Set(['branch.description.write','branch.photo.write','branch.instructions.write','branch.phone.change','staff.manage']);
const mapping={'branch.read':['branch.read','hours.read'],'branch.hours.write':['hours.write'],'menu.read':['menu.read'],'menu.write':['menu.edit','menu.price.write','menu.availability.write'],'orders.read':['orders.read'],'orders.manage':['orders.accept','orders.reject','orders.prepare','orders.ready']};
const fail=code=>{throw Object.assign(Error(code),{code});};
function snapshot(row,policy){
 require('./staff-permission-policy').validatePolicy(policy,require('./staff-capabilities').REGISTRY);
 if(row.permissionSchema!==undefined||!Object.hasOwn(roles,row.role)||!Array.isArray(row.extraPermissions)||row.extraPermissions.some(p=>!extras.has(p))||typeof row.businessId!=='string'||!row.businessId||typeof row.ownerId!=='string'||!row.ownerId||row.pk!=='BRANCH#'+row.businessId||!Number.isSafeInteger(row.version)||row.version<1)fail('LEGACY_GRANT_REVIEW_REQUIRED');
 if(typeof row.sk!=='string'||(!row.sk.startsWith('MEMBER#')&&!row.sk.startsWith('INVITE#'))||row.sk.startsWith('MEMBER#')&&(typeof row.subjectId!=='string'||!row.subjectId||row.sk!=='MEMBER#'+row.subjectId)||row.sk.startsWith('INVITE#')&&(!Number.isSafeInteger(row.expiresAt)||row.expiresAt<=0))fail('LEGACY_GRANT_REVIEW_REQUIRED');
 const source=[...new Set([...roles[row.role],...row.extraPermissions])].sort();
 const permissions=[...new Set(source.flatMap(p=>mapping[p]||[]))].sort();
 return {permissionSchema:2,role:'LEGACY_'+row.role,extraPermissions:[],grant:{roleId:'LEGACY_'+row.role,roleNameAr:{MANAGER:'مدير الفرع',RECEPTION:'استقبال',FINANCE:'مالي — قراءة فقط',REPORT_READER:'قارئ التقارير'}[row.role],roleVersion:1,policyVersion:policy.version,branchIds:[row.businessId],permissions},legacyGrant:{mappingVersion:1,role:row.role,permissions:source,deferredPermissions:source.filter(p=>!mapping[p]),sourceVersion:row.version,sourceHash:createHash('sha256').update(JSON.stringify({pk:row.pk,sk:row.sk,businessId:row.businessId,ownerId:row.ownerId,role:row.role,permissions:source,version:row.version})).digest('hex')}};
}
function plan(rows,policy,{now=Date.now()/1000}={}){
 require('./staff-permission-policy').validatePolicy(policy,require('./staff-capabilities').REGISTRY);if(!Array.isArray(rows))fail('ITEMS_ARRAY_REQUIRED');
 const updates=[],review=[],counts={members:0,invitations:0,alreadyExplicit:0,skipped:0};
 for(const row of rows){if(!row?.sk?.startsWith('MEMBER#')&&!row?.sk?.startsWith('INVITE#')){counts.skipped++;continue;}if(row.permissionSchema===2){counts.alreadyExplicit++;continue;}
 if(row.sk.startsWith('INVITE#')&&row.status==='PENDING'&&row.expiresAt<=now){counts.skipped++;continue;}
 if(row.sk.startsWith('MEMBER#')&&row.status!=='ACTIVE'||row.sk.startsWith('INVITE#')&&row.status!=='PENDING'){counts.skipped++;continue;}
 try{const converted=snapshot(row,policy);updates.push({key:{pk:row.pk,sk:row.sk},baseVersion:row.version,ownerId:row.ownerId,businessId:row.businessId,expectedStatus:row.status,set:{...converted,version:row.version+1}});counts[row.sk.startsWith('MEMBER#')?'members':'invitations']++;}catch(e){review.push({key:{pk:row.pk,sk:row.sk},reason:e.code||'LEGACY_GRANT_REVIEW_REQUIRED'});}
 }
 return {mappingVersion:1,policyVersion:policy.version,counts,updates,review};
}
function transaction(entry,current,policy,{timestamp=new Date().toISOString()}={}){
 if(!current||entry.key.pk!==current.pk||entry.key.sk!==current.sk||entry.baseVersion!==current.version||entry.ownerId!==current.ownerId||entry.businessId!==current.businessId||entry.expectedStatus!==current.status||!['ACTIVE','PENDING'].includes(current.status))fail('MIGRATION_SOURCE_CHANGED');
 const converted=snapshot(current,policy);
 const now=Math.floor(new Date(timestamp).getTime()/1000);if(!Number.isSafeInteger(now)||current.status==='PENDING'&&current.expiresAt<=now)fail('MIGRATION_SOURCE_CHANGED');
 if(entry.set?.legacyGrant?.sourceHash!==converted.legacyGrant.sourceHash||entry.set?.grant?.policyVersion!==policy.version)fail('MIGRATION_SOURCE_CHANGED');
 // Recompute the result; never trust permissions edited in an exported plan.
 const item={...current,...converted,version:current.version+1,updatedAt:timestamp};
 const fence=pk=>({ConditionCheck:{TableName:'staging-AccountDeletion',Key:{pk,sk:'META'},ConditionExpression:'attribute_not_exists(pk)'}});
 return [fence('BUSINESS_LIFECYCLE#MERCHANT#'+current.businessId),fence('ACCOUNT_LIFECYCLE#MERCHANT#'+current.ownerId),...(current.sk.startsWith('MEMBER#')?[fence('ACCOUNT_LIFECYCLE#MERCHANT#'+current.subjectId)]:[]),
 {ConditionCheck:{TableName:'WhizzMerchants_Businesses',Key:{businessId:current.businessId},ConditionExpression:'ownerId=:owner AND cognitoUserId=:owner AND attribute_not_exists(deletionRequestId)',ExpressionAttributeValues:{':owner':current.ownerId}}},
 {ConditionCheck:{TableName:'staging-PlatformStaff',Key:{pk:'OPERATIONAL_SETTINGS#MERCHANT_STAFF_PERMISSIONS',sk:'CURRENT'},ConditionExpression:'#v=:v',ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':v':policy.version}}},
 {Put:{TableName:'staging-MerchantPlatform',Item:item,ConditionExpression:'#v=:v AND #s=:s AND attribute_not_exists(permissionSchema)'+(current.status==='PENDING'?' AND expiresAt>:now':''),ExpressionAttributeNames:{'#v':'version','#s':'status'},ExpressionAttributeValues:{':v':current.version,':s':current.status,...(current.status==='PENDING'?{':now':now}:{})}}},
 {Put:{TableName:'staging-MerchantPlatform',Item:{pk:current.pk,sk:'STAFF_AUDIT#MIGRATION#'+converted.legacyGrant.sourceHash,ownerId:current.ownerId,businessId:current.businessId,actorId:'SYSTEM_MIGRATION',subjectId:current.subjectId||null,action:'MIGRATE_EXPLICIT_GRANT',createdAt:timestamp,policyVersion:policy.version,before:{role:current.role,permissions:converted.legacyGrant.permissions},after:converted.grant},ConditionExpression:'attribute_not_exists(pk)'}}];
}
module.exports={snapshot,plan,transaction};
