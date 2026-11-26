'use strict';
const {allowed}=require('../driver-review/catalog');
const audit=require('../driver-review/audit-trail');
const TABLE='wizz-production-PlatformStaff';
const fail=(code,status=403)=>{throw Object.assign(Error(code),{code,status});};
const response=(statusCode,data)=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(data)});
function createRegionApi({db,sdk,verifyAccessToken,liveIdentity,route,enabled=false,writesEnabled=false,readersReady=false,now=()=>Date.now()}){
 return async event=>{const savingDraft=event.httpMethod==='POST'&&event.path==='/staff/regions/manage/draft';try{
  if(!enabled)fail('REGION_MANAGEMENT_UNAVAILABLE',503);
  const method=event.httpMethod,path=event.path;
  const get=method==='GET'&&/^\/staff\/regions\/manage(?:\/(?:history|jobs)\/[A-Za-z0-9_-]{1,100})?$/.test(path||'');
  const post=method==='POST'&&/^\/staff\/regions\/manage\/(validate|validate-plan|draft|discard|cancel|publish)$/.test(path||'');
  if(!get&&!post)fail('NOT_FOUND',404);
  let claims;try{claims=await verifyAccessToken((event.headers?.Authorization||event.headers?.authorization||'').replace(/^Bearer\s+/i,''));}catch{fail('UNAUTHORIZED',401);}
  if(claims?.iss!=='https://cognito-idp.us-east-1.amazonaws.com/us-east-1_njh6vaNWj'||claims.client_id!=='7924qedsr5m1j1bvc3c7va8egk'||claims.token_use!=='access'||!claims.sub||!Number.isFinite(claims.exp)||claims.exp*1000<=now())fail('UNAUTHORIZED',401);
  const actor=(await db.send(new sdk.GetCommand({TableName:TABLE,Key:{pk:'EMPLOYEE#'+claims.sub,sk:'PROFILE'},ConsistentRead:true}))).Item;
  if(!actor||actor.employeeId!==claims.sub||actor.status!=='ACTIVE'||!Number.isSafeInteger(actor.version)||!Number.isInteger(claims.auth_time)||claims.auth_time>Math.floor(now()/1000)+30||(actor.minimumAuthTime||0)>claims.auth_time)fail('EMPLOYEE_INACTIVE');
  const live=await liveIdentity(claims);
  if(!live?.Enabled||live.UserStatus!=='CONFIRMED'||live.UserAttributes?.find(x=>x.Name==='sub')?.Value!==claims.sub||!live.UserMFASettingList?.includes('SOFTWARE_TOKEN_MFA'))fail('ADMIN_MFA_REQUIRED');
  if(!allowed(actor,'regions.read')||post&&!allowed(actor,'regions.edit'))fail('PERMISSION_REQUIRED');
  if(post&&!writesEnabled)fail('REGION_WRITES_DISABLED',503);
  if(path.endsWith('/publish')&&!readersReady)fail('REGION_READERS_NOT_READY',503);
  let input={};if(post){try{if(event.isBase64Encoded||typeof event.body!=='string'||Buffer.byteLength(event.body)>3500000)throw Error();input=JSON.parse(event.body);if(!input||typeof input!=='object'||Array.isArray(input))throw Error();}catch{fail('INVALID_BODY',400);}}
  const ctx={db,sdk,table:TABLE,allowed,now,
   guard(person){return {ConditionCheck:{TableName:TABLE,Key:{pk:'EMPLOYEE#'+person.employeeId,sk:'PROFILE'},ConditionExpression:'#v=:v AND #s=:s AND #r=:r AND #scope=:scope AND '+(person.minimumAuthTime===undefined?'attribute_not_exists(#auth)':'#auth=:auth'),ExpressionAttributeNames:{'#v':'version','#s':'status','#r':'roles','#scope':'scope','#auth':'minimumAuthTime'},ExpressionAttributeValues:{':v':person.version,':s':'ACTIVE',':r':person.roles,':scope':person.scope,...(person.minimumAuthTime===undefined?{}:{':auth':person.minimumAuthTime})}}};},
   audit:(id,action,before,after,request)=>audit.write(TABLE,actor,id,action,before,after,request)};
  const result=await route(ctx,actor,method,path,input);
  if(savingDraft)console.info('Region draft request',{status:200,outcome:'REGION_DRAFT_SAVED'});
  if(get&&path==='/staff/regions/manage'&&result.permissions){result.permissions.edit=result.permissions.edit&&writesEnabled;result.permissions.publish=result.permissions.publish&&writesEnabled&&readersReady;}
  return response(200,result);
 }catch(error){
  const conflict=['TransactionCanceledException','ConditionalCheckFailedException'].includes(error.name);
  const status=conflict?409:error.status||503;
  const code=conflict?'REGION_VERSION_CONFLICT':error.status?error.code||error.message:'REGION_MANAGEMENT_UNAVAILABLE';
  if(savingDraft)console.warn('Region draft request',{status,outcome:/^[A-Z][A-Z_0-9]{0,90}$/.test(code)?code:'UNEXPECTED_ERROR',errorType:status>=500&&/^[A-Za-z]{1,70}$/.test(error.name)?error.name:undefined});
  return response(status,{error:code});
 }};
}
module.exports={createRegionApi};
