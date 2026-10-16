'use strict';
const {GetCommand,QueryCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {randomUUID}=require('node:crypto');
const PK='OPERATIONAL_SETTINGS#ACCOUNT_DELETION';
const DEFAULTS={financialRetentionYears:7,locationRetentionDays:0,documentRetentionDays:0,supportRetentionDays:0};
const limits={financialRetentionYears:[1,30],locationRetentionDays:[0,365],documentRetentionDays:[0,365],supportRetentionDays:[0,365]};
const fail=(code,status=400)=>Object.assign(Error(code),{status});
function validate(values){
 if(!values||typeof values!=='object'||Array.isArray(values)||Object.keys(values).length!==Object.keys(limits).length)throw fail('INVALID_SETTINGS');
 for(const [field,[min,max]]of Object.entries(limits))if(!Number.isSafeInteger(values[field])||values[field]<min||values[field]>max)throw fail('INVALID_SETTINGS');
 return {...values};
}
async function route(ctx,actor,method,path,input){
 const {db,table,employee,guard,audit,requirePermission,recent,claims}=ctx;
 if(method==='POST'&&!ctx.enrolled)throw fail('ENROLLMENT_REQUIRED',403);
 const can=(person,action)=>ctx.allowed(person,action==='read'?'settings.read':'settings.change.'+action)||ctx.allowed(person,action==='read'?'finance.read':'finance.settings.'+action);
 const requireAction=action=>{if(!can(actor,action))throw fail('PERMISSION_REQUIRED',403);};
 const read=async sk=>(await db.send(new GetCommand({TableName:table,Key:{pk:PK,sk},ConsistentRead:true}))).Item;
 if(method==='GET'&&path==='/staff/settings/account-deletion'){
  requireAction('read');const current=await read('CURRENT');if(!current)throw fail('SETTINGS_NOT_INITIALIZED',503);
  return {current,limits,canRequest:can(actor,'request'),canApprove:can(actor,'approve')};
 }
 if(method==='GET'&&path==='/staff/settings/account-deletion/changes'){
  requireAction('read');const items=[];let cursor;
  do{const r=await db.send(new QueryCommand({TableName:table,KeyConditionExpression:'pk = :pk AND begins_with(sk,:prefix)',ExpressionAttributeValues:{':pk':PK,':prefix':'CHANGE#'},ExclusiveStartKey:cursor,ConsistentRead:true}));items.push(...r.Items||[]);cursor=r.LastEvaluatedKey;if(items.length>1000)throw fail('SETTINGS_HISTORY_TOO_LARGE',503);}while(cursor);return {items};
 }
 if(method==='POST'&&path==='/staff/settings/account-deletion/request'){
  requireAction('request');recent(claims);
  const values=validate(input.values);if(typeof input.reason!=='string'||input.reason.trim().length<5||input.reason.length>300)throw fail('REASON_REQUIRED');
  const current=await read('CURRENT');if(!current||input.baseVersion!==current.version)throw fail('VERSION_OR_STATE_CONFLICT',409);
  const id=randomUUID(),now=new Date().toISOString(),change={pk:PK,sk:'CHANGE#'+id,changeId:id,status:'PENDING',requestedBy:actor.employeeId,baseVersion:current.version,values,reason:input.reason.trim(),createdAt:now,expiresAt:Math.floor(Date.now()/1000)+86400};
  await db.send(new TransactWriteCommand({TransactItems:[guard(actor),{ConditionCheck:{TableName:table,Key:{pk:PK,sk:'CURRENT'},ConditionExpression:'#v = :v',ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':v':current.version}}},{Put:{TableName:table,Item:change,ConditionExpression:'attribute_not_exists(sk)'}},audit(actor.employeeId,'DELETION_SETTINGS_REQUESTED',current,change,id)]}));return {changeId:id,status:'PENDING'};
 }
 if(method==='POST'&&['/staff/settings/account-deletion/approve','/staff/settings/account-deletion/reject'].includes(path)){
  requireAction('approve');recent(claims);
  if(typeof input.changeId!=='string'||!/^[a-f0-9-]{36}$/.test(input.changeId))throw fail('INVALID_CHANGE');
  const change=await read('CHANGE#'+input.changeId);
  if(!change||change.status!=='PENDING'||change.expiresAt<=Math.floor(Date.now()/1000))throw fail('CHANGE_NOT_PENDING',409);
  if(change.requestedBy===actor.employeeId)throw fail('SELF_APPROVAL_FORBIDDEN',403);
  const requester=await employee(change.requestedBy);if(!requester||!can(requester,'request'))throw fail('REQUESTER_PERMISSION_REVOKED',403);
  const current=await read('CURRENT');if(!current||current.version!==change.baseVersion)throw fail('VERSION_OR_STATE_CONFLICT',409);
  const approve=path.endsWith('/approve'),now=new Date().toISOString();
  if(!approve&&(typeof input.reason!=='string'||input.reason.trim().length<5||input.reason.length>300))throw fail('REASON_REQUIRED');
  const next={pk:PK,sk:'CURRENT',version:current.version+1,policyVersion:randomUUID(),values:validate(change.values),approvedBy:actor.employeeId,requestedBy:requester.employeeId,approvedAt:now,effectiveFor:'NEW_REQUESTS',refundMethods:['WALLET_TRANSFER','MANUAL_ZAIN_CASH'],mandatoryWaitingDays:0};
  const result={...change,status:approve?'APPROVED':'REJECTED',reviewedBy:actor.employeeId,reviewedAt:now,...(!approve?{rejectionReason:input.reason.trim()}:{policyVersion:next.policyVersion})};
  const tx=[guard(actor),guard(requester),{Put:{TableName:table,Item:result,ConditionExpression:'#s = :pending',ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':pending':'PENDING'}}}];
  if(approve)tx.push({Put:{TableName:table,Item:next,ConditionExpression:'#v = :v',ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':v':current.version}}},{Put:{TableName:table,Item:{...next,sk:'VERSION#'+next.policyVersion},ConditionExpression:'attribute_not_exists(sk)'}});
  tx.push(audit(actor.employeeId,approve?'DELETION_SETTINGS_APPROVED':'DELETION_SETTINGS_REJECTED',current,result,change.changeId));
  await db.send(new TransactWriteCommand({TransactItems:tx}));return {changeId:change.changeId,status:result.status,...(approve?{current:next}:{})};
 }
 throw fail('NOT_FOUND',404);
}
module.exports={route,validate,DEFAULTS,PK};
