'use strict';
const {createHash,randomUUID}=require('node:crypto');
const devices=require('./branch_devices');
const B='WhizzMerchants_Businesses',T='staging-MerchantPlatform';
const fields=['acceptingOrders','onlineStatus','operatingStatus','lastStatusUpdate','ordersPausedUntil','orderPauseId'];
const project=b=>Object.fromEntries(fields.filter(k=>b[k]!==undefined).map(k=>[k,b[k]]));
const revision=b=>createHash('sha256').update(JSON.stringify(project(b))).digest('hex');
const fail=(code,status=403)=>{throw Object.assign(Error(code),{status});};
async function execute(db,{b,d,s,m,authorization,common},input){
 const write=input.action==='set_status';
 const allowed=write?['action','acceptingOrders','baseRevision']:['action'];
 if(Object.keys(input).some(k=>!allowed.includes(k)))fail('INVALID_STATUS_REQUEST',400);
 if(write&&(!authorization?.permissions.includes('branch.status.write')))fail('PERMISSION_REQUIRED');
 if(!write&&!(authorization?.permissions.includes('branch.read')||!authorization))fail('PERMISSION_REQUIRED');
 const view=()=>({businessId:b.businessId,...project(b),acceptingOrders:b.acceptingOrders===true,revision:revision(b)});
 if(!write){await devices.tx(db,common);return view();}
 if(typeof input.acceptingOrders!=='boolean'||typeof input.baseRevision!=='string')fail('INVALID_STATUS_REQUEST',400);
 if(input.baseRevision!==revision(b))fail('VERSION_OR_STATE_CONFLICT',409);
 const accepting=input.acceptingOrders;
 if(accepting&&!(b.isActive===true&&(!b.onboardingSchemaVersion||b.onboardingComplete===true)&&b.platformSuspended!==true&&b.ordersBlocked!==true))fail('BRANCH_NOT_READY',409);
 const now=new Date().toISOString(),names={'#review':'status'},values={':owner':b.ownerId,':approved':b.status,':accepting':accepting,':online':accepting?'online':'offline',':operating':accepting?'AVAILABLE':'OFFLINE',':now':now,':actor':s.subjectId,':source':'branch_employee'};
 let condition='ownerId=:owner AND cognitoUserId=:owner AND #review=:approved AND attribute_not_exists(deletionRequestId)';
 // Fence every status field, including legacy owner writes that do not bump a version.
 for(const [i,key] of fields.entries()){
  const name='#before'+i;names[name]=key;
  if(b[key]===undefined)condition+=' AND attribute_not_exists('+name+')';
  else {const value=':before'+i;values[value]=b[key];condition+=' AND '+name+'='+value;}
 }
 if(accepting){condition+=' AND isActive=:yes AND (attribute_not_exists(onboardingSchemaVersion) OR onboardingComplete=:yes) AND (attribute_not_exists(platformSuspended) OR platformSuspended=:no) AND (attribute_not_exists(ordersBlocked) OR ordersBlocked=:no)';values[':yes']=true;values[':no']=false;}
 const after={acceptingOrders:accepting,onlineStatus:accepting?'online':'offline',operatingStatus:accepting?'AVAILABLE':'OFFLINE',lastStatusUpdate:now};
 const audit={pk:'BRANCH#'+b.businessId,sk:'STAFF_AUDIT#OPERATIONS#'+now+'#'+randomUUID(),businessId:b.businessId,ownerId:b.ownerId,actorId:s.subjectId,actorName:m.displayName||'',roleName:m.grant?.roleNameAr||m.role,deviceId:d.deviceId,sessionId:s.sessionId,permissionVersion:m.version,policyVersion:authorization.policy.version,action:'BRANCH_STATUS_CHANGED',entityId:b.businessId,result:'SUCCEEDED',createdAt:now,before:project(b),after};
 // DynamoDB forbids checking and updating the same item. Merge branch ownership,
 // readiness and status fences into the update; keep all other canonical fences.
 const guards=common.filter(op=>!(op.ConditionCheck?.TableName===B&&op.ConditionCheck?.Key.businessId===b.businessId));
 await devices.tx(db,[...guards,{Update:{TableName:B,Key:{businessId:b.businessId},UpdateExpression:'SET acceptingOrders=:accepting, onlineStatus=:online, operatingStatus=:operating, lastStatusUpdate=:now, statusUpdatedBy=:actor, statusSource=:source REMOVE ordersPausedUntil, orderPauseId',ConditionExpression:condition,ExpressionAttributeNames:names,ExpressionAttributeValues:values}},{Put:{TableName:T,Item:audit,ConditionExpression:'attribute_not_exists(pk)'}}]);
 return {businessId:b.businessId,...after,revision:revision(after)};
}
module.exports={execute,revision};
