'use strict';
const EXPECTED={ENVIRONMENT:'production',USER_POOL_ID:'us-east-1_2sKZ4fGbZ',USER_POOL_CLIENT_ID:'5l8ng11uudg146crop63926svq',OTP_TABLE:'wizz-production-MerchantOtpSessions',LEGAL_TABLE:'wizz-production-PlatformStaff',LIFECYCLE_TABLE:'wizz-production-AccountDeletion'};
const ACCOUNT='746727375268',SECRET=/^arn:aws:secretsmanager:us-east-1:746727375268:secret:wizz\/production\/merchant\/otp-[A-Za-z0-9]{6}$/;
const configured=env=>env.MERCHANT_ENROLLMENT_ENABLED==='true'&&Object.entries(EXPECTED).every(([k,v])=>env[k]===v)&&SECRET.test(env.OTP_SECRET_ARN||'');
function createHttpHandler({env=process.env,initialize}){
 return async(event,context={})=>{
  const reply=(statusCode,data)=>({statusCode,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},body:JSON.stringify(data)});
  if(!configured(env)||!new RegExp('^arn:aws:lambda:us-east-1:'+ACCOUNT+':function:wizz-production-merchant-enrollment(?::[^:]+)?$').test(context.invokedFunctionArn||''))return reply(503,{code:'ENROLLMENT_UNAVAILABLE',message:'التسجيل غير متاح حاليًا'});
  const path=event.path,method=event.httpMethod;
  if(!['/auth/merchant-enrollment/legal','/auth/merchant-enrollment/send','/auth/merchant-enrollment/verify'].includes(path))return reply(404,{code:'NOT_FOUND',message:'المسار غير موجود'});
  if(method!==(path.endsWith('/legal')?'GET':'POST'))return reply(405,{code:'METHOD_NOT_ALLOWED',message:'طريقة الطلب غير مدعومة'});
  let input={};
  if(method==='POST'){
   try{if(event.isBase64Encoded||typeof event.body!=='string'||Buffer.byteLength(event.body)>8192)throw Error();input=JSON.parse(event.body);if(!input||typeof input!=='object'||Array.isArray(input))throw Error();}catch{return reply(400,{code:'INVALID_REQUEST',message:'تحقق من البيانات المدخلة'});}
   const keys=path.endsWith('/send')?['phone']:['phone','sessionId','code','name','legalAccepted','legalAcceptance'];
   if(Object.keys(input).some(k=>!keys.includes(k)))return reply(400,{code:'INVALID_REQUEST',message:'تحقق من البيانات المدخلة'});
  }
  try{
   const d=await initialize();
   if(path.endsWith('/legal'))return reply(200,{bundle:await d.published()});
   if(path.endsWith('/send'))return reply(200,await d.service.send(input,{sourceIp:event.requestContext?.identity?.sourceIp}));
   return reply(200,await d.service.verify(input));
  }catch(e){
   const messages={INVALID_PHONE:'أدخل رقم هاتف عراقي صحيحًا',INVALID_CHALLENGE:'تحقق من رمز التحقق',INVALID_CODE:'رمز التحقق غير صحيح',CHALLENGE_EXPIRED:'انتهت صلاحية الرمز؛ اطلب رمزًا جديدًا',NAME_REQUIRED:'أدخل الاسم الكامل',LEGAL_ACCEPTANCE_REQUIRED:'اطلع على السياسات ووافق عليها للمتابعة',ACCOUNT_RECOVERY_REQUIRED:'تعذر إكمال التسجيل؛ تواصل مع الدعم لمراجعة الحساب',ACCOUNT_CLOSING:'هذا الحساب غير متاح للتسجيل',DELIVERY_FAILED:'تعذر إرسال الرمز؛ حاول بعد قليل'};
   const code=e.code||e.message;
   if(messages[code])return reply(code==='ACCOUNT_CLOSING'?403:code==='ACCOUNT_RECOVERY_REQUIRED'?409:code==='DELIVERY_FAILED'?503:400,{code,message:messages[code]});
   if(['TransactionCanceledException','ConditionalCheckFailedException'].includes(e.name))return reply(429,{code:'TRY_LATER',message:'انتظر قليلًا قبل طلب رمز جديد'});
   if(['LEGAL_VERSION_CHANGED','LEGAL_DOCUMENTS_CHANGED','LEGAL_ACCEPTANCE_OUTDATED'].includes(code))return reply(409,{code:'LEGAL_DOCUMENTS_CHANGED',message:'تحدّثت السياسات؛ راجعها ثم أعد المحاولة'});
   return reply(503,{code:'ENROLLMENT_UNAVAILABLE',message:'تعذر إكمال التسجيل؛ حاول بعد قليل'});
  }
 };
}
async function initialize(){
 const {DynamoDBClient}=require('@aws-sdk/client-dynamodb');
 const {DynamoDBDocumentClient,GetCommand,PutCommand,UpdateCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
 const {CognitoIdentityProviderClient,ListUsersCommand,AdminCreateUserCommand,AdminGetUserCommand,AdminSetUserPasswordCommand}=require('@aws-sdk/client-cognito-identity-provider');
 const {SecretsManagerClient,GetSecretValueCommand}=require('@aws-sdk/client-secrets-manager');
 const {createService,POOL}=require('./merchant-enrollment.cjs'),{createStore}=require('./merchant-enrollment-store.cjs');
 const {createIdentity}=require('./merchant-enrollment-identity.cjs'),{createProofStore}=require('./merchant-login-proof.cjs');
 const legal=require('./customer-legal-contract-344');
 const db=DynamoDBDocumentClient.from(new DynamoDBClient({region:'us-east-1',maxAttempts:2}));
 const store=createStore({db,GetCommand,UpdateCommand,TransactWriteCommand});
 const identities=createIdentity({db,cognito:new CognitoIdentityProviderClient({region:'us-east-1',maxAttempts:2}),GetCommand,PutCommand,UpdateCommand,ListUsersCommand,AdminCreateUserCommand,AdminGetUserCommand,AdminSetUserPasswordCommand,assertIdentityOpen:store.assertIdentityOpen});
 const proofs=createProofStore({db,GetCommand,TransactWriteCommand});
 // One invocation-local read: secret rotation is honored on the next request.
 let key;const config=async()=>{if(!key){const r=await new SecretsManagerClient({region:'us-east-1',maxAttempts:2}).send(new GetSecretValueCommand({SecretId:process.env.OTP_SECRET_ARN}));key=JSON.parse(r.SecretString);if(typeof key.apiKey!=='string'||!key.apiKey||typeof key.hmacKey!=='string'||key.hmacKey.length<32)throw Error('PROVIDER_UNAVAILABLE');}return key;};
 return {published:()=>legal.published(db,GetCommand,EXPECTED.LEGAL_TABLE,'MERCHANT'),service:createService({...store,...identities,enabled:true,poolId:POOL,now:()=>Math.floor(Date.now()/1000),config,consent:pin=>legal.consent(db,GetCommand,EXPECTED.LEGAL_TABLE,pin,'MERCHANT'),login:async identity=>proofs.issue(identity,(await config()).hmacKey),deliver:async(phone,code,apiKey)=>{
  const r=await fetch('https://api.otpiq.com/api/sms',{method:'POST',headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json','User-Agent':'WizzProductionVerification/1.0'},body:JSON.stringify({phoneNumber:phone.slice(1),smsType:'verification',provider:'whatsapp-telegram-sms',verificationCode:code}),signal:AbortSignal.timeout(5000)});if(!r.ok)throw Error('DELIVERY_FAILED');
 }})};
}
exports.handler=createHttpHandler({initialize});
exports.createHttpHandler=createHttpHandler;exports.EXPECTED=EXPECTED;exports.configured=configured;
