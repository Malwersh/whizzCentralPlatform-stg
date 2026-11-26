'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createOnboardingApi}=require('./api.cjs');
class GetCommand{constructor(input){this.input=input;}}
const now=1800000000000;
const claims={iss:'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_njh6vaNWj',client_id:'7924qedsr5m1j1bvc3c7va8egk',token_use:'access',sub:'owner',exp:now/1000+600,auth_time:now/1000};
const actor={employeeId:'owner',status:'ACTIVE',version:2,scope:{allRegions:true}};
function setup(over={}){let calls=0;const api=createOnboardingApi({db:{send:async()=>({Item:actor})},GetCommand,verifyAccessToken:async()=>claims,liveIdentity:async()=>({Enabled:true,UserStatus:'CONFIRMED',UserAttributes:[{Name:'sub',Value:'owner'}],UserMFASettingList:['SOFTWARE_TOKEN_MFA']}),allowed:()=>true,route:async(ctx,a,m,p)=>{calls++;if(m==='POST'&&p.endsWith('/publish'))ctx.recent(ctx.claims);return {ok:true};},guard:()=>{},audit:()=>{},now:()=>now,...over});return {api,calls:()=>calls};}
const event={httpMethod:'GET',path:'/staff/merchants/onboarding',headers:{Authorization:'Bearer test'}};

test('authenticated global administrator can read configuration',async()=>{const s=setup();assert.equal((await s.api(event)).statusCode,200);assert.equal(s.calls(),1);});
test('foreign issuer denied before service',async()=>{const s=setup({verifyAccessToken:async()=>({...claims,iss:'staging'})});assert.equal((await s.api(event)).statusCode,401);assert.equal(s.calls(),0);});
test('revoked employee denied',async()=>{const s=setup({db:{send:async()=>({Item:{...actor,minimumAuthTime:claims.auth_time+1}})}});assert.equal((await s.api(event)).statusCode,403);});
test('live MFA required',async()=>{const s=setup({liveIdentity:async()=>({Enabled:true,UserStatus:'CONFIRMED',UserMFASettingList:[]})});assert.equal((await s.api(event)).statusCode,403);});
test('regional employee cannot edit onboarding policy',async()=>{const s=setup({db:{send:async()=>({Item:{...actor,scope:{allRegions:false}}})}});assert.equal((await s.api(event)).statusCode,403);});
test('valid session does not require repeated login',async()=>{const s=setup({verifyAccessToken:async()=>({...claims,auth_time:claims.auth_time-3600})});assert.equal((await s.api({...event,httpMethod:'POST',path:event.path+'/save',body:'{}'})).statusCode,200);});
test('unknown routes and invalid body rejected',async()=>{const s=setup();assert.equal((await s.api({...event,path:'/staff/merchants/other'})).statusCode,404);assert.equal((await s.api({...event,httpMethod:'POST',body:'[]'})).statusCode,400);assert.equal(s.calls(),0);});
