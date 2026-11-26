'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'customer-registration.bundle.cjs'),'utf8');
const valid={ENVIRONMENT:'production',USER_POOL_ID:'us-east-1_rNtNKVsVf',CLIENT_ID:'3e8p0ouglrprpd0a3pc91du0hg',OTP_TABLE:'wizz-production-CustomerPhoneAuth',USERS_TABLE:'wizz-production-Customers',DELETION_TABLE:'wizz-production-AccountDeletion',WALLETS_TABLE:'wizz-production-Wallets',LEGAL_SETTINGS_TABLE:'wizz-production-PlatformStaff',OTP_SECRET_ARN:'arn:aws:secretsmanager:us-east-1:746727375268:secret:wizz/production/customer/otp-example',OTP_ENABLED:'true'};
async function blocked(env){let io=0;const ctx={exports:{},process:{env},require(){io++;throw Error('Unexpected module access');}};vm.runInNewContext(code,ctx);const r=await ctx.exports.handler({path:'/verify',body:'{}'});assert.equal(r.statusCode,503);assert.equal(JSON.parse(r.body).code,'PRODUCTION_REGISTRATION_UNAVAILABLE');assert.equal(io,0);}
test('inactive registration refuses requests before loading AWS clients',async()=>blocked({...valid,OTP_ENABLED:'false'}));
test('every pool, client and table binding is validated before enrollment',async()=>{for(const key of Object.keys(valid).filter(k=>k!=='OTP_ENABLED'))await blocked({...valid,[key]:'wrong-resource'});});
test('test-code bypass configuration cannot activate production enrollment',async()=>{await blocked({...valid,REVIEW_TEST_PHONE:'+9647800000000'});await blocked({...valid,REVIEW_TEST_CODE:'123456'});});
test('production bundle preserves existing funded wallet and blocks account deletion',async()=>{
 for(const closing of [null,'subject','phone','phone-race']){
  const calls=[];const phone='+9647800000000';const {digest}=require('../../../../wizzuser-stg/backend/phone-auth/challenge-policy');
  const {customerPhoneClosureKey}=require('../../../backend/account-deletion/customer-phone-binding');
  const phoneKey=customerPhoneClosureKey(phone);
  const kinds=['GetCommand','PutCommand','QueryCommand','UpdateCommand','TransactWriteCommand','GetSecretValueCommand','ListUsersCommand','AdminCreateUserCommand','AdminSetUserPasswordCommand','AdminInitiateAuthCommand','AdminRespondToAuthChallengeCommand'];
  const commands=Object.fromEntries(kinds.map(k=>[k,class{constructor(input){this.kind=k;this.input=input;}}]));
  const send=async c=>{calls.push(c);const i=c.input;
   if(c.kind==='GetSecretValueCommand')return {SecretString:JSON.stringify({hmacKey:'unit-only',apiKey:'unit-only'})};
   if(c.kind==='ListUsersCommand')return {Users:[{Username:phone,Enabled:true,UserStatus:'CONFIRMED',Attributes:[{Name:'sub',Value:'subject'},{Name:'phone_number_verified',Value:'true'},{Name:'phone_number',Value:phone}]}]};
   if(c.kind==='GetCommand'){
    if(i.Key.id==='session')return {Item:{id:'session',phone,username:phone,purpose:'customer-phone-otp',used:false,attempts:0,expiresAt:Math.floor(Date.now()/1000)+300,digest:digest('unit-only','session',phone,'123456')}};
    if(i.Key.id==='ACTIVE#'+phone)return {Item:{sessionId:'session'}};
    if(i.TableName===valid.USERS_TABLE)return {Item:{userId:'subject',cognitoSub:'subject',cognitoUsername:phone,isActive:true,phone}};
    if(i.TableName===valid.DELETION_TABLE)return (closing==='phone'&&i.Key.pk===phoneKey.pk||
     closing==='subject'&&i.Key.pk==='ACCOUNT_LIFECYCLE#CUSTOMER#subject')?{Item:{state:'CLOSING'}}:{};
    if(i.TableName===valid.WALLETS_TABLE)return {Item:{ownerId:'subject',status:'ACTIVE',availableBalance:50000,lockedBalance:1000}};
    return {};
   }
   if(closing==='phone-race'&&c.kind==='TransactWriteCommand'&&i.TransactItems.some(x=>x.ConditionCheck?.Key.pk===phoneKey.pk))
    throw Object.assign(Error('condition'),{name:'TransactionCanceledException'});
   if(c.kind==='AdminInitiateAuthCommand')return {ChallengeName:'CUSTOM_CHALLENGE',Session:'proof-session'};
   if(c.kind==='AdminRespondToAuthChallengeCommand')return {AuthenticationResult:{AccessToken:'test-access',RefreshToken:'test-refresh'}};
   return {};
  };
  const sdk={...commands,DynamoDBClient:class{},DynamoDBDocumentClient:{from:()=>({send})},SecretsManagerClient:class{send=send},CognitoIdentityProviderClient:class{send=send}};
  const ctx={exports:{},process:{env:valid},require:n=>n.startsWith('@aws-sdk/')?sdk:require(n),console:{error(){}},Buffer,AbortSignal};vm.runInNewContext(code,ctx);
  const result=await ctx.exports.handler({path:'/auth/phone/verify',body:JSON.stringify({phone,sessionId:'session',code:'123456'})});assert.equal(result.statusCode,closing==='phone-race'?429:closing?409:200);
  assert.ok(!calls.some(c=>c.kind==='AdminCreateUserCommand'));
  assert.ok(!calls.some(c=>c.input.TableName===valid.WALLETS_TABLE&&c.kind!=='GetCommand'));
  assert.ok(!calls.some(c=>c.kind==='TransactWriteCommand'&&c.input.TransactItems.some(x=>x.Put?.TableName===valid.WALLETS_TABLE)));
  if(closing)assert.ok(!calls.some(c=>c.kind==='AdminInitiateAuthCommand'));
  if(closing==='phone')assert.ok(!calls.some(c=>c.kind==='ListUsersCommand'));
  if(closing==='phone-race'||closing===null)assert.ok(calls.some(c=>c.kind==='TransactWriteCommand'&&c.input.TransactItems.some(x=>x.ConditionCheck?.Key.pk===phoneKey.pk)));
 }
});
