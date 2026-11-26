'use strict';
const {randomUUID}=require('node:crypto');
const {validateRegistration,registrationOptions}=require('./registration-regions');
const vehicles=require('./driver-vehicles-308');
const legal=require('./customer-legal-contract-344');
const POOL='us-east-1_5sUT54eCB',CLIENT='59to4hbat3lv2fvosa49afu0gi';
const TABLE='wizz-production-Drivers',LIFECYCLE='wizz-production-AccountDeletion',SETTINGS='wizz-production-PlatformStaff';
const REGIONS='wizz-production-RegionsDerived',LIVE='wizz-production-DriverLiveState';
const BUCKET='wizz-production-driver-documents-746727375268-us-east-1';
const fail=(code,status=400)=>{throw Object.assign(Error(code),{code,status});};
function identity(event){
 const c=event.requestContext?.authorizer?.claims;
 const reject=reason=>{throw Object.assign(Error('UNAUTHORIZED'),{code:'UNAUTHORIZED',status:401,reason});};
 if(!c)reject('claims_missing');
 if(c.iss!=='https://cognito-idp.us-east-1.amazonaws.com/'+POOL||c.aud!==CLIENT||c.token_use!=='id')reject('token_binding');
 // REST API Gateway can serialize the verified Cognito expiry as a UTC date string.
 const exp=c.exp;
 const numeric=typeof exp==='number'||(typeof exp==='string'&&/^\d+$/.test(exp));
 const expiresAt=numeric?Number(exp)*1000:typeof exp==='string'?Date.parse(exp):NaN;
 if(!Number.isFinite(expiresAt))reject(typeof exp==='string'?'expiry_format':'expiry_missing');
 if(expiresAt<=Date.now())reject('token_expired');
 if(!(/^[a-f0-9-]{36}$/i.test(c.sub||'')))reject('subject_invalid');
 return c.sub;
}
function fence(sub){return {ConditionCheck:{TableName:LIFECYCLE,Key:{pk:'ACCOUNT_LIFECYCLE#DRIVER#'+sub,sk:'META'},ConditionExpression:'attribute_not_exists(pk)'}};}
function uploadInput(body){
 const fields={driving_license:'drivingLicenseUrl',national_id:'nationalIdUrl',registration_paper:'registrationPaperUrl'};
 if(!body||!fields[body.documentType]||!['image/jpeg','image/png','application/pdf'].includes(body.contentType)||typeof body.fileData!=='string'||body.fileData.length>5600000||(body.fileData.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(body.fileData)))fail('INVALID_DOCUMENT');
 const bytes=Buffer.from(body.fileData,'base64');if(bytes.length<8||bytes.length>4*1024*1024)fail('INVALID_DOCUMENT');
 const valid=body.contentType==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):body.contentType==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:bytes.subarray(0,5).toString()==='%PDF-';
 if(!valid)fail('DOCUMENT_TYPE_MISMATCH');
 if(body.vehicleId!==undefined&&(body.documentType!=='registration_paper'||!/^[A-Za-z0-9_-]{1,80}$/.test(body.vehicleId)))fail('INVALID_VEHICLE');
 return {bytes,field:fields[body.documentType],extension:body.contentType==='image/png'?'png':body.contentType==='image/jpeg'?'jpg':'pdf'};
}
function createApi({db,s3,GetCommand,ScanCommand,TransactWriteCommand,PutObjectCommand,HeadObjectCommand,beginUpload,withContext}){
 const read=sub=>db.send(new GetCommand({TableName:TABLE,Key:{driverId:sub},ConsistentRead:true}));
 async function profile(sub){const r=await read(sub);if(!r.Item||r.Item.driverId!==sub)fail('DRIVER_PROFILE_REQUIRED',409);if(r.Item.deletionRequestId||r.Item.isDeleted||r.Item.deletedAt)fail('ACCOUNT_CLOSING',409);return r.Item;}
 async function regionRows(){let cursor;const rows=[];do{const r=await db.send(new ScanCommand({TableName:REGIONS,ConsistentRead:true,ExclusiveStartKey:cursor}));rows.push(...(r.Items||[]));cursor=r.LastEvaluatedKey;}while(cursor);return rows;}
 function regionFences(rows,profile){
  const chain=[profile.country_id,profile.governorate_id,profile.parent_district_id,profile.work_region_id];
  return chain.map(regionId=>{
   const row=rows.find(item=>item.regionId===regionId);
   const names={},values={};
   const checks=['attribute_not_exists(#pending)'];
   names['#pending']='_regionPublication';
   for(const [i,field] of ['level','parent_id','effective_is_active','effective_config','effective','version'].entries()){
    const name='#r'+i,value=':r'+i;
    names[name]=field;
    if(row[field]===undefined)checks.push('attribute_not_exists('+name+')');
    else{checks.push(name+'='+value);values[value]=row[field];}
   }
   return {ConditionCheck:{TableName:REGIONS,Key:{regionId},ConditionExpression:checks.join(' AND '),ExpressionAttributeNames:names,ExpressionAttributeValues:values}};
  });
 }
 function onboardingOnly(p){
  if(p.vehicleRegistry||p.isSuspended===true||p.isBanned===true||require('./driver_eligibility').isDriverApproved(p)||[p.status,p.registrationStatus].some(x=>['APPROVED','VERIFIED','SUSPENDED','BANNED','REJECTED'].includes(String(x).toUpperCase())))fail('USE_REVIEWED_PROFILE_MANAGEMENT',409);
 }
 async function update(sub,body){
  const p=await profile(sub);
  onboardingOnly(p);
  const allowed=['name','email','home_address_text','vehicleType','vehiclePlate','governorate_id','work_region_id','drivingLicenseUrl','nationalIdUrl','registrationPaperUrl','profileSchemaVersion','legalAccepted','legalAcceptance'];
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!allowed.includes(k))||body.profileSchemaVersion!==2)fail('INVALID_PROFILE');
  for(const [k,max]of [['name',150],['home_address_text',500],['vehiclePlate',40]])if(typeof body[k]!=='string'||!body[k].trim()||body[k].length>max)fail('INVALID_PROFILE');
  if(body.email!==undefined&&body.email!==''&&!(typeof body.email==='string'&&body.email.length<=120&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)))fail('INVALID_EMAIL');
  const rows=await regionRows();let validated;try{validated=validateRegistration(body,registrationOptions(rows));}catch{fail('INVALID_WORK_REGION_OR_VEHICLE');}
  for(const k of ['drivingLicenseUrl','nationalIdUrl','registrationPaperUrl']){
   if(!vehicles.owns(body[k],sub,BUCKET))fail('DOCUMENT_OWNERSHIP_INVALID');
   await s3.send(new HeadObjectCommand({Bucket:BUCKET,Key:body[k].slice(('s3://'+BUCKET+'/').length)}));
  }
  if(body.legalAccepted!==true)fail('LEGAL_ACCEPTANCE_REQUIRED',409);
  const consent=await legal.consent(db,GetCommand,SETTINGS,body.legalAcceptance,'DRIVER');
  const now=new Date().toISOString(),next={...p,...validated,status:'PENDING_REVIEW',isVerified:false,isOnline:false,updatedAt:now,profileCompletedAt:now,legalAcceptance:{schemaVersion:1,subjectId:sub,acceptedAt:now,...legal.pin(consent.bundle),documentSnapshot:consent.bundle}};
  delete next.legalAccepted;
  // Guard every field used in review and prevent overwriting a simultaneous update.
  const guard=vehicles.fence(TABLE,{driverId:sub},p).ConditionCheck;
  await db.send(new TransactWriteCommand({TransactItems:[fence(sub),consent.condition,...regionFences(rows,validated),{Put:{TableName:TABLE,Item:next,ConditionExpression:guard.ConditionExpression,ExpressionAttributeNames:guard.ExpressionAttributeNames,...(guard.ExpressionAttributeValues?{ExpressionAttributeValues:guard.ExpressionAttributeValues}:{})}}]}));
  return {message:'أُرسلت بياناتك للمراجعة',data:next};
 }
 async function manageVehicles(sub,body){
  if(body!==null){
   if(!body||typeof body!=='object'||Array.isArray(body))fail('INVALID_VEHICLE',400);
   if(['ADD','UPDATE'].includes(body.action)){
    const url=body.vehicle?.registrationUrl,id=body.vehicle?.id;
    const prefix='s3://'+BUCKET+'/drivers/'+sub+'/vehicles/'+id+'/';
    if(typeof id!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(id)||
      !vehicles.owns(url,sub,BUCKET)||!url.startsWith(prefix))fail('DOCUMENT_VEHICLE_MISMATCH',400);
    await profile(sub);
    await s3.send(new HeadObjectCommand({Bucket:BUCKET,Key:url.slice(('s3://'+BUCKET+'/').length)}));
   }
  }
  return vehicles.operation({db,GetCommand,TransactWriteCommand,driversTable:TABLE,
   liveTable:LIVE,bucket:BUCKET,lifecycleGuard:fence(sub)},{driverId:sub,actorId:sub,body});
 }
 async function upload(sub,body,managed=false){
  const p=await profile(sub);
  const input=uploadInput(body);
  if(managed){
   if(body.documentType==='registration_paper'&&!body.vehicleId)fail('INVALID_VEHICLE');
  }else{
   onboardingOnly(p);
   if(body.vehicleId)fail('USE_VEHICLE_MANAGEMENT',409);
  }
  const key='drivers/'+sub+'/'+(body.vehicleId?'vehicles/'+body.vehicleId:body.documentType)+'/'+randomUUID()+'.'+input.extension;
  const finish=await beginUpload(sub);
  try{
   await s3.send(new PutObjectCommand({Bucket:BUCKET,Key:key,Body:input.bytes,ContentType:body.contentType}));
   const url='s3://'+BUCKET+'/'+key;
   if(!body.vehicleId){const guard=vehicles.fence(TABLE,{driverId:sub},p).ConditionCheck;
    await db.send(new TransactWriteCommand({TransactItems:[fence(sub),{Update:{TableName:TABLE,Key:{driverId:sub},UpdateExpression:'SET #doc = :url, #time = :time',ConditionExpression:guard.ConditionExpression,ExpressionAttributeNames:{...guard.ExpressionAttributeNames,'#doc':input.field,'#time':'updatedAt'},ExpressionAttributeValues:{...guard.ExpressionAttributeValues,':url':url,':time':new Date().toISOString()}}}]}));}
   return {success:true,documentUrl:url};
  }finally{await finish();}
 }
 return async event=>{
  const reply=(statusCode,data)=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(data)});
  try{const sub=identity(event);return await withContext(sub,async()=>{
   const method=event.httpMethod,path=event.path||'';let data;
   if(method==='GET'&&path.endsWith('/driver/me'))data={data:await profile(sub)};
   else if(method==='GET'&&path.endsWith('/driver/registration-options'))data=registrationOptions(await regionRows());
   else if(method==='GET'&&path.endsWith('/driver/legal'))data=await legal.published(db,GetCommand,SETTINGS,'DRIVER');
   else if(method==='PUT'&&path.endsWith('/driver/me'))data=await update(sub,JSON.parse(event.body||'{}'));
   else if(method==='GET'&&path.endsWith('/driver/vehicles'))data=await manageVehicles(sub,null);
   else if(method==='POST'&&path.endsWith('/driver/vehicles')){
    const body=JSON.parse(event.body||'{}');
    if(body===null)fail('INVALID_VEHICLE',400);
    data=await manageVehicles(sub,body);
   }
   else if(method==='POST'&&path.endsWith('/driver/vehicles/documents'))data=await upload(sub,JSON.parse(event.body||'{}'),true);
   else if(method==='POST'&&path.endsWith('/driver/documents/upload'))data=await upload(sub,JSON.parse(event.body||'{}'));
   else return reply(404,{code:'NOT_FOUND'});
   return reply(200,data);
  });}catch(e){const conflict=['TransactionCanceledException','ConditionalCheckFailedException'].includes(e.name);const status=e.status||e.statusCode||(conflict?409:e instanceof SyntaxError?400:503);if(event.httpMethod==='GET'&&(event.path||'').endsWith('/driver/me')){
   const reasons=['DRIVER_PROFILE_REQUIRED','ACCOUNT_CLOSING','AccessDeniedException','ResourceNotFoundException','ValidationException'];
   console.warn('DriverProfileReadFailed',status,e.reason||(reasons.includes(e.code)?e.code:reasons.includes(e.name)?e.name:'profile_unavailable'));
  }
  return reply(status,{code:conflict?'STATE_CHANGED':e.code||'PROFILE_REQUEST_UNAVAILABLE',message:status===409?'تغيّرت البيانات؛ حدّث الصفحة وأعد المحاولة':status===401?'يرجى تسجيل الدخول':'تعذر إكمال الطلب؛ راجع البيانات وحاول مجددًا'});}
 };
}
module.exports={identity,uploadInput,createApi};
