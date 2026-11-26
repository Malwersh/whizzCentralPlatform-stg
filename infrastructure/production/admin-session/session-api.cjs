'use strict';
const {effective}=require('../driver-review/catalog');
const audit=require('../driver-review/audit-trail');
const {randomUUID}=require('node:crypto');
const POOL='us-east-1_njh6vaNWj',CLIENT='7924qedsr5m1j1bvc3c7va8egk',TABLE='wizz-production-PlatformStaff';
const deny=(message,status=403)=>{throw Object.assign(Error(message),{status});};
const response=(statusCode,data)=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(data)});
function employeeDisplayName(profile, attributes){
 const attribute=name=>attributes?.find(item=>item.Name===name)?.Value?.trim();
 const staffName=profile.name?.trim();
 if(staffName && staffName!=='مالك منصة الإنتاج')return staffName;
 const fullName=[attribute('given_name'),attribute('family_name')].filter(Boolean).join(' ');
 return attribute('name')||fullName||attribute('preferred_username')||profile.email?.trim()||'حساب الإدارة';
}
// Limited to the caller's identity. No invitation, role change, finance or other employee access.
function createSessionApi({db,GetCommand,TransactWriteCommand,verifyAccessToken,liveIdentity,now=()=>Date.now()}){
 return async event=>{try{
  const finish=event.httpMethod==='POST'&&event.path==='/staff/enrollment/finish';
  if(!finish&&!(event.httpMethod==='GET'&&event.path==='/staff/me'))return response(404,{error:'NOT_FOUND'});
  let c;try{c=await verifyAccessToken((event.headers?.Authorization||event.headers?.authorization||'').replace(/^Bearer\s+/i,''));}catch{deny('UNAUTHORIZED',401);}
  if(c?.iss!==`https://cognito-idp.us-east-1.amazonaws.com/${POOL}`||c.client_id!==CLIENT||c.token_use!=='access'||!c.sub||!c.username||!Number.isFinite(c.exp)||c.exp*1000<=now()||!Number.isInteger(c.auth_time)||c.auth_time*1000>now())deny('UNAUTHORIZED',401);
  const p=(await db.send(new GetCommand({TableName:TABLE,Key:{pk:'EMPLOYEE#'+c.sub,sk:'PROFILE'},ConsistentRead:true}))).Item;
  if(!p||p.employeeId!==c.sub||!['ACTIVE','INVITED'].includes(p.status)||!Number.isSafeInteger(p.version)||(p.minimumAuthTime||0)>c.auth_time)deny('EMPLOYEE_INACTIVE');
  const live=await liveIdentity(c);
  if(!live?.Enabled||live.UserStatus!=='CONFIRMED'||live.UserAttributes?.find(a=>a.Name==='sub')?.Value!==c.sub)deny('EMPLOYEE_INACTIVE');
  const enrolled=live.UserMFASettingList?.includes('SOFTWARE_TOKEN_MFA')===true;
  // An invited employee can reach MFA enrollment, but receives no operational permissions.
  if(p.status==='INVITED'&&p.activationApproved!==true)deny('ACTIVATION_APPROVAL_REQUIRED');
  if(p.status==='ACTIVE'&&!enrolled)deny('ADMIN_MFA_REQUIRED');
  if(finish){
   if(!enrolled)deny('ADMIN_MFA_REQUIRED');
   if(p.status==='ACTIVE')return response(200,{ok:true});
   if(now()/1000-c.auth_time>300)deny('RECENT_AUTH_REQUIRED');
   const after={...p,status:'ACTIVE',version:p.version+1,mfaRequired:true,minimumAuthTime:Math.floor(now()/1000)+1};
   await db.send(new TransactWriteCommand({TransactItems:[{Update:{TableName:TABLE,Key:{pk:'EMPLOYEE#'+c.sub,sk:'PROFILE'},UpdateExpression:'SET #status=:active, version=:next, mfaRequired=:yes, minimumAuthTime=:floor',ConditionExpression:'employeeId=:id AND #status=:invited AND version=:version AND activationApproved=:yes',ExpressionAttributeNames:{'#status':'status'},ExpressionAttributeValues:{':id':c.sub,':active':'ACTIVE',':invited':'INVITED',':version':p.version,':next':after.version,':yes':true,':floor':after.minimumAuthTime}}},audit.write(TABLE,p,c.sub,'STAFF_ENROLLMENT_FINISHED',p,after,randomUUID())]}));
   return response(200,{ok:true,requiresNewLogin:true});
  }
  const employee={employeeId:p.employeeId,name:p.name||'',displayName:employeeDisplayName(p,live.UserAttributes),status:p.status,version:p.version,roles:p.status==='ACTIVE'?p.roles||[]:[],scope:p.scope||{allRegions:false,regionIds:[]},mfaRequired:true};
  return response(200,{employee,permissions:p.status==='ACTIVE'?effective(p):[],activationRequired:p.status==='INVITED',mfaEnrolled:enrolled,directWrite:{enabled:false,allowlisted:false}});
 }catch(e){if(['TransactionCanceledException','ConditionalCheckFailedException'].includes(e.name))return response(409,{error:'STATE_CHANGED'});return response(e.status||503,{error:e.status?e.message:'ADMIN_SESSION_UNAVAILABLE'});}};
}
module.exports={createSessionApi,POOL,CLIENT,TABLE};
