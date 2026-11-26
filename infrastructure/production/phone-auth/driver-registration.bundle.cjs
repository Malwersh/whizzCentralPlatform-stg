'use strict';
const nativeRequire=require;const factories={
"registration":function(module,exports,require){
const {requireWallet,lifecycleCondition,phoneClosureCondition,checkPhoneOpen}=require('./driver-enrollment-gates');
'use strict';
const crypto=require('node:crypto');
const {DynamoDBClient}=require('@aws-sdk/client-dynamodb');
const {DynamoDBDocumentClient,GetCommand,PutCommand,UpdateCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {SecretsManagerClient,GetSecretValueCommand}=require('@aws-sdk/client-secrets-manager');
const {CognitoIdentityProviderClient,ListUsersCommand,AdminCreateUserCommand,AdminSetUserPasswordCommand,AdminUpdateUserAttributesCommand}=require('@aws-sdk/client-cognito-identity-provider');
const {LambdaClient,InvokeCommand}=require('@aws-sdk/client-lambda');
const lambda=new LambdaClient({});
const {normalizeIraqiPhone}=require('./iraqi-phone');
const {digest,matches}=require('./challenge-policy');
const {newProof}=require('./login-proof');
const db=DynamoDBDocumentClient.from(new DynamoDBClient({}));
const cognito=new CognitoIdentityProviderClient({});
const secrets=new SecretsManagerClient({});
const table=process.env.OTP_TABLE,pool=process.env.USER_POOL_ID;
const now=()=>Math.floor(Date.now()/1000);
const reply=(statusCode,body)=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(body)});
async function config(){const r=await secrets.send(new GetSecretValueCommand({SecretId:process.env.OTP_SECRET_ARN}));const v=JSON.parse(r.SecretString);if(!v.apiKey||!v.hmacKey)throw new Error('Configuration');return v;}
async function send(phone,ip,key){
 const time=now(),day=Math.floor(time/86400);
 const limits=[{id:`COOLDOWN#${phone}`,cooldown:true},{id:`DAILY#${day}#${phone}`,limit:10},{id:`IP#${day}#${crypto.createHash('sha256').update(ip).digest('hex')}`,limit:30},{id:`GLOBAL#${day}`,limit:200}];
 await db.send(new TransactWriteCommand({TransactItems:[phoneClosureCondition(phone),...limits.map(x=>({Update:{TableName:table,Key:{id:x.id},
 UpdateExpression:x.cooldown?'SET nextAllowedAt = :next, expiresAt = :ttl':'SET expiresAt = :ttl ADD sends :one',
 ConditionExpression:x.cooldown?'attribute_not_exists(nextAllowedAt) OR nextAllowedAt <= :now':'attribute_not_exists(sends) OR sends < :limit',
 ExpressionAttributeValues:x.cooldown?{':next':time+60,':ttl':time+86400,':now':time}:{':ttl':time+172800,':one':1,':limit':x.limit}}}))]}));
 const id=crypto.randomUUID(),code=String(crypto.randomInt(0,1000000)).padStart(6,'0');
 const item={id,phone,username:phone,purpose:'registration-otp',expiresAt:time+300,attempts:0,used:false,digest:digest(key.hmacKey,id,phone,code)};
 await db.send(new TransactWriteCommand({TransactItems:[phoneClosureCondition(phone),{Put:{TableName:table,Item:item,ConditionExpression:'attribute_not_exists(id)'}},{Put:{TableName:table,Item:{id:`ACTIVE#${phone}`,sessionId:id,expiresAt:time+300}}}]}));
 const response=await fetch('https://api.otpiq.com/api/sms',{method:'POST',headers:{Authorization:`Bearer ${key.apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({phoneNumber:phone.slice(1),smsType:'verification',provider:'whatsapp-telegram-sms',verificationCode:code}),signal:AbortSignal.timeout(10000)});
 if(!response.ok)return reply(503,{message:'تعذر إرسال رمز التحقق، حاول لاحقًا'});
 return reply(200,{sessionId:id,expiresIn:300,resendAfter:60});
}
async function resolveUser(phone){
 const result=await cognito.send(new ListUsersCommand({UserPoolId:pool,Filter:`phone_number = "${phone}"`,Limit:60}));
 if(result.PaginationToken || result.Users.length>1)throw new Error('RecoveryRequired');
 if(result.Users.length){
  const user=result.Users[0];
  const verified=user.Attributes.some(a=>a.Name==='phone_number_verified'&&a.Value==='true');
  if (!user.Enabled) throw new Error('RecoveryRequired');
  if (user.UserStatus==='UNCONFIRMED') {
    const sub=user.Attributes.find(a=>a.Name==='sub')?.Value;
    if(!sub || user.Attributes.some(a=>a.Name==='email_verified'&&a.Value==='true')) throw new Error('RecoveryRequired');
    const [profile,wallet]=await Promise.all([
      db.send(new GetCommand({TableName:process.env.DRIVER_TABLE,Key:{driverId:sub},ConsistentRead:true})),
      db.send(new GetCommand({TableName:process.env.WALLETS_TABLE,Key:{walletId:`WALLET#DRIVER#${sub}`,sk:'META'},ConsistentRead:true}))
    ]);
    if(profile.Item || wallet.Item)throw new Error('RecoveryRequired');
    // Reclaim only an abandoned signup, after the caller proved phone ownership.
    // Setting a permanent password confirms Cognito without granting driver approval.
    await cognito.send(new AdminUpdateUserAttributesCommand({UserPoolId:pool,Username:user.Username,UserAttributes:[{Name:'phone_number_verified',Value:'true'}]}));
    await cognito.send(new AdminSetUserPasswordCommand({UserPoolId:pool,Username:user.Username,Password:`Aa1!${crypto.randomBytes(48).toString('hex')}`,Permanent:true}));
    return user.Username;
  }
  if (!verified) throw new Error('RecoveryRequired');
  if (user.UserStatus==='FORCE_CHANGE_PASSWORD') {
    const {Item:provision}=await db.send(new GetCommand({TableName:table,Key:{id:`PROVISION#${phone}`},ConsistentRead:true}));
    if (provision?.username!==user.Username) throw new Error('RecoveryRequired');
    await cognito.send(new AdminSetUserPasswordCommand({UserPoolId:pool,Username:user.Username,Password:`Aa1!${crypto.randomBytes(48).toString('hex')}`,Permanent:true}));
  } else if (user.UserStatus!=='CONFIRMED') throw new Error('RecoveryRequired');
  return user.Username;
 }
 // A deterministic username prevents concurrent successful verifications creating duplicates.
 // A private creation marker allows retrying only accounts created by this flow.
 await db.send(new TransactWriteCommand({TransactItems:[phoneClosureCondition(phone),{Put:{TableName:table,Item:{id:`PROVISION#${phone}`,expiresAt:now()+86400}}}]}));
 const created=await cognito.send(new AdminCreateUserCommand({UserPoolId:pool,Username:phone,MessageAction:'SUPPRESS',UserAttributes:[{Name:'phone_number',Value:phone},{Name:'phone_number_verified',Value:'true'}],TemporaryPassword:`Aa1!${crypto.randomBytes(32).toString('hex')}`}));
 await db.send(new TransactWriteCommand({TransactItems:[phoneClosureCondition(phone),{Update:{TableName:table,Key:{id:`PROVISION#${phone}`},UpdateExpression:'SET username = :username',ExpressionAttributeValues:{':username':created.User.Username}}}]}));
 await cognito.send(new AdminSetUserPasswordCommand({UserPoolId:pool,Username:created.User.Username,Password:`Aa1!${crypto.randomBytes(48).toString('hex')}`,Permanent:true}));
 return created.User.Username;
}
async function verify(phone,body,key){
 if(typeof body.sessionId!=='string'||! /^[0-9]{6}$/.test(body.code||''))return reply(400,{message:'رمز أو جلسة غير صحيحة'});
 const {Item:record}=await db.send(new GetCommand({TableName:table,Key:{id:body.sessionId},ConsistentRead:true}));
 const {Item:active}=await db.send(new GetCommand({TableName:table,Key:{id:`ACTIVE#${phone}`},ConsistentRead:true}));
 const time=now();
 if(!record||record.purpose!=='registration-otp'||record.phone!==phone||active?.sessionId!==record.id||record.expiresAt<=time||record.used||record.attempts>=5)return reply(400,{message:'انتهى الرمز أو جلسة التحقق؛ اطلب رمزًا جديدًا'});
 const correct=matches(key.hmacKey,record,phone,body.code,time);
 await db.send(new TransactWriteCommand({TransactItems:[
  phoneClosureCondition(phone),
  {ConditionCheck:{TableName:table,Key:{id:`ACTIVE#${phone}`},ConditionExpression:'sessionId = :id',ExpressionAttributeValues:{':id':record.id}}},
  {Update:{TableName:table,Key:{id:record.id},UpdateExpression:correct?'SET used = :true ADD attempts :one':'ADD attempts :one',ConditionExpression:'used = :false AND attempts < :max AND expiresAt > :now',ExpressionAttributeValues:{':false':false,':max':5,':now':time,':one':1,...(correct?{':true':true}:{})}}}
 ]}));
 if(!correct)return reply(400,{message:'رمز التحقق غير صحيح'});
 await checkPhoneOpen(db,GetCommand,phone);
 const username=await resolveUser(phone);
 const userResult=await cognito.send(new ListUsersCommand({UserPoolId:pool,Filter:`phone_number = "${phone}"`,Limit:60}));
 const user=userResult.Users.find(u=>u.Username===username);
 const sub=user?.Attributes.find(a=>a.Name==='sub')?.Value;
 if(!sub)throw new Error('MissingIdentity');
 const timestamp=new Date().toISOString();
 try {
  await db.send(new TransactWriteCommand({TransactItems:[phoneClosureCondition(phone),lifecycleCondition(sub),{Put:{TableName:process.env.DRIVER_TABLE,Item:{driverId:sub,phoneNumber:phone,registrationMethod:'phone-otp',status:'PENDING_PROFILE',isVerified:false,isActive:true,isOnline:false,createdAt:timestamp,updatedAt:timestamp},ConditionExpression:'attribute_not_exists(driverId)'}}]}));
 } catch(error) { if(error.name!=='TransactionCanceledException')throw error; const existing=(await db.send(new GetCommand({TableName:process.env.DRIVER_TABLE,Key:{driverId:sub},ConsistentRead:true}))).Item; if(!existing||existing.driverId!==sub)throw error; }
 await requireWallet({db,GetCommand,lambda,InvokeCommand,subject:sub,event:{triggerSource:'PostConfirmation_ConfirmSignUp',userPoolId:pool,userName:username,request:{userAttributes:{sub,phone_number:phone,phone_number_verified:'true'}},response:{}}});
 const proof=newProof(key.hmacKey,username,now());
 await db.send(new TransactWriteCommand({TransactItems:[phoneClosureCondition(phone),lifecycleCondition(sub),{Put:{TableName:table,Item:proof.record,ConditionExpression:'attribute_not_exists(id)'}},{Put:{TableName:table,Item:{id:`LOGIN#${username}`,proofId:proof.record.id,expiresAt:proof.record.expiresAt}}}]}));
 return reply(200,{username,loginProof:proof.answer});
}
exports.handler=async event=>{
 try{
  const body=JSON.parse(event.body||'{}'),phone=normalizeIraqiPhone(body.phone);
  await checkPhoneOpen(db,GetCommand,phone);
  const key=await config();
  if(event.path.endsWith('/send'))return await send(phone,event.requestContext?.identity?.sourceIp||'unknown',key);
  if(event.path.endsWith('/verify'))return await verify(phone,body,key);
  return reply(404,{message:'Not found'});
 }catch(error){
  if(error.name==='TransactionCanceledException'||error.name==='ConditionalCheckFailedException')return reply(429,{message:'انتظر قبل إعادة المحاولة'});
  if(error.message==='AccountClosing')return reply(409,{message:'الحساب قيد الإغلاق.'});
  if(error.message==='RecoveryRequired')return reply(409,{message:'حسابك يحتاج ربط الهاتف بطريقة آمنة. استخدم استعادة الحساب'});
  if(error instanceof SyntaxError||error instanceof TypeError||error.message?.includes('Only Iraqi'))return reply(400,{message:'أدخل رقم هاتف عراقي صحيح'});
  return reply(503,{message:'تعذر إكمال العملية؛ حاول لاحقًا'});
 }
};

},
"iraqi-phone":function(module,exports,require){
'use strict';

// Iraq mobile numbers only. Canonical storage is E.164 (+9647XXXXXXXXX).
function normalizeIraqiPhone(input) {
  if (typeof input !== 'string') throw new TypeError('Phone must be a string');
  const digits = input.trim().replace(/[٠-٩۰-۹]/g, c => {
    const n = c.charCodeAt(0);
    return String(n >= 0x6f0 ? n - 0x6f0 : n - 0x660);
  }).replace(/[\s()\-]/g, '');
  let national;
  if (/^\+9647[0-9]{9}$/.test(digits)) national = digits.slice(4);
  else if (/^009647[0-9]{9}$/.test(digits)) national = digits.slice(5);
  else if (/^9647[0-9]{9}$/.test(digits)) national = digits.slice(3);
  else if (/^07[0-9]{9}$/.test(digits)) national = digits.slice(1);
  else if (/^7[0-9]{9}$/.test(digits)) national = digits;
  else throw new Error('Only Iraqi mobile numbers (+964) are supported');
  return '+964' + national;
}
module.exports = { normalizeIraqiPhone };

},
"challenge-policy":function(module,exports,require){
'use strict';
const crypto = require('node:crypto');
const MAX_ATTEMPTS = 5;
const TTL_SECONDS = 300;
function defineChallenge(event) {
  const session = event.request.session || [];
  const valid = session.every(s => s.challengeName === 'CUSTOM_CHALLENGE');
  const success = valid && session.length > 0 && session.at(-1).challengeResult === true;
  event.response = {
    issueTokens: success && !event.request.userNotFound,
    failAuthentication: !valid || !!event.request.userNotFound || (!success && session.length >= MAX_ATTEMPTS),
  };
  if (!event.response.issueTokens && !event.response.failAuthentication) event.response.challengeName = 'CUSTOM_CHALLENGE';
  return event;
}
function digest(key, id, username, code) {
  return crypto.createHmac('sha256', key).update(JSON.stringify([id, username, code])).digest('hex');
}
function matches(key, record, username, answer, now) {
  if (!record || record.username !== username || record.expiresAt <= now || record.used || record.attempts >= MAX_ATTEMPTS || !/^[0-9]{6}$/.test(answer || '')) return false;
  const expected = Buffer.from(record.digest, 'hex');
  const received = Buffer.from(digest(key, record.id, username, answer), 'hex');
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}
module.exports = { defineChallenge, digest, matches, MAX_ATTEMPTS, TTL_SECONDS };

},
"login-proof":function(module,exports,require){
'use strict';
const crypto = require('node:crypto');
const { digest } = require('./challenge-policy');
function newProof(key, username, time) {
  const id=crypto.randomUUID();
  const answer=crypto.randomBytes(32).toString('hex');
  return {answer,record:{id,username,purpose:'login-proof',expiresAt:time+90,attempts:0,used:false,digest:digest(key,id,username,answer)}};
}
function proofMatches(key, record, username, answer, time) {
  if (!record || record.purpose!=='login-proof' || record.username!==username || record.used || record.expiresAt<=time || !/^[a-f0-9]{64}$/.test(answer || '')) return false;
  const expected=Buffer.from(record.digest,'hex'),actual=Buffer.from(digest(key,record.id,username,answer),'hex');
  return expected.length===actual.length && crypto.timingSafeEqual(expected,actual);
}
module.exports={newProof,proofMatches};

},
"driver-phone-binding":function(module,exports,require){
'use strict';

const { createHash } = require('node:crypto');

function driverPhoneClosureKey(phone) {
  if (typeof phone !== 'string' || !/^\+9647\d{9}$/.test(phone)) throw Error('INVALID_DRIVER_PHONE_BINDING');
  return { pk:'DRIVER_PHONE_CLOSURE#'+createHash('sha256').update(phone).digest('hex'), sk:'META' };
}

module.exports = { driverPhoneClosureKey };

},
"driver-enrollment-gates":function(module,exports,require){
'use strict';
const {driverPhoneClosureKey}=require('./driver-phone-binding');
function phoneClosureCondition(phone){
 return {ConditionCheck:{TableName:'wizz-production-AccountDeletion',Key:driverPhoneClosureKey(phone),ConditionExpression:'attribute_not_exists(pk)'}};
}
async function checkPhoneOpen(db,GetCommand,phone){
 const {TableName,Key}=phoneClosureCondition(phone).ConditionCheck;
 if((await db.send(new GetCommand({TableName,Key,ConsistentRead:true}))).Item)throw Error('AccountClosing');
}
const POOL='us-east-1_5sUT54eCB';
function lifecycleCondition(subject){
 if(typeof subject!=='string'||!subject||subject.length>128)throw Error('InvalidIdentity');
 return {ConditionCheck:{TableName:'wizz-production-AccountDeletion',Key:{pk:'ACCOUNT_LIFECYCLE#DRIVER#'+subject,sk:'META'},ConditionExpression:'attribute_not_exists(pk)'}};
}
async function requireWallet({db,GetCommand,lambda,InvokeCommand,event,subject}){
 if(event.request?.userAttributes?.sub!==subject)throw Error('InvalidIdentity');
 if(event.userPoolId!==POOL)throw Error('InvalidIdentityPool');
 const key={walletId:'WALLET#DRIVER#'+subject,sk:'META'};
 const fence=lifecycleCondition(subject);
 const marker=await db.send(new GetCommand({TableName:fence.ConditionCheck.TableName,Key:fence.ConditionCheck.Key,ConsistentRead:true}));
 if(marker.Item)throw Error('AccountClosing');
 const read=()=>db.send(new GetCommand({TableName:'wizz-production-Wallets',Key:key,ConsistentRead:true}));
 let wallet=(await read()).Item;
 if(!wallet){
  const response=await lambda.send(new InvokeCommand({FunctionName:'wizz-production-wallet-creation-trigger',InvocationType:'RequestResponse',Payload:Buffer.from(JSON.stringify(event))}));
  if(response.FunctionError||response.StatusCode!==200)throw Error('WalletProvisioningUnavailable');
  wallet=(await read()).Item;
 }
 if(!wallet)throw Error('WalletProvisioningUnavailable');
 if(wallet.ownerType!=='DRIVER'||wallet.ownerId!==subject||wallet.status!=='ACTIVE'||wallet.deletionRequestId||wallet.currency!=='IQD')throw Error('WalletNotEligible');
 return fence;
}
module.exports={requireWallet,lifecycleCondition,phoneClosureCondition,checkPhoneOpen};

},
};
const cache={};function load(n){if(!n.startsWith('./'))return nativeRequire(n);const id=n.slice(2);if(!Object.hasOwn(factories,id))throw Error('Unknown module');if(!cache[id]){const m={exports:{}};cache[id]=m;factories[id](m,m.exports,load);}return cache[id].exports;}
exports.handler=async event=>{
 const e=process.env;
 const bindings={ENVIRONMENT:'production',USER_POOL_ID:'us-east-1_5sUT54eCB',OTP_TABLE:'wizz-production-DriverOtpSessions',DRIVER_TABLE:'wizz-production-Drivers',WALLETS_TABLE:'wizz-production-Wallets'};
 if(e.OTP_ENABLED!=='true'||e.WALLET_BINDING_READY!=='true'||Object.entries(bindings).some(([k,v])=>e[k]!==v)||!/^arn:aws:secretsmanager:us-east-1:746727375268:secret:wizz\/production\/driver\/otp-[A-Za-z0-9]+$/.test(e.OTP_SECRET_ARN||''))return {statusCode:503,body:JSON.stringify({code:'PRODUCTION_REGISTRATION_UNAVAILABLE',message:'التسجيل غير متاح حاليًا'})};
 return load('./registration').handler(event);
};
