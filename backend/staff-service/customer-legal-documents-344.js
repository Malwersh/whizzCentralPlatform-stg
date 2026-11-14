'use strict';
const {GetCommand,QueryCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {randomUUID}=require('node:crypto');
const p=require('../shared/customer-legal-contract-344');
const workflow=require('./write-workflow');
const PATH='/staff/settings/legal-documents';
const fail=(c,s=400)=>{throw Object.assign(Error(c),{status:s});};
async function route(ctx,actor,method,path,input={}){
 const suffix=path.slice(PATH.length).split('/').filter(Boolean);let audience='CUSTOMER';if(p.AUDIENCES.includes(suffix[0])){audience=suffix.shift();path=PATH+(suffix.length?'/'+suffix.join('/'):'');}const pk=p.pkFor(audience);
 if(actor.scope?.allRegions!==true)fail('PERMISSION_REQUIRED',403);
 const can=k=>ctx.allowed(actor,k),read=async sk=>(await ctx.db.send(new GetCommand({TableName:ctx.table,Key:{pk:pk,sk},ConsistentRead:true}))).Item;
 if(!can('settings.read'))fail('PERMISSION_REQUIRED',403);
 if(method==='GET'&&path===PATH){const [current,draft]=await Promise.all([read('CURRENT'),read('DRAFT')]);return {current:current?p.readPublished(current):null,draft:draft??null,defaults:p.defaults(audience),canEdit:can('settings.change.request'),canPublish:workflow.direct()?can('settings.change.request'):can('settings.change.approve'),directWrite:workflow.direct()};}
 if(method==='GET'&&new RegExp('^'+PATH+'/version/[1-9][0-9]{0,6}$').test(path)){const version=Number(path.split('/').pop()),row=await read('VERSION#'+String(version).padStart(10,'0'));if(!row||row.version!==version)fail('VERSION_NOT_FOUND',404);return {bundle:p.readPublished({...row,sk:'CURRENT'})};}
 if(method==='GET'&&path===PATH+'/history'){const r=await ctx.db.send(new QueryCommand({TableName:ctx.table,KeyConditionExpression:'pk = :pk AND begins_with(sk,:v)',ExpressionAttributeValues:{':pk':pk,':v':'VERSION#'},ScanIndexForward:false,Limit:30,ConsistentRead:true}));return {versions:(r.Items??[]).map(x=>({revision:x.version,digest:x.digest,publishedAt:x.publishedAt,publishedBy:x.publishedBy,reason:x.reason}))};}
 if(method!=='POST'||![PATH+'/draft',PATH+'/publish'].includes(path))fail('NOT_FOUND',404);
 if(!ctx.enrolled)fail('ENROLLMENT_REQUIRED',403);ctx.recent(ctx.claims);
 if(typeof input.reason!=='string'||input.reason.trim().length<5||input.reason.length>300)fail('REASON_REQUIRED');
 const current=await read('CURRENT'),version=current?.version??0;
 if(input.baseVersion!==version)fail('VERSION_OR_STATE_CONFLICT',409);
 const fence={ConditionCheck:{TableName:ctx.table,Key:{pk:pk,sk:'CURRENT'},ConditionExpression:current?'#v = :v':'attribute_not_exists(pk)',...(current?{ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':v':version}}:{})}};
 const now=new Date().toISOString();
 if(path===PATH+'/draft'){
  if(!can('settings.change.request'))fail('PERMISSION_REQUIRED',403);
  const values=p.validate(input.values);if(values.audience!==audience)fail('INVALID_LEGAL_AUDIENCE');const old=await read('DRAFT');
  if((old?.draftId??null)!==(input.draftId??null))fail('DRAFT_CHANGED',409);
  const next={pk:pk,sk:'DRAFT',draftId:randomUUID(),baseVersion:version,values,editedBy:actor.employeeId,editedAt:now,reason:input.reason.trim()};
  await ctx.db.send(new TransactWriteCommand({TransactItems:[ctx.guard(actor),fence,{Put:{TableName:ctx.table,Item:next,ConditionExpression:old?'draftId = :id':'attribute_not_exists(pk)',...(old?{ExpressionAttributeValues:{':id':old.draftId}}:{})}},ctx.audit(actor.employeeId,'CUSTOMER_LEGAL_DRAFT_SAVED',old??null,next,next.draftId)]}));return {status:'DRAFT_SAVED',draft:next};
 }
 if(!(workflow.direct()?can('settings.change.request'):can('settings.change.approve')))fail('PERMISSION_REQUIRED',403);
 const draft=await read('DRAFT');if(!draft||draft.draftId!==input.draftId||draft.baseVersion!==version)fail('DRAFT_CHANGED',409);
 if(!workflow.direct()&&draft.editedBy===actor.employeeId)fail('INDEPENDENT_APPROVAL_REQUIRED',403);
 const values=p.validate(draft.values);if(values.audience!==audience)fail('INVALID_LEGAL_AUDIENCE');const bundle={schemaVersion:1,revision:version+1,publishedAt:now,...values};
 const next={pk:pk,sk:'CURRENT',status:'PUBLISHED',version:version+1,values,digest:p.hash(bundle),publishedAt:now,publishedBy:actor.employeeId,reason:input.reason.trim()};
 await ctx.db.send(new TransactWriteCommand({TransactItems:[ctx.guard(actor),{Put:{TableName:ctx.table,Item:next,ConditionExpression:current?'#v = :v':'attribute_not_exists(pk)',...(current?{ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':v':version}}:{})}},{Put:{TableName:ctx.table,Item:{...next,sk:'VERSION#'+String(next.version).padStart(10,'0')},ConditionExpression:'attribute_not_exists(sk)'}},{Delete:{TableName:ctx.table,Key:{pk:pk,sk:'DRAFT'},ConditionExpression:'draftId = :id',ExpressionAttributeValues:{':id':draft.draftId}}},ctx.audit(actor.employeeId,'CUSTOMER_LEGAL_PUBLISHED',current??null,next,randomUUID())]}));return {status:'PUBLISHED',current:p.readPublished(next)};
}
module.exports={route,PATH};
