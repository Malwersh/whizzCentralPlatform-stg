'use strict';
// Permanent history marker: stopping a shared campaign never unlocks its terms.
const {GetCommand,ScanCommand}=require('@aws-sdk/lib-dynamodb');
const TABLE='staging-MerchantPlatform';
const key=(source,id)=>({pk:'CAMPAIGN_SHARING_LOCK#'+source+'#'+id,sk:'META'});
const fail=code=>{throw Object.assign(Error(code),{status:409,statusCode:409});};
async function read(db,source,row){
 const lockKey=key(source,row.discountId),marker=(await db.send(new GetCommand({TableName:TABLE,Key:lockKey,ConsistentRead:true}))).Item;
 let locked=!!marker||!!row.fundingPolicyId;
 const guards=[{ConditionCheck:{TableName:TABLE,Key:lockKey,ConditionExpression:marker?'attribute_exists(pk)':'attribute_not_exists(pk)'}}];
 if(!locked&&source==='MERCHANT'){
  const bindingKey={pk:'BRANCH#'+row.businessId,sk:'COMMERCIAL_SHARING#MERCHANT#'+row.discountId};
  const binding=(await db.send(new GetCommand({TableName:TABLE,Key:bindingKey,ConsistentRead:true}))).Item;
  locked=!!binding;guards.push({ConditionCheck:{TableName:TABLE,Key:bindingKey,ConditionExpression:binding?'attribute_exists(pk)':'attribute_not_exists(pk)'}});
 }else if(!locked&&source==='PLATFORM'){
  // Legacy approvals predate the permanent marker. Read every page, never assume absence.
  let cursor;do{const page=await db.send(new ScanCommand({TableName:'staging-PlatformStaff',ConsistentRead:true,FilterExpression:'campaignId = :campaign AND #source = :source AND sk = :current',ExpressionAttributeNames:{'#source':'source'},ExpressionAttributeValues:{':campaign':row.discountId,':source':'PLATFORM',':current':'CURRENT'},...(cursor?{ExclusiveStartKey:cursor}:{})}));if(page.Items?.some(r=>r.campaignId===row.discountId&&r.source==='PLATFORM'&&r.sk==='CURRENT'&&r.schemaVersion===3)){locked=true;break;}cursor=page.LastEvaluatedKey;}while(cursor);
 }
 return {locked,guards,initiallyInactive:marker?.initiallyInactive===true};
}
function assertChange(lock,before,after){
 if(!lock.locked)return;
 if(!after)fail('SHARED_DISCOUNT_DELETE_FORBIDDEN');
 const mutable=new Set(['status','isActive','autoActivate','updatedAt','updated_at','version','revision','usage','currentUsage','usage_count','usageCount','sharedStopped']);
 const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
 const terms=r=>JSON.stringify(stable(Object.fromEntries(Object.entries(r).filter(([k])=>!mutable.has(k)))));
 if(terms(before)!==terms(after))fail('SHARED_DISCOUNT_TERMS_LOCKED');
 // Once stopped, a shared discount requires a new campaign and fresh consent.
 const active=r=>typeof r.status==='string'?['active','scheduled'].includes(r.status):r.isActive===true||r.autoActivate===true;
 if((before.sharedStopped===true||!active(before)&&!lock.initiallyInactive)&&active(after))fail('SHARED_DISCOUNT_RESTART_FORBIDDEN');
 if(active(before)&&!active(after)){after.sharedStopped=true;if(before.isActive!==undefined)after.isActive=false;if(before.autoActivate!==undefined)after.autoActivate=false;}
}
module.exports={read,assertChange,key,TABLE};
