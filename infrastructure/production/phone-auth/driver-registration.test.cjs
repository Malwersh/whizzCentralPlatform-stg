'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'driver-registration.bundle.cjs'),'utf8');
test('driver production enrollment refuses missing gates and cross-environment bindings before I/O',async()=>{
 const valid={ENVIRONMENT:'production',USER_POOL_ID:'us-east-1_5sUT54eCB',OTP_TABLE:'wizz-production-DriverOtpSessions',DRIVER_TABLE:'wizz-production-Drivers',WALLETS_TABLE:'wizz-production-Wallets',OTP_SECRET_ARN:'arn:aws:secretsmanager:us-east-1:746727375268:secret:wizz/production/driver/otp-example',OTP_ENABLED:'true',WALLET_BINDING_READY:'true'};
 for(const key of Object.keys(valid)){
  let touched=false;const box={exports:{},process:{env:{...valid,[key]:'wrong'}},require(){touched=true;throw Error('Unexpected access');}};vm.runInNewContext(code,box);const r=await box.exports.handler({path:'/verify',body:'{}'});assert.equal(r.statusCode,503);assert.equal(touched,false);
 }
});

test('packaged verification waits for persisted wallet and fences login proof against deletion',async()=>{
 const {digest}=require('../../../../whizzDrivers-stg/backend/phone-auth/challenge-policy');
 for(const scenario of ['existing','create','creator-failure','closing','phone-closing','closing-at-proof']){
  const phone='+9647800000000',sub='34d8e408-1021-7076-6055-7325644f97cb';let wallet=scenario==='create'||scenario==='creator-failure'?null:{ownerId:sub,ownerType:'DRIVER',currency:'IQD',status:'ACTIVE',availableBalance:50000,lockedBalance:12000};
  const calls=[],kinds=['GetCommand','PutCommand','UpdateCommand','TransactWriteCommand','GetSecretValueCommand','ListUsersCommand','AdminCreateUserCommand','AdminSetUserPasswordCommand','AdminUpdateUserAttributesCommand','InvokeCommand'];
  const commands=Object.fromEntries(kinds.map(k=>[k,class{constructor(input){this.kind=k;this.input=input;}}]));
  const send=async c=>{calls.push(c);const i=c.input;
   if(c.kind==='GetSecretValueCommand')return {SecretString:JSON.stringify({hmacKey:'unit',apiKey:'unit'})};
   if(c.kind==='ListUsersCommand')return {Users:[{Username:phone,Enabled:true,UserStatus:'CONFIRMED',Attributes:[{Name:'sub',Value:sub},{Name:'phone_number_verified',Value:'true'}]}]};
   if(c.kind==='GetCommand'){
    if(i.Key.id==='session')return {Item:{id:'session',phone,username:phone,purpose:'registration-otp',used:false,attempts:0,expiresAt:Math.floor(Date.now()/1000)+300,digest:digest('unit','session',phone,'123456')}};
    if(i.Key.id==='ACTIVE#'+phone)return {Item:{sessionId:'session'}};
    if(i.TableName==='wizz-production-Drivers')return {Item:{driverId:sub}};
    if(i.TableName==='wizz-production-AccountDeletion')return ((scenario==='closing'&&i.Key.pk.startsWith('ACCOUNT_LIFECYCLE#'))||
      (scenario==='phone-closing'&&i.Key.pk.startsWith('DRIVER_PHONE_CLOSURE#')))?{Item:{state:'CLOSING'}}:{};
    if(i.TableName==='wizz-production-Wallets')return {Item:wallet};
   }
   if(c.kind==='InvokeCommand'){
    if(scenario==='creator-failure')return {StatusCode:200,FunctionError:'Unhandled'};
    wallet={ownerId:sub,ownerType:'DRIVER',currency:'IQD',status:'ACTIVE',availableBalance:0,lockedBalance:0};return {StatusCode:200};
   }
   if(c.kind==='TransactWriteCommand'&&i.TransactItems.some(x=>x.Put?.Item?.purpose==='login-proof')&&scenario==='closing-at-proof')throw Object.assign(Error('closed'),{name:'TransactionCanceledException'});
   return {};
  };
  const sdk={...commands,DynamoDBClient:class{},DynamoDBDocumentClient:{from:()=>({send})},SecretsManagerClient:class{send=send},CognitoIdentityProviderClient:class{send=send},LambdaClient:class{send=send}};
  const env={ENVIRONMENT:'production',USER_POOL_ID:'us-east-1_5sUT54eCB',OTP_TABLE:'wizz-production-DriverOtpSessions',DRIVER_TABLE:'wizz-production-Drivers',WALLETS_TABLE:'wizz-production-Wallets',OTP_SECRET_ARN:'arn:aws:secretsmanager:us-east-1:746727375268:secret:wizz/production/driver/otp-example',OTP_ENABLED:'true',WALLET_BINDING_READY:'true'};
  const box={exports:{},process:{env},require:n=>n.startsWith('@aws-sdk/')?sdk:require(n),Buffer,AbortSignal};vm.runInNewContext(code,box);
  const r=await box.exports.handler({path:'/auth/phone/verify',body:JSON.stringify({phone,sessionId:'session',code:'123456'})});
  assert.equal(r.statusCode,['existing','create'].includes(scenario)?200:scenario==='closing-at-proof'?429:['closing','phone-closing'].includes(scenario)?409:503,scenario);
  const proof=calls.find(c=>c.input.TransactItems?.some(x=>x.Put?.Item?.purpose==='login-proof'));
  if(['closing','phone-closing','creator-failure'].includes(scenario))assert.equal(proof,undefined);
  else assert.equal(proof.input.TransactItems[0].ConditionCheck.TableName,'wizz-production-AccountDeletion');
  if(scenario==='existing'){assert.equal(wallet.availableBalance,50000);assert.ok(!calls.some(c=>c.kind==='InvokeCommand'));}
  if(scenario==='phone-closing')assert.ok(!calls.some(c=>c.kind==='GetSecretValueCommand'||c.kind==='TransactWriteCommand'));
  assert.ok(!calls.some(c=>c.kind==='AdminCreateUserCommand'));
 }
});
