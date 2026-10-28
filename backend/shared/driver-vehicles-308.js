'use strict';
const {createHash,randomUUID}=require('crypto');
const MAX_VEHICLES=12;
const criticalFields=['driverId','updatedAt','vehicleRegistry','vehicleOperational','personalDocumentReview','vehicleType','vehiclePlate','registrationPaperUrl','drivingLicenseUrl','nationalIdUrl','status','registrationStatus','isActive','work_region_id','home_region_id','isDeleted','deletedAt','deletionRequestId','isSuspended','isBanned'];
const fail=(code,status=409)=>{throw Object.assign(Error(code),{code,status,statusCode:status});};
const clone=x=>JSON.parse(JSON.stringify(x));
const id=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(x);
const text=(v,max=100)=>typeof v==='string'&&v.trim().length>0&&v.trim().length<=max;
const validType=x=>['car','motorcycle'].includes(x);
const fingerprint=v=>createHash('sha256').update(JSON.stringify([v.type,v.plateNumber,v.make||'',v.model||'',v.color||'',v.registrationUrl])).digest('hex');
function owns(url,driverId,bucket){return typeof bucket==='string'&&bucket.length>0&&typeof url==='string'&&url.startsWith(`s3://${bucket}/drivers/${driverId}/`)&&!url.includes('..')&&!/%2e|%2f|%5c/i.test(url);}
function expiresAt(date,noExpiry,reason){
 if(noExpiry===true){if(date!=null&&date!=='')fail('DOCUMENT_EXPIRY_CONFLICT',400);if(!text(reason,1000))fail('DOCUMENT_NO_EXPIRY_REASON_REQUIRED',400);return null;}
 if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date))fail('DOCUMENT_EXPIRY_REQUIRED',400);
 const ms=Date.parse(date+'T00:00:00.000Z');if(!Number.isFinite(ms)||new Date(ms).toISOString().slice(0,10)!==date)fail('DOCUMENT_EXPIRY_INVALID',400);
 // Last valid local day ends at midnight Asia/Baghdad (UTC+3).
 return new Date(ms+21*3600000).toISOString();
}
function reviewValid(r,url,now){return !!r&&r.status==='APPROVED'&&r.documentUrl===url&&typeof r.reviewedBy==='string'&&typeof r.reviewedAt==='string'&&(r.expiresAt===null&&r.noExpiry===true&&text(r.reason,1000)||typeof r.expiresAt==='string'&&Number.isFinite(Date.parse(r.expiresAt))&&Date.parse(r.expiresAt)>now);}
function documentStatus(review,url,now=Date.now()){
 if(!url)return 'MISSING';if(!review||review.documentUrl!==url)return 'PENDING_REVIEW';
 if(review.status==='REJECTED')return 'REJECTED';
 if(review.status==='APPROVED'&&review.expiresAt!==null&&Date.parse(review.expiresAt)<=now)return 'EXPIRED';
 return reviewValid(review,url,now)?'APPROVED':'PENDING_REVIEW';
}
function vehicleStatus(v,now=Date.now()){
 if(v.removedAt)return 'REMOVED';if(v.review?.status==='REJECTED')return 'REJECTED';
 if(v.review?.status==='APPROVED'&&v.review.expiresAt!==null&&Date.parse(v.review.expiresAt)<=now)return 'EXPIRED';
 return validType(v.type)&&text(v.plateNumber)&&v.review?.fingerprint===fingerprint(v)&&reviewValid(v.review,v.registrationUrl,now)?'APPROVED':'PENDING_REVIEW';
}
function initialRegistry(p){
 const items={};if(p.vehicleType||p.registrationPaperUrl)items.legacy={id:'legacy',type:p.vehicleType||'',plateNumber:p.vehiclePlate||'',make:'',model:'',color:'',registrationUrl:p.registrationPaperUrl||'',review:null,createdAt:p.createdAt||null,legacy:true};
 return {schemaVersion:1,version:0,activeId:null,items,events:[]};
}
function registry(p){
 if(p.vehicleRegistry===undefined)return initialRegistry(p);
 const r=p.vehicleRegistry;
 if(!r||r.schemaVersion!==1||!Number.isSafeInteger(r.version)||r.version<1||!r.items||Array.isArray(r.items)||Object.keys(r.items).length>60||!Array.isArray(r.events)||r.activeId!==null&&!id(r.activeId))fail('VEHICLE_REGISTRY_INVALID');
 for(const [k,v]of Object.entries(r.items))if(!id(k)||!v||v.id!==k)fail('VEHICLE_REGISTRY_INVALID');
 return clone(r);
}
function eligibility(p,now=Date.now()){
 const blocked=['BANNED','SUSPENDED','REJECTED','PENDING_REVIEW','PENDING_PROFILE','PENDING_DOCS'];
 const states=[p?.status,p?.registrationStatus].map(s=>String(s||'').toUpperCase());
 if(!p||(p.isActive!==undefined&&p.isActive!==true)||['isDeleted','isSuspended','isBanned'].some(k=>p[k]!==undefined&&p[k]!==false)||p.deletedAt!=null||p.deletionRequestId!=null||states.some(s=>blocked.includes(s))||!states.some(s=>['APPROVED','VERIFIED'].includes(s)))return {eligible:false,code:'DRIVER_ACCOUNT_NOT_APPROVED'};
 // Existing approved profiles need an explicit administrative transition; never manufacture vehicle approval.
 if(p.vehicleRegistry===undefined&&p.vehicleOperational===undefined)return {eligible:false,code:'VEHICLE_INITIAL_REVIEW_REQUIRED'};
 let r;try{r=registry(p.vehicleRegistry===undefined?{...p,vehicleRegistry:p.vehicleOperational}:p);}catch{return {eligible:false,code:'VEHICLE_REGISTRY_INVALID'};}
 const v=r.items[r.activeId];if(!v||vehicleStatus(v,now)!=='APPROVED')return {eligible:false,code:'ACTIVE_VEHICLE_NOT_APPROVED'};
 if(p.vehicleType!==v.type||p.vehiclePlate!==v.plateNumber||p.registrationPaperUrl!==v.registrationUrl)return {eligible:false,code:'ACTIVE_VEHICLE_REFERENCE_CHANGED'};
 if(!reviewValid(p.personalDocumentReview?.drivingLicense,p.drivingLicenseUrl,now)||!reviewValid(p.personalDocumentReview?.nationalId,p.nationalIdUrl,now))return {eligible:false,code:'DRIVER_DOCUMENT_REVIEW_REQUIRED'};
 if(!text(p.work_region_id))return {eligible:false,code:'DRIVER_WORK_REGION_REQUIRED'};
 const dates=[v.review.expiresAt,p.personalDocumentReview.drivingLicense.expiresAt,p.personalDocumentReview.nationalId.expiresAt].filter(Boolean).map(Date.parse);
 return {eligible:true,code:'ELIGIBLE',validUntil:dates.length?new Date(Math.min(...dates)).toISOString():null,vehicle:{id:v.id,type:v.type,plateNumber:v.plateNumber,make:v.make,model:v.model,color:v.color,registryVersion:r.version,fingerprint:fingerprint(v)},workRegionId:p.work_region_id};
}
function view(p,now=Date.now(),staff=false){const r=registry(p);return {version:r.version,initialized:p.vehicleRegistry!==undefined,activeId:r.activeId,eligibility:eligibility(p,now),vehicles:Object.values(r.items).map(v=>({...v,effectiveStatus:vehicleStatus(v,now),...(staff?{}:{registrationUrl:undefined,review:v.review?{status:v.review.status,reason:v.review.reason,expiresAt:v.review.expiresAt,noExpiry:v.review.noExpiry}:null})})),events:staff?r.events:r.events.map(({id,action,vehicleId,documentKind,staff,at,decision,reason})=>({id,action,vehicleId,documentKind,staff,at,decision,reason})),documents:['drivingLicense','nationalId'].map(kind=>({kind,uploaded:text(p[kind+'Url'],2000),status:documentStatus(p.personalDocumentReview?.[kind],p[kind+'Url'],now),review:staff?(p.personalDocumentReview?.[kind]??null):p.personalDocumentReview?.[kind]?{status:p.personalDocumentReview[kind].status,reason:p.personalDocumentReview[kind].reason,expiresAt:p.personalDocumentReview[kind].expiresAt}:null,...(staff?{url:p[kind+'Url']||null}:{})})),profile:{status:p.status,registrationStatus:p.registrationStatus,isActive:p.isActive,name:p.name||p.fullName||'',vehicleType:p.vehicleType||'',workRegionId:p.work_region_id||null,workRegionName:p.work_region_name||'',governorateName:p.governorate_name||''}};}
function fence(table,key,p,fields=criticalFields){const names={},values={},terms=[];fields.forEach((f,i)=>{names['#f'+i]=f;if(p?.[f]===undefined)terms.push('attribute_not_exists(#f'+i+')');else{values[':v'+i]=p[f];terms.push('#f'+i+'=:v'+i);}});return {ConditionCheck:{TableName:table,Key:key,ConditionExpression:terms.join(' AND '),ExpressionAttributeNames:names,...(Object.keys(values).length?{ExpressionAttributeValues:values}:{})}};}
function offlineCheck(table,driverId,live){
 if(live&&(live.isActive===true||live.isSearching===true||live.currentOrderId!=null||(live.activeOrdersCount??0)!==0||['busy','available'].includes(live.status)))fail('VEHICLE_CHANGE_REQUIRES_OFFLINE');
 return fence(table,{driverId},live||{},['driverId','status','isActive','isSearching','currentOrderId','activeOrdersCount']);
}
function inputVehicle(data,driverId,bucket){
 if(!data||Object.keys(data).some(k=>!['id','type','plateNumber','make','model','color','registrationUrl'].includes(k))||!id(data.id)||!validType(data.type)||!text(data.plateNumber,40)||!owns(data.registrationUrl,driverId,bucket))fail('VEHICLE_DATA_INVALID',400);
 for(const k of ['make','model','color'])if(data[k]!=null&&(typeof data[k]!=='string'||data[k].length>80))fail('VEHICLE_DATA_INVALID',400);
 return {id:data.id,type:data.type,plateNumber:data.plateNumber.trim(),make:(data.make||'').trim(),model:(data.model||'').trim(),color:(data.color||'').trim(),registrationUrl:data.registrationUrl};
}
async function operation(ctx,{driverId,actorId,staff=false,body}){
 const {db,GetCommand,TransactWriteCommand,driversTable,liveTable,bucket}=ctx;
 const p=(await db.send(new GetCommand({TableName:driversTable,Key:{driverId},ConsistentRead:true}))).Item;
 if(!p||p.isDeleted||p.deletedAt||p.deletionRequestId)fail('DRIVER_UNAVAILABLE',404);
 if(ctx.authorize)ctx.authorize(p);
 if(!body)return view(p,ctx.now?.()??Date.now(),staff);
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['action','expectedVersion','vehicle','vehicleId','decision','reason','expiryDate','noExpiry','documentKind'].includes(k)))fail('VEHICLE_REQUEST_INVALID',400);
 if(body.reason!==undefined&&!text(body.reason,1000))fail('VEHICLE_REVIEW_REASON_REQUIRED',400);
 const r=registry(p),now=ctx.now?.()??Date.now(),at=new Date(now).toISOString(),action=body.action;
 if(body.expectedVersion!==r.version)fail('VEHICLE_VERSION_CONFLICT');
 const driverActions=['ADD','UPDATE','SELECT','REMOVE','SELECT_DEFAULT'];const staffActions=['INITIALIZE','REVIEW','REVIEW_DOCUMENT','REVIEW_ACCOUNT'];
 if(!(staff?staffActions:driverActions).includes(action))fail('VEHICLE_ACTION_FORBIDDEN',403);
 const previous={activeId:r.activeId,vehicle:clone(r.items[body.vehicleId??body.vehicle?.id]??null),personalDocumentReview:clone(p.personalDocumentReview??null),accountStatus:p.status};
 const v=r.items[body.vehicleId];let personal=p.personalDocumentReview,canonical=null,needsOffline=false;
 if(action==='INITIALIZE'){if(p.vehicleRegistry!==undefined)fail('VEHICLE_ALREADY_INITIALIZED');if(body.vehicle){const data=inputVehicle(body.vehicle,driverId,bucket);if(data.id!=='legacy'||data.registrationUrl!==p.registrationPaperUrl)fail('VEHICLE_DATA_INVALID',400);r.items.legacy={...data,review:null,createdAt:at,legacy:true};}}
 if(action==='ADD'||action==='UPDATE'){
  const data=inputVehicle(body.vehicle,driverId,bucket),old=r.items[data.id];
  if(!data.registrationUrl.startsWith(`s3://${bucket}/drivers/${driverId}/vehicles/${data.id}/`))fail('DOCUMENT_VEHICLE_MISMATCH',400);
  if(action==='ADD'&&(old||Object.values(r.items).filter(x=>!x.removedAt).length>=MAX_VEHICLES||Object.keys(r.items).length>=60))fail('VEHICLE_LIMIT_OR_DUPLICATE');
  if(action==='UPDATE'&&(!old||old.removedAt))fail('VEHICLE_NOT_FOUND',404);
  if(Object.values(r.items).some(x=>x.id!==data.id&&!x.removedAt&&x.plateNumber.replace(/\s/g,'')===data.plateNumber.replace(/\s/g,'')))fail('VEHICLE_PLATE_ALREADY_REGISTERED');
  r.items[data.id]={...data,review:null,createdAt:old?.createdAt??at,updatedAt:at};needsOffline=action==='UPDATE'&&r.activeId===data.id;
 }
 if(['SELECT','REMOVE','REVIEW'].includes(action)&&(!v||v.removedAt))fail('VEHICLE_NOT_FOUND',404);
 if(action==='REMOVE'){needsOffline=true;v.removedAt=at;v.review={...v.review,status:'REMOVED'};if(r.activeId===v.id){r.activeId=null;canonical={vehicleType:null,vehiclePlate:null,registrationPaperUrl:null};}}
 if(action==='REVIEW'||action==='REVIEW_DOCUMENT'){
  if(!['APPROVED','REJECTED'].includes(body.decision)||!text(body.reason,1000))fail('VEHICLE_REVIEW_REASON_REQUIRED',400);
  const kind=body.documentKind;
  if(action==='REVIEW_DOCUMENT'&&!['drivingLicense','nationalId'].includes(kind))fail('DOCUMENT_KIND_INVALID',400);
  const url=action==='REVIEW'?v.registrationUrl:p[kind+'Url'];if(!owns(url,driverId,bucket))fail('DOCUMENT_OWNERSHIP_INVALID',400);
  if(action==='REVIEW'&&(!validType(v.type)||!text(v.plateNumber)))fail('VEHICLE_DATA_INCOMPLETE',400);
  const expiry=body.decision==='APPROVED'?expiresAt(body.expiryDate,body.noExpiry,body.reason):null;
  if(expiry!==null&&Date.parse(expiry)<=now)fail('DOCUMENT_ALREADY_EXPIRED',400);
  const review={status:body.decision,documentUrl:url,expiresAt:expiry,noExpiry:body.noExpiry===true,reason:body.reason.trim(),reviewedBy:actorId,reviewedAt:at};
  if(action==='REVIEW')v.review={...review,fingerprint:fingerprint(v)};else personal={...personal,[kind]:review};
 }
 if(action==='REVIEW_ACCOUNT'){
  if(!['APPROVED','SUSPENDED','REJECTED'].includes(body.decision)||!text(body.reason,1000))fail('ACCOUNT_REVIEW_INVALID',400);
  if(body.decision==='APPROVED'){
   if(p.isBanned!==undefined&&p.isBanned!==false)fail('DRIVER_ACCOUNT_NOT_APPROVED');
   const candidate=Object.values(r.items).find(v=>vehicleStatus(v,now)==='APPROVED');
   if(!candidate||!reviewValid(p.personalDocumentReview?.drivingLicense,p.drivingLicenseUrl,now)||!reviewValid(p.personalDocumentReview?.nationalId,p.nationalIdUrl,now))fail('ACCOUNT_DOCUMENTS_INCOMPLETE');
  }
  canonical={status:body.decision,registrationStatus:body.decision,isVerified:body.decision==='APPROVED',isActive:body.decision==='APPROVED',isSuspended:body.decision==='SUSPENDED'};
 }
 if(action==='SELECT'){
  needsOffline=true;const candidate={...p,vehicleRegistry:{...r,version:r.version||1,activeId:v.id},vehicleType:v.type,vehiclePlate:v.plateNumber,registrationPaperUrl:v.registrationUrl};
  const e=eligibility(candidate,now);if(!e.eligible)fail(e.code);
  r.activeId=v.id;canonical={vehicleType:v.type,vehiclePlate:v.plateNumber,registrationPaperUrl:v.registrationUrl};
 }
 // Establish the first/default vehicle, never switch an existing selection.
 // Approval is still required; account/documents/region gates remain independent.
 const remaining=Object.values(r.items).filter(x=>!x.removedAt);
 let defaultVehicleId=null;
 if((action==='SELECT_DEFAULT'||['REVIEW','REVIEW_ACCOUNT'].includes(action)&&body.decision==='APPROVED')&&r.activeId===null&&remaining.length===1&&vehicleStatus(remaining[0],now)==='APPROVED'){
  const only=remaining[0];r.activeId=only.id;defaultVehicleId=only.id;
  canonical={...canonical,vehicleType:only.type,vehiclePlate:only.plateNumber,registrationPaperUrl:only.registrationUrl};
 }
 if(action==='SELECT_DEFAULT'&&!defaultVehicleId)fail('VEHICLE_DEFAULT_NOT_APPLICABLE');
 const guards=[];
 if(needsOffline){const live=(await db.send(new GetCommand({TableName:liveTable,Key:{driverId},ConsistentRead:true}))).Item;guards.push(offlineCheck(liveTable,driverId,live));}
 r.version++;r.events=[...r.events,{id:ctx.id?.()??randomUUID(),action,defaultVehicleId,vehicleId:body.vehicleId??body.vehicle?.id??defaultVehicleId,documentKind:body.documentKind??null,actorId,staff,at,decision:body.decision??null,reason:body.reason??null,before:previous,after:{activeId:r.activeId,vehicle:clone(r.items[body.vehicleId??body.vehicle?.id]??null),personalDocumentReview:clone(personal??null),accountStatus:canonical?.status??p.status}}];
 if(Buffer.byteLength(JSON.stringify(r))>260000)fail('VEHICLE_HISTORY_CAPACITY_REQUIRES_ARCHIVE');
 const operational={schemaVersion:1,version:r.version,activeId:r.activeId,items:r.activeId&&r.items[r.activeId]?{[r.activeId]:r.items[r.activeId]}:{},events:[]};
 const guard=fence(driversTable,{driverId},p).ConditionCheck;
 const names={...guard.ExpressionAttributeNames,'#registry':'vehicleRegistry','#operational':'vehicleOperational','#updated':'updatedAt'},values={...guard.ExpressionAttributeValues,':registry':r,':operational':operational,':updated':at},sets=['#registry=:registry','#operational=:operational','#updated=:updated'];
 if(personal!==p.personalDocumentReview){names['#personal']='personalDocumentReview';values[':personal']=personal;sets.push('#personal=:personal');}
 if(canonical)for(const [k,val]of Object.entries(canonical)){names['#c'+k]=k;values[':c'+k]=val;sets.push('#c'+k+'=:c'+k);}
 const update={Update:{...guard,UpdateExpression:'SET '+sets.join(','),ExpressionAttributeNames:names,ExpressionAttributeValues:values}};
 const after={...p,vehicleRegistry:r,vehicleOperational:operational,personalDocumentReview:personal,...canonical,updatedAt:at};
 const ops=[...(ctx.lifecycleGuard?[ctx.lifecycleGuard]:[]),...(ctx.staffGuard?[ctx.staffGuard]:[]),...guards,update,...(ctx.audit?[ctx.audit('DRIVER_VEHICLE_'+action,{driverId,version:r.version-1},{driverId,version:r.version,vehicleId:body.vehicleId??body.vehicle?.id??null,decision:body.decision??null,reason:body.reason??null})]:[])];
 try{await db.send(new TransactWriteCommand({TransactItems:ops}));}catch(e){if(['TransactionCanceledException','ConditionalCheckFailedException'].includes(e.name))fail('VEHICLE_VERSION_CONFLICT');throw e;}
 return view(after,now,staff);
}
function reviewSummary(p,now=Date.now()){
 try{const r=registry(p),vehicles=Object.values(r.items).filter(v=>!v.removedAt);
 const pendingVehicles=vehicles.filter(v=>vehicleStatus(v,now)!=='APPROVED').length;
 const pendingDocuments=['drivingLicense','nationalId'].filter(k=>documentStatus(p.personalDocumentReview?.[k],p[k+'Url'],now)!=='APPROVED').length;
 return {initialReviewRequired:p.vehicleRegistry===undefined,pendingVehicles,pendingDocuments,pendingTotal:pendingVehicles+pendingDocuments};
 }catch{return {initialReviewRequired:true,pendingVehicles:0,pendingDocuments:0,pendingTotal:1};}
}
function enforce(p){return p?.vehicleRegistry!==undefined||p?.vehicleOperational!==undefined||process.env.DRIVER_VEHICLE_REGISTRY_ENFORCE==='true';}
module.exports={reviewSummary,documentStatus,enforce,criticalFields,MAX_VEHICLES,registry,initialRegistry,vehicleStatus,eligibility,view,operation,owns,expiresAt,reviewValid,fingerprint,fence};
