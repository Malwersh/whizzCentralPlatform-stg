import {transferVerification} from './transferVerification';
import {MobileAccount,merchantGuards} from './transferIdentity';
import {financialStaff,staffGuard,approvalAmount} from './staffAccess';
import { getTransferSettings, settingsGuard, baghdadDay, TransferSettings } from './transferSettings';
import { createHash } from 'crypto';
import { docClient, TABLES, GetCommand, ScanCommand, TransactWriteCommand } from './db';
import { fundingError } from './fundingService';

export type TransferActor = { id: string; type: 'DRIVER' | 'CUSTOMER' | 'MERCHANT' | 'FINANCE'; authTime: number; account?:MobileAccount; stepUp?:{expiresAt:number,verifiedAt:number,guard:any} };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const walletPattern = /^WALLET#(DRIVER|CUSTOMER|MERCHANT)#[a-zA-Z0-9_-]{1,100}$/;
const key = (id: string) => ({ idempotencyKey: `TRANSFER#${id}`, sk: 'META' });
const error = (message: string, code='INVALID_TRANSFER', status=400) => fundingError(message,code,status);
function recent(actor: TransferActor, settings: TransferSettings) {
  if(actor.type!=='FINANCE'&&actor.stepUp&&actor.stepUp.expiresAt>Math.floor(Date.now()/1000)&&actor.stepUp.verifiedAt>=Math.floor(Date.now()/1000)-settings.reauthSeconds)return;
  const age = Math.floor(Date.now()/1000)-actor.authTime;
  if (!Number.isInteger(actor.authTime) || age < -30 || age > settings.reauthSeconds) throw error('أعد تسجيل الدخول لتأكيد التحويل','REAUTH_REQUIRED',403);
}
function validate(input: any, settings: TransferSettings) {
  if (!uuid.test(input.requestId || '') || !walletPattern.test(input.recipientWalletId || '') || !Number.isSafeInteger(input.amount) || input.amount < settings.minAmount || input.amount > settings.maxAmount || typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 250) throw error(`المبلغ بين ${settings.minAmount} و${settings.maxAmount} دينار، والمستلم وسبب التحويل مطلوبان`);
}
async function record(id: string) { return (await docClient.send(new GetCommand({TableName:TABLES.IDEMPOTENCY_KEYS,Key:key(id),ConsistentRead:true}))).Item; }
async function wallet(id: string) {
  const {Item}=await docClient.send(new GetCommand({TableName:TABLES.WALLETS,Key:{walletId:id,sk:'META'},ConsistentRead:true}));
  if (!Item || Item.walletId !== id || (id !== 'WALLET#PLATFORM' && id !== `WALLET#${Item.ownerType}#${Item.ownerId}`) || Item.status!=='ACTIVE' || Item.currency!=='IQD' || !Number.isSafeInteger(Item.availableBalance) || !Number.isSafeInteger(Item.version)) throw error('المحفظة غير موجودة أو غير نشطة','WALLET_UNAVAILABLE',409);
  return Item;
}
function same(existing: any, input: any, source: string, actor: string) {
  if(existing.sourceWalletId!==source || existing.requestedBy!==actor || existing.recipientWalletId!==input.recipientWalletId || existing.amount!==input.amount || existing.reason!==input.reason.trim()) throw error('مرجع التحويل مستخدم ببيانات مختلفة','TRANSFER_CONFLICT',409);
}
export async function requestTransfer(actor: TransferActor, input: any) {
  const staff=actor.type==='FINANCE'?await financialStaff(actor.id,'finance.request'):undefined;
  const settings=await getTransferSettings();
  if(actor.type==='FINANCE')recent(actor,settings);
  validate(input,{...settings,minAmount:1,maxAmount:Number.MAX_SAFE_INTEGER});
  const source=actor.type==='FINANCE'?'WALLET#PLATFORM':actor.account?.walletId||`WALLET#${actor.type}#${actor.id}`;
  if(source===input.recipientWalletId)throw error('لا يمكن التحويل لنفس المحفظة');
  const previous=await record(input.requestId);
  if(previous){same(previous,input,source,actor.id);return previous;}
  validate(input,settings);
  if(!settings.enabled)throw error('التحويلات موقوفة من الإعدادات','TRANSFERS_DISABLED',409);
  if(actor.type!=='FINANCE'){const mobile=actor.account||{principalId:actor.id,ownerId:actor.id,type:actor.type,walletId:source};actor={...actor,stepUp:await transferVerification(mobile,input,settings.reauthSeconds)};}
  recent(actor,settings);
  await wallet(source);await wallet(input.recipientWalletId);
  const operation={...key(input.requestId),transferId:input.requestId,sourceWalletId:source,recipientWalletId:input.recipientWalletId,amount:input.amount,currency:'IQD',reason:input.reason.trim(),requestedBy:actor.id,requestedByStaffVersion:staff?.version,settingsVersion:settings.version,createdAt:new Date().toISOString(),expiresAt:Math.floor(Date.now()/1000)+settings.requestTtlSeconds,status:actor.type==='FINANCE'?'PENDING_APPROVAL':'COMPLETED'};
  if(actor.type!=='FINANCE')return execute(operation,actor,false);
  try {
    await docClient.send(new TransactWriteCommand({TransactItems:[...(staff?[staffGuard(staff)]:[]),settingsGuard(settings),{Put:{TableName:TABLES.IDEMPOTENCY_KEYS,Item:operation,ConditionExpression:'attribute_not_exists(idempotencyKey)'}},audit(operation,actor.id,'TRANSFER_REQUESTED')]}));
    return operation;
  } catch(e:any) {
    if(e.name==='TransactionCanceledException'){const retry=await record(input.requestId);if(retry){same(retry,input,source,actor.id);return retry;}}
    throw e;
  }
}
export async function approveTransfer(actor: TransferActor, id: string) {
  const settings=await getTransferSettings();
  recent(actor,settings);
  if(actor.type!=='FINANCE' || !uuid.test(id))throw error('صلاحية مالية مطلوبة','FORBIDDEN',403);
  const operation=await record(id);
  if(!operation || operation.sourceWalletId!=='WALLET#PLATFORM')throw error('طلب التحويل غير موجود','NOT_FOUND',404);
  if(operation.requestedBy===actor.id)throw error('منشئ الطلب لا يستطيع اعتماده','SECOND_APPROVER_REQUIRED',403);
  if(operation.status==='COMPLETED')return operation;
  if(operation.status!=='PENDING_APPROVAL' || Math.min(operation.expiresAt,Math.floor(Date.parse(operation.createdAt)/1000)+settings.requestTtlSeconds)<=Math.floor(Date.now()/1000))throw error('طلب التحويل منتهي أو غير قابل للاعتماد','TRANSFER_STATE',409);
  return execute(operation,actor,true);
}
function audit(o:any, actor:string, action:string) {
  return {Put:{TableName:TABLES.AUDIT_LOG,Item:{datePartition:'date#'+new Date().toISOString().slice(0,10).replace(/-/g,''),sk:`${new Date().toISOString()}#${o.transferId}#${action}`,action,actorId:actor,transferId:o.transferId,sourceWalletId:o.sourceWalletId,recipientWalletId:o.recipientWalletId,amount:o.amount,reason:o.reason},ConditionExpression:'attribute_not_exists(sk)'}};
}
async function execute(o:any,actor:TransferActor,approval:boolean) {
  const settings=await getTransferSettings();
  recent(actor,settings);
  if(!settings.enabled || o.amount<settings.minAmount || o.amount>settings.maxAmount)throw error('التحويل لا يطابق الإعدادات الحالية','TRANSFER_SETTINGS_CHANGED',409);
  const [source,destination]=await Promise.all([wallet(o.sourceWalletId),wallet(o.recipientWalletId)]);
  if(source.availableBalance<o.amount)throw error('الرصيد المتاح غير كافٍ؛ المحجوز لا يمكن تحويله','INSUFFICIENT_AVAILABLE_BALANCE',409);
  if(!Number.isSafeInteger(destination.availableBalance+o.amount))throw error('تجاوز حد الرصيد','BALANCE_LIMIT',409);
  const now=new Date().toISOString();const done={...o,status:'COMPLETED',completedAt:now,approvedBy:approval?actor.id:undefined};
  const approver=approval?await financialStaff(actor.id,'finance.approve'):undefined;
  const requester=approval?await financialStaff(o.requestedBy,'finance.request'):undefined;
  if(requester&&requester.version!==o.requestedByStaffVersion)throw error('تغيّرت صلاحيات منشئ الطلب؛ أنشئ طلبًا جديدًا','REQUESTER_PERMISSION_CHANGED',403);
  approvalAmount(approver,o.amount);
  const items:any[]=[...(actor.stepUp?[actor.stepUp.guard]:[]),...(actor.account?merchantGuards(actor.account):[]),...(approver?[staffGuard(approver)]:[]),...(requester?[staffGuard(requester)]:[]),settingsGuard(settings)];
  for(const [w,delta] of [[source,-o.amount],[destination,o.amount]] as [any,number][]){
    items.push({Update:{TableName:TABLES.WALLETS,Key:{walletId:w.walletId,sk:'META'},UpdateExpression:'SET availableBalance = availableBalance + :delta, #v = #v + :one, updatedAt = :now',ConditionExpression:'attribute_exists(walletId) AND #s = :active AND currency = :currency AND #v = :version AND availableBalance >= :minimum',ExpressionAttributeNames:{'#s':'status','#v':'version'},ExpressionAttributeValues:{':delta':delta,':one':1,':now':now,':active':'ACTIVE',':currency':'IQD',':version':w.version,':minimum':delta<0?o.amount:0}}});
    items.push({Put:{TableName:TABLES.LEDGER,Item:{walletId:w.walletId,sk:`ts#${now}#TRANSFER#${o.transferId}`,transactionId:o.transferId,type:delta<0?'DEBIT':'CREDIT',category:'TRANSFER',amount:delta,balanceBefore:w.availableBalance,balanceAfter:w.availableBalance+delta,createdAt:now,description:o.reason,relatedEntityId:o.transferId,metadata:{sourceWalletId:o.sourceWalletId,recipientWalletId:o.recipientWalletId}},ConditionExpression:'attribute_not_exists(sk)'}});
  }
  items.push(approval?{Update:{TableName:TABLES.IDEMPOTENCY_KEYS,Key:key(o.transferId),UpdateExpression:'SET #s = :completed, completedAt = :now, approvedBy = :actor',ConditionExpression:'#s = :pending AND requestedBy <> :actor AND expiresAt > :time AND createdAt > :oldest',ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':completed':'COMPLETED',':pending':'PENDING_APPROVAL',':now':now,':actor':actor.id,':time':Math.floor(Date.now()/1000),':oldest':new Date(Date.now()-settings.requestTtlSeconds*1000).toISOString()}}}:{Put:{TableName:TABLES.IDEMPOTENCY_KEYS,Item:done,ConditionExpression:'attribute_not_exists(idempotencyKey)'}});
  // Reserve a daily outgoing limit atomically with the money movement.
  const dailyLimit=source.ownerType==='PLATFORM'?settings.platformDaily:source.ownerType==='CUSTOMER'?settings.customerDaily:source.ownerType==='MERCHANT'?settings.merchantDaily:settings.driverDaily;
  items.push({Update:{TableName:TABLES.IDEMPOTENCY_KEYS,Key:{idempotencyKey:`TRANSFER_DAILY#${source.walletId}#${baghdadDay(new Date(now))}`,sk:'META'},UpdateExpression:'SET #total = if_not_exists(#total, :zero) + :amount',ConditionExpression:'attribute_not_exists(#total) OR #total <= :remaining',ExpressionAttributeNames:{'#total':'total'},ExpressionAttributeValues:{':zero':0,':amount':o.amount,':remaining':dailyLimit-o.amount}}});
  items.push(audit(o,actor.id,'TRANSFER_COMPLETED'));
  for(const [w,direction] of [[source,'sent'],[destination,'received']] as [any,string][]){
    if(w.ownerType==='PLATFORM')continue;
    let subjectId=w.ownerId;
    if(w.ownerType==='MERCHANT'){const business=(await docClient.send(new GetCommand({TableName:process.env.MERCHANTS_TABLE,Key:{businessId:w.ownerId},ConsistentRead:true}))).Item;subjectId=business?.ownerId||business?.cognitoUserId;if(!subjectId)throw error('تعذر تحديد صاحب محفظة المطعم','WALLET_UNAVAILABLE',409);}
    const eventId=`TRANSFER#${o.transferId}#${direction}`;
    items.push({Put:{TableName:process.env.WALLET_NOTIFICATIONS_TABLE,Item:{eventId,driverId:subjectId,recipientApp:w.ownerType==='CUSTOMER'?'user':w.ownerType==='MERCHANT'?'merchant':'driver',type:'wallet_transfer_completed',transferId:o.transferId,amount:o.amount,title:direction==='sent'?'تم تحويل الرصيد':'وصل تحويل إلى محفظتك',body:`${direction==='sent'?'حُوّل':'أُضيف'} ${o.amount} دينار.`,createdAt:now,deliveryStatus:'PENDING',nextAttemptAt:0,attempts:0},ConditionExpression:'attribute_not_exists(eventId)'}});
  }
  try {await docClient.send(new TransactWriteCommand({TransactItems:items,ClientRequestToken:createHash('sha256').update(o.transferId+'#'+source.version+'#'+destination.version+'#'+now).digest('hex').slice(0,36)}));return done;}
  catch(e:any){if(e.name==='TransactionCanceledException'){const completed=await record(o.transferId);if(completed?.status==='COMPLETED'){same(completed,o,o.sourceWalletId,o.requestedBy);return completed;}throw error('تغيّر الرصيد أو تجاوزت الحد اليومي؛ أعد المحاولة بنفس المرجع','TRANSFER_CONCURRENT_OR_LIMIT',409);}throw e;}
}

export async function listTransferRequests(cursor?: string) {
  let start;
  if (cursor) {
    try { if(cursor.length>2048)throw Error();start=JSON.parse(Buffer.from(cursor,'base64url').toString());if(typeof start.idempotencyKey!=='string' || start.sk!=='META' || Object.keys(start).length!==2)throw Error(); }
    catch(_){throw error('مؤشر الصفحة غير صالح');}
  }
  const result=await docClient.send(new ScanCommand({TableName:TABLES.IDEMPOTENCY_KEYS,Limit:100,ExclusiveStartKey:start,FilterExpression:'begins_with(idempotencyKey, :prefix)',ExpressionAttributeValues:{':prefix':'TRANSFER#'}}));
  return {requests:(result.Items || []).filter(i=>i.sourceWalletId==='WALLET#PLATFORM'),nextCursor:result.LastEvaluatedKey?Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64url'):null};
}

export async function cancelMobileTransfer(actor:TransferActor,input:any){const settings=await getTransferSettings();validate(input,{...settings,minAmount:1,maxAmount:Number.MAX_SAFE_INTEGER});if(actor.type==='FINANCE')throw error('طلب تطبيق مطلوب','FORBIDDEN',403);const source=actor.account?.walletId||`WALLET#${actor.type}#${actor.id}`,existing=await record(input.requestId);if(existing){same(existing,input,source,actor.id);return existing;}const cancelled={...key(input.requestId),transferId:input.requestId,sourceWalletId:source,recipientWalletId:input.recipientWalletId,amount:input.amount,reason:input.reason.trim(),requestedBy:actor.id,status:'CANCELLED',createdAt:new Date().toISOString()};try{await docClient.send(new TransactWriteCommand({TransactItems:[{Put:{TableName:TABLES.IDEMPOTENCY_KEYS,Item:cancelled,ConditionExpression:'attribute_not_exists(idempotencyKey)'}},audit(cancelled,actor.id,'TRANSFER_ATTEMPT_CANCELLED')]}));return cancelled;}catch(e:any){if(e.name==='TransactionCanceledException'){const saved=await record(input.requestId);if(saved){same(saved,input,source,actor.id);return saved;}}throw e;}}
