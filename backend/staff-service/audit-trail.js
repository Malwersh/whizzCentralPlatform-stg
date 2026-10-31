'use strict';
const {createHash}=require('node:crypto');
const denied=/(secret|password|token|credential|authorization|private.?key|api.?key|access.?key|otp|verification.?code|signed.?url|presigned)/i;
const digest=s=>createHash('sha256').update(s).digest('hex');
function safe(value,depth=0,budget={n:0}){
 if(value===undefined)return null;
 if(++budget.n>2000||depth>10)return {auditValue:'OMITTED_SIZE_LIMIT'};
 if(value===null||typeof value==='boolean'||typeof value==='number')return value;
 if(typeof value==='string'){
  if(/\bBearer\s+|X-Amz-(Signature|Credential|Security-Token)=|eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\./i.test(value))return '[محجوب]';
  return value.length>4000?{auditValue:'HASHED_LARGE_TEXT',length:value.length,sha256:digest(value)}:value;
 }
 if(Array.isArray(value))return value.slice(0,200).map(v=>safe(v,depth+1,budget)).concat(value.length>200?[{auditValue:'OMITTED_ARRAY_ITEMS',count:value.length-200}]:[]);
 if(typeof value==='object'){const result={};for(const [key,v] of Object.entries(value)){if(['__proto__','constructor','prototype'].includes(key))continue;result[key]=denied.test(key)?'[محجوب]':safe(v,depth+1,budget);}return result;}
 return '[غير قابل للعرض]';
}
function write(table,person,actorId,action,before,after,id){
 const createdAt=new Date().toISOString(),verified=person?.employeeId===actorId;
 const snapshot=verified?{employeeId:actorId,name:person.name||person.displayName||null,roles:Array.isArray(person.roles)?person.roles:[],version:person.version??null,scope:person.scope||null}:null;
 const a=safe(before),b=safe(after);const fields=[...new Set([...Object.keys(a||{}),...Object.keys(b||{})])].filter(k=>JSON.stringify(a?.[k])!==JSON.stringify(b?.[k]));
 return {Put:{TableName:table,Item:{pk:'AUDIT',sk:createdAt+'#'+id,schemaVersion:2,createdAt,actorId,actorSnapshot:safe(snapshot),actorIdentityEvidence:verified?'VERIFIED_STAFF_AT_ACTION':'ID_ONLY',action,before:a,after:b,changedFields:fields,reason:typeof after?.reason==='string'?safe(after.reason):null,outcome:'RECORDED'},ConditionExpression:'attribute_not_exists(sk)'}};
}
async function read({db,table,sdk,allowed},actor,q={}){
 if(!allowed(actor,'audit.read')||actor.scope?.allRegions!==true)throw Object.assign(Error('PERMISSION_REQUIRED'),{status:403});
 const limit=q.limit===undefined?30:Number(q.limit);if(!Number.isInteger(limit)||limit<1||limit>100)throw Object.assign(Error('INVALID_LIMIT'),{status:400});
 let cursor;if(q.cursor){try{if(typeof q.cursor!=='string'||q.cursor.length>2048)throw Error();cursor=JSON.parse(Buffer.from(q.cursor,'base64url').toString());if(Object.keys(cursor).length!==2||cursor.pk!=='AUDIT'||typeof cursor.sk!=='string'||cursor.sk.length>300)throw Error();}catch{throw Object.assign(Error('INVALID_CURSOR'),{status:400});}}
 if(q.action!==undefined&&(typeof q.action!=='string'||!/^[A-Z0-9_]{1,120}$/.test(q.action)))throw Object.assign(Error('INVALID_ACTION'),{status:400});
 const result=await db.send(new sdk.QueryCommand({TableName:table,KeyConditionExpression:'pk=:pk',ExpressionAttributeValues:{':pk':'AUDIT',...(q.action?{':action':q.action}:{})},...(q.action?{FilterExpression:'#action=:action',ExpressionAttributeNames:{'#action':'action'}}:{}),ConsistentRead:true,ScanIndexForward:false,Limit:limit,...(cursor?{ExclusiveStartKey:cursor}:{})}));
 return {items:(result.Items||[]).filter(v=>v.pk==='AUDIT').map(v=>safe(v)),nextCursor:result.LastEvaluatedKey?Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64url'):null,source:'STAFF_AUDIT_ONLY',historicalIdentityNotBackfilled:true};
}
module.exports={safe,write,read};
