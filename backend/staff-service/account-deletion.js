'use strict';
const {randomUUID}=require('crypto');
const {GetCommand,QueryCommand,ScanCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const fail=(code,status=403)=>Object.assign(Error(code),{status});
const valid=v=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
async function route(c,actor,method,path,input){
 const {db,table,employee,guard,audit,requirePermission,recent,claims,enrolled}=c;
 if(method==='GET'&&path==='/staff/deletions/applications'){
  if(!c.allowed(actor,'audit.read')&&!c.allowed(actor,'finance.read'))throw fail('PERMISSION_REQUIRED');
  if(actor.scope?.allRegions!==true)throw fail('GLOBAL_SCOPE_REQUIRED');
  let cursor;const encoded=c.query?.cursor;if(encoded){try{if(encoded.length>2048)throw Error();cursor=JSON.parse(Buffer.from(encoded,'base64url').toString());if(Object.keys(cursor).length!==2||typeof cursor.pk!=='string'||typeof cursor.sk!=='string')throw Error();}catch(_){throw fail('INVALID_CURSOR',400);}}
  const r=await db.send(new ScanCommand({TableName:'staging-AccountDeletion',Limit:100,ConsistentRead:true,ExclusiveStartKey:cursor,FilterExpression:'begins_with(pk,:subject) AND begins_with(sk,:request)',ExpressionAttributeValues:{':subject':'SUBJECT#',':request':'REQUEST#'},ProjectionExpression:'requestId,actorType,#scope,#status,blockers,policyVersion,createdAt,updatedAt',ExpressionAttributeNames:{'#scope':'scope','#status':'status'}}));
  const items=(r.Items||[]).map(row=>Object.fromEntries(['requestId','actorType','scope','status','policyVersion','createdAt','updatedAt'].map(k=>[k,row[k]]).concat([['blockers',(row.blockers||[]).map(b=>Object.fromEntries(['code','count','amount','walletId','action'].filter(k=>b[k]!==undefined).map(k=>[k,b[k]])))]])));
  return {items,nextCursor:r.LastEvaluatedKey?Buffer.from(JSON.stringify(r.LastEvaluatedKey)).toString('base64url'):null};
 }
 if(method==='GET'&&path==='/staff/deletions'){requirePermission('staff.read');const r=await db.send(new QueryCommand({TableName:table,KeyConditionExpression:'pk = :pk',ExpressionAttributeValues:{':pk':'STAFF_DELETIONS'},ConsistentRead:true}));if(r.LastEvaluatedKey)throw fail('DELETION_JOBS_INCOMPLETE',503);return {items:r.Items||[]};}
 if(method!=='POST')throw fail('NOT_FOUND',404);
 recent(claims);if(!enrolled)throw fail('ENROLLMENT_REQUIRED');
 if(path==='/staff/deletions/request'){
  requirePermission('staff.change.request');
  if(!valid(input.employeeId)||input.employeeId===actor.employeeId)throw fail('SELF_CHANGE_FORBIDDEN');
  const target=await employee(input.employeeId);
  if(!target||target.roles.includes('bootstrap_admin'))throw fail('PROTECTED_ACCOUNT');
  if(!['SUSPENDED','PENDING','INVITED'].includes(target.status))throw fail('SUSPEND_BEFORE_DELETION',409);
  if(input.version!==target.version)throw fail('VERSION_CONFLICT',409);
  if(target.legalHold||target.retentionHold)throw fail('DOCUMENTED_RETENTION_HOLD',409);
  // Free text is intentionally not copied to the deletion job.
  const id=randomUUID(),job={pk:'STAFF_DELETIONS',sk:id,requestId:id,employeeId:target.employeeId,baseVersion:target.version,status:'PENDING_APPROVAL',requestedBy:actor.employeeId,requestedByVersion:actor.version,createdAt:new Date().toISOString(),expiresAt:Math.floor(Date.now()/1000)+3600};
  await db.send(new TransactWriteCommand({TransactItems:[guard(actor),{ConditionCheck:{TableName:table,Key:{pk:'EMPLOYEE#'+target.employeeId,sk:'PROFILE'},ConditionExpression:'#v = :v AND #s = :s',ExpressionAttributeNames:{'#v':'version','#s':'status'},ExpressionAttributeValues:{':v':target.version,':s':target.status}}},{Put:{TableName:table,Item:job,ConditionExpression:'attribute_not_exists(sk)'}},audit(actor.employeeId,'STAFF_DELETION_REQUESTED',null,{employeeId:target.employeeId,requestId:id},id)]}));return job;
 }
 if(path==='/staff/deletions/approve'){
  requirePermission('staff.change.approve');if(!valid(input.requestId))throw fail('INVALID_REQUEST',400);
  const {Item:job}=await db.send(new GetCommand({TableName:table,Key:{pk:'STAFF_DELETIONS',sk:input.requestId},ConsistentRead:true}));
  if(!job||job.status!=='PENDING_APPROVAL'||job.expiresAt<=Math.floor(Date.now()/1000))throw fail('REQUEST_NOT_PENDING',409);
  if([job.requestedBy,job.employeeId].includes(actor.employeeId))throw fail('SELF_APPROVAL_FORBIDDEN');
  const requester=await employee(job.requestedBy),target=await employee(job.employeeId);
  if(!c.allowed(requester,'staff.change.request')||requester.version!==job.requestedByVersion)throw fail('REQUESTER_PERMISSION_REVOKED');
  if(!target||target.roles.includes('bootstrap_admin')||target.version!==job.baseVersion||!['SUSPENDED','PENDING','INVITED'].includes(target.status)||target.legalHold||target.retentionHold)throw fail('TARGET_CHANGED_OR_HELD',409);
  const next={...target,status:'DELETING',roles:[],approvalLimit:0,version:target.version+1,deletionRequestId:job.requestId,minimumAuthTime:Math.floor(Date.now()/1000)+1};
  await db.send(new TransactWriteCommand({TransactItems:[guard(actor),guard(requester),{Put:{TableName:table,Item:next,ConditionExpression:'#v = :v AND #s = :s AND attribute_not_exists(deletionRequestId) AND (attribute_not_exists(legalHold) OR legalHold = :no) AND (attribute_not_exists(retentionHold) OR retentionHold = :no)',ExpressionAttributeNames:{'#v':'version','#s':'status'},ExpressionAttributeValues:{':v':target.version,':s':target.status,':no':false}}},{Put:{TableName:table,Item:{...job,status:'READY',approvedBy:actor.employeeId,approvedAt:new Date().toISOString()},ConditionExpression:'#s = :pending AND expiresAt > :now',ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':pending':'PENDING_APPROVAL',':now':Math.floor(Date.now()/1000)}}},audit(actor.employeeId,'STAFF_DELETION_APPROVED',null,{employeeId:target.employeeId,requestId:job.requestId},randomUUID())]}));return {requestId:job.requestId,status:'READY'};
 }
 throw fail('NOT_FOUND',404);
}
// Only identity snapshots for this employee are redacted. Accounting references
// remain stable; no ledger or financial amount is changed by this service.
function redact(value,id,related=false){
 if(Array.isArray(value))return value.map(v=>redact(v,id,related));
 if(!value||typeof value!=='object')return value;
 related=related||['employeeId','actorId','requestedBy','approvedBy','reviewedBy','updatedBy'].some(k=>value[k]===id);
 const out={};for(const [k,v]of Object.entries(value)){
  if(related&&['reason','rejectionReason','note','notes','comment','description'].includes(k))continue;
  if(value.employeeId===id&&['name','email','username','phone','phoneNumber','firstName','lastName','address','dateOfBirth','photoUrl','avatarUrl','identityUrl'].includes(k))continue;
  out[k]=redact(v,id,related);
 }return out;
}
module.exports={route,redact};
