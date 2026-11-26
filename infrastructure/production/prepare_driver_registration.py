"""Package driver enrollment with explicit production lifecycle/wallet gates. Inactive."""
import hashlib,json
from pathlib import Path
ROOT=Path(__file__).resolve().parent

def build():
 source=ROOT.parents[2]/'whizzDrivers-stg/backend/phone-auth'
 names=['registration','iraqi-phone','challenge-policy','login-proof'];modules={};evidence=[]
 for name in names:
  raw=(source/(name+'.js')).read_text();text=raw
  if name=='registration':
   start=text.index(' await lambda.send(new InvokeCommand(');end=text.index('\n const proof=',start)
   text=text[:start]+''' await requireWallet({db,GetCommand,lambda,InvokeCommand,subject:sub,event:{triggerSource:'PostConfirmation_ConfirmSignUp',userPoolId:pool,userName:username,request:{userAttributes:{sub,phone_number:phone,phone_number_verified:'true'}},response:{}}});'''+text[end:]
   text="const {requireWallet,lifecycleCondition,phoneClosureCondition,checkPhoneOpen}=require('./driver-enrollment-gates');\n"+text
   old="await db.send(new PutCommand({TableName:process.env.DRIVER_TABLE,Item:{driverId:sub,phoneNumber:phone,registrationMethod:'phone-otp',status:'PENDING_PROFILE',isVerified:false,isActive:true,isOnline:false,createdAt:timestamp,updatedAt:timestamp},ConditionExpression:'attribute_not_exists(driverId)'}));"
   assert old in text
   new="await db.send(new TransactWriteCommand({TransactItems:[lifecycleCondition(sub),{Put:{TableName:process.env.DRIVER_TABLE,Item:{driverId:sub,phoneNumber:phone,registrationMethod:'phone-otp',status:'PENDING_PROFILE',isVerified:false,isActive:true,isOnline:false,createdAt:timestamp,updatedAt:timestamp},ConditionExpression:'attribute_not_exists(driverId)'}}]}));"
   text=text.replace(old,new)
   previous="} catch(error) { if(error.name!=='ConditionalCheckFailedException')throw error; }"
   assert previous in text
   text=text.replace(previous,"} catch(error) { if(error.name!=='TransactionCanceledException')throw error; const existing=(await db.send(new GetCommand({TableName:process.env.DRIVER_TABLE,Key:{driverId:sub},ConsistentRead:true}))).Item; if(!existing||existing.driverId!==sub)throw error; }")
   replacements=[
    ('TransactItems:limits.map(x=>','TransactItems:[phoneClosureCondition(phone),...limits.map(x=>'),
    ("':limit':x.limit}}}))}));","':limit':x.limit}}}))]}));"),
    ('TransactItems:[{Put:{TableName:table,Item:item','TransactItems:[phoneClosureCondition(phone),{Put:{TableName:table,Item:item'),
    ('TransactItems:[\n  {ConditionCheck:{TableName:table,Key:{id:`ACTIVE#','TransactItems:[\n  phoneClosureCondition(phone),\n  {ConditionCheck:{TableName:table,Key:{id:`ACTIVE#'),
    ("  const key=await config();","  await checkPhoneOpen(db,GetCommand,phone);\n  const key=await config();"),
    ('await db.send(new PutCommand({TableName:table,Item:{id:`PROVISION#${phone}`,expiresAt:now()+86400},}));',
     'await db.send(new TransactWriteCommand({TransactItems:[phoneClosureCondition(phone),{Put:{TableName:table,Item:{id:`PROVISION#${phone}`,expiresAt:now()+86400}}}]}));'),
    ("await db.send(new UpdateCommand({TableName:table,Key:{id:`PROVISION#${phone}`},UpdateExpression:'SET username = :username',ExpressionAttributeValues:{':username':created.User.Username}}));",
     "await db.send(new TransactWriteCommand({TransactItems:[phoneClosureCondition(phone),{Update:{TableName:table,Key:{id:`PROVISION#${phone}`},UpdateExpression:'SET username = :username',ExpressionAttributeValues:{':username':created.User.Username}}}]}));"),
    (' const username=await resolveUser(phone);',' await checkPhoneOpen(db,GetCommand,phone);\n const username=await resolveUser(phone);'),
    ('TransactItems:[lifecycleCondition(sub),{Put:', 'TransactItems:[phoneClosureCondition(phone),lifecycleCondition(sub),{Put:'),
    ("  if(error.message==='RecoveryRequired')", "  if(error.message==='AccountClosing')return reply(409,{message:'الحساب قيد الإغلاق.'});\n  if(error.message==='RecoveryRequired')"),
   ]
   for old,new in replacements:
    assert old in text,old
    text=text.replace(old,new)
   old="TransactItems:[{Put:{TableName:table,Item:proof.record"
   assert old in text;text=text.replace(old,"TransactItems:[phoneClosureCondition(phone),lifecycleCondition(sub),{Put:{TableName:table,Item:proof.record")
  assert 'staging' not in text
  modules[name]=text;evidence.append({'module':name,'sourceSha256':hashlib.sha256(raw.encode()).hexdigest(),'packagedSha256':hashlib.sha256(text.encode()).hexdigest()})
 modules['driver-phone-binding']=(ROOT.parents[1]/'backend/account-deletion/driver-phone-binding.js').read_text()
 modules['driver-enrollment-gates']=(ROOT/'phone-auth/driver-enrollment-gates.cjs').read_text().replace('../../../backend/account-deletion/driver-phone-binding','./driver-phone-binding')
 code="'use strict';\nconst nativeRequire=require;const factories={\n"
 for name,text in modules.items():code+=json.dumps(name)+':function(module,exports,require){\n'+text+'\n},\n'
 code+='''};
const cache={};function load(n){if(!n.startsWith('./'))return nativeRequire(n);const id=n.slice(2);if(!Object.hasOwn(factories,id))throw Error('Unknown module');if(!cache[id]){const m={exports:{}};cache[id]=m;factories[id](m,m.exports,load);}return cache[id].exports;}
exports.handler=async event=>{
 const e=process.env;
 const bindings={ENVIRONMENT:'production',USER_POOL_ID:'us-east-1_5sUT54eCB',OTP_TABLE:'wizz-production-DriverOtpSessions',DRIVER_TABLE:'wizz-production-Drivers',WALLETS_TABLE:'wizz-production-Wallets'};
 if(e.OTP_ENABLED!=='true'||e.WALLET_BINDING_READY!=='true'||Object.entries(bindings).some(([k,v])=>e[k]!==v)||!/^arn:aws:secretsmanager:us-east-1:746727375268:secret:wizz\\/production\\/driver\\/otp-[A-Za-z0-9]+$/.test(e.OTP_SECRET_ARN||''))return {statusCode:503,body:JSON.stringify({code:'PRODUCTION_REGISTRATION_UNAVAILABLE',message:'التسجيل غير متاح حاليًا'})};
 return load('./registration').handler(event);
};
'''
 return code,{'accountId':'746727375268','status':'LOCAL_PACKAGE_TESTED_NOT_DEPLOYED','otpEnabled':False,'walletServiceReady':False,'sourceEvidence':evidence,'activationRequirements':['Deploy and verify scoped production wallet creation service','Complete production driver profile/legal/documents/region APIs','Verify full registration retries and concurrent lifecycle changes','Configure provider and load limits']}
if __name__=='__main__':
 code,report=build();(ROOT/'phone-auth/driver-registration.bundle.cjs').write_text(code);(ROOT/'driver-registration-readiness.json').write_text(json.dumps(report,indent=2)+'\n')
