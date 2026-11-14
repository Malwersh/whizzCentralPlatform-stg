'use strict';
const {GetCommand,QueryCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {randomUUID}=require('node:crypto');
const {allowed}=require('./catalog');
const {validatePolicy}=require('./staff-permission-policy');
const PK='OPERATIONAL_SETTINGS#MERCHANT_STAFF_PERMISSIONS';
const PATH='/staff/merchants/staff-policy';
const fail=(code,status=400)=>Object.assign(Error(code),{status});
// Server-owned capabilities are synchronized with the merchant runtime guards.
const {REGISTRY,rolePresets}=require('./staff-capabilities');
const view=row=>({version:row.version,enabledPermissions:row.enabledPermissions,roles:row.roles});
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
const same=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
function validate(input,current){
 if(!input||Object.keys(input).some(k=>!['enabledPermissions','roles'].includes(k))||!Array.isArray(input.enabledPermissions)||input.enabledPermissions.length>REGISTRY.length||!Array.isArray(input.roles)||input.roles.length>100)throw fail('INVALID_STAFF_POLICY');
 for(const role of input.roles){
  if(!role||Object.keys(role).some(k=>!['id','version','enabled','nameAr','nameEn','description','order','permissions'].includes(k))||typeof role.nameEn!=='string'||!role.nameEn.trim()||role.nameEn.length>100||typeof role.description!=='string'||role.description.length>1000||!Number.isSafeInteger(role.order)||role.order<0||role.order>1000||!Array.isArray(role.permissions)||role.permissions.length>REGISTRY.length)throw fail('INVALID_STAFF_TYPE');
  const preset=rolePresets().find(p=>p.id===role.id);
  if(preset&&role.enabled&&preset.pendingPermissions.length)throw fail('ROLE_NOT_READY');
  if(preset&&!same([...role.permissions].sort(),[...preset.permissions].sort()))throw fail('ROLE_BUNDLE_REQUIRED');
  const orderActions=['orders.accept','orders.reject','orders.prepare','orders.ready'];
  if(orderActions.some(id=>role.permissions.includes(id))&&!orderActions.every(id=>role.permissions.includes(id)))throw fail('ROLE_ORDER_BUNDLE_REQUIRED');
  const old=current?.roles.find(r=>r.id===role.id);
  const withoutVersion=r=>{const {version,...rest}=r;return rest;};
  const expected=old?old.version+(same(withoutVersion(old),withoutVersion(role))?0:1):1;
  if(role.version!==expected)throw fail('ROLE_VERSION_CONFLICT',409);
 }
 for(const old of current?.roles||[])if(!input.roles.some(r=>r.id===old.id))throw fail('TYPE_ARCHIVE_REQUIRED');
 const next={version:(current?.version||0)+1,...JSON.parse(JSON.stringify(input))};
 try{validatePolicy(next,REGISTRY);}catch(e){throw fail(e.code||'INVALID_STAFF_POLICY');}
 return next;
}
async function route(ctx,actor,method,path,input){
 if(path!==PATH&&path!==PATH+'/save'&&path!==PATH+'/history')throw fail('NOT_FOUND',404);
 if(!allowed(actor,'merchant_staff_policy.read')||actor.scope?.allRegions!==true)throw fail('PERMISSION_REQUIRED',403);
 const {db,table}=ctx;
 const read=async()=> (await db.send(new GetCommand({TableName:table,Key:{pk:PK,sk:'CURRENT'},ConsistentRead:true}))).Item;
 if(method==='GET'&&path===PATH){const row=await read();return {current:row?view(row):null,capabilities:REGISTRY,rolePresets:rolePresets(),canManage:allowed(actor,'merchant_staff_policy.manage'),initialized:!!row};}
 if(method==='GET'&&path===PATH+'/history'){
  let cursor;const encoded=ctx.query?.cursor;
  if(encoded!==undefined){try{if(typeof encoded!=='string'||encoded.length>2048)throw Error();cursor=JSON.parse(Buffer.from(encoded,'base64url').toString());if(cursor.pk!==PK||typeof cursor.sk!=='string'||!cursor.sk.startsWith('VERSION#')||Object.keys(cursor).length!==2)throw Error();}catch(_){throw fail('INVALID_CURSOR');}}
  const result=await db.send(new QueryCommand({TableName:table,KeyConditionExpression:'pk=:pk AND begins_with(sk,:prefix)',ExpressionAttributeValues:{':pk':PK,':prefix':'VERSION#'},ConsistentRead:true,ScanIndexForward:false,Limit:25,...(cursor?{ExclusiveStartKey:cursor}:{})}));
  return {items:(result.Items||[]).map(r=>({...view(r),updatedAt:r.updatedAt,updatedBy:r.updatedBy,reason:r.reason})),nextCursor:result.LastEvaluatedKey?Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64url'):null};
 }
 if(method!=='POST'||path!==PATH+'/save')throw fail('NOT_FOUND',404);
 if(!allowed(actor,'merchant_staff_policy.manage'))throw fail('PERMISSION_REQUIRED',403);
 if(!ctx.enrolled)throw fail('ENROLLMENT_REQUIRED',403);
 ctx.recent(ctx.claims);
 if(!input||Object.keys(input).some(k=>!['baseVersion','values','reason'].includes(k))||!Number.isSafeInteger(input.baseVersion)||input.baseVersion<0||typeof input.reason!=='string'||input.reason.trim().length<5||input.reason.length>300)throw fail('INVALID_STAFF_POLICY_REQUEST');
 const current=await read();if(input.baseVersion!==(current?.version||0))throw fail('VERSION_OR_STATE_CONFLICT',409);
 const values=validate(input.values,current),now=new Date().toISOString(),id=randomUUID();
 const row={pk:PK,sk:'CURRENT',...values,updatedBy:actor.employeeId,updatedAt:now,reason:input.reason.trim()};
 const condition=current?{ConditionExpression:'#v=:v',ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':v':current.version}}:{ConditionExpression:'attribute_not_exists(pk)'};
 try{await db.send(new TransactWriteCommand({TransactItems:[ctx.guard(actor),{Put:{TableName:table,Item:row,...condition}},{Put:{TableName:table,Item:{...row,sk:'VERSION#'+String(row.version).padStart(12,'0')},ConditionExpression:'attribute_not_exists(pk)'}},ctx.audit(actor.employeeId,'MERCHANT_STAFF_POLICY_SAVED',current?view(current):null,{...view(row),reason:row.reason},id)]}));}catch(e){if(e.name==='TransactionCanceledException')throw fail('VERSION_OR_STATE_CONFLICT',409);throw e;}
 return {status:'SAVED',current:view(row)};
}
module.exports={route,validate,REGISTRY,PK,PATH};
