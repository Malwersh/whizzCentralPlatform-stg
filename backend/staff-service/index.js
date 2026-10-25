'use strict';
const workflow=require('./write-workflow');const direct=()=>workflow.direct?.()===true;
const {randomUUID}=require('crypto');
const {DynamoDBClient}=require('@aws-sdk/client-dynamodb');
const {DynamoDBDocumentClient,GetCommand,ScanCommand,DeleteCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {CognitoIdentityProviderClient,AdminGetUserCommand,AdminUserGlobalSignOutCommand}=require('@aws-sdk/client-cognito-identity-provider');
const {CognitoJwtVerifier}=require('aws-jwt-verify');
const invitations=require('./invitations');
const driverRoutes=require('./drivers');
const settingsRoutes=require('./operational-settings');
const deletionRoutes=require('./account-deletion');
const onboardingPolicy=require('./onboarding-policy');
const {ROLES,LABELS,effective,allowed,validateAssignment}=require('./catalog');
const db=DynamoDBDocumentClient.from(new DynamoDBClient({}),{marshallOptions:{removeUndefinedValues:true}}),cognito=new CognitoIdentityProviderClient({});
const table=process.env.STAFF_TABLE;
const verifier=CognitoJwtVerifier.create({userPoolId:process.env.USER_POOL_ID,clientId:process.env.CLIENT_ID,tokenUse:'access'});
const validId=id=>typeof id==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id);
const key=id=>({pk:'EMPLOYEE#'+id,sk:'PROFILE'});
const response=(statusCode,data)=>({statusCode,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':process.env.FRONTEND_ORIGIN},body:JSON.stringify(data)});
const fail=(code,status=403)=>Object.assign(Error(code),{status});
async function employee(id){return (await db.send(new GetCommand({TableName:table,Key:key(id),ConsistentRead:true}))).Item;}
async function validateRegions(assignment){for(const regionId of assignment.scope.regionIds){const {Item}=await db.send(new GetCommand({TableName:process.env.REGIONS_TABLE,Key:{regionId},ConsistentRead:true,ProjectionExpression:'regionId'}));if(!Item)throw fail('UNKNOWN_REGION',400);}}
function recent(claims){const age=Math.floor(Date.now()/1000)-claims.auth_time;if(!Number.isInteger(claims.auth_time)||age< -30||(age>300&&!(process.env.PLATFORM_ENVIRONMENT==='staging'&&process.env.PLATFORM_SESSION_POLICY==='VALID_SESSION')))throw fail('REAUTH_REQUIRED');}
function guard(person){return {ConditionCheck:{TableName:table,Key:key(person.employeeId),ConditionExpression:'#v = :v AND #s = :active',ExpressionAttributeNames:{'#v':'version','#s':'status'},ExpressionAttributeValues:{':v':person.version,':active':'ACTIVE'}}};}
function audit(actor,action,before,after,id){return {Put:{TableName:table,Item:{pk:'AUDIT',sk:new Date().toISOString()+'#'+id,actorId:actor,action,before,after},ConditionExpression:'attribute_not_exists(sk)'}};}
async function handler(event){
 if(event?.action==='commercial_notice_tick'&&!event.httpMethod&&!event.requestContext)return require('./commercial-notices').tick({db});
 if(event?.action==='merchant_device_payout')return require('./merchant-device-payouts').handle({db,enabled:process.env.SETTLEMENT_SCHEDULE_ADMIN_ENABLED==='true'},event);
 if(event?.action==='settlement_schedule_owner')return require('./commercial-owner').handle({db,cognito,table,enabled:process.env.SETTLEMENT_SCHEDULE_ADMIN_ENABLED==='true'},event);
 if(event?.action==='commercial_owner')return require('./commercial-owner').handle({db,cognito,table,audit,enabled:process.env.COMMERCIAL_ADMIN_ENABLED==='true',deliveryFundingEnabled:process.env.DELIVERY_FUNDING_MANAGEMENT_ENABLED==='true'},event);
 try{
  if(((event.httpMethod==='GET'&&['/staff/public/home-slideshow','/staff/public/home-offer'].includes(event.path))||(event.httpMethod==='POST'&&event.path==='/staff/public/slideshow-events')))return response(200,await require('./home-slideshow').publicFeed({db,table},event));
  const token=(event.headers?.Authorization||event.headers?.authorization||'').replace(/^Bearer\s+/i,'');let claims;
  try{claims=await verifier.verify(token);}catch(_){return response(401,{error:'UNAUTHORIZED'});}
  const actor=await employee(claims.sub);if(!actor||actor.employeeId!==claims.sub||['DELETING','DELETED'].includes(actor.status))throw fail('EMPLOYEE_INACTIVE');
  const live=await cognito.send(new AdminGetUserCommand({UserPoolId:process.env.USER_POOL_ID,Username:claims.username}));if(!live.Enabled||live.UserAttributes?.find(a=>a.Name==='sub')?.Value!==claims.sub)throw fail('EMPLOYEE_INACTIVE');
  const enrolled=live.UserMFASettingList?.includes('SOFTWARE_TOKEN_MFA')===true;
  if(event.httpMethod==='POST'&&event.path==='/staff/enrollment/finish'){
   if(actor.status==='ACTIVE')return response(200,{active:true});
   if(actor.status!=='INVITED'||actor.activationApproved!==true||!enrolled||live.UserStatus!=='CONFIRMED')throw fail('ENROLLMENT_REQUIRED');
   const next={...actor,status:'ACTIVE',version:actor.version+1,minimumAuthTime:Math.floor(Date.now()/1000)+1,activatedAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
   await db.send(new TransactWriteCommand({TransactItems:[{Put:{TableName:table,Item:next,ConditionExpression:'#v = :v AND #s = :invited AND activationApproved = :approved',ExpressionAttributeNames:{'#v':'version','#s':'status'},ExpressionAttributeValues:{':v':actor.version,':invited':'INVITED',':approved':true}}},audit(actor.employeeId,'STAFF_ACTIVATED',actor,next,randomUUID())]}));
   return response(200,{active:true,requiresNewLogin:true});
  }
  if(event.httpMethod==='GET'&&event.path==='/staff/me'&&actor.status==='INVITED')return response(200,{employee:actor,permissions:[],activationRequired:true});
  if(actor.status!=='ACTIVE')throw fail('EMPLOYEE_INACTIVE');
  if(actor.mfaRequired&&!enrolled)throw fail('ENROLLMENT_REQUIRED');
  if((actor.minimumAuthTime||0)>(claims.auth_time||0))throw fail('REAUTH_REQUIRED');
  const method=event.httpMethod,path=event.path;const requirePermission=p=>{if(!allowed(actor,p))throw fail('PERMISSION_REQUIRED');};
  if(method==='GET'&&path==='/staff/me')return response(200,{employee:actor,permissions:effective(actor),directWrite:direct()});
  if(method==='GET'&&path==='/staff/regions'){requirePermission('staff.read');let items=[],cursor,pages=0;do{const result=await db.send(new ScanCommand({TableName:process.env.REGIONS_TABLE,ExclusiveStartKey:cursor,Limit:100,ProjectionExpression:'regionId, #n, name_ar, parent_id, #l',ExpressionAttributeNames:{'#n':'name','#l':'level'}}));items.push(...(result.Items||[]));cursor=result.LastEvaluatedKey;if(++pages>100)throw fail('REGIONS_INCOMPLETE',503);}while(cursor);return response(200,{items});}
  if(method==='GET'&&path==='/staff/catalog'){requirePermission('staff.read');return response(200,{roles:Object.keys(ROLES).filter(r=>r!=='bootstrap_admin').map(id=>({id,label:LABELS[id],permissions:ROLES[id]}))});}
  if(method==='GET'&&(path==='/staff/employees'||path==='/staff/changes'||path==='/staff/audit')){
   requirePermission(path==='/staff/audit'?'audit.read':'staff.read');const prefix=path==='/staff/employees'?'EMPLOYEE#':path==='/staff/changes'?'CHANGE#':'AUDIT';
   let cursor;if(event.queryStringParameters?.cursor){try{if(event.queryStringParameters.cursor.length>2048)throw Error();cursor=JSON.parse(Buffer.from(event.queryStringParameters.cursor,'base64url').toString());if(typeof cursor.pk!=='string'||typeof cursor.sk!=='string'||Object.keys(cursor).length!==2)throw Error();}catch(_){throw fail('INVALID_CURSOR',400);}}
   const result=await db.send(new ScanCommand({TableName:table,Limit:100,ExclusiveStartKey:cursor,FilterExpression:'begins_with(pk, :prefix)',ExpressionAttributeValues:{':prefix':prefix}}));
   return response(200,{items:result.Items||[],nextCursor:result.LastEvaluatedKey?Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64url'):null});
  }
  if(method==='GET'&&path.startsWith('/staff/drivers'))return response(200,await driverRoutes.route({db,driversTable:process.env.DRIVERS_TABLE,regionsTable:process.env.REGIONS_TABLE,derivedTable:process.env.DERIVED_REGIONS_TABLE},actor,method,path));
  let input;try{input=JSON.parse(event.body||'{}');if(!input||typeof input!=='object'||Array.isArray(input))throw Error();}catch(_){throw fail('INVALID_BODY',400);}
  if(path==='/staff/offers'||path.startsWith('/staff/offers/'))return response(200,await require('./offers').route({db,table,guard,audit,query:event.queryStringParameters},actor,method,path,input));
  if(path.startsWith('/staff/settings/return-operations'))return response(200,await require('./return-operations-settings').route({settingsRoute:settingsRoutes.route,db,table,employee,guard,audit,enrolled,recent,claims,allowed},actor,method,path,input));
  if(path==='/staff/company-accounts')return response(200,await require('./company-accounts').route({db,table,employee,guard,audit,enrolled,recent,claims,allowed,query:event.queryStringParameters,deadline:Date.now()+22000},actor,method,path,input));
  if(path==='/staff/pickup-issues')return response(200,await require('./pickup-issue-workflow').route({db,guard,audit,enrolled,recent,claims,allowed},actor,method,method==='GET'?event.queryStringParameters||{}:input));
  if(path==='/staff/customer-benefit-compensation')return response(200,await require('./customer-benefit-compensation').route({db,guard,audit,enrolled,recent,claims},actor,method,method==='GET'?event.queryStringParameters||{}:input));
  if(path==='/staff/cancellation-compensation')return response(200,await require('./cancellation-compensation').route({allowed,enrolled,recent,claims,query:event.queryStringParameters,accessToken:token},actor,method,path,input));
  if(path==='/staff/order-management')return response(200,await require('./order-management').route({db,allowed,enrolled,recent,claims,query:event.queryStringParameters,accessToken:token},actor,method,path,input));
  if(path==='/staff/order-exceptions'||path.startsWith('/staff/order-exceptions/'))return response(200,await require('./order-exception-cases').route({db,table,employee,guard,audit,enrolled,recent,claims,allowed,query:event.queryStringParameters,accessToken:token},actor,method,path,input));
  if(path==='/staff/dispatch-reviews'||path.startsWith('/staff/dispatch-reviews/')){const rollout=require('./finance-rollout').createFinanceRollout({db});return response(200,await require('./dispatch-reviews').route({...require('./dispatch-reviews').reviewAccess({db,rollout}),table,employee,guard,audit,enrolled,recent,claims,query:event.queryStringParameters},actor,method,path,input));}
  if(path==='/staff/slideshow'||path.startsWith('/staff/slideshow/'))return response(200,await require('./home-slideshow').route({db,table,guard,audit},actor,method,path,input));
  if(path==='/staff/benefits')return response(200,await require('./platform-benefits').route({db,table,guard,audit,enrolled,recent,claims},actor,method,method==='GET'?event.queryStringParameters||{}:input));
  if(path==='/staff/promotions')return response(200,await require('./promotions').route({db,guard,audit,enrolled},actor,method,method==='GET'?event.queryStringParameters||{}:input));
  if(path==='/staff/settlement-schedules/branches')return response(200,await require('./settlement-schedules').branches({db,claims,enrolled,enabled:process.env.SETTLEMENT_SCHEDULE_ADMIN_ENABLED==='true'},actor,method,event.queryStringParameters||{}));
  if(path==='/staff/settlement-schedules')return response(200,await require('./settlement-schedules').staff({db,claims,enrolled,enabled:process.env.SETTLEMENT_SCHEDULE_ADMIN_ENABLED==='true'},actor,method,method==='GET'?event.queryStringParameters||{}:input));
  if(path==='/staff/commercial')return response(200,await require('./commercial-management').service({db,table,employee,guard,audit,enrolled,recent,claims,enabled:process.env.COMMERCIAL_ADMIN_ENABLED==='true',deliveryFundingEnabled:process.env.DELIVERY_FUNDING_MANAGEMENT_ENABLED==='true'},{kind:'STAFF',actor},method,method==='GET'?event.queryStringParameters||{}:input));
  if(path==='/staff/pricing/cash-rounding'||path.startsWith('/staff/pricing/cash-rounding/'))return response(200,await require('./cash-rounding').route({db,table,guard,audit,enrolled,recent,claims},actor,method,path,input));
  if(path==='/staff/pricing'||path.startsWith('/staff/pricing/'))return response(200,await require('./delivery-pricing').route({db,table,employee,guard,audit,enrolled,recent,claims,query:event.queryStringParameters},actor,method,path,input));
  if(path==='/staff/merchants/staff-policy'||path.startsWith('/staff/merchants/staff-policy/'))return response(200,await require('./merchant-staff-policy').route({db,table,guard,audit,enrolled,recent,claims,query:event.queryStringParameters},actor,method,path,input));
  if(path==='/staff/merchants/changes')return response(200,await require('./merchant-changes').route({db,table,guard,audit},actor,method,input));
  if(path==='/staff/merchants/control')return response(200,await require('./merchant-control').route({db,table,guard,audit},actor,method,input));
  if(path.startsWith('/staff/merchants/'))return response(200,await require('./merchant-onboarding').route({db,table,guard,audit,query:event.queryStringParameters},actor,method,path,input));
  if(path==='/staff/deletions'||path.startsWith('/staff/deletions/'))return response(200,await deletionRoutes.route({db,table,employee,guard,audit,requirePermission,recent,claims,enrolled,allowed,query:event.queryStringParameters},actor,method,path,input));
  if(path==='/staff/settings/onboarding'||path.startsWith('/staff/settings/onboarding/'))return response(200,await settingsRoutes.route({db,table,employee,guard,audit,requirePermission,recent,claims,allowed,enrolled,settingsSpec:{pk:'OPERATIONAL_SETTINGS#MERCHANT_ONBOARDING',validate:onboardingPolicy.validate,actionPrefix:'ONBOARDING',directSave:true}},actor,method,path.replace('/staff/settings/onboarding','/staff/settings/account-deletion'),input));
  if(path==='/staff/settings/delivery-operations'||path.startsWith('/staff/settings/delivery-operations/'))return response(200,await require('./dispatch-settings').route({db,table,employee,guard,audit,requirePermission,recent,claims,allowed,enrolled},actor,method,path,input));
  if(path==='/staff/settings/notification-sounds'||path.startsWith('/staff/settings/notification-sounds/'))return response(200,await require('./notification-settings-contract').route({db,table,employee,guard,audit,requirePermission,recent,claims,allowed,enrolled},actor,method,path,input));
  if(path.startsWith('/staff/settings/'))return response(200,await settingsRoutes.route({db,table,employee,guard,audit,requirePermission,recent,claims,allowed,enrolled},actor,method,path,input));
  if(method==='POST'&&path==='/staff/drivers/edit')return response(200,await driverRoutes.route({db,driversTable:process.env.DRIVERS_TABLE,regionsTable:process.env.REGIONS_TABLE,derivedTable:process.env.DERIVED_REGIONS_TABLE,guard,audit,id:randomUUID},actor,method,path,input));
  const invitationContext={db,cognito,table,pool:process.env.USER_POOL_ID,guard,audit,validateRegions};
  if(method==='POST'&&path==='/staff/invitations'){
   requirePermission('staff.invite');requirePermission('staff.change.request');recent(claims);if(!enrolled)throw fail('ENROLLMENT_REQUIRED');
   return response(201,await invitations.create(invitationContext,actor,input));
  }
  if(method==='POST'&&path==='/staff/invitations/send'){
   requirePermission('staff.invite');recent(claims);if(!enrolled)throw fail('ENROLLMENT_REQUIRED');
   if(!validId(input.employeeId))throw fail('INVALID_EMPLOYEE_ID',400);
   const target=await employee(input.employeeId);if(!target)throw fail('EMPLOYEE_NOT_FOUND',404);
   return response(200,await invitations.send(invitationContext,actor,target));
  }
  if(method==='POST'&&path==='/staff/changes'){
   requirePermission('staff.change.request');recent(claims);
   if(!validId(input.employeeId))throw fail('INVALID_EMPLOYEE_ID',400);
   if(input.employeeId===actor.employeeId)throw fail('SELF_CHANGE_FORBIDDEN');
   const target=await employee(input.employeeId);if(!target)throw fail('EMPLOYEE_NOT_FOUND',404);if(target.roles.includes('bootstrap_admin'))throw fail('BOOTSTRAP_ACCOUNT_PROTECTED');if(['DELETING','DELETED'].includes(target.status))throw fail('EMPLOYEE_INACTIVE');
   if(!Number.isInteger(input.version)||input.version!==target.version)throw fail('VERSION_CONFLICT',409);
   let assignment;try{assignment=validateAssignment(input);}catch(e){throw fail(e.message,400);}
   await validateRegions(assignment);
   if(typeof input.reason!=='string'||input.reason.trim().length<5||input.reason.length>300)throw fail('REASON_REQUIRED',400);
   const id=randomUUID(),now=new Date().toISOString(),change={pk:'CHANGE#'+id,sk:'META',changeId:id,employeeId:target.employeeId,baseVersion:target.version,requestedBy:actor.employeeId,requestedByVersion:actor.version,status:'PENDING',assignment,reason:input.reason.trim(),createdAt:now,expiresAt:Math.floor(Date.now()/1000)+3600};
   if(direct()){
    const next={...target,...assignment,...(!target.activatedAt&&target.mfaRequired&&assignment.status==='ACTIVE'?{status:'INVITED',activationApproved:true,mfaRequired:true}:{}),version:target.version+1,minimumAuthTime:Math.floor(Date.now()/1000)+1,updatedAt:now,updatedBy:actor.employeeId};
    const revocation={pk:'REVOCATIONS',sk:id,employeeId:target.employeeId,username:target.username,createdAt:now};
    await db.send(new TransactWriteCommand({TransactItems:[guard(actor),{Put:{TableName:table,Item:next,ConditionExpression:'#v=:v',ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':v':target.version}}},{Put:{TableName:table,Item:revocation,ConditionExpression:'attribute_not_exists(sk)'}},audit(actor.employeeId,'STAFF_ASSIGNMENT_SAVED',target,next,id)]}));
    let sessionsRevoked=true;try{await cognito.send(new AdminUserGlobalSignOutCommand({UserPoolId:process.env.USER_POOL_ID,Username:target.username}));await db.send(new DeleteCommand({TableName:table,Key:{pk:revocation.pk,sk:revocation.sk}}));}catch(_){sessionsRevoked=false;}
    return response(200,{employee:next,sessionsRevoked,status:'SAVED'});
   }
   await db.send(new TransactWriteCommand({TransactItems:[guard(actor),{ConditionCheck:{TableName:table,Key:key(target.employeeId),ConditionExpression:'#v = :v',ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':v':target.version}}},{Put:{TableName:table,Item:change,ConditionExpression:'attribute_not_exists(pk)'}},audit(actor.employeeId,'STAFF_CHANGE_REQUESTED',target,change,id)]}));return response(201,change);
  }
  if(method==='POST'&&path==='/staff/changes/approve'){
   requirePermission('staff.change.approve');recent(claims);if(!validId(input.changeId))throw fail('INVALID_CHANGE_ID',400);const {Item:change}=await db.send(new GetCommand({TableName:table,Key:{pk:'CHANGE#'+input.changeId,sk:'META'},ConsistentRead:true}));
   if(!change||change.status!=='PENDING'||change.expiresAt<=Math.floor(Date.now()/1000))throw fail('CHANGE_NOT_PENDING',409);
   if(!direct()&&(change.requestedBy===actor.employeeId||change.employeeId===actor.employeeId))throw fail('SELF_APPROVAL_FORBIDDEN');
   const requester=await employee(change.requestedBy);if(!allowed(requester,'staff.change.request')||requester.version!==change.requestedByVersion)throw fail('REQUESTER_PERMISSION_REVOKED');
   const target=await employee(change.employeeId);if(!target||target.roles.includes('bootstrap_admin')||['DELETING','DELETED'].includes(target.status))throw fail('PROTECTED_ACCOUNT');
   const assignment=validateAssignment(change.assignment);await validateRegions(assignment);const revocation={pk:'REVOCATIONS',sk:change.changeId,employeeId:target.employeeId,username:target.username,createdAt:new Date().toISOString()};const next={...target,...assignment,...(!target.activatedAt&&target.mfaRequired&&assignment.status==='ACTIVE'?{status:'INVITED',activationApproved:true,mfaRequired:true}:{}),version:target.version+1,updatedAt:new Date().toISOString(),updatedBy:actor.employeeId};
   await db.send(new TransactWriteCommand({TransactItems:[guard(actor),...(requester.employeeId===actor.employeeId?[]:[guard(requester)]),{Put:{TableName:table,Item:next,ConditionExpression:'#v = :v',ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':v':change.baseVersion}}},{Update:{TableName:table,Key:{pk:change.pk,sk:change.sk},UpdateExpression:'SET #s = :approved, approvedBy = :actor',ConditionExpression:'#s = :pending AND expiresAt > :now',ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':approved':'APPROVED',':pending':'PENDING',':actor':actor.employeeId,':now':Math.floor(Date.now()/1000)}}},{Put:{TableName:table,Item:revocation,ConditionExpression:'attribute_not_exists(sk)'}},audit(actor.employeeId,'STAFF_CHANGE_APPROVED',target,next,change.changeId)]}));
   let sessionsRevoked=true;try{await cognito.send(new AdminUserGlobalSignOutCommand({UserPoolId:process.env.USER_POOL_ID,Username:target.username}));await db.send(new DeleteCommand({TableName:table,Key:{pk:revocation.pk,sk:revocation.sk}}));}catch(_){sessionsRevoked=false;}
   return response(200,{employee:next,sessionsRevoked});
  }
  if(method==='POST'&&path==='/staff/changes/reject'){
   requirePermission('staff.change.approve');recent(claims);
   if(!validId(input.changeId)||typeof input.reason!=='string'||input.reason.trim().length<5||input.reason.length>300)throw fail('INVALID_REJECTION',400);
   const {Item:change}=await db.send(new GetCommand({TableName:table,Key:{pk:'CHANGE#'+input.changeId,sk:'META'},ConsistentRead:true}));
   if(!change||change.status!=='PENDING')throw fail('CHANGE_NOT_PENDING',409);
   if(!direct()&&(change.requestedBy===actor.employeeId||change.employeeId===actor.employeeId))throw fail('SELF_APPROVAL_FORBIDDEN');
   await db.send(new TransactWriteCommand({TransactItems:[guard(actor),{Update:{TableName:table,Key:{pk:change.pk,sk:change.sk},UpdateExpression:'SET #s = :rejected, reviewedBy = :actor, rejectionReason = :reason',ConditionExpression:'#s = :pending',ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':rejected':'REJECTED',':pending':'PENDING',':actor':actor.employeeId,':reason':input.reason.trim()}}},audit(actor.employeeId,'STAFF_CHANGE_REJECTED',change,{reason:input.reason.trim()},change.changeId)]}));
   return response(200,{changeId:change.changeId,status:'REJECTED'});
  }
  return response(404,{error:'NOT_FOUND'});
 }catch(e){if(e.name==='TransactionCanceledException')e=fail('VERSION_OR_STATE_CONFLICT',409);console.warn('Staff API request failed',{code:e.message,status:e.status});return response(e.status||500,{error:e.status?e.message:'INTERNAL_ERROR'});}
}
module.exports={handler};
