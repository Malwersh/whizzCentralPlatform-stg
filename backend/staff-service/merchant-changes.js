'use strict';
const {GetCommand,QueryCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {allowed}=require('./catalog');
const domain=require('./business-change-review');
const TABLE='staging-MerchantPlatform',B='WhizzMerchants_Businesses';
const fail=(code,status=400)=>Object.assign(Error(code),{status});
async function route(ctx,actor,method,input={}){
 if(!allowed(actor,'merchants.read'))throw fail('PERMISSION_REQUIRED',403);
 const get=async(table,key)=>(await ctx.db.send(new GetCommand({TableName:table,Key:key,ConsistentRead:true}))).Item;
 const permitted=(permission,b,r)=>allowed(actor,permission,b.regionId)&&(r.kind!=='LOCATION'||allowed(actor,permission,r.proposed.regionPath[3]));
 if(method==='GET'){
  const items=[];let cursor;do{const page=await ctx.db.send(new QueryCommand({TableName:TABLE,KeyConditionExpression:'pk=:pk AND begins_with(sk,:prefix)',ExpressionAttributeValues:{':pk':'REVIEW#MERCHANT',':prefix':'CHANGE#'},ExclusiveStartKey:cursor,ConsistentRead:true}));for(const queue of page.Items||[]){if(queue.status!=='PENDING')continue;const request=await get(TABLE,{pk:queue.requestPk,sk:queue.sk}),business=await get(B,{businessId:queue.businessId});if(!business||business.deletionRequestId||!request||request.status!=='PENDING'||request.version!==queue.version||request.subjectId!==business.ownerId||!permitted('merchants.read',business,request))continue;items.push({request,businessName:business.businessName,canReview:permitted('merchants.review',business,request)});}cursor=page.LastEvaluatedKey;}while(cursor);return {items};
 }
 if(method!=='POST'||!allowed(actor,'merchants.review'))throw fail('PERMISSION_REQUIRED',403);
 if(typeof input.reason!=='string'||input.reason.trim().length<5||input.reason.length>1000)throw fail('REASON_REQUIRED');
 if(typeof input.requestId!=='string'||!/^[a-f0-9-]{36}$/i.test(input.requestId)||!Number.isSafeInteger(input.baseVersion))throw fail('INVALID_REVIEW');
 const queue=await get(TABLE,{pk:'REVIEW#MERCHANT',sk:'CHANGE#'+input.requestId});if(!queue)throw fail('REQUEST_UNAVAILABLE',404);
 const request=await get(TABLE,{pk:queue.requestPk,sk:queue.sk}),business=await get(B,{businessId:queue.businessId});
 if(!business||!request||!permitted('merchants.review',business,request))throw fail('REQUEST_UNAVAILABLE',404);
 if(request.version!==input.baseVersion||request.version!==queue.version||queue.status!=='PENDING'||queue.subjectId!==request.subjectId)throw fail('VERSION_OR_STATE_CONFLICT',409);
 let validatedLocation;
 if(request.kind==='LOCATION'&&input.decision==='APPROVE'){
  const p=request.proposed,v=await require('./merchant-change-regions').validate(ctx.db,p.regionPath,p.latitude,p.longitude);
  validatedLocation={...v,latitude:p.latitude,longitude:p.longitude,address:{fullAddress:p.address,latitude:p.latitude,longitude:p.longitude,country:v.regionNames[0],city:v.regionNames[1],district:v.regionNames[2],region:v.regionNames[3]}};
 }
 const now=new Date().toISOString();let plan;
 try{plan=domain.decide({business,request,decision:input.decision,actorId:actor.employeeId,reason:input.reason,now,validatedLocation});}catch(e){throw fail(e.code||e.message,['CHANGE_BASE_CONFLICT','REQUEST_NOT_PENDING','OWNERSHIP_CHANGED'].includes(e.code)?409:400);}
 const tx=[ctx.guard(actor),...['ACCOUNT_LIFECYCLE#MERCHANT#'+request.subjectId,'BUSINESS_LIFECYCLE#MERCHANT#'+request.businessId].map(pk=>({ConditionCheck:{TableName:'staging-AccountDeletion',Key:{pk,sk:'META'},ConditionExpression:'attribute_not_exists(pk)'}})),...plan.TransactItems];
 if(input.decision==='REJECT')tx.push({ConditionCheck:{TableName:B,Key:{businessId:business.businessId},ConditionExpression:'ownerId=:owner AND cognitoUserId=:owner AND attribute_not_exists(deletionRequestId)',ExpressionAttributeValues:{':owner':request.subjectId}}});
 tx.push({Put:{TableName:TABLE,Item:{...queue,...plan.request,pk:queue.pk,requestPk:queue.requestPk},ConditionExpression:'#s=:pending AND #v=:v',ExpressionAttributeNames:{'#s':'status','#v':'version'},ExpressionAttributeValues:{':pending':'PENDING',':v':queue.version}}},ctx.audit(actor.employeeId,'MERCHANT_CHANGE_'+input.decision,{businessId:request.businessId,requestId:request.requestId,kind:request.kind},{status:plan.request.status,reason:input.reason},request.requestId+'#'+plan.request.version));
 try{await ctx.db.send(new TransactWriteCommand({TransactItems:tx}));}catch(e){if(e.name==='TransactionCanceledException')throw fail('VERSION_OR_STATE_CONFLICT',409);throw e;}
 return {saved:true,status:plan.request.status};
}
module.exports={route};
