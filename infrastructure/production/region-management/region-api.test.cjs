const {test}=require('node:test'),assert=require('node:assert/strict');
const {createRegionApi}=require('./region-api.cjs');
function fixture(options={}){
 let called=0,context;const now=1800000000000;
 const claims={iss:'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_njh6vaNWj',client_id:'7924qedsr5m1j1bvc3c7va8egk',token_use:'access',sub:'owner',exp:now/1000+3600,auth_time:now/1000};
 const actor={employeeId:'owner',status:'ACTIVE',version:2,roles:['region_manager'],scope:{allRegions:true,regionIds:[]}};
 const live={Enabled:true,UserStatus:'CONFIRMED',UserAttributes:[{Name:'sub',Value:'owner'}],UserMFASettingList:['SOFTWARE_TOKEN_MFA']};
 class GetCommand{constructor(input){this.input=input;}}
 const handler=createRegionApi({enabled:true,db:{send:async()=>({Item:actor})},sdk:{GetCommand},verifyAccessToken:async()=>claims,liveIdentity:async()=>live,now:()=>now,route:async ctx=>{called++;context=ctx;return {permissions:{edit:true,publish:true}};},...options});
 return {claims,actor,live,handler,get called(){return called;},get context(){return context;}};
}
const event={httpMethod:'GET',path:'/staff/regions/manage',headers:{Authorization:'Bearer example'}};
for(const [name,change,status]of [
 ['foreign pool',f=>f.claims.iss='staging',401],['expired token',f=>f.claims.exp=1,401],['revoked session',f=>f.actor.minimumAuthTime=f.claims.auth_time+1,403],['inactive staff',f=>f.actor.status='SUSPENDED',403],['missing MFA',f=>f.live.UserMFASettingList=[],403],['missing role',f=>f.actor.roles=['driver_manager'],403]])test(name,async()=>{const f=fixture();change(f);assert.equal((await f.handler(event)).statusCode,status);assert.equal(f.called,0);});
test('read-only capabilities cannot suggest enabled writes',async()=>{const f=fixture();const r=await f.handler(event);assert.equal(r.statusCode,200);assert.deepEqual(JSON.parse(r.body).permissions,{edit:false,publish:false});});
test('writes disabled by default',async()=>{const f=fixture();assert.equal((await f.handler({...event,httpMethod:'POST',path:event.path+'/draft',body:'{}'})).statusCode,503);assert.equal(f.called,0);});
test('publish requires ready readers',async()=>{const f=fixture({writesEnabled:true});assert.equal((await f.handler({...event,httpMethod:'POST',path:event.path+'/publish',body:'{}'})).statusCode,503);assert.equal(f.called,0);});
test('malformed input does not reach engine',async()=>{const f=fixture({writesEnabled:true});assert.equal((await f.handler({...event,httpMethod:'POST',path:event.path+'/draft',body:'[]'})).statusCode,400);assert.equal(f.called,0);});
test('transaction guard preserves identity version roles scope and auth fence',async()=>{const f=fixture();await f.handler(event);const g=f.context.guard(f.actor).ConditionCheck;assert.equal(g.TableName,'wizz-production-PlatformStaff');assert.ok(g.ConditionExpression.includes('attribute_not_exists(#auth)'));assert.deepEqual(g.ExpressionAttributeValues[':r'],['region_manager']);});
test('publication accepts a current session and rejects expiry or revocation',async()=>{
 const f=fixture({writesEnabled:true,readersReady:true});
 const publish={...event,httpMethod:'POST',path:event.path+'/publish',body:'{}'};
 f.claims.auth_time-=1800;
 assert.equal((await f.handler(publish)).statusCode,200);
 assert.equal(f.called,1);
 f.actor.minimumAuthTime=f.claims.auth_time+1;
 assert.equal((await f.handler(publish)).statusCode,403);
 f.claims.exp=1;
 assert.equal((await f.handler(publish)).statusCode,401);
 assert.equal(f.called,1);
});
