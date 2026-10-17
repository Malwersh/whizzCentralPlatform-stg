'use strict';
// Pure transaction plans. Callers must authenticate, authorize scope, strongly
// read both records, and revalidate region geometry before approval.
const {createHash}=require('node:crypto');
const fail=code=>{throw Object.assign(Error(code),{code});};
const TABLE='staging-MerchantPlatform',BUSINESSES='WhizzMerchants_Businesses';
const clean=(v,max)=>{if(typeof v!=='string'||!v.trim()||v.trim().length>max)fail('INVALID_TEXT');return v.trim();};
function active(b){if(!b||b.status!=='approved'||b.deletionRequestId||['CLOSING','CLOSED'].includes(b.lifecycleStatus))fail('BRANCH_NOT_EDITABLE');}
function base(b,kind){return kind==='NAME'?{businessName:b.businessName??b.name??''}:{address:b.address??null,regionPath:b.regionPath??null,regionId:b.regionId??null,latitude:b.latitude??b.address?.latitude??null,longitude:b.longitude??b.address?.longitude??null};}
function canonical(v){if(Array.isArray(v))return v.map(canonical);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])]));return v;}
function fingerprint(b,kind){return createHash('sha256').update(JSON.stringify(canonical(base(b,kind)))).digest('hex');}
function propose({business,subjectId,kind,proposed,requestId,reason,now}){
 active(business);if(!subjectId||business.ownerId!==subjectId||business.cognitoUserId!==subjectId)fail('OWNER_REQUIRED');
 if(!['NAME','LOCATION'].includes(kind))fail('INVALID_CHANGE_KIND');
 if(!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(requestId||''))fail('INVALID_REQUEST_ID');
 let value;if(kind==='NAME'){
  if(!proposed||Object.keys(proposed).some(k=>k!=='businessName'))fail('UNKNOWN_FIELD');value={businessName:clean(proposed.businessName,150)};
 }else{
  if(!proposed||Object.keys(proposed).some(k=>!['regionPath','latitude','longitude','address'].includes(k)))fail('UNKNOWN_FIELD');
  if(!Array.isArray(proposed.regionPath)||proposed.regionPath.length!==4||proposed.regionPath.some(x=>typeof x!=='string'||!x||x.length>100))fail('INVALID_REGION_PATH');
  if(typeof proposed.latitude!=='number'||!Number.isFinite(proposed.latitude)||Math.abs(proposed.latitude)>90||typeof proposed.longitude!=='number'||!Number.isFinite(proposed.longitude)||Math.abs(proposed.longitude)>180)fail('INVALID_LOCATION');
  value={regionPath:[...proposed.regionPath],latitude:proposed.latitude,longitude:proposed.longitude,address:clean(proposed.address,500)};
 }
 return {pk:'BUSINESS#'+business.businessId,sk:'CHANGE#'+requestId,requestId,businessId:business.businessId,subjectId,kind,proposed:value,base:structuredClone(base(business,kind)),baseFingerprint:fingerprint(business,kind),status:'PENDING',version:1,reason:clean(reason,1000),createdAt:clean(now,40)};
}
function decide({business,request,decision,actorId,reason,now,validatedLocation}){
 active(business);if(!request||request.status!=='PENDING'||request.businessId!==business.businessId)fail('REQUEST_NOT_PENDING');
 if(!['APPROVE','REJECT'].includes(decision))fail('INVALID_DECISION');
 if(request.subjectId!==business.ownerId||business.cognitoUserId!==request.subjectId)fail('OWNERSHIP_CHANGED');
 if(!Number.isSafeInteger(request.version)||request.version<1)fail('INVALID_VERSION');
 const audit={actorId:clean(actorId,150),decisionReason:clean(reason,1000),decidedAt:clean(now,40)};
 const items=[];
 if(decision==='APPROVE'){
  if(fingerprint(business,request.kind)!==request.baseFingerprint)fail('CHANGE_BASE_CONFLICT');
  let values;
  if(request.kind==='NAME')values={businessName:clean(request.proposed.businessName,150),name:clean(request.proposed.businessName,150)};
  else if(request.kind==='LOCATION'){
   const v=validatedLocation;
   if(!v||JSON.stringify(v.regionPath)!==JSON.stringify(request.proposed.regionPath)||v.latitude!==request.proposed.latitude||v.longitude!==request.proposed.longitude||!Array.isArray(v.checks)||!v.checks.length||!v.address||v.regionId!==v.regionPath[3])fail('VALIDATED_LOCATION_REQUIRED');
   values={address:v.address,regionPath:v.regionPath,regionNames:v.regionNames,regionId:v.regionId,countryId:v.countryId,governorateId:v.governorateId,districtId:v.districtId,latitude:v.latitude,longitude:v.longitude};items.push(...v.checks);
  }else fail('INVALID_CHANGE_KIND');
  const names={'#status':'status'},attrs={':approved':'approved',':owner':request.subjectId,...(business.updatedAt===undefined?{}:{':baseUpdatedAt':business.updatedAt})};
  const set=Object.entries({...values,updatedAt:now}).map(([key,value],i)=>{if(value===undefined)fail('INVALID_VALIDATED_LOCATION');names['#n'+i]=key;attrs[':v'+i]=value;return '#n'+i+'=:v'+i});
  items.push({Update:{TableName:BUSINESSES,Key:{businessId:business.businessId},UpdateExpression:'SET '+set.join(', '),ConditionExpression:'#status=:approved AND ownerId=:owner AND cognitoUserId=:owner AND '+(business.updatedAt===undefined?'attribute_not_exists(updatedAt)':'updatedAt=:baseUpdatedAt')+' AND attribute_not_exists(deletionRequestId)',ExpressionAttributeNames:names,ExpressionAttributeValues:attrs}});
 }
 const next={...request,...audit,status:decision==='APPROVE'?'APPROVED':'REJECTED',version:request.version+1};
 items.push({Put:{TableName:TABLE,Item:next,ConditionExpression:'#s=:pending AND #v=:version',ExpressionAttributeNames:{'#s':'status','#v':'version'},ExpressionAttributeValues:{':pending':'PENDING',':version':request.version}}});
 return {request:next,TransactItems:items};
}
module.exports={propose,decide,fingerprint};
