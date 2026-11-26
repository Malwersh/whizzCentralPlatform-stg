'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createSessionApi,POOL,CLIENT}=require('./session-api.cjs');
class GetCommand{constructor(input){this.input=input;}}
const clock=1800000000000;
function fixture(overrides={}){
 const claims={iss:`https://cognito-idp.us-east-1.amazonaws.com/${POOL}`,client_id:CLIENT,token_use:'access',sub:'admin',username:'admin',exp:clock/1000+100,auth_time:clock/1000-30,...overrides.claims};
 const employee={employeeId:'admin',status:'ACTIVE',version:1,roles:['driver_reviewer'],scope:{allRegions:false,regionIds:['r1']},...overrides.employee};
 const live={Enabled:true,UserStatus:'CONFIRMED',UserAttributes:[{Name:'sub',Value:'admin'}],UserMFASettingList:['SOFTWARE_TOKEN_MFA'],...overrides.live};
 let reads=0;
 return {handler:createSessionApi({GetCommand,now:()=>clock,verifyAccessToken:async()=>{if(overrides.invalid)throw Error();return claims;},liveIdentity:async()=>live,db:{send:async c=>{reads++;assert.equal(c.input.ConsistentRead,true);assert.deepEqual(c.input.Key,{pk:'EMPLOYEE#admin',sk:'PROFILE'});return {Item:employee};}}}),reads:()=>reads};
}
const event={httpMethod:'GET',path:'/staff/me',headers:{Authorization:'Bearer test'}};
test('greeting name uses the employee profile or an account attribute instead of the bootstrap label',async()=>{
 for(const [name,attributes,expected] of [
  ['محمد العبيدي',[{Name:'name',Value:'اسم قديم'}],'محمد العبيدي'],
  ['مالك منصة الإنتاج',[{Name:'name',Value:'أحمد علي'}],'أحمد علي'],
  ['مالك منصة الإنتاج',[{Name:'given_name',Value:'أحمد'},{Name:'family_name',Value:'علي'}],'أحمد علي'],
  ['مالك منصة الإنتاج',[],'admin@example.invalid'],
 ]){
  const f=fixture({employee:{name,email:'admin@example.invalid'},live:{UserAttributes:[{Name:'sub',Value:'admin'},...attributes]}});
  const {employee}=JSON.parse((await f.handler(event)).body);
  assert.equal(employee.displayName,expected);
  assert.equal(employee.name,name);
 }
});
test('active scoped user receives current permissions, never direct writes or private fields',async()=>{const f=fixture({employee:{privateNote:'hidden'}}),r=await f.handler(event),b=JSON.parse(r.body);assert.equal(r.statusCode,200);assert.ok(b.permissions.includes('drivers.review'));assert.ok(!b.permissions.includes('finance.read'));assert.deepEqual(b.employee.scope.regionIds,['r1']);assert.equal(b.employee.privateNote,undefined);assert.equal(b.directWrite.enabled,false);assert.equal(r.headers['Cache-Control'],'no-store');});
for(const [name,change,status] of [
 ['invalid signature',{invalid:true},401],['different issuer',{claims:{iss:'other'}},401],['different client',{claims:{client_id:'other'}},401],['id token',{claims:{token_use:'id'}},401],['expired',{claims:{exp:clock/1000}},401],['future auth',{claims:{auth_time:clock/1000+1}},401],['revoked session',{employee:{minimumAuthTime:clock/1000}},403],['suspended',{employee:{status:'SUSPENDED'}},403],['wrong identity',{live:{UserAttributes:[{Name:'sub',Value:'other'}]}},403],['disabled user',{live:{Enabled:false}},403],['missing MFA',{live:{UserMFASettingList:[]}},403],['unapproved invitation',{employee:{status:'INVITED'}},403]
])test(name,async()=>assert.equal((await fixture(change).handler(event)).statusCode,status));
test('approved invitation sees enrollment only',async()=>{const r=await fixture({employee:{status:'INVITED',activationApproved:true},live:{UserMFASettingList:[]}}).handler(event),b=JSON.parse(r.body);assert.equal(r.statusCode,200);assert.equal(b.activationRequired,true);assert.deepEqual(b.permissions,[]);assert.deepEqual(b.employee.roles,[]);});
test('no arbitrary employee or write endpoint',async()=>{const f=fixture();assert.equal((await f.handler({...event,path:'/staff/other'})).statusCode,404);assert.equal((await f.handler({...event,httpMethod:'POST'})).statusCode,404);assert.equal(f.reads(),0);});
test('enrollment activation is atomic, audited and revokes the enrollment session',async()=>{
 class TransactWriteCommand{constructor(input){this.input=input;}}
 const p={employeeId:'admin',status:'INVITED',version:1,activationApproved:true,roles:['driver_reviewer'],scope:{allRegions:true,regionIds:[]}};let transaction;
 const h=createSessionApi({GetCommand,TransactWriteCommand,now:()=>clock,verifyAccessToken:async()=>({iss:`https://cognito-idp.us-east-1.amazonaws.com/${POOL}`,client_id:CLIENT,token_use:'access',sub:'admin',username:'admin',exp:clock/1000+60,auth_time:clock/1000-10}),liveIdentity:async()=>({Enabled:true,UserStatus:'CONFIRMED',UserAttributes:[{Name:'sub',Value:'admin'}],UserMFASettingList:['SOFTWARE_TOKEN_MFA']}),db:{send:async c=>{if(c instanceof GetCommand)return {Item:p};transaction=c.input;return {};}}});
 const r=await h({...event,httpMethod:'POST',path:'/staff/enrollment/finish'});assert.equal(r.statusCode,200);assert.equal(JSON.parse(r.body).requiresNewLogin,true);assert.equal(transaction.TransactItems.length,2);const update=transaction.TransactItems[0].Update;assert.equal(update.ExpressionAttributeValues[':floor'],clock/1000+1);assert.match(update.ConditionExpression,/activationApproved/);assert.match(update.ConditionExpression,/version/);assert.equal(transaction.TransactItems[1].Put.Item.action,'STAFF_ENROLLMENT_FINISHED');
});
test('activation requires MFA and a recent session',async()=>{
 const e={...event,httpMethod:'POST',path:'/staff/enrollment/finish'};
 assert.equal((await fixture({employee:{status:'INVITED',activationApproved:true},live:{UserMFASettingList:[]}}).handler(e)).statusCode,403);
 assert.equal((await fixture({employee:{status:'INVITED',activationApproved:true},claims:{auth_time:clock/1000-301}}).handler(e)).statusCode,403);
});
test('production runtime stays disabled before dependency initialization',async()=>{
 const saved={...process.env};try{process.env.ENVIRONMENT='production';process.env.ADMIN_SESSION_ENABLED='false';const r=await require('./index.cjs').handler(event);assert.equal(r.statusCode,503);}finally{process.env=saved;}
});
