import {directWrite} from './writeWorkflow';
import {financialStaff,staffGuard} from './staffAccess';
import { randomUUID } from 'crypto';
import { docClient, TABLES, GetCommand, TransactWriteCommand } from './db';
import { fundingError } from './fundingService';
export const transferConfigKey={idempotencyKey:'CONFIG#TRANSFERS',sk:'META'};
const pendingKey={idempotencyKey:'CONFIG#TRANSFERS_PENDING',sk:'META'};
export const defaultTransferSettings={version:0,enabled:true,minAmount:1000,maxAmount:100000,driverDaily:100000,customerDaily:100000,merchantDaily:100000,platformDaily:1000000,requestTtlSeconds:3600,reauthSeconds:300,timeZone:'Asia/Baghdad'};
export type TransferSettings=typeof defaultTransferSettings;
export function validateTransferSettings(input:any):TransferSettings {
 const settings={...defaultTransferSettings};
 if(typeof input.enabled!=='boolean' || !Number.isSafeInteger(input.version) || input.version<0)throw fundingError('إعدادات التحويل غير صالحة');
 for(const key of ['minAmount','maxAmount','driverDaily','customerDaily','platformDaily','requestTtlSeconds','reauthSeconds'] as const){if(!Number.isSafeInteger(input[key]) || input[key]<1)throw fundingError('قيم الإعدادات يجب أن تكون أعداداً صحيحة موجبة');settings[key]=input[key];}
 if(settings.minAmount>settings.maxAmount || settings.maxAmount>1000000000 || [settings.driverDaily,settings.customerDaily,settings.platformDaily].some(v=>v<settings.maxAmount || v>10000000000) || settings.requestTtlSeconds<60 || settings.requestTtlSeconds>86400 || settings.reauthSeconds<30 || settings.reauthSeconds>900)throw fundingError('الحدود غير متناسقة؛ مدة الطلب 60–86400 ثانية وإعادة التحقق 30–900 ثانية');
 settings.merchantDaily=input.driverDaily;
 if(input.merchantDaily!==undefined){if(!Number.isSafeInteger(input.merchantDaily)||input.merchantDaily<settings.maxAmount||input.merchantDaily>10000000000)throw fundingError('حد المطعم اليومي غير صالح');settings.merchantDaily=input.merchantDaily;}
 settings.version=input.version;settings.enabled=input.enabled;return settings;
}
export async function getTransferSettings():Promise<TransferSettings>{const {Item}=await docClient.send(new GetCommand({TableName:TABLES.IDEMPOTENCY_KEYS,Key:transferConfigKey,ConsistentRead:true}));return Item?validateTransferSettings(Item.config):{...defaultTransferSettings};}
export function settingsGuard(settings:TransferSettings){return {ConditionCheck:{TableName:TABLES.IDEMPOTENCY_KEYS,Key:transferConfigKey,ConditionExpression:settings.version===0?'attribute_not_exists(idempotencyKey)':'config.#v = :v',...(settings.version===0?{}:{ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':v':settings.version}})}};}
export function baghdadDay(date:Date=new Date()){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Baghdad',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);const get=(type:string)=>parts.find(p=>p.type===type)!.value;return `${get('year')}-${get('month')}-${get('day')}`;}
function authenticated(authTime:number){const age=Math.floor(Date.now()/1000)-authTime;if(!Number.isInteger(authTime)||age< -30||age>300)throw fundingError('أعد تسجيل الدخول لتعديل الإعدادات المالية','REAUTH_REQUIRED',403);}
function audit(action:string,actor:string,before:any,after:any,id:string){const now=new Date().toISOString();return {Put:{TableName:TABLES.AUDIT_LOG,Item:{datePartition:'date#'+baghdadDay().replace(/-/g,''),sk:`${now}#${id}`,action,actorId:actor,before,after,timestamp:now},ConditionExpression:'attribute_not_exists(sk)'}};}
export async function transferSettingsOverview(){const [config,pending]=await Promise.all([getTransferSettings(),docClient.send(new GetCommand({TableName:TABLES.IDEMPOTENCY_KEYS,Key:pendingKey,ConsistentRead:true}))]);return {config,pending:pending.Item || null,directWrite:directWrite()};}
export async function proposeTransferSettings(actor:string,authTime:number,input:any){
 authenticated(authTime);const staff=await financialStaff(actor,'finance.settings.request');const current=await getTransferSettings();const proposed=validateTransferSettings(input);
 if(current.version!==proposed.version)throw fundingError('تغيرت الإعدادات؛ أعد التحميل','CONFIG_CONFLICT',409);
 const now=Math.floor(Date.now()/1000),changeId=randomUUID();const pending={...pendingKey,changeId,status:'PENDING',requestedBy:actor,requestedByStaffVersion:staff?.version,baseVersion:current.version,proposed,createdAt:new Date().toISOString(),expiresAt:now+3600};
 if(directWrite()){
  const next={...proposed,version:current.version+1};
  await docClient.send(new TransactWriteCommand({TransactItems:[...(staff?[staffGuard(staff)]:[]),{Put:{TableName:TABLES.IDEMPOTENCY_KEYS,Item:{...transferConfigKey,config:next,updatedBy:actor,updatedAt:new Date().toISOString()},ConditionExpression:current.version===0?'attribute_not_exists(idempotencyKey)':'config.#v=:v',...(current.version===0?{}:{ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':v':current.version}})}},audit('TRANSFER_SETTINGS_SAVED',actor,current,next,changeId)]}));return {status:'SAVED',config:next};
 }
 try{await docClient.send(new TransactWriteCommand({TransactItems:[...(staff?[staffGuard(staff)]:[]),settingsGuard(current),{Put:{TableName:TABLES.IDEMPOTENCY_KEYS,Item:pending,ConditionExpression:'attribute_not_exists(idempotencyKey) OR #s <> :pending OR expiresAt <= :now',ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':pending':'PENDING',':now':now}}},audit('TRANSFER_SETTINGS_PROPOSED',actor,current,proposed,changeId)]}));return pending;}
 catch(e:any){if(e.name==='TransactionCanceledException')throw fundingError('يوجد طلب إعدادات معلق أو تغيرت الإعدادات؛ أعد التحميل','CONFIG_CONFLICT',409);throw e;}
}
export async function approveTransferSettings(actor:string,authTime:number,changeId:string){
 authenticated(authTime);const current=await getTransferSettings();const {Item:pending}=await docClient.send(new GetCommand({TableName:TABLES.IDEMPOTENCY_KEYS,Key:pendingKey,ConsistentRead:true}));
 if(!pending || pending.changeId!==changeId || pending.status!=='PENDING' || pending.expiresAt<=Math.floor(Date.now()/1000))throw fundingError('طلب الإعدادات غير صالح أو انتهت مهلته','CONFIG_STATE',409);
 if(!directWrite()&&pending.requestedBy===actor)throw fundingError('يجب أن يعتمد التغيير مدير مالي آخر','SECOND_APPROVER_REQUIRED',403);
 if(pending.baseVersion!==current.version)throw fundingError('تغيرت الإعدادات؛ أنشئ طلباً جديداً','CONFIG_CONFLICT',409);
 const staff=await financialStaff(actor,'finance.settings.approve');const requester=await financialStaff(pending.requestedBy,'finance.settings.request');if(requester&&requester.version!==pending.requestedByStaffVersion)throw fundingError('تغيّرت صلاحيات منشئ الطلب','REQUESTER_PERMISSION_CHANGED',403);
 const next={...validateTransferSettings(pending.proposed),version:current.version+1};
 const put:any={TableName:TABLES.IDEMPOTENCY_KEYS,Item:{...transferConfigKey,config:next,updatedBy:actor,updatedAt:new Date().toISOString()},ConditionExpression:current.version===0?'attribute_not_exists(idempotencyKey)':'config.#v = :v',...(current.version===0?{}:{ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':v':current.version}})};
 try{await docClient.send(new TransactWriteCommand({TransactItems:[...(staff?[staffGuard(staff)]:[]),...(requester&&pending.requestedBy!==actor?[staffGuard(requester)]:[]),{Put:put},{Update:{TableName:TABLES.IDEMPOTENCY_KEYS,Key:pendingKey,UpdateExpression:'SET #s = :approved, approvedBy = :actor',ConditionExpression:`#s = :pending AND changeId = :id AND ${directWrite()?'':'requestedBy <> :actor AND '}expiresAt > :now`,ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':approved':'APPROVED',':pending':'PENDING',':actor':actor,':id':changeId,':now':Math.floor(Date.now()/1000)}}},audit('TRANSFER_SETTINGS_APPROVED',actor,current,next,changeId)]}));return next;}
 catch(e:any){if(e.name==='TransactionCanceledException')throw fundingError('تغيرت حالة الطلب؛ أعد التحميل','CONFIG_CONFLICT',409);throw e;}
}
export async function cancelTransferSettings(actor:string,authTime:number,changeId:string){
 authenticated(authTime);const staff=await financialStaff(actor,['finance.settings.request','finance.settings.approve']);const {Item:pending}=await docClient.send(new GetCommand({TableName:TABLES.IDEMPOTENCY_KEYS,Key:pendingKey,ConsistentRead:true}));
 if(!pending || pending.changeId!==changeId || pending.status!=='PENDING')throw fundingError('طلب الإعدادات غير قابل للإلغاء','CONFIG_STATE',409);
 try{await docClient.send(new TransactWriteCommand({TransactItems:[...(staff?[staffGuard(staff)]:[]),{Update:{TableName:TABLES.IDEMPOTENCY_KEYS,Key:pendingKey,UpdateExpression:'SET #s = :cancelled, cancelledBy = :actor',ConditionExpression:'#s = :pending AND changeId = :id',ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':cancelled':'CANCELLED',':pending':'PENDING',':id':changeId,':actor':actor}}},audit('TRANSFER_SETTINGS_CANCELLED',actor,pending,{status:'CANCELLED'},changeId)]}));return {status:'CANCELLED'};}
 catch(e:any){if(e.name==='TransactionCanceledException')throw fundingError('تغيرت حالة الطلب؛ أعد التحميل','CONFIG_CONFLICT',409);throw e;}
}
