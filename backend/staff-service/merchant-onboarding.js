'use strict';
const {GetCommand,QueryCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {randomUUID}=require('node:crypto');
const {allowed}=require('./catalog');
const policy=require('./onboarding-policy');
const TABLE='staging-MerchantPlatform',BUSINESSES='WhizzMerchants_Businesses',SETTINGS='OPERATIONAL_SETTINGS#MERCHANT_ONBOARDING';
const fail=(code,status=400)=>Object.assign(Error(code),{status});
async function route(ctx,actor,method,path,input={}){
 const get=async(table,key)=>(await ctx.db.send(new GetCommand({TableName:table,Key:key,ConsistentRead:true}))).Item;
 const requirePermission=p=>{if(!allowed(actor,p))throw fail('PERMISSION_REQUIRED',403);};
 const write=async items=>{try{await ctx.db.send(new TransactWriteCommand({TransactItems:items}));}catch(e){if(e.name==='TransactionCanceledException')throw fail('VERSION_OR_STATE_CONFLICT',409);throw e;}};
 if(path==='/staff/merchants/types'||path==='/staff/merchants/types/save'){
  requirePermission('merchants.read');const current=await get(ctx.table,{pk:SETTINGS,sk:'CURRENT'});if(!current)throw fail('SETTINGS_NOT_INITIALIZED',503);
  const canEdit=allowed(actor,'merchants.edit')&&actor.scope?.allRegions===true;
  if(method==='GET')return {current,canRequest:canEdit,canApprove:false};
  if(method!=='POST'||path!=='/staff/merchants/types/save')throw fail('NOT_FOUND',404);
  if(!canEdit)throw fail('PERMISSION_REQUIRED',403);if(current.version!==input.baseVersion)throw fail('VERSION_OR_STATE_CONFLICT',409);
  const values=policy.validate(input.values);for(const key of Object.keys(current.values).filter(k=>k!=='types'))if(JSON.stringify(values[key])!==JSON.stringify(current.values[key]))throw fail('REFERENCE_VALUES_ONLY');
  if(values.partnershipReady!==current.values.partnershipReady)throw fail('REFERENCE_VALUES_ONLY');
  for(const old of current.values.types){const next=values.types.find(t=>t.id===old.id);if(!next||next.model!==old.model||JSON.stringify(next.fields)!==JSON.stringify(old.fields))throw fail('TYPE_ARCHIVE_OR_MODEL_REQUIRED');}
  if(typeof input.reason!=='string'||input.reason.trim().length<5||input.reason.length>300)throw fail('REASON_REQUIRED');
  const next={pk:SETTINGS,sk:'CURRENT',version:current.version+1,policyVersion:randomUUID(),values,updatedBy:actor.employeeId,updatedAt:new Date().toISOString(),effectiveFor:'NEW_REQUESTS'};
  await write([ctx.guard(actor),{Put:{TableName:ctx.table,Item:next,ConditionExpression:'#v=:v',ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':v':current.version}}},{Put:{TableName:ctx.table,Item:{...next,sk:'VERSION#'+next.policyVersion},ConditionExpression:'attribute_not_exists(sk)'}},ctx.audit(actor.employeeId,'MERCHANT_REFERENCE_SAVED',current,{...next,reason:input.reason.trim()},next.policyVersion)]);return {saved:true};
 }
 if(path==='/staff/merchants/agreement'){
  requirePermission('merchants.read');const current=await get(ctx.table,{pk:SETTINGS,sk:'CURRENT'});if(!current)throw fail('SETTINGS_NOT_INITIALIZED',503);
  if(method==='GET')return {baseVersion:current.version,version:current.values.termsVersion,textAr:current.values.termsTextAr,ready:current.values.partnershipReady===true,canEdit:allowed(actor,'merchants.edit')};
  if(method!=='POST')throw fail('NOT_FOUND',404);requirePermission('merchants.edit');if(actor.scope?.allRegions!==true)throw fail('GLOBAL_SCOPE_REQUIRED',403);
  if(input.baseVersion!==current.version)throw fail('VERSION_OR_STATE_CONFLICT',409);
  if(typeof input.version!=='string'||!input.version.trim()||input.version.length>150||typeof input.textAr!=='string'||input.textAr.trim().length<10||input.textAr.length>20000||typeof input.ready!=='boolean'||typeof input.reason!=='string'||input.reason.trim().length<5||input.reason.length>300)throw fail('INVALID_AGREEMENT');
  if(current.values.termsTextAr!==input.textAr.trim()&&input.version===current.values.termsVersion)throw fail('NEW_AGREEMENT_VERSION_REQUIRED');
  const next={pk:SETTINGS,sk:'CURRENT',version:current.version+1,policyVersion:randomUUID(),values:policy.validate({...current.values,termsVersion:input.version.trim(),termsTextAr:input.textAr.trim(),partnershipReady:input.ready}),updatedBy:actor.employeeId,updatedAt:new Date().toISOString(),effectiveFor:'NEW_REQUESTS'};
  await write([ctx.guard(actor),{Put:{TableName:ctx.table,Item:next,ConditionExpression:'#v=:v',ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':v':current.version}}},{Put:{TableName:ctx.table,Item:{...next,sk:'VERSION#'+next.policyVersion},ConditionExpression:'attribute_not_exists(sk)'}},ctx.audit(actor.employeeId,'MERCHANT_AGREEMENT_UPDATED',current,{...next,reason:input.reason.trim()},next.policyVersion)]);return {saved:true};
 }
 if(path==='/staff/merchants/application-asset'&&method==='GET'){
  requirePermission('merchants.documents.read');const q=ctx.query||{};
  if(typeof q.queueKey!=='string'||q.queueKey.length>160||typeof q.assetId!=='string'||!/^[a-f0-9-]{36}$/i.test(q.assetId))throw fail('INVALID_ASSET');
  const queue=await get(TABLE,{pk:'REVIEW#MERCHANT',sk:q.queueKey});if(!queue||!allowed(actor,'merchants.documents.read',queue.regionId))throw fail('APPLICATION_UNAVAILABLE',404);
  const asset=await get(TABLE,{pk:'PERSON#'+queue.subjectId,sk:'ASSET#'+q.assetId});if(!asset||asset.subjectId!==queue.subjectId||asset.draftId!==queue.draftId||asset.status!=='READY'||!asset.key.startsWith('persons/'+queue.subjectId+'/drafts/'+queue.draftId+'/'))throw fail('ASSET_UNAVAILABLE',404);
  const {S3Client,GetObjectCommand}=require('@aws-sdk/client-s3'),{getSignedUrl}=require('@aws-sdk/s3-request-presigner');
  return {url:await getSignedUrl(new S3Client({}),new GetObjectCommand({Bucket:'staging-merchant-onboarding-699561669180',ExpectedBucketOwner:'699561669180',Key:asset.key,ResponseContentDisposition:asset.contentType==='application/pdf'?'attachment':'inline'}),{expiresIn:60}),expiresIn:60};
 }
 requirePermission('merchants.read');
 if(method==='GET'&&path==='/staff/merchants/applications'){
  const items=[];let cursor;do{const page=await ctx.db.send(new QueryCommand({TableName:TABLE,KeyConditionExpression:'pk=:pk',ExpressionAttributeValues:{':pk':'REVIEW#MERCHANT'},ConsistentRead:true,ExclusiveStartKey:cursor}));
   for(const item of page.Items||[]){if(!allowed(actor,'merchants.read',item.regionId)||item.status!=='SUBMITTED')continue;const draft=await get(TABLE,{pk:'PERSON#'+item.subjectId,sk:'DRAFT#'+item.draftId});if(draft?.reviewStatus==='SUBMITTED'&&draft.version===item.draftVersion)items.push({queueKey:item.sk,requestId:item.requestId,draft});}cursor=page.LastEvaluatedKey;
  }while(cursor);return {items,canReview:allowed(actor,'merchants.review'),canReadDocuments:allowed(actor,'merchants.documents.read')};
 }
 if(method!=='POST'||path!=='/staff/merchants/applications/review')throw fail('NOT_FOUND',404);
 requirePermission('merchants.review');if(typeof input.queueKey!=='string'||input.queueKey.length>160||!['APPROVE','REJECT','NEEDS_INFORMATION'].includes(input.decision)||typeof input.reason!=='string'||input.reason.trim().length<5||input.reason.length>1000)throw fail('INVALID_REVIEW');
 const queue=await get(TABLE,{pk:'REVIEW#MERCHANT',sk:input.queueKey});if(!queue||!allowed(actor,'merchants.review',queue.regionId))throw fail('APPLICATION_UNAVAILABLE',404);
 const draft=await get(TABLE,{pk:'PERSON#'+queue.subjectId,sk:'DRAFT#'+queue.draftId});
 if(queue.status==='APPROVED'&&input.decision==='APPROVE')return {businessId:queue.businessId,status:'APPROVED'};
 if(queue.status!=='SUBMITTED'||draft?.reviewStatus!=='SUBMITTED'||draft.version!==input.baseVersion||draft.version!==queue.draftVersion||draft.submission?.requestId!==queue.requestId)throw fail('VERSION_OR_STATE_CONFLICT',409);
 const now=new Date().toISOString(),status={APPROVE:'APPROVED',REJECT:'REJECTED',NEEDS_INFORMATION:'NEEDS_INFORMATION'}[input.decision];
 const review={reviewedBy:actor.employeeId,reviewedAt:now,reason:input.reason.trim()},next={...draft,reviewStatus:status,review,version:draft.version+1,updatedAt:now};
 const tx=[ctx.guard(actor),{ConditionCheck:{TableName:'staging-AccountDeletion',Key:{pk:'ACCOUNT_LIFECYCLE#MERCHANT#'+draft.subjectId,sk:'META'},ConditionExpression:'attribute_not_exists(pk)'}}];
 let business;
 if(status==='APPROVED'){
  const profile=await get(TABLE,{pk:draft.pk,sk:'PROFILE'});if(!profile||!draft.submission?.agreement?.version)throw fail('PROFILE_OR_AGREEMENT_UNAVAILABLE');
  const typePolicy=await get(ctx.table,{pk:SETTINGS,sk:'VERSION#'+draft.configVersion});
  const typeLabel=typePolicy?.values?.types?.find(t=>t.id===draft.businessTypeId);
  const businessId=ctx.newBusinessId?ctx.newBusinessId():'business_'+randomUUID();next.businessId=businessId;
  business={businessId,branchId:businessId,organizationId:draft.organizationId,brandId:draft.brandId,businessName:draft.name,name:draft.name,description:draft.description||'',...(typeLabel?{businessTypeLabelAr:typeLabel.labelAr,businessTypeLabelEn:typeLabel.labelEn}:{}),businessTypeId:draft.businessTypeId,businessType:draft.businessTypeId==='MARKET'?'grocery':draft.model==='FOOD'?'restaurant':'store',businessModel:draft.model,ownerId:draft.subjectId,cognitoUserId:draft.subjectId,ownerName:profile.name,phoneNumber:draft.contactPhone,...(profile.email?{email:profile.email}:{}),address:{fullAddress:draft.address,latitude:draft.latitude,longitude:draft.longitude,country:draft.regionNames?.[0]||'',city:draft.regionNames?.[1]||'',district:draft.regionNames?.[2]||'',region:draft.regionNames?.[3]||''},regionId:draft.regionId,regionPath:draft.regionPath,openingHours:draft.openingHours,status:'approved',reviewStatus:'APPROVED',isActive:false,operatingStatus:'OFFLINE',onboardingDraftId:draft.draftId,onboardingSchemaVersion:2,onboardingComplete:false,onboardingConfigVersion:draft.configVersion,registrationCertificateAssetId:draft.registrationCertificateAssetId||null,businessPhotoAssetId:draft.businessPhotoAssetId||null,createdAt:now,updatedAt:now,version:1};
  tx.push({Put:{TableName:BUSINESSES,Item:business,ConditionExpression:'attribute_not_exists(businessId)'}});
  for(const [kind,id,name] of [['ORGANIZATION',draft.organizationId,draft.name],['BRAND',draft.brandId,draft.name]]){const key={pk:draft.pk,sk:kind+'#'+id};if(!await get(TABLE,key))tx.push({Put:{TableName:TABLE,Item:{...key,subjectId:draft.subjectId,organizationId:draft.organizationId,...(kind==='BRAND'?{brandId:draft.brandId}:{}),name,version:1,createdAt:now},ConditionExpression:'attribute_not_exists(pk)'}});}
 }
 tx.push({Put:{TableName:TABLE,Item:next,ConditionExpression:'#v=:v AND #s=:submitted',ExpressionAttributeNames:{'#v':'version','#s':'reviewStatus'},ExpressionAttributeValues:{':v':draft.version,':submitted':'SUBMITTED'}}},{Put:{TableName:TABLE,Item:{...queue,status,...review,...(business?{businessId:business.businessId}:{})},ConditionExpression:'#s=:submitted',ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':submitted':'SUBMITTED'}}},ctx.audit(actor.employeeId,'MERCHANT_APPLICATION_'+status,{requestId:queue.requestId,draftVersion:draft.version},{requestId:queue.requestId,status,reason:review.reason,businessId:business?.businessId||null},randomUUID()));
 await write(tx);return {status,...(business?{businessId:business.businessId}:{})};
}
module.exports={route,TABLE};
