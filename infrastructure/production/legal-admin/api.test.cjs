'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createLegalApi}=require('./api.cjs');
class GetCommand{constructor(input){this.input=input;}}
const now=1800000000000;
const claims={iss:'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_njh6vaNWj',client_id:'7924qedsr5m1j1bvc3c7va8egk',token_use:'access',sub:'owner',exp:now/1000+600,auth_time:now/1000};
const actor={employeeId:'owner',status:'ACTIVE',version:2,scope:{allRegions:true}};
function setup(over={}){let calls=0;const api=createLegalApi({db:{send:async()=>({Item:actor})},GetCommand,verifyAccessToken:async()=>claims,liveIdentity:async()=>({Enabled:true,UserStatus:'CONFIRMED',UserAttributes:[{Name:'sub',Value:'owner'}],UserMFASettingList:['SOFTWARE_TOKEN_MFA']}),allowed:()=>true,route:async(ctx,a,m,p)=>{calls++;assert.equal(ctx.legalSelfPublication,true);assert.equal(ctx.legalSessionDraft,true);if(m==='POST'&&p.endsWith('/publish'))ctx.recent(ctx.claims);return {audience:p.split('/')[4]};},guard:()=>{},audit:()=>{},now:()=>now,...over});return {api,calls:()=>calls};}
const event={httpMethod:'GET',path:'/staff/settings/legal-documents/DRIVER',headers:{Authorization:'Bearer test'}};
for(const audience of ['CUSTOMER','DRIVER','MERCHANT'])test('explicit production audience '+audience,async()=>{const s=setup();assert.equal((await s.api({...event,path:event.path.replace('DRIVER',audience)})).statusCode,200);assert.equal(s.calls(),1);});
test('foreign staging issuer denied before source read',async()=>{const s=setup({verifyAccessToken:async()=>({...claims,iss:'staging'})});assert.equal((await s.api(event)).statusCode,401);assert.equal(s.calls(),0);});
test('revoked session denied',async()=>{const s=setup({db:{send:async()=>({Item:{...actor,minimumAuthTime:claims.auth_time+1}})}});assert.equal((await s.api(event)).statusCode,403);assert.equal(s.calls(),0);});
test('live MFA required',async()=>{const s=setup({liveIdentity:async()=>({Enabled:true,UserStatus:'CONFIRMED',UserMFASettingList:[]})});assert.equal((await s.api(event)).statusCode,403);});
test('regional employee cannot administer universal policies',async()=>{const s=setup({db:{send:async()=>({Item:{...actor,scope:{allRegions:false}}})}});assert.equal((await s.api(event)).statusCode,403);});
test('valid older session can read and save drafts but publication requires recent authentication',async()=>{const s=setup({verifyAccessToken:async()=>({...claims,auth_time:claims.auth_time-301})});assert.equal((await s.api(event)).statusCode,200);assert.equal((await s.api({...event,httpMethod:'POST',path:event.path+'/draft',body:'{}'})).statusCode,200);assert.equal((await s.api({...event,httpMethod:'POST',path:event.path+'/publish',body:'{}'})).statusCode,403);});
test('invalid body never reaches reused service',async()=>{const s=setup();assert.equal((await s.api({...event,httpMethod:'POST',body:'[]'})).statusCode,400);assert.equal(s.calls(),0);});
test('unscoped route unavailable',async()=>{const s=setup();assert.equal((await s.api({...event,path:'/staff/settings/legal-documents'})).statusCode,404);assert.equal(s.calls(),0);});
