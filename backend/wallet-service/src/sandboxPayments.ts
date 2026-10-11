import { createHash, randomUUID } from 'crypto';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { docClient, GetCommand, QueryCommand, ScanCommand, PutCommand, UpdateCommand, TransactWriteCommand } from './db';
import { fundingError } from './fundingService';

type Provider = 'zaincash' | 'qi';
type Payment = { pk: string; sk: string; driverId: string; amount: number; provider: Provider; requestId: string; state: string; createdAt: string; paymentId?: string; checkoutUrl?: string };
const table = () => {
 if (process.env.ENVIRONMENT !== 'staging' || !process.env.SANDBOX_PAYMENTS_TABLE) throw fundingError('الدفع التجريبي غير متاح', 'SANDBOX_DISABLED', 403);
 return process.env.SANDBOX_PAYMENTS_TABLE;
};
const settingsKey = { pk: 'SETTINGS', sk: 'SANDBOX' };
const secrets = new SecretsManagerClient({});
export async function sandboxSettings() {
 const {Item} = await docClient.send(new GetCommand({TableName: table(), Key: settingsKey, ConsistentRead: true}));
 return Item || { ...settingsKey, version: 0, driverIds: [], zaincash: false, qi: false };
}
async function authorized(driver: string, provider?: Provider) {
 const config = await sandboxSettings();
 if (!driver || !config.driverIds.includes(driver) || (provider && config[provider] !== true)) throw fundingError('الدفع التجريبي غير متاح لهذا الحساب', 'SANDBOX_FORBIDDEN', 403);
 return config;
}
export async function sandboxConfig(driver: string) {
 const config = await sandboxSettings();
 const allowed = config.driverIds.includes(driver);
 return { eligible: allowed, zaincash: allowed && config.zaincash === true, qi: allowed && config.qi === true, minimum: 25000, environment: 'sandbox' };
}
export async function saveSandboxSettings(input: any, actor: string) {
 const previous = await sandboxSettings();
 if(input.version !== previous.version) throw fundingError('أعد تحميل إعدادات الاختبار','CONFIG_CONFLICT',409);
 if(!Array.isArray(input.driverIds) || input.driverIds.length > 20 || input.driverIds.some((id: unknown)=>typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id))) throw fundingError('حسابات الاختبار غير صالحة');
 const item={...settingsKey,version:previous.version+1,driverIds:[...new Set(input.driverIds)],zaincash:input.zaincash===true,qi:input.qi===true,updatedBy:actor,updatedAt:new Date().toISOString()};
 await docClient.send(new TransactWriteCommand({TransactItems:[{Put:{TableName:table(),Item:item,ConditionExpression:previous.version===0?'attribute_not_exists(pk)':'#v = :v',...(previous.version===0?{}:{ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':v':previous.version}})}},{Put:{TableName:table(),Item:{pk:'AUDIT',sk:`${item.updatedAt}#${randomUUID()}`,action:'SANDBOX_CONFIG_UPDATED',actor,before:previous,after:item}}}]}));
 return item;
}
async function credentials(provider: Provider) {
 const result=await secrets.send(new GetSecretValueCommand({SecretId:`wizz/staging/payments/${provider}/sandbox`}));
 return JSON.parse(result.SecretString || '{}');
}
async function request(url: string, options: any) {
 const response=await fetch(url,{...options,signal:AbortSignal.timeout(7000)});
 if(!response.ok) throw fundingError('تعذر الاتصال ببوابة الاختبار','GATEWAY_UNAVAILABLE',502);
 return response.json() as Promise<any>;
}
async function zainToken(config: any) {
 return (await request('https://pg-api-uat.zaincash.iq/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',client_id:config.clientId,client_secret:config.clientSecret,scope:'payment:read payment:write'}).toString()})).access_token;
}
export const adapters = {
 async create(provider: Provider, payment: Payment) {
  const config=await credentials(provider);
  const finish=process.env.SANDBOX_RETURN_URL;
  if(!finish || !finish.startsWith('https://')) throw fundingError('رابط العودة غير مهيأ','SANDBOX_NOT_CONFIGURED',409);
  if(provider==='qi') {
   const data=await request('https://uat-sandbox-3ds-api.qi.iq/api/v1/payment',{method:'POST',headers:{'Content-Type':'application/json','X-Terminal-Id':config.terminalId,Authorization:`Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`},body:JSON.stringify({requestId:payment.requestId,amount:payment.amount,currency:'IQD',locale:'ar_IQ',finishPaymentUrl:finish,notificationUrl:process.env.SANDBOX_QI_WEBHOOK_URL})});
   return {paymentId:data.paymentId,checkoutUrl:data.formUrl};
  }
  const token=await zainToken(config);
  const data=await request('https://pg-api-uat.zaincash.iq/api/v2/payment-gateway/transaction/init',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({language:'ar',externalReferenceId:payment.requestId,orderId:payment.requestId,serviceType:'driver-wallet-sandbox',amount:{value:payment.amount,currency:'IQD'},redirectUrls:{successUrl:finish,failureUrl:finish}})});
  return {paymentId:data.transactionDetails?.transactionId,checkoutUrl:data.redirectUrl};
 },
 async inquire(payment: Payment) {
  const config=await credentials(payment.provider);
  if(payment.provider==='qi') return request(`https://uat-sandbox-3ds-api.qi.iq/api/v1/payment/${encodeURIComponent(payment.paymentId!)}/status`,{headers:{'X-Terminal-Id':config.terminalId,Authorization:`Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`}});
  const token=await zainToken(config);
  return request(`https://pg-api-uat.zaincash.iq/api/v2/payment-gateway/transaction/inquiry/${encodeURIComponent(payment.paymentId!)}`,{headers:{Authorization:`Bearer ${token}`}});
 }
};
export async function createSandboxPayment(driver: string, input: any) {
 if(!['zaincash','qi'].includes(input.provider) || !Number.isSafeInteger(input.amount) || input.amount<25000 || input.amount>500000 || !/^[a-f0-9-]{36}$/.test(input.requestId || '')) throw fundingError('بيانات الدفع غير صالحة');
 await authorized(driver,input.provider);
 const key={pk:`DRIVER#${driver}`,sk:`PAYMENT#${input.requestId}`};
 const existing=await docClient.send(new GetCommand({TableName:table(),Key:key,ConsistentRead:true}));
 if(existing.Item) {
  if(existing.Item.amount!==input.amount || existing.Item.provider!==input.provider) throw fundingError('لا يمكن تغيير بيانات المحاولة','PAYMENT_CONFLICT',409);
  return existing.Item;
 }
 const payment: Payment={...key,driverId:driver,amount:input.amount,provider:input.provider,requestId:input.requestId,state:'CREATING',createdAt:new Date().toISOString()};
 try {await docClient.send(new PutCommand({TableName:table(),Item:payment,ConditionExpression:'attribute_not_exists(pk)'}));}
 catch(error:any) {if(error.name==='ConditionalCheckFailedException')return createSandboxPayment(driver,input);throw error;}
 // An uncertain creation is retained; never blindly create it again on a retry.
 try {
  const result=await adapters.create(payment.provider,payment);
  if(typeof result.paymentId!=='string' || typeof result.checkoutUrl!=='string') throw fundingError('استجابة البوابة غير صالحة','GATEWAY_RESPONSE_INVALID',502);
  const url=new URL(result.checkoutUrl);
  const hosts=payment.provider==='qi'?['uat-sandbox-3ds-api.qi.iq']:['pg-api-uat.zaincash.iq','pg-uat.zaincash.iq'];
  if(url.protocol!=='https:' || !hosts.includes(url.hostname)) throw fundingError('رابط بوابة الاختبار غير صالح','GATEWAY_RESPONSE_INVALID',502);
  await docClient.send(new TransactWriteCommand({TransactItems:[
   {Update:{TableName:table(),Key:key,UpdateExpression:'SET #s = :pending, paymentId = :id, checkoutUrl = :url',ConditionExpression:'#s = :creating',ExpressionAttributeNames:{'#s':'state'},ExpressionAttributeValues:{':pending':'PENDING',':creating':'CREATING',':id':result.paymentId,':url':result.checkoutUrl}}},
   {Put:{TableName:table(),Item:{pk:`PROVIDER_LOOKUP#${payment.provider}`,sk:result.paymentId,driverId:driver,requestId:payment.requestId},ConditionExpression:'attribute_not_exists(pk)'}}
  ]}));
  return {...payment,...result,state:'PENDING'};
 } catch(error) {
  await docClient.send(new UpdateCommand({TableName:table(),Key:key,UpdateExpression:'SET #s = :unknown',ConditionExpression:'#s = :creating',ExpressionAttributeNames:{'#s':'state'},ExpressionAttributeValues:{':unknown':'CREATION_UNCERTAIN',':creating':'CREATING'}}));
  throw error;
 }
}
export async function sandboxOverview(driver: string) {
 await authorized(driver);
 const result=await docClient.send(new QueryCommand({TableName:table(),KeyConditionExpression:'pk = :pk',ExpressionAttributeValues:{':pk':`DRIVER#${driver}`},Limit:50,ScanIndexForward:false}));
 const balance=await docClient.send(new GetCommand({TableName:table(),Key:{pk:`DRIVER#${driver}`,sk:'BALANCE'},ConsistentRead:true}));
 return {environment:'sandbox',balance:balance.Item?.balance || 0,payments:(result.Items || []).filter(i=>i.sk.startsWith('PAYMENT#'))};
}
export async function checkSandboxPayment(driver: string, id: string) {
 await authorized(driver);
 const key={pk:`DRIVER#${driver}`,sk:`PAYMENT#${id}`};
 const {Item}=await docClient.send(new GetCommand({TableName:table(),Key:key,ConsistentRead:true}));
 if(!Item) throw fundingError('عملية الاختبار غير موجودة','PAYMENT_NOT_FOUND',404);
 const payment=Item as Payment;
 if(payment.state==='SUCCESS')return payment;
 if(!payment.paymentId)return payment;
 const result=await adapters.inquire(payment);
 const providerId=payment.provider==='qi'?result.paymentId:result.transactionDetails?.transactionId;
 const reference=payment.provider==='qi'?result.requestId:result.transactionDetails?.externalReferenceId;
 const amount=payment.provider==='qi'?result.amount:result.transactionDetails?.amount?.value;
 const currency=payment.provider==='qi'?result.currency:result.transactionDetails?.amount?.currency;
 if(providerId!==payment.paymentId || reference!==payment.requestId || Number(amount)!==payment.amount || currency!=='IQD')throw fundingError('تعذر مطابقة عملية الدفع','PAYMENT_MISMATCH',409);
 if(result.status!=='SUCCESS' || result.canceled===true) {
  if(['FAILED','EXPIRED','AUTHENTICATION_FAILED'].includes(result.status) || result.canceled===true) {
   const state=result.canceled===true?'CANCELED':result.status;
   await docClient.send(new UpdateCommand({TableName:table(),Key:key,UpdateExpression:'SET #s = :s',ConditionExpression:'#s = :pending',ExpressionAttributeNames:{'#s':'state'},ExpressionAttributeValues:{':s':state,':pending':'PENDING'}}));
   return {...payment,state};
  }
  return {...payment,providerStatus:result.status};
 }
 const now=new Date().toISOString();
 const receipt=createHash('sha256').update(`${payment.provider}:${payment.paymentId}`).digest('hex');
 try {
  await docClient.send(new TransactWriteCommand({TransactItems:[
   {Update:{TableName:table(),Key:key,UpdateExpression:'SET #s = :success, confirmedAt = :now',ConditionExpression:'#s = :pending',ExpressionAttributeNames:{'#s':'state'},ExpressionAttributeValues:{':success':'SUCCESS',':pending':'PENDING',':now':now}}},
   {Put:{TableName:table(),Item:{pk:'PROVIDER_PAYMENT',sk:receipt,driverId:driver,requestId:id},ConditionExpression:'attribute_not_exists(pk)'}},
   {Update:{TableName:table(),Key:{pk:`DRIVER#${driver}`,sk:'BALANCE'},UpdateExpression:'ADD balance :amount',ExpressionAttributeValues:{':amount':payment.amount}}},
   {Put:{TableName:table(),Item:{pk:`DRIVER#${driver}`,sk:`LEDGER#${id}`,amount:payment.amount,currency:'IQD',environment:'sandbox',provider:payment.provider,createdAt:now},ConditionExpression:'attribute_not_exists(pk)'}},
   {Put:{TableName:process.env.WALLET_NOTIFICATIONS_TABLE,Item:{eventId:`SANDBOX#${driver}#${id}#SUCCESS`,driverId:driver,topupId:id,amount:payment.amount,type:'wallet_sandbox_payment_succeeded',title:'نجح اختبار الدفع',body:'أضيف المبلغ إلى رصيد الاختبار فقط. لم يتغير رصيد المحفظة الأساسي.',createdAt:now,deliveryStatus:'PENDING',nextAttemptAt:0,attempts:0},ConditionExpression:'attribute_not_exists(eventId)'}},
   {Put:{TableName:table(),Item:{pk:'TEST_CLEARING',sk:`LEDGER#${driver}#${id}`,amount:-payment.amount,driverId:driver,createdAt:now},ConditionExpression:'attribute_not_exists(pk)'}}
  ]}));
 }catch(error:any){
  if(error.name!=='TransactionCanceledException')throw error;
  const read=await docClient.send(new GetCommand({TableName:table(),Key:key,ConsistentRead:true}));
  if(read.Item?.state!=='SUCCESS')throw fundingError('تعارض في تسوية الاختبار','PAYMENT_CONFLICT',409);
 }
 return {...payment,state:'SUCCESS',confirmedAt:now};
}

// Scheduled server reconciliation works even when the app is closed. Test-only.
export async function reconcileSandboxPayments() {
 let cursor;
 const due: any[]=[];
 const now=Date.now();
 do {
  const result: any=await docClient.send(new ScanCommand({TableName:table(),FilterExpression:'begins_with(sk, :payment) AND #s = :pending AND (attribute_not_exists(nextCheckAt) OR nextCheckAt <= :now)',ExpressionAttributeNames:{'#s':'state'},ExpressionAttributeValues:{':payment':'PAYMENT#',':pending':'PENDING',':now':now},Limit:25,ExclusiveStartKey:cursor}));
  due.push(...(result.Items || []));
  cursor=result.LastEvaluatedKey;
 } while(cursor && due.length<3);
 await Promise.all(due.slice(0,3).map(async payment=>{
  const expired=now-Date.parse(payment.createdAt)>24*3600*1000;
  await docClient.send(new UpdateCommand({TableName:table(),Key:{pk:payment.pk,sk:payment.sk},UpdateExpression:expired?'SET #s = :review':'SET nextCheckAt = :next',ConditionExpression:'#s = :pending',ExpressionAttributeNames:{'#s':'state'},ExpressionAttributeValues:{':pending':'PENDING',...(expired?{':review':'REVIEW_REQUIRED'}:{':next':now+10*60*1000})}}));
  if(expired)return;
  try {await checkSandboxPayment(payment.driverId,payment.requestId);}
  catch(error:any){console.warn('Sandbox reconciliation requires review',{requestId:payment.requestId,code:error.code || error.name});}
 }));
}

// Callback contents are a hint only. Settlement exclusively uses an authenticated
// inquiry response; no callback status, amount or driver identity is trusted.
export async function sandboxNotification(input: any) {
 if(typeof input?.paymentId!=='string' || !/^[a-f0-9-]{36}$/i.test(input.paymentId)) return {accepted:true};
 const key={pk:'PROVIDER_LOOKUP#qi',sk:input.paymentId};
 const {Item}=await docClient.send(new GetCommand({TableName:table(),Key:key,ConsistentRead:true}));
 if(!Item)return {accepted:true};
 const now=Date.now();
 try {
  await docClient.send(new UpdateCommand({TableName:table(),Key:key,UpdateExpression:'SET nextCallbackCheck = :next',ConditionExpression:'attribute_not_exists(nextCallbackCheck) OR nextCallbackCheck <= :now',ExpressionAttributeValues:{':next':now+60000,':now':now}}));
 }catch(error:any){if(error.name==='ConditionalCheckFailedException')return {accepted:true};throw error;}
 await checkSandboxPayment(Item.driverId,Item.requestId);
 return {accepted:true};
}
