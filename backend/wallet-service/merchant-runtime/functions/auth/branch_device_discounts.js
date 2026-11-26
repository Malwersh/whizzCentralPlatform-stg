'use strict';
const {GetCommand,ScanCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {createHash,randomUUID}=require('node:crypto');
const {versioned}=require('../shared/campaign-version');
const {patchTerms}=require('../shared/discount-contract');
const D='WhizzMerchants_Discounts',T='staging-MerchantPlatform';
const FIELDS=['discountId','businessId','title','description','type','value','applicability','minimum_order_amount','valid_from','valid_to','status','usage_count','usage_limit','updated_at','created_at','applicable_item_ids','applicable_category_ids','conditional_rule','conditional_parameters','version','fundingPolicyId','fundingPolicyVersion','perCustomerLimit','singleUse','maxDiscountAmount','sharedStopped','legalHold','retentionHold','validFrom','validTo','minimumOrderAmount','usageLimit','usageCount','discountType','discountValue','isActive'];
const fail=(code,status=400)=>{throw Object.assign(Error(code),{status});};
const pick=r=>Object.fromEntries(FIELDS.filter(k=>r[k]!==undefined).map(k=>[k,r[k]]));
const digest=r=>createHash('sha256').update(JSON.stringify(r)).digest('hex');
const revision=r=>digest(pick(r));
const simple=r=>['percentage','fixedAmount'].includes(r.type)&&r.applicability==='allItems'&&!(r.applicable_item_ids?.length||r.applicable_category_ids?.length||r.conditional_rule||Object.keys(r.conditional_parameters||{}).length);
const view=r=>({...Object.fromEntries(FIELDS.filter(k=>!['conditional_parameters','applicable_item_ids','applicable_category_ids','legalHold','retentionHold'].includes(k)&&r[k]!==undefined).map(k=>[k,r[k]])),revision:revision(r),editable:editable(r)});
const get=async(db,table,key)=>(await db.send(new GetCommand({TableName:table,Key:key,ConsistentRead:true}))).Item;
async function prove(db,guards){try{await db.send(new TransactWriteCommand({TransactItems:guards}));}catch(e){if(e.name==='TransactionCanceledException')fail('VERSION_OR_STATE_CONFLICT',409);throw e;}}
function validate(data){
 if(typeof data.title!=='string'||!data.title.trim()||data.title.length>150||typeof data.description!=='string'||data.description.length>2000||!['percentage','fixedAmount'].includes(data.type))fail('INVALID_DISCOUNT');
 if(!Number.isFinite(data.value)||data.value<=0||(data.type==='percentage'?data.value>100:!Number.isSafeInteger(data.value)||data.value>1000000000))fail('INVALID_DISCOUNT');
 if(!Number.isSafeInteger(data.minimum_order_amount)||data.minimum_order_amount<0||data.minimum_order_amount>1000000000)fail('INVALID_DISCOUNT');
 if([data.valid_from,data.valid_to].some(v=>{if(typeof v!=='string'||v.length>30||!Number.isFinite(Date.parse(v)))return true;const day=/^(\d{4})-(\d{2})-(\d{2})T/.exec(v);if(!day)return true;const date=new Date(day[1]+'-'+day[2]+'-'+day[3]+'T00:00:00.000Z');return !Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==v.slice(0,10);})||Date.parse(data.valid_to)<=Date.parse(data.valid_from))fail('INVALID_DISCOUNT');
}
function editable(row){try{validate(row);return simple(row);}catch(_){return false;}}
function fence(row){
 const names={},values={},parts=[];
 FIELDS.forEach((k,i)=>{const n='#old'+i;names[n]=k;if(row[k]===undefined)parts.push('attribute_not_exists('+n+')');else{values[':old'+i]=row[k];parts.push(n+'=:old'+i);}});
 return {TableName:D,Key:{discountId:row.discountId},ConditionExpression:parts.join(' AND '),ExpressionAttributeNames:names,ExpressionAttributeValues:values};
}
async function execute(db,{b,d,s,m,authorization,common},input){
 const action=input.action,needed={discounts_list:'discounts.read',discounts_create:'discounts.create',discounts_update:'discounts.edit',discounts_status:'discounts.activate',discounts_delete:'discounts.delete'}[action];
 if(!needed||!authorization?.permissions.includes(needed)||!authorization.permissions.includes('discounts.read'))fail('PERMISSION_REQUIRED',403);
 const allowed=action==='discounts_list'?['action','cursor']:['action','requestId',...(action==='discounts_create'?['data']:['discountId','baseRevision',...(action==='discounts_update'?['data']:action==='discounts_status'?['active']:[])])];
 if(Object.keys(input).some(k=>!allowed.includes(k)))fail('INVALID_DISCOUNT');
 await prove(db,common);
 if(action==='discounts_list'){
  let cursor;
  if(input.cursor){try{if(typeof input.cursor!=='string'||input.cursor.length>1024)throw Error();const parsed=JSON.parse(Buffer.from(input.cursor,'base64url'));if(Object.keys(parsed).sort().join(',')!=='businessId,discountId'||parsed.businessId!==b.businessId||typeof parsed.discountId!=='string'||!/^[\w-]{1,150}$/.test(parsed.discountId))throw Error();cursor={discountId:parsed.discountId};}catch(_){fail('INVALID_CURSOR');}}
  const names=Object.fromEntries(FIELDS.map((k,i)=>['#f'+i,k]));
  const page=await db.send(new ScanCommand({TableName:D,FilterExpression:'businessId=:b',ExpressionAttributeValues:{':b':b.businessId},ProjectionExpression:Object.keys(names).join(','),ExpressionAttributeNames:names,ConsistentRead:true,Limit:50,...(cursor?{ExclusiveStartKey:cursor}:{})}));
  const locksById=new Map();for(const r of (page.Items||[]).filter(r=>r.businessId===b.businessId))locksById.set(r.discountId,await require('../shared/shared-discount-lock').read(db,'MERCHANT',r));
  await prove(db,common);
  return {discounts:(page.Items||[]).filter(r=>r.businessId===b.businessId).map(r=>({...view(r),sharingLocked:locksById.get(r.discountId)?.locked===true,sharingCanActivate:locksById.get(r.discountId)?.initiallyInactive===true&&!r.sharedStopped})),nextCursor:page.LastEvaluatedKey?Buffer.from(JSON.stringify({businessId:b.businessId,discountId:page.LastEvaluatedKey.discountId})).toString('base64url'):null};
 }
 if(typeof input.requestId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input.requestId))fail('REQUEST_ID_REQUIRED');
 if(action!=='discounts_create'&&(typeof input.discountId!=='string'||!/^[\w-]{1,150}$/.test(input.discountId)||typeof input.baseRevision!=='string'))fail('INVALID_DISCOUNT');
 let data;
 if(['discounts_create','discounts_update'].includes(action)){
  const v=input.data;if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!['title','description','type','value','minimumOrderAmount','validFrom','validTo'].includes(k)))fail('INVALID_DISCOUNT');
  data={title:typeof v.title==='string'?v.title.trim():v.title,description:v.description??'',type:v.type,value:v.value,minimum_order_amount:v.minimumOrderAmount??0,valid_from:v.validFrom,valid_to:v.validTo};validate(data);
 }
 if(action==='discounts_status'&&typeof input.active!=='boolean')fail('INVALID_DISCOUNT');
 const content={action,discountId:input.discountId||null,baseRevision:input.baseRevision||null,data:data||null,active:input.active??null},fingerprint=digest(content),key={pk:'BRANCH#'+b.businessId,sk:'DISCOUNT_REQUEST#'+input.requestId};
 async function replay(){const marker=await get(db,T,key);if(!marker)return null;if(marker.ownerId!==b.ownerId||marker.fingerprint!==fingerprint)fail('REQUEST_ID_CONFLICT',409);await prove(db,common);return {success:true,discountId:marker.discountId,replayed:true};}
 const previous=await replay();if(previous)return previous;
 const id=action==='discounts_create'?randomUUID():input.discountId,now=new Date().toISOString();
 const row=action==='discounts_create'?null:await get(db,D,{discountId:id});
 if(action!=='discounts_create'&&(!row||row.businessId!==b.businessId))fail('DISCOUNT_UNAVAILABLE',404);
 if(row&&(row.legalHold===true||row.retentionHold===true))fail('CAMPAIGN_RETENTION_HOLD',409);
 if(row&&revision(row)!==input.baseRevision)fail('VERSION_OR_STATE_CONFLICT',409);
 if(row&&!simple(row))fail('DISCOUNT_UNSUPPORTED',409);
 if(action==='discounts_status'&&input.active)validate(row);
 if((action==='discounts_create'||action==='discounts_update')&&Date.parse(data.valid_to)<=Date.now()||action==='discounts_status'&&input.active&&Date.parse(row.valid_to)<=Date.now())fail('DISCOUNT_EXPIRED',409);
 let after=action==='discounts_delete'?null:row?{...row,...(data||{}),...(action==='discounts_status'?{status:input.active?'active':'inactive'}:{}),updated_at:now}:{discountId:id,id,businessId:b.businessId,...data,applicability:'allItems',applicable_item_ids:[],applicable_category_ids:[],conditional_rule:null,conditional_parameters:{},usage_limit:null,usage_count:0,status:'inactive',created_at:now,updated_at:now};
 after=after?versioned(row,patchTerms(row,row?{...(data||{}),...(action==='discounts_status'?{status:input.active?'active':'inactive'}:{})}:after,'merchant')):null;
 const locks=require('../shared/shared-discount-lock'),lock=row?await locks.read(db,'MERCHANT',row):null;if(lock){locks.assertChange(lock,row,after);common=[...common,...lock.guards];}
 const adopt=!!row&&row.version===undefined;
 const changed=!row||after===null||Object.keys(data||{status:after.status}).some(k=>row[k]!==after[k]);
 let write;
 if(!row)write={Put:{TableName:D,Item:after,ConditionExpression:'attribute_not_exists(discountId)'}};
 else if(action==='discounts_delete')write={Delete:fence(row)};
 else if(!changed&&!adopt)write={ConditionCheck:fence(row)};
 else{const op=fence(row),patch=Object.fromEntries(Object.entries(after).filter(([k,v])=>row[k]!==v&&!['fundingPolicyId','fundingPolicyVersion'].includes(k)));op.UpdateExpression='SET '+Object.entries(patch).map(([k,v],i)=>{op.ExpressionAttributeNames['#set'+i]=k;op.ExpressionAttributeValues[':set'+i]=v;return '#set'+i+'=:set'+i;}).join(',');const removed=['fundingPolicyId','fundingPolicyVersion'].filter(k=>row[k]!==undefined&&after[k]===undefined);if(removed.length)op.UpdateExpression+=' REMOVE '+removed.map((k,i)=>{op.ExpressionAttributeNames['#remove'+i]=k;return '#remove'+i;}).join(',');write={Update:op};}
 const eventAction={discounts_create:'DISCOUNT_CREATED',discounts_update:'DISCOUNT_UPDATED',discounts_status:'DISCOUNT_STATUS_CHANGED',discounts_delete:'DISCOUNT_DELETED'}[action];
 const audit={pk:key.pk,sk:'STAFF_AUDIT#OPERATIONS#'+now+'#'+randomUUID(),ownerId:b.ownerId,businessId:b.businessId,actorId:s.subjectId,actorName:m.displayName||'',roleName:m.grant?.roleNameAr||m.role,deviceId:d.deviceId,sessionId:s.sessionId,permissionVersion:m.version,policyVersion:authorization.policy.version,action:eventAction,entityId:id,createdAt:now,result:'SUCCEEDED',before:row?view(row):null,after:after?view(after):null};
 try{await db.send(new TransactWriteCommand({TransactItems:[...common,write,{Put:{TableName:T,Item:{...key,ownerId:b.ownerId,businessId:b.businessId,discountId:id,fingerprint,createdAt:now},ConditionExpression:'attribute_not_exists(pk)'}},...(changed?[{Put:{TableName:T,Item:audit,ConditionExpression:'attribute_not_exists(pk)'}}]:[])]}));}catch(e){if(e.name!=='TransactionCanceledException')throw e;const repeated=await replay();if(repeated)return repeated;fail('VERSION_OR_STATE_CONFLICT',409);}
 return {success:true,discountId:id,unchanged:!changed};
}
module.exports={execute,revision};
