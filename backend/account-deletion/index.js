'use strict';
const {DynamoDBClient}=require('@aws-sdk/client-dynamodb');
const {DynamoDBDocumentClient,GetCommand}=require('@aws-sdk/lib-dynamodb');
const {SecretsManagerClient,GetSecretValueCommand}=require('@aws-sdk/client-secrets-manager');
const {customerAuth}=require('./customer-auth');
const {customerEvidence}=require('./customer-evidence');
const {deletionVerification}=require('./deletion-verification');
const {coordinator}=require('./coordinator');
const {dynamoStore}=require('./store');
const {retentionSettings}=require('./settings');
const {receipt,error}=require('./policy');
const db=DynamoDBDocumentClient.from(new DynamoDBClient({}),{marshallOptions:{removeUndefinedValues:true}});
const table=process.env.DELETION_TABLE,auth=customerAuth(),evidence=customerEvidence({db}),store=dynamoStore({table,db});
const settings=retentionSettings({db,table:process.env.STAFF_TABLE}); // Inventory is NOT approved for irreversible execution yet.
const verification=deletionVerification({db,table,secret:async()=>{const r=await new SecretsManagerClient({}).send(new GetSecretValueCommand({SecretId:process.env.OTP_SECRET_ARN}));return JSON.parse(r.SecretString);},deliver:async(key,phone,code)=>{const r=await fetch('https://api.otpiq.com/api/sms',{method:'POST',headers:{Authorization:'Bearer '+key.apiKey,'Content-Type':'application/json'},body:JSON.stringify({phoneNumber:phone.slice(1),smsType:'verification',provider:'whatsapp-sms',verificationCode:code}),signal:AbortSignal.timeout(10000)});if(!r.ok)throw error('VERIFICATION_UNAVAILABLE');}});
const service=coordinator({store,settings,verifyDeletionChallenge:verification.verify,adapters:{CUSTOMER:{evidence,requiredSteps:()=>['eligibilityLock','personalData','orderPersonalData','walletClosure','identityClosure']}}});
const reply=(statusCode,data)=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(data)});
async function status(actor){const {Item}=await db.send(new GetCommand({TableName:table,Key:{pk:`SUBJECT#CUSTOMER#${actor.sub}`,sk:`ACTIVE#ACCOUNT#${actor.sub}`},ConsistentRead:true}));if(!Item)return {request:null};const r=await store.get(actor,Item.requestId);if(!r||r.subjectId!==actor.sub)throw error('REQUEST_UNAVAILABLE');return {request:receipt(r)};}
exports.handler=async event=>{
 try{
  if(process.env.ENVIRONMENT!=='staging')throw error('ENVIRONMENT_NOT_ALLOWED');
  const actor=await auth(event),path=event.path,method=event.httpMethod;
  if(method==='GET'&&path==='/deletion/status')return reply(200,await status(actor));
  if(method==='GET'&&path==='/deletion/eligibility'){const e=await evidence(actor);return reply(200,{wallets:e.wallets,activeOrders:e.activeOrders,activeHolds:e.activeHolds,pendingTransfers:e.pendingTransfers,policyVersion:(await settings('CUSTOMER')).retentionPolicyVersion,executionReady:false});}
  let body;try{body=JSON.parse(event.body||'{}');if(!body||Array.isArray(body)||typeof body!=='object')throw Error();}catch(_){return reply(400,{code:'INVALID_BODY',message:'بيانات الطلب غير صحيحة'});}
  if(method==='POST'&&path==='/deletion/send')return reply(200,await verification.send(actor,{...body,scope:{kind:'ACCOUNT'}}));
  if(method==='POST'&&path==='/deletion/request')return reply(200,await service.request(actor,{...body,scope:{kind:'ACCOUNT'}}));
  return reply(404,{code:'NOT_FOUND',message:'المسار غير متاح'});
 }catch(e){
  const code=e.code||e.name;
  if(code==='UNAUTHORIZED')return reply(401,{code,message:'يرجى تسجيل الدخول'});
  if(code==='PHONE_VERIFICATION_REQUIRED')return reply(403,{code,message:'وثّق رقم هاتف حسابك أولًا'});
  if(['INVALID_CODE','INVALID_REQUEST_ID','INVALID_BODY'].includes(code))return reply(400,{code,message:'الرمز أو بيانات الطلب غير صحيحة؛ اطلب رمزًا جديدًا عند انتهاء صلاحيته'});
  if(['TransactionCanceledException','ConditionalCheckFailedException'].includes(code))return reply(409,{code:'STATE_CONFLICT',message:'حدّث حالة الطلب قبل إعادة المحاولة'});
  if(['PROFILE_NOT_FOUND','IDENTITY_AMBIGUOUS','OWNERSHIP_MISMATCH'].includes(code))return reply(409,{code,message:'تعذر مطابقة حسابك بأمان. يحتاج مراجعة دون تغيير بياناتك'});
  console.error('Deletion request failed',{code:code||'SERVICE_ERROR'});
  return reply(503,{code:'SERVICE_UNAVAILABLE',message:'تعذر إكمال العملية. حسابك ورصيدك لم يتغيرا؛ حدّث حالة الطلب قبل إعادة المحاولة'});
 }
};
