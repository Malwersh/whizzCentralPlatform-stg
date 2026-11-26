'use strict';

const {randomUUID}=require('node:crypto');
function createService({sdk,regions,tables}) {
 const {GetCommand,QueryCommand,TransactWriteCommand}=sdk;
 const {platform:TABLE,policy:POLICY,lifecycle:LIFECYCLE}=tables||{};
 for(const name of [TABLE,POLICY,LIFECYCLE])if(typeof name!=='string'||!/^wizz-production-[A-Za-z0-9_-]+$/.test(name))throw Error('PRODUCTION_TABLE_REQUIRED');
 if(new Set([TABLE,POLICY,LIFECYCLE]).size!==3)throw Error('DISTINCT_TABLES_REQUIRED');
 if(typeof regions?.validate!=='function')throw Error('REGION_VALIDATOR_REQUIRED');
const fail=(code,status=400)=>Object.assign(Error(code),{status});
const text=(v,max,optional=false)=>{if(optional&&(v===undefined||v===null))return '';if(typeof v!=='string'||v.length>max||(!optional&&!v.trim()))throw fail('INVALID_DRAFT');return v.trim();};
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
function hours(value){if(value==null)return null;if(!Array.isArray(value)||value.length!==7)throw fail('INVALID_HOURS');return value.map((r,i)=>{if(!r||r.day!==i||typeof r.closed!=='boolean'||!Array.isArray(r.periods)||r.periods.length>3||(r.closed&&r.periods.length))throw fail('INVALID_HOURS');let previous=-1;const periods=r.periods.map(p=>{if(!p||typeof p.open!=='string'||typeof p.close!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(p.open)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(p.close))throw fail('INVALID_HOURS');const n=s=>Number(s.slice(0,2))*60+Number(s.slice(3));if(n(p.open)>=n(p.close)||n(p.open)<previous)throw fail('INVALID_HOURS');previous=n(p.close);return {open:p.open,close:p.close};});if(!r.closed&&!periods.length)throw fail('INVALID_HOURS');return {day:i,closed:r.closed,periods};});}
function assetFence(pk,id,asset,sub,draftId,kind){
 if(typeof asset.sha256!=='string'||!/^[a-f0-9]{64}$/i.test(asset.sha256))throw fail('ASSET_UNAVAILABLE');
 return {ConditionCheck:{TableName:TABLE,Key:{pk,sk:'ASSET#'+id},ConditionExpression:'#s=:ready AND subjectId=:sub AND draftId=:draft AND kind=:kind AND sha256=:hash',ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':ready':'READY',':sub':sub,':draft':draftId,':kind':kind,':hash':asset.sha256}}};
}
async function write(db,items){try{await db.send(new TransactWriteCommand({TransactItems:items}));}catch(e){if(e.name==='TransactionCanceledException')throw fail('VERSION_OR_STATE_CONFLICT',409);throw e;}}
async function route({db,sub,phone},event,input){
 const pk='PERSON#'+sub,lifecycle={pk:'ACCOUNT_LIFECYCLE#MERCHANT#'+sub,sk:'META'},fence={ConditionCheck:{TableName:LIFECYCLE,Key:lifecycle,ConditionExpression:'attribute_not_exists(pk)'}};
 const get=async(table,key)=>(await db.send(new GetCommand({TableName:table,Key:key,ConsistentRead:true}))).Item;
 if(event.path.endsWith('/config')&&event.httpMethod==='GET'){
  if(event.queryStringParameters?.draftId===undefined){
   const current=await get(POLICY,{pk:'OPERATIONAL_SETTINGS#MERCHANT_ONBOARDING',sk:'CURRENT'});
   if(!Number.isSafeInteger(current?.policyVersion)||current.policyVersion<1||!Array.isArray(current?.values?.types)||typeof current.values.termsVersion!=='string'||typeof current.values.termsTextAr!=='string')throw fail('CONFIG_UNAVAILABLE',503);
   return {configVersion:String(current.policyVersion),version:current.policyVersion,termsVersion:current.values.termsVersion,termsTextAr:current.values.termsTextAr,types:current.values.types};
  }
  const id=event.queryStringParameters?.draftId;if(!uuid(id))throw fail('INVALID_DRAFT');const draft=await get(TABLE,{pk,sk:'DRAFT#'+id});if(!draft)throw fail('DRAFT_NOT_FOUND',404);
  const pinned=await get(POLICY,{pk:'OPERATIONAL_SETTINGS#MERCHANT_ONBOARDING',sk:'VERSION#'+draft.configVersion}),current=await get(POLICY,{pk:'OPERATIONAL_SETTINGS#MERCHANT_ONBOARDING',sk:'CURRENT'});
  return {configVersion:draft.configVersion,agreementVersion:pinned?.values?.termsVersion,agreementTextAr:pinned?.values?.termsTextAr,partnershipReady:pinned?.values?.partnershipReady===true,currentConfigVersion:current?.policyVersion,updateAvailable:current?.policyVersion!==draft.configVersion};
 }
 if(event.path.endsWith('/rebase')&&event.httpMethod==='POST'){
  if(Object.keys(input).some(k=>!['draftId','baseVersion','targetConfigVersion'].includes(k))||!uuid(input.draftId))throw fail('INVALID_DRAFT');
  const old=await get(TABLE,{pk,sk:'DRAFT#'+input.draftId}),current=await get(POLICY,{pk:'OPERATIONAL_SETTINGS#MERCHANT_ONBOARDING',sk:'CURRENT'});
  if(!old||old.version!==input.baseVersion||!['DRAFT','NEEDS_INFORMATION','REJECTED'].includes(old.reviewStatus)||current?.policyVersion!==input.targetConfigVersion)throw fail('VERSION_OR_STATE_CONFLICT',409);
  const type=current.values.types.find(t=>t.id===old.businessTypeId);if(!type||!type.registrationOpen)throw fail('REGISTRATION_CLOSED');
  const draft={...old,configVersion:current.policyVersion,version:old.version+1,updatedAt:new Date().toISOString()};await write(db,[fence,{Put:{TableName:TABLE,Item:draft,ConditionExpression:'#v=:v',ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':v':old.version}}}]);return {draft};
 }
 if(event.httpMethod==='GET'){
  const items=[];let cursor;do{const page=await db.send(new QueryCommand({TableName:TABLE,KeyConditionExpression:'pk=:pk AND begins_with(sk,:prefix)',ExpressionAttributeValues:{':pk':pk,':prefix':'DRAFT#'},ConsistentRead:true,ExclusiveStartKey:cursor}));items.push(...page.Items||[]);cursor=page.LastEvaluatedKey;}while(cursor);return {items};
 }
 if(event.httpMethod!=='POST')throw fail('NOT_FOUND',404);
 const submit=event.path.endsWith('/submit');
 if(submit){
  if(Object.keys(input).some(k=>!['draftId','baseVersion','agreementVersion'].includes(k))||!uuid(input.draftId))throw fail('INVALID_DRAFT');
  const old=await get(TABLE,{pk,sk:'DRAFT#'+input.draftId});if(!old||old.subjectId!==sub)throw fail('DRAFT_NOT_FOUND',404);
  if(old.reviewStatus==='SUBMITTED'&&old.submission?.draftVersion===input.baseVersion)return {draft:old};
  if(!['DRAFT','NEEDS_INFORMATION','REJECTED'].includes(old.reviewStatus)||old.version!==input.baseVersion)throw fail('VERSION_OR_STATE_CONFLICT',409);
  if(!uuid(old.organizationId)||!uuid(old.brandId)||!['FOOD','RETAIL'].includes(old.model)||!old.address||!old.contactPhone||!old.openingHours||!old.openingHours.some(r=>!r.closed&&r.periods.length))throw fail('BRANCH_DETAILS_REQUIRED');
  const policy=await get(POLICY,{pk:'OPERATIONAL_SETTINGS#MERCHANT_ONBOARDING',sk:'CURRENT'});
  const type=policy?.values?.types?.find(t=>t.id===old.businessTypeId);
  if(!type||type.registrationOpen!==true)throw fail('REGISTRATION_CLOSED');
  if(type.regions.length&&!type.regions.includes(old.regionPath?.[3]))throw fail('REGISTRATION_CLOSED');
  const pinned=await get(POLICY,{pk:'OPERATIONAL_SETTINGS#MERCHANT_ONBOARDING',sk:'VERSION#'+old.configVersion});
  if(!pinned)throw fail('CONFIG_VERSION_UNAVAILABLE',409);
  const terms=pinned.values;
  if(!terms?.partnershipReady||!terms.termsVersion||input.agreementVersion!==terms.termsVersion)throw fail('PARTNERSHIP_AGREEMENT_REQUIRED');
  for(const field of type.fields||[])if(field.required===true&&field.id==='registrationCertificateAssetId'&&!old.registrationCertificateAssetId)throw fail('REGISTRATION_CERTIFICATE_REQUIRED');
  const selection=await regions.validate(db,old.regionPath,old.latitude,old.longitude);
  const assetChecks=[];for(const [field,kind] of [['registrationCertificateAssetId','REGISTRATION_CERTIFICATE'],['businessPhotoAssetId','BUSINESS_PHOTO']])if(old[field]){
   const asset=await get(TABLE,{pk,sk:'ASSET#'+old[field]});if(!asset||asset.subjectId!==sub||asset.draftId!==old.draftId||asset.kind!==kind||asset.status!=='READY')throw fail('ASSET_UNAVAILABLE');assetChecks.push(assetFence(pk,old[field],asset,sub,old.draftId,kind));
  }
  const snapshot=JSON.parse(JSON.stringify(old)),now=new Date().toISOString(),requestId=randomUUID();
  delete snapshot.submission;delete snapshot.review;
  const draft={...old,regionId:selection.regionId,regionNames:selection.regionNames,reviewStatus:'SUBMITTED',version:old.version+1,updatedAt:now,submission:{requestId,draftVersion:old.version,submittedAt:now,configVersion:old.configVersion,snapshot,agreement:{version:terms.termsVersion,textAr:terms.termsTextAr,acceptedAt:now,subjectId:sub}}};
  await write(db,[fence,...selection.checks,...assetChecks,{ConditionCheck:{TableName:POLICY,Key:{pk:'OPERATIONAL_SETTINGS#MERCHANT_ONBOARDING',sk:'CURRENT'},ConditionExpression:'policyVersion=:v',ExpressionAttributeValues:{':v':policy.policyVersion}}},{Put:{TableName:TABLE,Item:draft,ConditionExpression:'#v=:v',ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':v':old.version}}},{Put:{TableName:TABLE,Item:{pk,sk:'SUBMISSION#'+requestId,subjectId:sub,draftId:old.draftId,...draft.submission},ConditionExpression:'attribute_not_exists(pk)'}},{Put:{TableName:TABLE,Item:{pk:'REVIEW#MERCHANT',sk:now+'#'+requestId,requestId,subjectId:sub,draftId:old.draftId,regionId:selection.regionId,status:'SUBMITTED',draftVersion:draft.version,createdAt:now},ConditionExpression:'attribute_not_exists(pk)'}}]);return {draft};
 }
 if(Object.keys(input).some(k=>!['draftId','baseVersion','name','businessTypeId','address','contactPhone','description','regionPath','latitude','longitude','openingHours','registrationCertificateAssetId','businessPhotoAssetId','organizationId','brandId'].includes(k)))throw fail('UNKNOWN_FIELD');
 const profile=await get(TABLE,{pk,sk:'PROFILE'});if(!profile)throw fail('PROFILE_REQUIRED',403);
 if(input.draftId&&!uuid(input.draftId))throw fail('INVALID_DRAFT');
 const draftId=input.draftId||randomUUID(),key={pk,sk:'DRAFT#'+draftId},old=input.draftId?await get(TABLE,key):null;
 if(input.draftId&&(!old||old.subjectId!==sub||old.version!==input.baseVersion||!['DRAFT','NEEDS_INFORMATION','REJECTED'].includes(old.reviewStatus)))throw fail('VERSION_OR_STATE_CONFLICT',409);
 const policy=await get(POLICY,{pk:'OPERATIONAL_SETTINGS#MERCHANT_ONBOARDING',sk:'CURRENT'}),type=policy?.values?.types?.find(t=>t.id===input.businessTypeId&&['FOOD','RETAIL'].includes(t.model));
 if(!type&&(!old||old.businessTypeId!==input.businessTypeId))throw fail('BUSINESS_TYPE_UNAVAILABLE');
 const regionPath=input.regionPath??old?.regionPath??[];if(!Array.isArray(regionPath)||regionPath.length>4||regionPath.some(r=>typeof r!=='string'||r.length>100))throw fail('INVALID_REGION');
 const coords={};for(const field of ['latitude','longitude']){const v=Object.hasOwn(input,field)?input[field]:old?.[field];if(v!=null){if(typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>(field==='latitude'?90:180))throw fail('INVALID_LOCATION');coords[field]=v;}}
 for(const field of ['registrationCertificateAssetId','businessPhotoAssetId'])if(input[field]&&!uuid(input[field]))throw fail('INVALID_ASSET');
 let organizationId=old?.organizationId||randomUUID(),brandId=old?.brandId||randomUUID();
 if(input.organizationId||input.brandId){if(!uuid(input.organizationId)||!uuid(input.brandId))throw fail('INVALID_ORGANIZATION');const org=await get(TABLE,{pk,sk:'ORGANIZATION#'+input.organizationId}),brand=await get(TABLE,{pk,sk:'BRAND#'+input.brandId});if(!org||!brand||org.subjectId!==sub||brand.organizationId!==org.organizationId)throw fail('ORGANIZATION_UNAVAILABLE',403);organizationId=org.organizationId;brandId=brand.brandId;}
 const assetChecks=[];
 for(const [field,kind] of [['registrationCertificateAssetId','REGISTRATION_CERTIFICATE'],['businessPhotoAssetId','BUSINESS_PHOTO']]){
  const id=Object.hasOwn(input,field)?input[field]:old?.[field];if(!id)continue;
  const asset=await get(TABLE,{pk,sk:'ASSET#'+id});if(!asset||asset.status!=='READY'||asset.subjectId!==sub||asset.draftId!==draftId||asset.kind!==kind)throw fail('ASSET_UNAVAILABLE');
  assetChecks.push(assetFence(pk,id,asset,sub,draftId,kind));
 }
 const now=new Date().toISOString(),draft={...key,draftId,subjectId:sub,organizationId,brandId,name:text(input.name,150),businessTypeId:text(input.businessTypeId,40),model:type?.model||old.model,address:text(input.address,500,true),contactPhone:input.contactPhone?phone(input.contactPhone):profile.phoneNumber,description:text(input.description,2000,true),regionPath,...coords,openingHours:hours(input.openingHours??old?.openingHours),registrationCertificateAssetId:Object.hasOwn(input,'registrationCertificateAssetId')?input.registrationCertificateAssetId:old?.registrationCertificateAssetId??null,businessPhotoAssetId:Object.hasOwn(input,'businessPhotoAssetId')?input.businessPhotoAssetId:old?.businessPhotoAssetId??null,configVersion:(old?.businessTypeId===input.businessTypeId?old.configVersion:null)||policy.policyVersion,reviewStatus:'DRAFT',operatingStatus:'OFFLINE',version:(old?.version||0)+1,createdAt:old?.createdAt||now,updatedAt:now};
 await write(db,[fence,...assetChecks,{Put:{TableName:TABLE,Item:draft,ConditionExpression:old?'#v=:v':'attribute_not_exists(pk)',...(old?{ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':v':old.version}}:{})}}]);return {draft};
}
return {route,hours};
}
module.exports={createService};
