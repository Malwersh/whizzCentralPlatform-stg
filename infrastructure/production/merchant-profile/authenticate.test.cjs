'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createAuthenticator,POOL,CLIENT}=require('./authenticate.cjs');
const sub='11111111-1111-4111-8111-111111111111',phone='+9647800868280';
const claims={iss:'https://cognito-idp.us-east-1.amazonaws.com/'+POOL,aud:CLIENT,sub,token_use:'id',exp:2000,iat:900,'cognito:username':'owner',phone_number:phone};
const user={Enabled:true,UserStatus:'CONFIRMED',UserAttributes:[{Name:'sub',Value:sub},{Name:'phone_number',Value:phone},{Name:'phone_number_verified',Value:'true'}]};
class Command{constructor(input){this.input=input;}}
function setup(c=claims,u=user){const calls=[];return {calls,event:{requestContext:{authorizer:{claims:c}}},auth:createAuthenticator({cognito:{send:async x=>{calls.push(x.input);return u;}},AdminGetUserCommand:Command,now:()=>1000})};}
test('reads live user from only the merchant production pool',async()=>{const s=setup();assert.equal((await s.auth(s.event)).sub,sub);assert.deepEqual(s.calls,[{UserPoolId:POOL,Username:'owner'}]);});
for(const [field,value]of [['iss','https://other'],['aud','other'],['token_use','access'],['exp',999],['exp','bad'],['iat',1100],['sub','other'],['cognito:username','']])test('rejects claims '+field,async()=>{const s=setup({...claims,[field]:value});await assert.rejects(s.auth(s.event),{code:'UNAUTHORIZED'});assert.equal(s.calls.length,0);});
for(const [name,mutate]of [['disabled',u=>u.Enabled=false],['unconfirmed',u=>u.UserStatus='UNCONFIRMED'],['subject changed',u=>u.UserAttributes[0].Value='other'],['phone changed',u=>u.UserAttributes[1].Value='+9647811111111'],['phone unverified',u=>u.UserAttributes[2].Value='false']])test('rejects live user '+name,async()=>{const u=structuredClone(user);mutate(u);const s=setup(claims,u);await assert.rejects(s.auth(s.event),{code:'UNAUTHORIZED'});});
test('disabled runtime does not load AWS clients or write data',async()=>{const old={...process.env};try{process.env.ENVIRONMENT='production';process.env.PROFILE_API_ENABLED='false';const r=await require('./index.cjs').handler({});assert.equal(r.statusCode,503);}finally{process.env=old;}});
