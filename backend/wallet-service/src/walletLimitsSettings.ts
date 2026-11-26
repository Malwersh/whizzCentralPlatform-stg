import {financialAudit} from './financialAudit';
import {docClient,TABLES,GetCommand,TransactWriteCommand} from './db';
import {financialStaff,staffGuard} from './staffAccess';
import {directWrite} from './writeWorkflow';
import {readWalletLimits,validateWalletLimits,walletLimitsGuard,walletLimitsKey,limitsError} from './walletOperatingLimits';
import {createHash} from 'node:crypto';
const pendingKey={idempotencyKey:'CONFIG#WALLET_OPERATING_LIMITS_PENDING',sk:'META'};
const id=(v:any)=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
export async function walletLimitsOverview(){const [config,{Item}]=await Promise.all([readWalletLimits(docClient,TABLES.IDEMPOTENCY_KEYS),docClient.send(new GetCommand({TableName:TABLES.IDEMPOTENCY_KEYS,Key:pendingKey,ConsistentRead:true}))]);return {config,pending:Item?.status==='PENDING'&&Item.expiresAt>Math.floor(Date.now()/1000)?Item:null,directWrite:directWrite(),approvalDayTimeZone:'UTC',gatewayLimitsSeparate:true};}
export async function walletLimitsAction(actor:string,authTime:number,v:any){
 const age=Math.floor(Date.now()/1000)-authTime;
 if(!Number.isSafeInteger(authTime)||age< -30||age>300)return limitsError('أعد تسجيل الدخول لتعديل الحدود المالية','REAUTH_REQUIRED',403);
 if(!v||!['PROPOSE_WALLET_LIMITS','APPROVE_WALLET_LIMITS','CANCEL_WALLET_LIMITS'].includes(v.action)||!id(v.requestId)||typeof v.reason!=='string'||v.reason.trim().length<5||v.reason.length>1000||Object.keys(v).some(k=>!['action','requestId','reason','config','changeId'].includes(k)))return limitsError('راجع بيانات تعديل حدود المحفظة');
 const permission=v.action==='APPROVE_WALLET_LIMITS'?'finance.settings.approve':v.action==='CANCEL_WALLET_LIMITS'?['finance.settings.request','finance.settings.approve']:'finance.settings.request';
 const staff=await financialStaff(actor,permission);if(!staff)return limitsError('يلزم حساب موظف مالي موثّق','STAFF_PERMISSION_REQUIRED',403);
 const guards:any[]=[staffGuard(staff)],at=new Date().toISOString();
 const ek={idempotencyKey:'WALLET_LIMITS_EVENT#'+v.requestId,sk:'META'},hash=createHash('sha256').update(JSON.stringify(v)).digest('hex');
 const oldEvent=(await docClient.send(new GetCommand({TableName:TABLES.IDEMPOTENCY_KEYS,Key:ek,ConsistentRead:true}))).Item;
 if(oldEvent){if(oldEvent.actorId!==actor||oldEvent.requestDigest!==hash)return limitsError('هوية المحاولة مستخدمة ببيانات مختلفة','WALLET_LIMITS_REQUEST_CONFLICT');return {...oldEvent.receipt,replayed:true};}
 const current=await readWalletLimits(docClient,TABLES.IDEMPOTENCY_KEYS),old=(await docClient.send(new GetCommand({TableName:TABLES.IDEMPOTENCY_KEYS,Key:pendingKey,ConsistentRead:true}))).Item;
 const ops:any[]=[...guards,walletLimitsGuard(current,TABLES.IDEMPOTENCY_KEYS)];let receipt:any;
 const configPut=(config:any)=>({Put:{TableName:TABLES.IDEMPOTENCY_KEYS,Item:{...walletLimitsKey,config,updatedAt:at,updatedBy:actor},ConditionExpression:current.version===0?'attribute_not_exists(idempotencyKey)':'config.#v=:v',...(current.version===0?{}:{ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':v':current.version}})}});
 if(v.action==='PROPOSE_WALLET_LIMITS'){
  const config=validateWalletLimits(v.config);if(config.version!==current.version)return limitsError('تغيرت الحدود؛ حدّث الصفحة','CONFIG_CONFLICT');
  if(old?.status==='PENDING'&&old.expiresAt>Math.floor(Date.now()/1000))return limitsError('يوجد تعديل بانتظار المراجعة','CONFIG_CONFLICT');
  if(directWrite()){const approver=await financialStaff(actor,'finance.settings.approve');if(approver?.version!==staff.version)return limitsError('تغيرت صلاحيات الموظف','STAFF_PERMISSION_REQUIRED',403);ops.pop();ops.push(configPut({...config,version:current.version+1}));receipt={status:'SAVED',config:{...config,version:current.version+1}};}
  else{const row={...pendingKey,status:'PENDING',changeId:v.requestId,baseVersion:current.version,proposed:config,requestedBy:actor,reason:v.reason.trim(),requesterVersion:staff?.version,createdAt:at,expiresAt:Math.floor(Date.now()/1000)+3600};ops.push({Put:{TableName:TABLES.IDEMPOTENCY_KEYS,Item:row,ConditionExpression:'attribute_not_exists(idempotencyKey) OR #s<>:pending OR expiresAt<=:now',ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':pending':'PENDING',':now':Math.floor(Date.now()/1000)}}});receipt={status:'PENDING',changeId:row.changeId};}
 }else{
  if(v.config!==undefined||!id(v.changeId)||!old||old.changeId!==v.changeId||old.status!=='PENDING'||old.expiresAt<=Math.floor(Date.now()/1000))return limitsError('تغير طلب الحدود أو انتهت مهلته','CONFIG_CONFLICT');
  if(v.action==='APPROVE_WALLET_LIMITS'){
   if(!directWrite()&&old.requestedBy===actor)return limitsError('يلزم اعتماد موظف مخوّل آخر','SECOND_APPROVER_REQUIRED',403);
   if(old.baseVersion!==current.version)return limitsError('تغيرت الحدود الحالية؛ أنشئ مقترحًا جديدًا','CONFIG_CONFLICT');
   const maker=await financialStaff(old.requestedBy,'finance.settings.request');if(maker&&maker.version!==old.requesterVersion)return limitsError('تغيرت صلاحيات منشئ المقترح','REQUESTER_PERMISSION_CHANGED',403);
   if(maker&&maker.employeeId!==staff?.employeeId)ops.push(staffGuard(maker));
   const config={...validateWalletLimits(old.proposed),version:current.version+1};ops.splice(guards.length,1);ops.push(configPut(config));receipt={status:'SAVED',config};
  }else receipt={status:'CANCELLED'};
  ops.push({Update:{TableName:TABLES.IDEMPOTENCY_KEYS,Key:pendingKey,UpdateExpression:'SET #s=:next,reviewedBy=:actor,reviewedAt=:at',ConditionExpression:'#s=:pending AND changeId=:id AND expiresAt>:now',ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':next':receipt.status==='SAVED'?'APPROVED':'CANCELLED',':actor':actor,':at':at,':pending':'PENDING',':id':v.changeId,':now':Math.floor(Date.now()/1000)}}});
 }
 ops.push({Put:{TableName:TABLES.IDEMPOTENCY_KEYS,Item:{...ek,actorId:actor,requestDigest:hash,receipt,createdAt:at},ConditionExpression:'attribute_not_exists(idempotencyKey)'}},{Put:{TableName:TABLES.AUDIT_LOG,Item:{datePartition:'date#'+at.slice(0,10).replace(/-/g,''),sk:'WALLET_LIMITS#'+v.requestId,action:v.action,...financialAudit(actor,staff,current,{...receipt,activeConfigChanged:receipt.status==='SAVED',...(receipt.status==='PENDING'?{proposedConfig:validateWalletLimits(v.config)}:{})},{requestId:v.requestId,...(v.changeId?{changeId:v.changeId}:{})},v.reason.trim()),createdAt:at},ConditionExpression:'attribute_not_exists(sk)'}});
 try{await docClient.send(new TransactWriteCommand({TransactItems:ops}));}catch(e:any){const event=(await docClient.send(new GetCommand({TableName:TABLES.IDEMPOTENCY_KEYS,Key:ek,ConsistentRead:true}))).Item;if(event?.actorId===actor&&event.requestDigest===hash)return {...event.receipt,replayed:true};if(e.name==='TransactionCanceledException')return limitsError('تغيرت الحدود أو صلاحيات المراجعة؛ حدّث الصفحة','CONFIG_CONFLICT');throw e;}return receipt;
}
