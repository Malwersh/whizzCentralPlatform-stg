import {createHash,timingSafeEqual} from 'node:crypto';
import {CognitoIdentityProviderClient,GetUserCommand} from '@aws-sdk/client-cognito-identity-provider';
import {GetCommand} from '@aws-sdk/lib-dynamodb';
import {MobileAccount} from './transferIdentity';
import {fundingError} from './fundingService';
type Row=Record<string,any>;
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
const fail=():never=>{throw fundingError('افتح القسم المالي برمز تحقق المالك أولًا','PAYOUT_FINANCIAL_UNLOCK_REQUIRED',403);};
/** Reads the same persisted capability contract as staff-service. Employee
 * device/PIN authorization remains a separate, explicitly permissioned route. */
export async function merchantOwnerFinancialGuard(a:MobileAccount,headers:Row,options:{db:{send:(c:any)=>Promise<any>};cognito?:{send:(c:any)=>Promise<any>};now?:()=>number}){
 if(a.type!=='MERCHANT'||a.isOwner!==true)return fail();
 const raw=headers['X-Financial-Session']??headers['x-financial-session'];let access:Row;
 try{if(typeof raw!=='string'||raw.length>1024)throw Error();access=JSON.parse(raw);if(!access||Object.keys(access).sort().join(',')!=='deviceId,token'||typeof access.deviceId!=='string'||typeof access.token!=='string'||!/^[A-Za-z0-9_-]{24,128}$/.test(access.deviceId)||!/^[A-Za-z0-9_-]{43}$/.test(access.token))throw Error();}catch{return fail();}
 const credential=(headers.Authorization??headers.authorization??'').replace(/^Bearer /i,'');if(!credential)return fail();
 const cognito=options.cognito??new CognitoIdentityProviderClient({region:process.env.AWS_REGION});let attrs:Row;
 try{const live=await cognito.send(new GetUserCommand({AccessToken:credential}));attrs=Object.fromEntries((live.UserAttributes||[]).map((x:Row)=>[x.Name,x.Value]));}catch{return fail();}
 if(attrs.sub!==a.principalId||attrs.phone_number_verified!=='true'||!/^\+9647\d{9}$/.test(attrs.phone_number||''))return fail();
 const db=options.db,get=async(table:string,key:Row,projection?:string)=>(await db.send(new GetCommand({TableName:table,Key:key,ConsistentRead:true,...(projection?{ProjectionExpression:projection}:{})}))).Item;
 const branchTable=process.env.MERCHANTS_TABLE||'WhizzMerchants_Businesses',b=await get(branchTable,{businessId:a.ownerId});
 if(!b||b.businessId!==a.ownerId||b.ownerId!==a.principalId||b.cognitoUserId!==a.principalId||b.status!=='approved'||b.deletionRequestId!=null||b.deletedAt!=null||b.isDeleted===true)return fail();
 const guards:any[]=[],deletion=process.env.ACCOUNT_DELETION_TABLE||'staging-AccountDeletion';
 for(const pk of ['BUSINESS_LIFECYCLE#MERCHANT#'+a.ownerId,'ACCOUNT_LIFECYCLE#MERCHANT#'+a.principalId]){
  const key={pk,sk:'META'};if(await get(deletion,key,'pk,sk'))return fail();
  guards.push({ConditionCheck:{TableName:deletion,Key:key,ConditionExpression:'attribute_not_exists(pk)'}});
 }
 const key={pk:'MERCHANT_FINANCIAL_SESSION#'+hash(JSON.stringify([a.principalId,a.ownerId,access.deviceId])),sk:'SESSION'},table='staging-MerchantPlatform',row=await get(table,key);
 const fingerprint=hash(JSON.stringify([a.principalId,attrs.phone_number,b.ownerId,b.version??null,b.status]));
 const at=Math.floor((options.now??Date.now)()/1000),tokenHash=hash(access.token);
 if(!row||row.kind!=='MERCHANT_FINANCIAL_SESSION'||!Number.isSafeInteger(row.version)||row.version<1||!Number.isSafeInteger(row.expiresAt)||row.expiresAt<=at||row.fingerprint!==fingerprint||typeof row.tokenHash!=='string'||row.tokenHash.length!==tokenHash.length||!timingSafeEqual(Buffer.from(tokenHash),Buffer.from(row.tokenHash)))return fail();
 guards.push({ConditionCheck:{TableName:table,Key:key,ConditionExpression:'#v=:v AND tokenHash=:token AND fingerprint=:fingerprint AND expiresAt>:now',ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':v':row.version,':token':tokenHash,':fingerprint':fingerprint,':now':at}}});
 const names:Row={},values:Row={},terms:string[]=[];
 for(const [i,f] of ['ownerId','cognitoUserId','status','version','deletionRequestId','deletedAt','isDeleted'].entries()){
  names['#f'+i]=f;if(b[f]===undefined)terms.push('attribute_not_exists(#f'+i+')');else{values[':f'+i]=b[f];terms.push('#f'+i+'=:f'+i);}
 }
 guards.push({ConditionCheck:{TableName:branchTable,Key:{businessId:a.ownerId},ConditionExpression:terms.join(' AND '),ExpressionAttributeNames:names,ExpressionAttributeValues:values}});
 return guards;
}
