'use strict';
const {createHash}=require('node:crypto');
const {GetCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {allowed}=require('./catalog');
const {revision,fence}=require('./campaign-version');
const TABLE='staging-PlatformStaff',OFFERS='WizzCentral_Platform_Discounts';
const fail=(code,status=400)=>{throw Object.assign(Error(code),{status});};
const key=id=>({pk:'CAMPAIGN_PUSH#'+id,sk:'META'});
const jobIdFor=campaign=>createHash('sha256').update(campaign.discountId+':'+campaign.version).digest('hex');
const rejectedCodes=new Set(['messaging/third-party-auth-error','messaging/invalid-apns-credentials']);
function canRetry(job){const c=job.resultCounts||{},errors=Object.entries(c.failuresByCode||{});return ['FAILED','PARTIAL'].includes(job.status)&&c.sent===0&&c.failed>0&&errors.length>0&&errors.every(([code])=>rejectedCodes.has(code))&&errors.reduce((sum,[,n])=>sum+n,0)===c.failed;}
function result(job,campaign){
 const c=job.resultCounts;let state=job.status;
 if(state==='SENT'&&c?.targeted===0)state='NO_RECIPIENTS';
 if(state==='PARTIAL'&&c?.sent===0&&c?.failed>0)state='FAILED';
 return {success:true,notificationStatus:state,jobId:job.jobId,counts:c||null,retryable:canRetry(job),firstOrderOnly:campaign.firstOrderOnly===true||['first-order','first_order'].includes(campaign.campaignType)};
}
async function status(ctx,actor,input){
 if(!allowed(actor,'promotions.read'))fail('PERMISSION_REQUIRED',403);
 if(input.source!=='PLATFORM'||typeof input.discountId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_:#.-]{0,149}$/.test(input.discountId))fail('CAMPAIGN_SCOPE_INVALID');
 if(Object.keys(input).some(k=>!['source','discountId','action'].includes(k)))fail('INVALID_CAMPAIGN_REQUEST');
 const campaign=(await ctx.db.send(new GetCommand({TableName:OFFERS,Key:{discountId:input.discountId},ConsistentRead:true}))).Item;
 if(!campaign)fail('CAMPAIGN_UNAVAILABLE',404);
 if(actor.scope?.allRegions!==true&&(!campaign.targetRegionIds?.length||campaign.targetRegionIds.some(r=>!allowed(actor,'promotions.read',r))))fail('REGION_SCOPE_REQUIRED',403);
 const job=(await ctx.db.send(new GetCommand({TableName:TABLE,Key:key(jobIdFor(campaign)),ConsistentRead:true}))).Item;
 return job?result(job,campaign):{success:true,notificationStatus:'NOT_REQUESTED'};
}
async function route(ctx,actor,input){
 if(!allowed(actor,'promotions.edit')||!allowed(actor,'promotions.approve'))fail('PERMISSION_REQUIRED',403);
 if(!ctx.enrolled)fail('ENROLLMENT_REQUIRED',403);
 if(input.source!=='PLATFORM'||typeof input.discountId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_:#.-]{0,149}$/.test(input.discountId))fail('CAMPAIGN_SCOPE_INVALID');
 if(Object.keys(input).some(k=>!['source','discountId','action','baseRevision','notification'].includes(k)))fail('INVALID_CAMPAIGN_REQUEST');
 const campaign=(await ctx.db.send(new GetCommand({TableName:OFFERS,Key:{discountId:input.discountId},ConsistentRead:true}))).Item;
 if(!campaign)fail('CAMPAIGN_UNAVAILABLE',404);
 if(input.baseRevision!==revision(campaign))fail('VERSION_OR_STATE_CONFLICT',409);
 if(actor.scope?.allRegions!==true&&(!campaign.targetRegionIds?.length||campaign.targetRegionIds.some(r=>!allowed(actor,'promotions.read',r))))fail('REGION_SCOPE_REQUIRED',403);
 const now=ctx.now?.()||Date.now();
 const limit=campaign.usageLimit??campaign.limit??0,used=Math.max(campaign.usage||0,campaign.currentUsage||0);
 if(campaign.isDeleted===true||campaign.deletedAt||limit>0&&used>=limit)fail('CAMPAIGN_PUSH_NOT_LIVE',409);
 if(campaign.status!=='active'||campaign.isActive===false||!(Date.parse(campaign.validFrom||campaign.startDate)<=now&&Date.parse(campaign.validTo||campaign.endDate)>now))fail('CAMPAIGN_PUSH_NOT_LIVE',409);
 const n=input.notification||{};
 if(typeof n!=='object'||Array.isArray(n)||Object.keys(n).some(k=>!['title','body'].includes(k))||['title','body'].some(k=>n[k]!==undefined&&typeof n[k]!=='string'))fail('CAMPAIGN_PUSH_INVALID');
 const title=(n.title||(campaign.title||campaign.name||'').slice(0,100)).trim(),body=(n.body||(campaign.description||'عرض جديد متاح في تطبيق ويز يوزر').slice(0,150)).trim();
 if(!title||title.length>100||!body||body.length>150)fail('CAMPAIGN_PUSH_INVALID');
 if(!Number.isSafeInteger(campaign.version)||campaign.version<1)fail('CAMPAIGN_VERSION_INVALID',409);
 const jobId=jobIdFor(campaign);
 const jobKey=key(jobId),existing=(await ctx.db.send(new GetCommand({TableName:TABLE,Key:jobKey,ConsistentRead:true}))).Item;
 if(existing){
  if(existing.title!==title||existing.body!==body)fail('CAMPAIGN_PUSH_ALREADY_REQUESTED',409);
  if(canRetry(existing)){
   try{await ctx.db.send(new TransactWriteCommand({TransactItems:[ctx.guard(actor),{ConditionCheck:{TableName:OFFERS,Key:{discountId:campaign.discountId},...fence(campaign)}},{Update:{TableName:TABLE,Key:jobKey,UpdateExpression:'SET #s=:queued, retriedAt=:at REMOVE completedAt, resultCounts',ConditionExpression:'#s=:old AND resultCounts.sent=:zero AND resultCounts.failed=:failed',ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':queued':'QUEUED',':at':new Date(now).toISOString(),':old':existing.status,':zero':0,':failed':existing.resultCounts.failed}}},ctx.audit(actor.employeeId,'CAMPAIGN_CUSTOMER_PUSH_RETRY_REQUESTED',null,{jobId,discountId:campaign.discountId,version:campaign.version},jobId)]}));}
   catch(e){if(e.name==='TransactionCanceledException')fail('VERSION_OR_STATE_CONFLICT',409);throw e;}
  }else if(existing.status!=='QUEUED')return result(existing,campaign);
 }else{
  try{await ctx.db.send(new TransactWriteCommand({TransactItems:[ctx.guard(actor),{ConditionCheck:{TableName:OFFERS,Key:{discountId:campaign.discountId},...fence(campaign)}},{Put:{TableName:TABLE,Item:{...jobKey,jobId,discountId:campaign.discountId,campaignVersion:campaign.version,title,body,status:'QUEUED',requestedBy:actor.employeeId,createdAt:new Date(now).toISOString()},ConditionExpression:'attribute_not_exists(pk)'}},ctx.audit(actor.employeeId,'CAMPAIGN_CUSTOMER_PUSH_REQUESTED',null,{discountId:campaign.discountId,version:campaign.version,jobId,recipientApp:'user'},jobId)]}));}
  catch(e){if(e.name==='TransactionCanceledException')fail('VERSION_OR_STATE_CONFLICT',409);throw e;}
 }
 await ctx.invoke(jobId);
 return {success:true,notificationStatus:'QUEUED',jobId};
}
module.exports={route,status,key};
