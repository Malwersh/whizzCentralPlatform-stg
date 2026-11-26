'use strict';
const vehicles=require('./driver-vehicles-308');
const {allowed}=require('./catalog');
const audit=require('./audit-trail');
const {registrationOptions}=require('./registration-regions');
const {randomUUID}=require('crypto');
const {readSnapshot,PRODUCTION_SNAPSHOT_TABLE}=require('../../../backend/shared/driver-performance-snapshot');
const TABLE='wizz-production-PlatformStaff',DRIVERS='wizz-production-Drivers',LIVE='wizz-production-DriverLiveState',LIFECYCLE='wizz-production-AccountDeletion',REGIONS='wizz-production-RegionsDerived',BUCKET='wizz-production-driver-documents-746727375268-us-east-1';
const fail=(code,status=403)=>{throw Object.assign(Error(code),{status});};
function createReviewApi({db,verifyAccessToken,liveIdentity,GetCommand,ScanCommand,TransactWriteCommand,HeadObjectCommand,s3,signDocument,reviewWritesEnabled=false,now=()=>Date.now()}){
 return async event=>{
 try{
 const method=event.httpMethod,path=event.path,match=path?.match(/^\/staff\/drivers\/([a-f0-9-]{36})\/(vehicles|documents\/view|performance|account-deletion)$/i);
 const listing=path==='/staff/drivers'&&method==='GET';
 const performance=match?.[2]==='performance';
 const deletion=match?.[2]==='account-deletion';
 if(!listing&&(!match||!['GET','POST'].includes(method)||match[2]!=='vehicles'&&method!=='GET'))fail('NOT_FOUND',404);
 let claims;try{claims=await verifyAccessToken((event.headers?.Authorization||event.headers?.authorization||'').replace(/^Bearer\s+/i,''));}catch{fail('UNAUTHORIZED',401);}
 if(claims?.iss!=='https://cognito-idp.us-east-1.amazonaws.com/us-east-1_njh6vaNWj'||claims?.client_id!=='7924qedsr5m1j1bvc3c7va8egk'||!claims?.sub||claims.token_use!=='access'||!Number.isFinite(claims.exp)||claims.exp*1000<=now())fail('UNAUTHORIZED',401);
 const actor=(await db.send(new GetCommand({TableName:TABLE,Key:{pk:'EMPLOYEE#'+claims.sub,sk:'PROFILE'},ConsistentRead:true}))).Item;
 if(!actor||actor.employeeId!==claims.sub||actor.status!=='ACTIVE'||!Number.isSafeInteger(actor.version)||!Number.isInteger(claims.auth_time)||(actor.minimumAuthTime||0)>claims.auth_time)fail('EMPLOYEE_INACTIVE');
 const live=await liveIdentity(claims);
 if(!live?.Enabled||live.UserStatus!=='CONFIRMED'||live.UserAttributes?.find(x=>x.Name==='sub')?.Value!==claims.sub||!live.UserMFASettingList?.includes('SOFTWARE_TOKEN_MFA'))fail('ADMIN_MFA_REQUIRED');
 const permission=listing||performance||deletion?'drivers.read':method==='POST'?'drivers.review':'drivers.documents.read';
 if(!allowed(actor,permission))fail('PERMISSION_REQUIRED');
 if(listing){
 const q=event.queryStringParameters||{};
 if(Object.keys(q).some(k=>!['cursor'].includes(k)))fail('INVALID_QUERY',400);
 let cursor;
 if(q.cursor){try{if(q.cursor.length>512)throw Error();cursor=JSON.parse(Buffer.from(q.cursor,'base64url').toString());if(Object.keys(cursor).length!==1||typeof cursor.driverId!=='string'||!/^[-a-f0-9]{36}$/i.test(cursor.driverId))throw Error();}catch{fail('INVALID_CURSOR',400);}}
 const page=await db.send(new ScanCommand({TableName:DRIVERS,Limit:50,ExclusiveStartKey:cursor,ConsistentRead:true,ProjectionExpression:'#id,#name,#full,#phone,#status,#reg,#work,#region,#gov,#deleted,#at,#request',ExpressionAttributeNames:{'#id':'driverId','#name':'name','#full':'fullName','#phone':'phoneNumber','#status':'status','#reg':'registrationStatus','#work':'work_region_id','#region':'work_region_name','#gov':'governorate_name','#deleted':'isDeleted','#at':'deletedAt','#request':'deletionRequestId'}}));
 const items=(page.Items||[]).filter(p=>!p.isDeleted&&!p.deletedAt&&(actor.scope?.allRegions===true||typeof p.work_region_id==='string'&&allowed(actor,permission,p.work_region_id))).map(p=>({driverId:p.driverId,name:p.name||p.fullName||'سائق دون اسم',phone:p.deletionRequestId?'':p.phoneNumber||'',accountClosing:!!p.deletionRequestId,status:p.status||p.registrationStatus||'PENDING_REVIEW',region:p.work_region_name||'',governorate:p.governorate_name||''}));
 return response(200,{items,nextCursor:page.LastEvaluatedKey?Buffer.from(JSON.stringify(page.LastEvaluatedKey)).toString('base64url'):null});
 }
 let body=null;
 if(method==='POST'){
 try{body=JSON.parse(event.body||'{}');}catch{fail('INVALID_BODY',400);}
 if(!body||Array.isArray(body)||typeof body!=='object')fail('INVALID_BODY',400);
 if(body.action==='REVIEW_ACCOUNT'&&body.decision==='SUSPENDED'&&!allowed(actor,'drivers.suspend'))fail('PERMISSION_REQUIRED');
 }
 const driverId=match[1];let regionChecks=[];
 const wrappedDb={send:async command=>{
 if(command instanceof TransactWriteCommand)command=new TransactWriteCommand({...command.input,TransactItems:[...command.input.TransactItems,...regionChecks]});
 return db.send(command);
 }};
 let profile;
 // Load once to validate scope and document existence. The reused operation fences all critical profile fields.
 profile=(await db.send(new GetCommand({TableName:DRIVERS,Key:{driverId},ConsistentRead:true}))).Item;
 if(deletion){
  if(Object.keys(event.queryStringParameters||{}).length)fail('INVALID_QUERY',400);
  const canRead=row=>row?.driverId===driverId
   ?actor.scope?.allRegions===true||typeof row.work_region_id==='string'&&allowed(actor,permission,row.work_region_id)
   :!row&&actor.scope?.allRegions===true;
  if(!canRead(profile))fail('DRIVER_UNAVAILABLE',404);
  const pk='SUBJECT#DRIVER#'+driverId;
  const get=async (sk,projection)=>(await db.send(new GetCommand({
   TableName:LIFECYCLE,Key:{pk,sk},ConsistentRead:true,...projection,
  }))).Item;
  const active=await get('ACTIVE#ACCOUNT#'+driverId,{ProjectionExpression:'requestId'});
  if(!active){
   if(!profile)fail('DRIVER_UNAVAILABLE',404);
   return response(200,{request:null});
  }
  if(!/^[a-f0-9-]{36}$/i.test(active.requestId))fail('REQUEST_UNAVAILABLE',503);
  const [request,fresh]=await Promise.all([
   get('REQUEST#'+active.requestId,{
    ProjectionExpression:'requestId,actorType,subjectId,#scope,#status,updatedAt,blockers',
    ExpressionAttributeNames:{'#scope':'scope','#status':'status'},
   }),
   db.send(new GetCommand({TableName:DRIVERS,Key:{driverId},ConsistentRead:true})),
  ]);
  if(!canRead(fresh.Item))fail('DRIVER_UNAVAILABLE',404);
  if(request?.actorType!=='DRIVER'||request.subjectId!==driverId||request.requestId!==active.requestId||
     request.scope?.kind!=='ACCOUNT'||request.scope.id!==driverId)fail('REQUEST_UNAVAILABLE',503);
  return response(200,{request:{
   requestId:request.requestId,status:request.status,updatedAt:request.updatedAt,
   blockers:(request.blockers||[]).map(({code})=>code),
  }});
 }
 if(!profile||!allowed(actor,permission,profile.work_region_id))fail('DRIVER_UNAVAILABLE',404);
 if(performance){
  if(Object.keys(event.queryStringParameters||{}).length)fail('INVALID_QUERY',400);
  const withinScope=row=>row?.driverId===driverId&&!row.isDeleted&&!row.deletedAt&&!row.deletionRequestId&&
   (actor.scope?.allRegions===true||(typeof row.work_region_id==='string'&&allowed(actor,permission,row.work_region_id)));
  if(!withinScope(profile))fail('DRIVER_UNAVAILABLE',404);
  const lifecycleKey={pk:'ACCOUNT_LIFECYCLE#DRIVER#'+driverId,sk:'META'};
  const initiallyClosing=(await db.send(new GetCommand({TableName:LIFECYCLE,Key:lifecycleKey,ConsistentRead:true}))).Item;
  if(initiallyClosing)fail('DRIVER_UNAVAILABLE',404);
  const snapshot=await readSnapshot({db,GetCommand,driverId,table:PRODUCTION_SNAPSHOT_TABLE,includeDetails:false,now});
  const [fresh,closing]=await Promise.all([
   db.send(new GetCommand({TableName:DRIVERS,Key:{driverId},ConsistentRead:true})),
   db.send(new GetCommand({TableName:LIFECYCLE,Key:lifecycleKey,ConsistentRead:true})),
  ]);
  if(!withinScope(fresh.Item)||closing.Item)fail('DRIVER_UNAVAILABLE',404);
  const count=value=>Number.isSafeInteger(value)&&value>=0?value:null;
  const rate=(value,minimum=0,maximum=1)=>Number.isFinite(value)&&value>=minimum&&value<=maximum?value:null;
  const liveStatus=snapshot.projection?.status;
  return response(200,{
   status:['CURRENT','UPDATING','STALE'].includes(liveStatus)?liveStatus:'UNAVAILABLE',
   computedAt:snapshot.projection?.computedAt??null,
   acceptanceRate:rate(snapshot.acceptanceRate),acceptanceSample:count(snapshot.acceptance?.sampleSize),
   completionRate:rate(snapshot.completionRate),completionSample:count(snapshot.completion?.sampleSize),
   consecutiveDeclines:snapshot.rejections?.windowComplete===true?count(snapshot.rejections.consecutive):null,
   rating:rate(snapshot.customerRating,1,5),ratingCount:count(snapshot.customerRatingCount),
  });
 }
 if(match[2]==='documents/view'){
 const q=event.queryStringParameters||{};
 if(Object.keys(q).some(k=>!['kind','vehicleId'].includes(k)))fail('INVALID_DOCUMENT_SELECTION',400);
 let url;
 if(['drivingLicense','nationalId'].includes(q.kind)&&!q.vehicleId)url=profile[q.kind+'Url'];
 else if(q.kind==='registrationPaper'&&typeof q.vehicleId==='string')url=vehicles.registry(profile).items[q.vehicleId]?.registrationUrl;
 else fail('INVALID_DOCUMENT_SELECTION',400);
 if(profile.isDeleted||profile.deletedAt||profile.deletionRequestId)fail('DRIVER_UNAVAILABLE',404);
 if(!vehicles.owns(url,driverId,BUCKET))fail('DOCUMENT_UNAVAILABLE',404);
 const key=url.slice(('s3://'+BUCKET+'/').length);
 const head=await s3.send(new HeadObjectCommand({Bucket:BUCKET,Key:key}));
 if(!head.VersionId||head.DeleteMarker)fail('DOCUMENT_UNAVAILABLE',404);
 const evidence={driverId,documentKind:q.kind,vehicleId:q.vehicleId||null,objectVersion:head.VersionId,reason:'فتح وثيقة لمراجعة اعتماد السائق'};
 await db.send(new TransactWriteCommand({TransactItems:[
 vehicles.fence(DRIVERS,{driverId},profile),
 vehicles.fence(TABLE,{pk:'EMPLOYEE#'+actor.employeeId,sk:'PROFILE'},actor,['employeeId','version','status','roles','scope','minimumAuthTime']),
 {ConditionCheck:{TableName:LIFECYCLE,Key:{pk:'ACCOUNT_LIFECYCLE#DRIVER#'+driverId,sk:'META'},ConditionExpression:'attribute_not_exists(pk)'}},
 audit.write(TABLE,actor,actor.employeeId,'DRIVER_DOCUMENT_VIEW_AUTHORIZED',null,evidence,randomUUID())]}));
 const signedUrl=await signDocument({Bucket:BUCKET,Key:key,VersionId:head.VersionId,ResponseCacheControl:'no-store',ResponseContentDisposition:'inline'},60);
 return response(200,{url:signedUrl,expiresIn:60});
 }
 if(body?.decision==='APPROVED'){
 let urls=[];
 if(body.action==='REVIEW_DOCUMENT')urls=[profile[body.documentKind+'Url']];
 if(body.action==='REVIEW')urls=[vehicles.registry(profile).items[body.vehicleId]?.registrationUrl];
 if(body.action==='REVIEW_ACCOUNT'){
 const rows=[];let cursor;
 do{const p=await db.send(new ScanCommand({TableName:REGIONS,ExclusiveStartKey:cursor,Limit:100}));rows.push(...p.Items||[]);cursor=p.LastEvaluatedKey;if(rows.length>10000)fail('REGIONS_UNAVAILABLE',503);}while(cursor);
 let options;try{options=registrationOptions(rows);}catch{fail('WORK_REGION_UNAVAILABLE',409);}
 if(!options.regions.some(x=>x.regionId===profile.work_region_id&&x.governorateId===profile.governorate_id))fail('WORK_REGION_UNAVAILABLE',409);
 const byId=new Map(rows.map(x=>[x.regionId,x]));let row=byId.get(profile.work_region_id);
 while(row){regionChecks.push(vehicles.fence(REGIONS,{regionId:row.regionId},row,['regionId','parent_id','level','effective_is_active','effective','effective_config']));row=byId.get(row.parent_id);if(regionChecks.length>4)fail('REGIONS_UNAVAILABLE',503);}
 urls=[profile.drivingLicenseUrl,profile.nationalIdUrl,...Object.values(vehicles.registry(profile).items).filter(v=>vehicles.vehicleStatus(v,now())==='APPROVED').map(v=>v.registrationUrl)];
 }
 for(const url of urls){if(!vehicles.owns(url,driverId,BUCKET))fail('DOCUMENT_OWNERSHIP_INVALID',400);await s3.send(new HeadObjectCommand({Bucket:BUCKET,Key:url.slice(('s3://'+BUCKET+'/').length)}));}
 }
 const result=await vehicles.operation({db:wrappedDb,GetCommand,TransactWriteCommand,driversTable:DRIVERS,liveTable:LIVE,bucket:BUCKET,now,
 authorize(p){if(!allowed(actor,permission,p.work_region_id)||JSON.stringify(vehicles.criticalFields.map(k=>p[k]))!==JSON.stringify(vehicles.criticalFields.map(k=>profile[k])))fail('STATE_CHANGED',409);},
 ...(body?{lifecycleGuard:{ConditionCheck:{TableName:LIFECYCLE,Key:{pk:'ACCOUNT_LIFECYCLE#DRIVER#'+driverId,sk:'META'},ConditionExpression:'attribute_not_exists(pk)'}},staffGuard:vehicles.fence(TABLE,{pk:'EMPLOYEE#'+actor.employeeId,sk:'PROFILE'},actor,['employeeId','version','status','roles','scope','minimumAuthTime']),audit:(action,before,after)=>audit.write(TABLE,actor,actor.employeeId,action,before,after,randomUUID())}:{})
 },{driverId,actorId:actor.employeeId,staff:true,body});
 return response(200,{...result,capabilities:{review:reviewWritesEnabled&&allowed(actor,'drivers.review',profile.work_region_id),suspend:reviewWritesEnabled&&allowed(actor,'drivers.suspend',profile.work_region_id)}});
 }catch(e){if(['TransactionCanceledException','ConditionalCheckFailedException'].includes(e.name))return response(409,{error:'STATE_CHANGED'});return response(e.status||503,{error:e.status?e.code||e.message:'REVIEW_UNAVAILABLE'});}
 };
}
function response(statusCode,data){return {statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(data)};}
module.exports={createReviewApi,TABLE,DRIVERS,REGIONS};
