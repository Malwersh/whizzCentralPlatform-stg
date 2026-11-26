"use strict";
const TABLE='wizz-production-PlatformStaff';
const fail=(code,status=403)=>{throw Object.assign(Error(code),{status});};
function createOnboardingApi({db,verifyAccessToken,liveIdentity,GetCommand,allowed,route,guard,audit,now=()=>Date.now()}){
 return async event=>{try{
 const path=event.path||'',method=event.httpMethod;
 if(!/^\/staff\/merchants\/onboarding(\/(initialize|save))?$/.test(path)||!['GET','POST'].includes(method))fail('NOT_FOUND',404);
 let claims;try{claims=await verifyAccessToken((event.headers?.Authorization||event.headers?.authorization||'').replace(/^Bearer\s+/i,''));}catch{fail('UNAUTHORIZED',401);}
 if(claims?.iss!=='https://cognito-idp.us-east-1.amazonaws.com/us-east-1_njh6vaNWj'||claims.client_id!=='7924qedsr5m1j1bvc3c7va8egk'||claims.token_use!=='access'||!claims.sub||!Number.isFinite(claims.exp)||claims.exp*1000<=now())fail('UNAUTHORIZED',401);
 const actor=(await db.send(new GetCommand({TableName:TABLE,Key:{pk:'EMPLOYEE#'+claims.sub,sk:'PROFILE'},ConsistentRead:true}))).Item;
 if(!actor||actor.employeeId!==claims.sub||actor.status!=='ACTIVE'||!Number.isSafeInteger(actor.version)||!Number.isInteger(claims.auth_time)||(actor.minimumAuthTime||0)>claims.auth_time)fail('EMPLOYEE_INACTIVE');
 const live=await liveIdentity(claims);
 if(!live?.Enabled||live.UserStatus!=='CONFIRMED'||live.UserAttributes?.find(x=>x.Name==='sub')?.Value!==claims.sub||!live.UserMFASettingList?.includes('SOFTWARE_TOKEN_MFA'))fail('ADMIN_MFA_REQUIRED');
 if(actor.scope?.allRegions!==true||!allowed(actor,'merchants.read'))fail('PERMISSION_REQUIRED');
 let input={};if(method==='POST'){if(typeof event.body!=='string'||Buffer.byteLength(event.body)>200000)fail('INVALID_BODY',400);try{input=JSON.parse(event.body);}catch{fail('INVALID_BODY',400);}if(!input||Array.isArray(input)||typeof input!=='object')fail('INVALID_BODY',400);}
 const result=await route({db,table:TABLE,allowed,guard:a=>guard(TABLE,a),audit:(id,action,before,after,key)=>audit(TABLE,actor,id,action,before,after,key)},actor,method,path,input);
 return response(200,result);
 }catch(e){console.error(JSON.stringify({event:'ONBOARDING_ADMIN_FAILURE',requestId:event.requestContext?.requestId,errorName:e.name,code:e.status?e.message:undefined,message:e.status?undefined:e.message}));if(['TransactionCanceledException','ConditionalCheckFailedException'].includes(e.name))return response(409,{error:'VERSION_OR_STATE_CONFLICT'});return response(e.status||503,{error:e.status?e.message:'ONBOARDING_ADMIN_UNAVAILABLE'});}};
}
function response(statusCode,data){return {statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(data)};}
module.exports={createOnboardingApi,TABLE};
