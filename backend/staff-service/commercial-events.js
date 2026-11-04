'use strict';
// Read the existing transactional consent audit. No inferred or fabricated approvals.
const {QueryCommand,GetCommand}=require('@aws-sdk/lib-dynamodb');
const {allowed}=require('./catalog');
const S='staging-PlatformStaff',P='staging-MerchantPlatform',B='WhizzMerchants_Businesses';
const fail=(message,status)=>{throw Object.assign(Error(message),{status});};
const clean=v=>typeof v==='string'?v.trim().slice(0,120):'';
async function list(ctx,actor,input){
 if(!allowed(actor,'commercial.read')||actor.scope?.allRegions!==true)fail('PERMISSION_REQUIRED',403);
 if(Object.keys(input).length!==1||input.view!=='platform-events')fail('INVALID_COMMERCIAL_REQUEST',400);
 const now=ctx.now?Date.parse(ctx.now()):Date.now(),from=new Date(now-7*86400000).toISOString(),to=new Date(now+30000).toISOString()+'~';
 let cursor;const rows=[];
 for(let page=0;page<20;page++){
  const q=await ctx.db.send(new QueryCommand({TableName:S,KeyConditionExpression:'pk=:pk AND sk BETWEEN :from AND :to',FilterExpression:'#action IN (:agreement,:funding)',ExpressionAttributeNames:{'#action':'action'},ExpressionAttributeValues:{':pk':'AUDIT',':from':from,':to':to,':agreement':'COMMERCIAL_ACCEPT_AGREEMENT',':funding':'COMMERCIAL_ACCEPT_FUNDING'},ConsistentRead:true,ScanIndexForward:false,Limit:100,...(cursor?{ExclusiveStartKey:cursor}:{})}));
  rows.push(...q.Items||[]);cursor=q.LastEvaluatedKey;if(!cursor||rows.length>=50)break;
  if(page===19)fail('COMMERCIAL_EVENTS_INCOMPLETE',503);
 }
 const get=async(t,k)=>(await ctx.db.send(new GetCommand({TableName:t,Key:k,ConsistentRead:true}))).Item;
 const items=[];
 for(const row of rows.slice(0,50)){
  const a=row.after,before=row.before;if(!['OWNER','MANAGER'].includes(a?.actorKind)||typeof row.actorId!=='string'||!row.actorId.startsWith(a.actorKind+'#')||!before?.businessId||!before.id||!Number.isSafeInteger(a.draftVersion))continue;
  const subjectId=row.actorId.slice(a.actorKind.length+1),funding=row.action==='COMMERCIAL_ACCEPT_FUNDING',pk=(funding?'DISCOUNT_FUNDING#':'COMMERCIAL_AGREEMENT#')+before.id;
  const consent=await get(funding?S:P,{pk,sk:'CONSENT#'+a.draftVersion}),branch=await get(B,{businessId:before.businessId});
  if(!consent||consent.subjectId!==subjectId||!branch||branch.cognitoUserId!==branch.ownerId||(a.actorKind==='OWNER'?branch.ownerId!==subjectId:consent.acceptedRole!=='MANAGER'||consent.ownerId!==branch.ownerId)||branch.deletionRequestId||branch.deletedAt||branch.isDeleted)continue;
  const profile=await get(P,{pk:'PERSON#'+subjectId,sk:'PROFILE'}),draft=await get(funding?S:P,{pk,sk:'DRAFT'});
  let label=funding?'مشاركة خصم':'الاتفاقية التجارية';
  if(funding&&draft?.values){const v=draft.values,campaign=await get(v.source==='MERCHANT'?'WhizzMerchants_Discounts':'WizzCentral_Platform_Discounts',{discountId:v.campaignId});label=clean(campaign?.title)||clean(campaign?.name)||label;}
  const current=await get(funding?S:P,{pk,sk:'CURRENT'});
  items.push({publicationVersion:current?.acceptedAt===consent.acceptedAt?current.version:null,eventId:row.sk,businessId:before.businessId,businessName:clean(branch.businessName)||clean(branch.name)||'المتجر',sharingId:funding?before.id:null,kind:funding?'FUNDING':'AGREEMENT',label,draftVersion:a.draftVersion,acceptedAt:consent.acceptedAt,acceptedBy:{role:a.actorKind,name:clean(profile?.fullName)||clean(profile?.displayName)||clean(profile?.name)||(a.actorKind==='MANAGER'?'مدير الفرع':'مالك المتجر')}});
 }
 return {items,serverTime:new Date(now).toISOString(),windowDays:7};
}
module.exports={list};
