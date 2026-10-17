'use strict';
// REQUESTS_ONLY: existing order permissions authorize a review intent, never
// impersonation of a driver/owner or execution of cancellation, funds or search.
// A separate worker must revalidate authority, evidence and lifecycle before effects.
const {createHash}=require('crypto');
const {GetCommand,QueryCommand,ScanCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {allowed}=require('./catalog');
const PATH='/staff/dispatch-reviews',JOBS='WizzDispatchJobs_staging',ORDERS='WizzOrders',BRANCH='WhizzMerchants_Businesses',HOLDS='staging-Holds',LOCKS='staging-AccountDeletion';
const fail=(code,status=409)=>Object.assign(Error(code),{status});
const id=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_:#.-]{0,149}$/.test(v);
const canon=v=>JSON.stringify(v===undefined?null:Array.isArray(v)?v.map(x=>JSON.parse(canon(x))):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(canon(v[k]))])):v);
const hash=v=>createHash('sha256').update(canon(v)).digest('hex');
const fields={order:['PK','SK','orderId','storeId','businessId','status','orderStatus','driverId','assignedDriverId','pickedUpAt','deliveredAt','completedAt','financialOutcome','financialRelease','returnCaseId','returnStatus','cashCollected','cashCollectedAmount','cancellationRequestId','cancellationStatus','deletionRequestId','deletionStatus','deletedAt','isDeleted','dispatchReviewOutcome'],branch:['businessId','regionId','businessName','name','ownerId','cognitoUserId','status','isActive','ordersBlocked','platformSuspended','isDeleted','deletedAt','deletionRequestId'],hold:['orderId','sk','holdId','status','version','updatedAt'],job:['orderId','SK','kind','status','state','restaurantId','dispatchJobId','dispatchCycle','dispatchReview','financialDispatch','financialSearchVersion','noDriverReason','attemptId','cycleId','branchId','version','reason','updatedAt','createdAt','dispatchReviewOutcome']};
function exact(table,key,row,keys){const names={},values={},parts=[];for(const [i,k]of keys.entries()){names['#g'+i]=k;if(row?.[k]===undefined)parts.push('attribute_not_exists(#g'+i+')');else{values[':g'+i]=row[k];parts.push('#g'+i+'=:g'+i);}}return {ConditionCheck:{TableName:table,Key:key,ConditionExpression:parts.join(' AND '),ExpressionAttributeNames:names,...(Object.keys(values).length?{ExpressionAttributeValues:values}:{})}};}
const selector=q=>q.source==='SEARCH'?{orderId:q.orderId,SK:'METADATA'}:{orderId:q.orderId,SK:'DISPATCH_ACCEPTANCE#'+q.attemptId};
function validate(q){if(!q||Object.keys(q).some(k=>!['orderId','source','attemptId'].includes(k))||!id(q.orderId)||!['SEARCH','ACCEPTANCE'].includes(q.source)||q.source==='ACCEPTANCE'&&!/^LA:[a-f0-9]{48}$/.test(q.attemptId||''))throw fail('INVALID_REVIEW_SELECTOR',400);return {orderId:q.orderId,source:q.source,...(q.source==='ACCEPTANCE'?{attemptId:q.attemptId}:{})};}
function candidate(r){return r.SK==='METADATA'&&r.status==='no_driver_available'&&(r.dispatchReview?.reviewStatus==='REQUIRED'||r.financialDispatch===true&&r.financialSearchVersion===1)||r.kind==='LEGACY_ACCEPTANCE_ATTEMPT'&&['RESERVATION_PENDING','ASSIGNMENT_PENDING','REVIEW_REQUIRED'].includes(r.state);}
function createReviewReader(ctx,actor){
 const get=async(table,key,keys)=>{const names=keys&&Object.fromEntries(keys.map((k,i)=>['#p'+i,k]));return (await ctx.db.send(new GetCommand({TableName:table,Key:key,ConsistentRead:true,...(names?{ProjectionExpression:Object.keys(names).join(','),ExpressionAttributeNames:names}:{})}))).Item;};
 async function fresh(){const live=await ctx.employee(actor.employeeId);if(!live||live.version!==actor.version||live.status!=='ACTIVE')throw fail('EMPLOYEE_CHANGED',403);}
 async function load(q){
  q=validate(q);const key=selector(q),source=await get(JOBS,key,fields.job),job=q.source==='SEARCH'?source:await get(JOBS,{orderId:q.orderId,SK:'METADATA'},fields.job);
  if(!source||!job||!id(job.restaurantId))throw fail('REVIEW_UNAVAILABLE',404);
  const [order,branch,hold]=await Promise.all([get(ORDERS,{PK:'ORDER#'+q.orderId,SK:'META'},fields.order),get(BRANCH,{businessId:job.restaurantId},fields.branch),get(HOLDS,{orderId:q.orderId,sk:'HOLD'},fields.hold)]);
  if(!order||order.orderId!==q.orderId||![order.storeId,order.businessId].includes(job.restaurantId)||[order.storeId,order.businessId].some(v=>v!==undefined&&v!==job.restaurantId)||!branch||branch.businessId!==job.restaurantId||!allowed(actor,'orders.read',branch.regionId)||!id(branch.ownerId)||branch.cognitoUserId!==branch.ownerId)throw fail('REVIEW_UNAVAILABLE',404);
  const guards=[exact(JOBS,key,source,fields.job),...(q.source==='SEARCH'?[]:[exact(JOBS,{orderId:q.orderId,SK:'METADATA'},job,fields.job)]),exact(ORDERS,{PK:order.PK,SK:order.SK},order,fields.order),exact(BRANCH,{businessId:branch.businessId},branch,fields.branch),exact(HOLDS,{orderId:q.orderId,sk:'HOLD'},hold,fields.hold)];
  if(order.deletionRequestId!=null||order.deletionStatus!=null||order.deletedAt!=null||order.isDeleted===true||branch.deletionRequestId!=null||branch.deletedAt!=null||branch.isDeleted===true)throw fail('REVIEW_UNAVAILABLE',404);
  for(const pk of ['ACCOUNT_LIFECYCLE#MERCHANT#'+branch.ownerId,'BUSINESS_LIFECYCLE#MERCHANT#'+branch.businessId]){if(await get(LOCKS,{pk,sk:'META'},['pk','sk']))throw fail('REVIEW_UNAVAILABLE',404);guards.push(exact(LOCKS,{pk,sk:'META'},undefined,['pk']));}
  const cycle=q.source==='SEARCH'?job.dispatchCycle?.id??job.dispatchJobId:source.cycleId;if(!id(cycle)||q.source==='ACCEPTANCE'&&(source.kind!=='LEGACY_ACCEPTANCE_ATTEMPT'||source.attemptId!==q.attemptId))throw fail('REVIEW_UNAVAILABLE',404);
  let pending=false,attempts=[];
  if(q.source==='SEARCH'){
   let cursor;const seen=new Set(),projection=Object.fromEntries(fields.job.map((k,i)=>['#j'+i,k]));for(let page=0;page<5;page++){const r=await ctx.db.send(new QueryCommand({TableName:JOBS,KeyConditionExpression:'orderId=:id AND begins_with(SK,:prefix)',ExpressionAttributeValues:{':id':q.orderId,':prefix':'DISPATCH_ACCEPTANCE#'},ConsistentRead:true,Limit:20,ExclusiveStartKey:cursor,ProjectionExpression:Object.keys(projection).join(','),ExpressionAttributeNames:projection}));attempts.push(...r.Items||[]);cursor=r.LastEvaluatedKey;if(!cursor)break;const s=canon(cursor);if(seen.has(s))throw fail('REVIEW_INCOMPLETE',503);seen.add(s);}
   if(cursor||attempts.length>50)throw fail('REVIEW_INCOMPLETE',503);
   for(const a of attempts){if(a.orderId!==q.orderId||a.kind!=='LEGACY_ACCEPTANCE_ATTEMPT'||a.SK!=='DISPATCH_ACCEPTANCE#'+a.attemptId||!['ASSIGNED','RESERVATION_PENDING','ASSIGNMENT_PENDING','REVIEW_REQUIRED'].includes(a.state))throw fail('REVIEW_INCOMPLETE',503);if(['RESERVATION_PENDING','ASSIGNMENT_PENDING','REVIEW_REQUIRED'].includes(a.state))pending=true;guards.push(exact(JOBS,{orderId:q.orderId,SK:a.SK},a,fields.job));}
  }
  const active=candidate(source)&&(q.source!=='ACCEPTANCE'||job.dispatchCycle?.id===source.cycleId),before=['ready_for_pickup','confirmed','preparing','pending'].includes(order.status)&&order.driverId==null&&order.assignedDriverId==null&&order.pickedUpAt==null&&order.deliveredAt==null&&order.completedAt==null&&order.financialOutcome==null&&order.returnCaseId==null&&order.returnStatus==null&&order.cancellationRequestId==null&&order.cancellationStatus==null&&[undefined,null,false].includes(order.cashCollected)&&[undefined,null,0].includes(order.cashCollectedAmount);
  const safeHold=!hold||hold.status==='RELEASED';
  const ready=active&&q.source==='SEARCH'&&before&&safeHold&&!pending;
  const caseId=hash({orderId:q.orderId,source:q.source,cycle,...(q.attemptId?{attemptId:q.attemptId}:{})}),decisionKey={pk:'DISPATCH_REVIEW#'+caseId,sk:'DECISION'},decision=await get(ctx.table,decisionKey);
  const baseDigest=hash({source,job,order,branch,hold:hold??null,attempts});
  const publicDecision=decision?{requestId:decision.requestId,action:decision.action,status:decision.status,reason:decision.reason,createdAt:decision.createdAt,resultCode:decision.resultCode??null,executedAt:decision.executedAt??null,stale:['PENDING_EXECUTION','BLOCKED_DEPENDENCY'].includes(decision.status)&&decision.baseDigest!==baseDigest}:null;
  const item={...q,caseId,baseDigest,active,branchId:branch.businessId,branchName:branch.businessName??branch.name??branch.businessId,regionId:branch.regionId,reason:q.source==='SEARCH'?source.dispatchReview?.reason??source.noDriverReason:source.reason??source.state,phase:q.source==='SEARCH'?'SEARCH_EXHAUSTED':source.state,orderStatus:order.status,goodsState:before?'BEFORE_PICKUP_RECORDED':'REQUIRES_CHECK',holdState:hold?.status??'NOT_RECORDED',pendingAcceptance:pending,decision:publicDecision,executionReady:false,
   canRequestRetry:!decision&&ready&&branch.status==='approved'&&branch.isActive===true&&branch.ordersBlocked!==true&&branch.platformSuspended!==true&&allowed(actor,'orders.assign',branch.regionId),
   canRequestCancel:!decision&&ready&&allowed(actor,'orders.cancel',branch.regionId),
   canRequestReservationReview:!decision&&active&&q.source==='ACCEPTANCE'&&allowed(actor,'orders.assign',branch.regionId)};
  return {item,guards,decisionKey,decision,baseDigest,source,job,order,branch,hold,attempts};
 }
 async function readFence(c){
  const decisionGuard=exact(ctx.table,c.decisionKey,c.decision,c.decision?Object.keys(c.decision):['pk']);
  try{await ctx.db.send(new TransactWriteCommand({TransactItems:[ctx.guard(actor),...c.guards,decisionGuard]}));}
  catch(e){if(e.name==='TransactionCanceledException')throw fail('REVIEW_CHANGED');throw e;}
 }
 return {get,fresh,load,readFence};
}
async function route(ctx,actor,method,path,input={}){
 if((ctx.mode??process.env.DISPATCH_REVIEW_MODE)!=='REQUESTS_ONLY')throw fail('DISPATCH_REVIEW_DISABLED',503);
 if(!allowed(actor,'orders.read'))throw fail('PERMISSION_REQUIRED',403);
 const {get,fresh,load,readFence}=createReviewReader(ctx,actor);
 if(method==='GET'&&path===PATH){
  const query=ctx.query||{};
  if(query.orderId){const c=await load(query);await readFence(c);await fresh();return {item:c.item,mode:'REQUESTS_ONLY'};}
  let cursor;if(query.cursor){try{const c=JSON.parse(Buffer.from(query.cursor,'base64url').toString());if(query.cursor.length>2048||c.actorId!==actor.employeeId||c.version!==actor.version||!id(c.key?.orderId)||typeof c.key.SK!=='string'||c.key.SK.length>220||Object.keys(c.key).sort().join(',')!=='SK,orderId')throw Error();cursor=c.key;}catch{throw fail('INVALID_CURSOR',400);}}
  const projection=Object.fromEntries(fields.job.map((k,i)=>['#p'+i,k]));
  const result=await ctx.db.send(new ScanCommand({TableName:JOBS,ConsistentRead:true,Limit:25,ExclusiveStartKey:cursor,ProjectionExpression:Object.keys(projection).join(','),ExpressionAttributeNames:projection})),items=[];
  for(const row of result.Items||[]){if(ctx.scopeContains&&!ctx.scopeContains(row.orderId))continue;if(!candidate(row)&&!(row.SK==='METADATA'&&row.dispatchReviewOutcome?.caseId))continue;try{const c=await load({orderId:row.orderId,source:row.SK==='METADATA'?'SEARCH':'ACCEPTANCE',attemptId:row.attemptId});if(c.item.active||c.item.decision){await readFence(c);items.push(c.item);}}catch(e){if(e.message!=='REVIEW_UNAVAILABLE')throw e;}}
  await fresh();return {items,nextCursor:result.LastEvaluatedKey?Buffer.from(JSON.stringify({actorId:actor.employeeId,version:actor.version,key:result.LastEvaluatedKey})).toString('base64url'):null,mode:'REQUESTS_ONLY'};
 }
 if(method!=='POST'||path!==PATH+'/decisions')throw fail('NOT_FOUND',404);
 if(!ctx.enrolled)throw fail('ENROLLMENT_REQUIRED',403);ctx.recent(ctx.claims);
 if(Object.keys(input).sort().join(',')!=='action,baseDigest,reason,requestId,selector'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input.requestId||'')||!['RETRY_SEARCH','CANCEL_BEFORE_PICKUP','CHECK_RESERVATION'].includes(input.action)||!/^[a-f0-9]{64}$/.test(input.baseDigest||'')||typeof input.reason!=='string'||input.reason.trim().length<5||input.reason.length>1000)throw fail('INVALID_REVIEW_DECISION',400);
 const c=await load(input.selector),permission=input.action==='CANCEL_BEFORE_PICKUP'?'orders.cancel':'orders.assign';if(!allowed(actor,permission,c.item.regionId))throw fail('PERMISSION_REQUIRED',403);
 const requestDigest=hash(input);
 function receipt(row,replayed=false){if(!['PENDING_EXECUTION','EXECUTED','STALE','AUTHORIZATION_CHANGED','BLOCKED_DEPENDENCY','NEEDS_REVIEW','SUPPRESSED_DELETION'].includes(row.status))throw fail('REVIEW_CHANGED');return {saved:true,status:row.status,executed:row.status==='EXECUTED',requestId:row.requestId,action:row.action,resultCode:row.resultCode??null,executedAt:row.executedAt??null,replayed};}
 if(c.decision){if(c.decision.requestId===input.requestId&&c.decision.actorId===actor.employeeId&&c.decision.requestDigest===requestDigest){await fresh();return receipt(c.decision,true);}throw fail('REVIEW_ALREADY_DECIDED');}
 if(c.baseDigest!==input.baseDigest)throw fail('REVIEW_CHANGED');
 const flag={RETRY_SEARCH:'canRequestRetry',CANCEL_BEFORE_PICKUP:'canRequestCancel',CHECK_RESERVATION:'canRequestReservationReview'}[input.action];if(!c.item[flag])throw fail('REVIEW_ACTION_NOT_ALLOWED');
 const row={...c.decisionKey,kind:'DISPATCH_REVIEW_DECISION',schemaVersion:1,caseId:c.item.caseId,orderId:c.item.orderId,branchId:c.item.branchId,regionId:c.item.regionId,selector:validate(input.selector),baseDigest:c.baseDigest,requestId:input.requestId,requestDigest,action:input.action,reason:input.reason.trim(),status:'PENDING_EXECUTION',actorId:actor.employeeId,actorVersion:actor.version,createdAt:new Date().toISOString()};
 const tx=[ctx.guard(actor),...c.guards,{Put:{TableName:ctx.table,Item:row,ConditionExpression:'attribute_not_exists(pk)'}},ctx.audit(actor.employeeId,'DISPATCH_REVIEW_DECISION_REQUESTED',{orderId:row.orderId,caseId:row.caseId},{requestId:row.requestId,action:row.action,status:row.status},row.requestId)];
 if(tx.length>100||Buffer.byteLength(JSON.stringify(tx))>3500000)throw fail('REVIEW_INCOMPLETE',503);
 try{await ctx.db.send(new TransactWriteCommand({TransactItems:tx}));}catch(e){const saved=await get(ctx.table,c.decisionKey);if(saved?.requestId===row.requestId&&saved.actorId===actor.employeeId&&saved.requestDigest===requestDigest){await fresh();return receipt(saved,true);}if(e.name==='TransactionCanceledException')throw fail('REVIEW_CHANGED');throw e;}
 return receipt(row);
}
module.exports={route,PATH,hash,createReviewReader};
