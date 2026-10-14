'use strict';
const {DynamoDBClient}=require('@aws-sdk/client-dynamodb');
const {DynamoDBDocumentClient,GetCommand}=require('@aws-sdk/lib-dynamodb');
const {SecretsManagerClient,GetSecretValueCommand}=require('@aws-sdk/client-secrets-manager');
const {accountAuth}=require('./account-auth');
const {customerEvidence}=require('./customer-evidence');
const {driverEvidence}=require('./driver-evidence');
const {merchantEvidence}=require('./merchant-evidence');
const {deletionVerification}=require('./deletion-verification');
const {coordinator}=require('./coordinator');
const {dynamoStore}=require('./store');
const {retentionSettings}=require('./settings');
const {receipt,error,target}=require('./policy');
const {receiptAccess}=require('./receipt-access');
const db=DynamoDBDocumentClient.from(new DynamoDBClient({}),{marshallOptions:{removeUndefinedValues:true}});
const table=process.env.DELETION_TABLE,auth=accountAuth({allowedTypes:['CUSTOMER','DRIVER','MERCHANT']}),store=dynamoStore({table,db});
const evidenceByType={CUSTOMER:customerEvidence({db}),DRIVER:driverEvidence({db}),MERCHANT:merchantEvidence({db})};
const executionTypes=new Set(['CUSTOMER','DRIVER','MERCHANT'].filter(type=>process.env.AUTOMATIC_EXECUTION_ENABLED==='true'&&process.env[({CUSTOMER:'MUTATION_GUARDS_VERIFIED',DRIVER:'DRIVER_MUTATION_GUARDS_VERIFIED',MERCHANT:'MERCHANT_MUTATION_GUARDS_VERIFIED'})[type]]==='true'));
const settings=retentionSettings({db,table:process.env.STAFF_TABLE,approvedInventories:executionTypes});
async function deletionSecret(){const r=await new SecretsManagerClient({}).send(new GetSecretValueCommand({SecretId:process.env.OTP_SECRET_ARN}));return JSON.parse(r.SecretString);}
const receipts=receiptAccess({db,table,store,secret:deletionSecret});
const verification=deletionVerification({db,table,secret:deletionSecret,deliver:async(key,phone,code)=>{const r=await fetch('https://api.otpiq.com/api/sms',{method:'POST',headers:{Authorization:'Bearer '+key.apiKey,'Content-Type':'application/json'},body:JSON.stringify({phoneNumber:phone.slice(1),smsType:'verification',provider:'whatsapp-sms',verificationCode:code}),signal:AbortSignal.timeout(10000)});if(!r.ok)throw error('VERIFICATION_UNAVAILABLE');}});
const service=coordinator({store,settings,verifyDeletionChallenge:verification.verify,adapters:Object.fromEntries(Object.entries(evidenceByType).map(([type,evidence])=>[type,{evidence,requiredSteps:()=>['eligibilityLock','personalData','orderPersonalData','walletClosure','identityClosure']}]))});
const reply=(statusCode,data)=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':'https://staging.d2vmebm1e1n95m.amplifyapp.com','Access-Control-Allow-Headers':'Authorization,Content-Type','Access-Control-Allow-Methods':'GET,POST,OPTIONS'},body:JSON.stringify(data)});
async function status(actor,scope){const {Item}=await db.send(new GetCommand({TableName:table,Key:{pk:`SUBJECT#${actor.type}#${actor.sub}`,sk:`ACTIVE#${scope.kind}#${scope.id}`},ConsistentRead:true}));if(!Item)return {request:null};const r=await store.get(actor,Item.requestId);if(!r||r.subjectId!==actor.sub||r.actorType!==actor.type)throw error('REQUEST_UNAVAILABLE');return {request:await service.refresh(actor,Item.requestId),receiptToken:await receipts.issue(actor,r)};}
exports.handler=async event=>{
 try{
  if(process.env.ENVIRONMENT!=='staging')throw error('ENVIRONMENT_NOT_ALLOWED');
  if(event.httpMethod==='OPTIONS')return reply(204,{});
  if(event.httpMethod==='POST'&&event.path==='/deletion/receipt'){let body;try{body=JSON.parse(event.body||'{}');}catch(_){throw error('UNAUTHORIZED');}return reply(200,await receipts.read(body.receiptToken));}
  const actor=await auth(event),path=event.path,method=event.httpMethod;
  const scoped=input=>target(actor,actor.type==='MERCHANT'?(input||{kind:'ACCOUNT'}):{kind:'ACCOUNT'});
  const readScope=scoped({kind:event.queryStringParameters?.scope||'ACCOUNT',businessId:event.queryStringParameters?.businessId});
  if(method==='GET'&&path==='/deletion/status')return reply(200,await status(actor,readScope));
  if(method==='GET'&&path==='/deletion/eligibility'){const e=await evidenceByType[actor.type](actor,readScope);return reply(200,{wallets:e.wallets,activeOrders:e.activeOrders,activeHolds:e.activeHolds,pendingTransfers:e.pendingTransfers,pendingPayments:e.pendingPayments||[],policyVersion:(await settings(actor.type)).retentionPolicyVersion,executionReady:executionTypes.has(actor.type)});}
  let body;try{body=JSON.parse(event.body||'{}');if(!body||Array.isArray(body)||typeof body!=='object')throw Error();}catch(_){return reply(400,{code:'INVALID_BODY',message:'بيانات الطلب غير صحيحة'});}
  if(method==='POST'&&path==='/deletion/send'){
   const input={...body,scope:scoped(body.scope)},challenge=await verification.send(actor,input);
   return reply(200,{...challenge,receiptToken:await receipts.prepare(actor,input)});
  }
  if(method==='POST'&&path==='/deletion/request'){const result=await service.request(actor,{...body,scope:scoped(body.scope)});const record=await store.get(actor,result.requestId);return reply(200,{...result,receiptToken:await receipts.issue(actor,record)});}
  return reply(404,{code:'NOT_FOUND',message:'المسار غير متاح'});
 }catch(e){
  const code=e.code||e.name;
  if(code==='UNAUTHORIZED')return reply(401,{code,message:'يرجى تسجيل الدخول'});
  if(['OWNER_REQUIRED','MEMBERSHIP_REQUIRED','OWNERSHIP_TRANSFER_REQUIRED'].includes(code))return reply(403,{code,message:'هذا الإجراء يتطلب ملكية المطعم أو العضوية المناسبة'});
  if(code==='PHONE_VERIFICATION_REQUIRED')return reply(403,{code,message:'وثّق رقم هاتف حسابك أولًا'});
  if(['INVALID_CODE','INVALID_REQUEST_ID','INVALID_BODY','INVALID_SCOPE'].includes(code))return reply(400,{code,message:'الرمز أو بيانات الطلب غير صحيحة؛ اطلب رمزًا جديدًا عند انتهاء صلاحيته'});
  if(['TransactionCanceledException','ConditionalCheckFailedException'].includes(code))return reply(409,{code:'STATE_CONFLICT',message:'حدّث حالة الطلب قبل إعادة المحاولة'});
  if(['PROFILE_NOT_FOUND','IDENTITY_AMBIGUOUS','OWNERSHIP_MISMATCH'].includes(code))return reply(409,{code,message:'تعذر مطابقة حسابك بأمان. يحتاج مراجعة دون تغيير بياناتك'});
  console.error('Deletion request failed',{code:code||'SERVICE_ERROR'});
  return reply(503,{code:'SERVICE_UNAVAILABLE',message:'تعذر إكمال العملية. حسابك ورصيدك لم يتغيرا؛ حدّث حالة الطلب قبل إعادة المحاولة'});
 }
};
