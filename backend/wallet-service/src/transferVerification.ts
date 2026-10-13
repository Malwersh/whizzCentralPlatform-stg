import {createHash,createHmac,randomInt,randomUUID,timingSafeEqual} from 'crypto';
import {CognitoIdentityProviderClient,GetUserCommand} from '@aws-sdk/client-cognito-identity-provider';
import {SecretsManagerClient,GetSecretValueCommand} from '@aws-sdk/client-secrets-manager';
import {docClient,TABLES,GetCommand,TransactWriteCommand} from './db';
import {MobileAccount} from './transferIdentity';
import {getTransferSettings} from './transferSettings';
import {fundingError} from './fundingService';
const now=()=>Math.floor(Date.now()/1000);
const key=(id:string)=>({idempotencyKey:`TRANSFER_VERIFY#${id}`,sk:'META'});
const failure=(m:string,c='TRANSFER_VERIFICATION_REQUIRED',s=403)=>fundingError(m,c,s);
export function verificationFingerprint(a:MobileAccount,input:any){
 if(!/^[a-f0-9-]{36}$/.test(input.requestId||'')||!/^WALLET#(DRIVER|CUSTOMER|MERCHANT)#[A-Za-z0-9_-]{1,100}$/.test(input.recipientWalletId||'')||!Number.isSafeInteger(input.amount)||input.amount<=0||typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>250)throw failure('بيانات التحويل غير صحيحة','INVALID_TRANSFER',400);
 return createHash('sha256').update(JSON.stringify([a.principalId,a.walletId,input.requestId,input.recipientWalletId,input.amount,input.reason.trim()])).digest('hex');
}
function signature(secret:string,id:string,fingerprint:string,code:string){return createHmac('sha256',secret).update(JSON.stringify([id,fingerprint,code])).digest('hex');}
async function config(){const r=await new SecretsManagerClient({}).send(new GetSecretValueCommand({SecretId:process.env.TRANSFER_OTP_SECRET_ARN}));const s=JSON.parse(r.SecretString!);if(!s.apiKey||!s.hmacKey)throw failure('خدمة التحقق غير متاحة','VERIFICATION_UNAVAILABLE',503);return s;}
async function record(id:string){return (await docClient.send(new GetCommand({TableName:TABLES.IDEMPOTENCY_KEYS,Key:key(id),ConsistentRead:true}))).Item;}
export async function sendTransferCode(a:MobileAccount,token:string,input:any){
 const fingerprint=verificationFingerprint(a,input),settings=await getTransferSettings();
 if(!settings.enabled||input.amount<settings.minAmount||input.amount>settings.maxAmount)throw failure('التحويل لا يطابق الحدود الحالية','INVALID_TRANSFER',400);
 const u=await new CognitoIdentityProviderClient({}).send(new GetUserCommand({AccessToken:token}));const attrs=Object.fromEntries((u.UserAttributes||[]).map(x=>[x.Name!,x.Value!]));
 if(attrs.sub!==a.principalId||attrs.phone_number_verified!=='true'||!/^\+9647\d{9}$/.test(attrs.phone_number||''))throw failure('وثّق رقم هاتف حسابك أولًا','PHONE_VERIFICATION_REQUIRED',403);
 const time=now(),secret=await config(),id=randomUUID(),code=String(randomInt(0,1000000)).padStart(6,'0');
 const quota=[{id:`COOLDOWN#${a.principalId}`,cool:true},{id:`DAILY#${Math.floor(time/86400)}#${a.principalId}`,limit:10},{id:`GLOBAL#${Math.floor(time/86400)}`,limit:200}];
 await docClient.send(new TransactWriteCommand({TransactItems:[...quota.map(q=>({Update:{TableName:TABLES.IDEMPOTENCY_KEYS,Key:key(q.id),UpdateExpression:q.cool?'SET nextAllowedAt = :next':'SET #count = if_not_exists(#count, :zero) + :one',ConditionExpression:q.cool?'attribute_not_exists(nextAllowedAt) OR nextAllowedAt <= :now':'attribute_not_exists(#count) OR #count < :limit',...(q.cool?{}:{ExpressionAttributeNames:{'#count':'count'}}),ExpressionAttributeValues:q.cool?{':next':time+60,':now':time}:{':zero':0,':one':1,':limit':q.limit}}})),{Put:{TableName:TABLES.IDEMPOTENCY_KEYS,Item:{...key(id),principalId:a.principalId,fingerprint,expiresAt:time+300,attempts:0,used:false,digest:signature(secret.hmacKey,id,fingerprint,code)},ConditionExpression:'attribute_not_exists(idempotencyKey)'}},{Put:{TableName:TABLES.IDEMPOTENCY_KEYS,Item:{...key(`ACTIVE#${a.principalId}`),challengeId:id}}}]}));
 const r=await fetch('https://api.otpiq.com/api/sms',{method:'POST',headers:{Authorization:`Bearer ${secret.apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({phoneNumber:attrs.phone_number.slice(1),smsType:'verification',provider:'whatsapp-sms',verificationCode:code}),signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw failure('تعذر إرسال الرمز، حاول لاحقًا','VERIFICATION_UNAVAILABLE',503);
 return {challengeId:id,phoneHint:'••••'+attrs.phone_number.slice(-4),expiresIn:300,resendAfter:60};
}
export async function verifyTransferCode(a:MobileAccount,input:any){
 const fingerprint=verificationFingerprint(a,input),r=await record(input.challengeId),active=await record(`ACTIVE#${a.principalId}`);
 if(!r||r.principalId!==a.principalId||r.fingerprint!==fingerprint||active?.challengeId!==input.challengeId||r.used||r.attempts>=5||r.expiresAt<=now()||!/^\d{6}$/.test(input.code||''))throw failure('الرمز غير صحيح أو انتهت صلاحيته','INVALID_VERIFICATION_CODE',400);
 const s=await config(),expected=Buffer.from(r.digest,'hex'),answer=Buffer.from(signature(s.hmacKey,input.challengeId,fingerprint,input.code),'hex'),correct=expected.length===answer.length&&timingSafeEqual(expected,answer),time=now();
 if(r.verifiedAt){if(!correct)throw failure('رمز التحقق غير صحيح','INVALID_VERIFICATION_CODE',400);return {verificationId:input.challengeId};}
 await docClient.send(new TransactWriteCommand({TransactItems:[{ConditionCheck:{TableName:TABLES.IDEMPOTENCY_KEYS,Key:key(`ACTIVE#${a.principalId}`),ConditionExpression:'challengeId = :id',ExpressionAttributeValues:{':id':input.challengeId}}},{Update:{TableName:TABLES.IDEMPOTENCY_KEYS,Key:key(input.challengeId),UpdateExpression:correct?'SET verifiedAt = :time ADD attempts :one':'ADD attempts :one',ConditionExpression:'used = :false AND attribute_not_exists(verifiedAt) AND attempts < :max AND expiresAt > :now',ExpressionAttributeValues:{':false':false,':max':5,':now':time,':one':1,...(correct?{':time':time}:{})}}}]}));
 if(!correct)throw failure('رمز التحقق غير صحيح','INVALID_VERIFICATION_CODE',400);
 return {verificationId:input.challengeId};
}
export async function transferVerification(a:MobileAccount,input:any,validSeconds:number){
 const r=typeof input.verificationId==='string'?await record(input.verificationId):undefined,time=now(),fingerprint=verificationFingerprint(a,input);
 if(!r||r.principalId!==a.principalId||r.fingerprint!==fingerprint||r.used||!r.verifiedAt||r.verifiedAt<time-validSeconds||r.verifiedAt>time+30||r.expiresAt<=time)throw failure('أكد التحويل برمز يُرسل إلى هاتفك','REAUTH_REQUIRED',403);
 return {verifiedAt:r.verifiedAt,expiresAt:Math.min(r.expiresAt,r.verifiedAt+validSeconds),guard:{Update:{TableName:TABLES.IDEMPOTENCY_KEYS,Key:key(input.verificationId),UpdateExpression:'SET used = :true',ConditionExpression:'used = :false AND fingerprint = :fp AND principalId = :actor AND verifiedAt >= :oldest AND expiresAt > :now',ExpressionAttributeValues:{':true':true,':false':false,':fp':fingerprint,':actor':a.principalId,':oldest':time-validSeconds,':now':time}}}};
}
