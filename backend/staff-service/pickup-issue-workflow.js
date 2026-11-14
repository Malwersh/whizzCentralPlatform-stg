'use strict';
const {GetCommand,ScanCommand,QueryCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {digest,fence}=require('./campaign-version');
const fail=(code,status=409)=>{throw Object.assign(Error(code),{status});};
const O='WizzOrders',S='staging-PlatformStaff',H='staging-Holds';
const types=['ItemUnavailable','StoreClosed','LongDelay','WrongOrder','Other'];
const pre=['assigned','accepted','heading_to_store','arrived_at_store'];
const id=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:#-]{0,149}$/.test(v);
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
const key=(orderId,reportId)=>({pk:'PICKUP_ISSUE#'+orderId,sk:'REPORT#'+reportId});
const check=(table,k,row)=>({ConditionCheck:{TableName:table,Key:k,...fence(row)}});
const shortOrder=o=>Object.fromEntries(['PK','SK','orderId','status','driverId','assignmentAttemptCounter','financialAcceptance','pickedUpAt','pickupAt','merchantHandover','deletedAt','deletionRequestId','isDeleted','pickupIssueReports','items','pricing'].map(k=>[k,o[k]]));
const minutes=v=>Number.isSafeInteger(v)&&v>=1&&v<=1440;
function sameAssignment(o,r){return o.driverId===r.driverId&&(r.assignment?o.financialAcceptance?.offerId===r.assignment.offerId&&o.assignmentAttemptCounter===r.assignment.attempt:!o.financialAcceptance);}
function view(o,r,w,now){return {orderId:o.orderId,orderNumber:o.orderNumber||o.orderId,branchName:o.storeName||o.restaurantName||'مطعم الطلب',orderStatus:o.status,reportId:r.id,issueType:r.issueType,notes:r.notes||'',reportedAt:r.reportedAt,driverId:r.driverId,reportAssignment:r.assignment||null,currentAssignmentMatches:sameAssignment(o,r),pickedUp:!!(o.pickedUpAt||o.pickupAt||o.merchantHandover),workflow:w||null,version:w?.version||0,status:w?.status||'OPEN',overdue:!!w?.followUpAt&&Date.parse(w.followUpAt)<now&&w.status!=='CLOSED'};}
async function route(ctx,actor,method,input={}){
 if(actor.scope?.allRegions!==true||!ctx.allowed(actor,'orders.read'))fail('PERMISSION_REQUIRED',403);
 const now=ctx.now?ctx.now():Date.now(),at=new Date(now).toISOString();
 const get=async(t,k)=>(await ctx.db.send(new GetCommand({TableName:t,Key:k,ConsistentRead:true}))).Item;
 const readable=o=>o&&o.SK==='META'&&id(o.orderId)&&o.PK==='ORDER#'+o.orderId&&o.deletedAt==null&&o.deletionRequestId==null&&o.isDeleted!==true;
 const canOperate=ctx.allowed(actor,'orders.cancel')||ctx.allowed(actor,'support.reply');
 if(method==='GET'&&input.view==='queue'){
  if(Object.keys(input).some(k=>!['view','cursor'].includes(k)))fail('PICKUP_WORKFLOW_INVALID',400);
  let cursor={after:null,carry:null};if(input.cursor){try{if(input.cursor.length>2000)throw Error();cursor=JSON.parse(Buffer.from(input.cursor,'base64url'));if(cursor.actor!==actor.employeeId||cursor.actorVersion!==actor.version)throw Error();for(const k of [cursor.after,cursor.carry?.key].filter(Boolean))if(Object.keys(k).sort().join(',')!=='PK,SK'||typeof k.PK!=='string'||k.PK.length>512||typeof k.SK!=='string'||k.SK.length>512)throw Error();if(cursor.carry&&(!cursor.carry.key.PK.startsWith('ORDER#')||cursor.carry.key.SK!=='META'||!Number.isSafeInteger(cursor.carry.offset)||cursor.carry.offset<0||cursor.carry.offset>50))throw Error();}catch{fail('PICKUP_WORKFLOW_CURSOR_INVALID',400);}}
  const items=[];let processed=0,scanned=0,after=cursor.after,carry=cursor.carry;
  const encode=(after,carry)=>Buffer.from(JSON.stringify({actor:actor.employeeId,actorVersion:actor.version,after,carry})).toString('base64url');
  async function consume(o,offset=0){if(!readable(o))return null;const reports=o.pickupIssueReports||[];if(!Array.isArray(reports)||reports.length>50)return null;for(let i=offset;i<reports.length;i++){if(processed>=30)return {key:{PK:o.PK,SK:o.SK},offset:i};const r=reports[i];processed++;if(!id(r.id)||!types.includes(r.issueType))continue;const w=await get(S,key(o.orderId,r.id));if(w?.status!=='CLOSED')items.push(view(o,r,w,now));}return null;}
  if(carry){const o=await get(O,carry.key);const next=await consume(o,carry.offset);if(next)return {items,nextCursor:encode(after,next),canOperate,currentEmployeeId:actor.employeeId,canTakeover:ctx.allowed(actor,'support.assign'),coverage:'BOUNDED_PAGE'};after=carry.key;}
  for(let page=0;page<3;page++){
   const r=await ctx.db.send(new ScanCommand({TableName:O,ConsistentRead:true,Limit:10,ExclusiveStartKey:after||undefined,FilterExpression:'SK=:meta AND attribute_exists(pickupIssueReports)',ExpressionAttributeValues:{':meta':'META'},ProjectionExpression:'PK,SK,orderId,orderNumber,storeName,restaurantName,#status,driverId,assignmentAttemptCounter,financialAcceptance,pickedUpAt,pickupAt,merchantHandover,deletedAt,deletionRequestId,isDeleted,pickupIssueReports',ExpressionAttributeNames:{'#status':'status'}}));
   scanned+=r.ScannedCount||0;for(const o of r.Items||[]){const next=await consume(o);if(next)return {items,nextCursor:encode(after,next),canOperate,currentEmployeeId:actor.employeeId,canTakeover:ctx.allowed(actor,'support.assign'),coverage:'BOUNDED_PAGE',scanned};}
   after=r.LastEvaluatedKey;if(!after)return {items,nextCursor:null,canOperate,currentEmployeeId:actor.employeeId,canTakeover:ctx.allowed(actor,'support.assign'),coverage:'BOUNDED_PAGE',scanned};
  }
  return {items,nextCursor:encode(after,null),canOperate,currentEmployeeId:actor.employeeId,canTakeover:ctx.allowed(actor,'support.assign'),coverage:'BOUNDED_PAGE',scanned};
 }
 const required=method==='GET'?['orderId']:['orderId','reportId','expectedVersion','requestId','action','reason',...(input.action==='CONTACT'?['party','channel','result','reference']:input.action==='WAIT'||input.action==='CLAIM'?['followUpMinutes',...(input.action==='WAIT'?['waitingOn']:[])]:input.action==='CLOSE'?['resolution','reference','originalOrderUnchanged']:[])];
 if(!['GET','POST'].includes(method)||Object.keys(input).sort().join(',')!==required.sort().join(',')||!id(input.orderId))fail('PICKUP_WORKFLOW_INVALID',400);
 let resolved=input.orderId;if(/^ORD[0-9]{10,20}$/i.test(resolved)){const cfg=ctx.publicOrderIndex||require('./order-number-index-232.json'),r=await ctx.db.send(new QueryCommand({TableName:O,IndexName:cfg.indexName,KeyConditionExpression:'#n=:n',ExpressionAttributeNames:{'#n':cfg.partitionKey},ExpressionAttributeValues:{':n':resolved.toUpperCase()},Limit:2}));const candidates=(r.Items||[]).filter(o=>o.SK==='META'&&o.PK==='ORDER#'+o.orderId);if(candidates.length!==1)fail('PICKUP_WORKFLOW_UNAVAILABLE',404);resolved=candidates[0].orderId;const actual=await get(O,{PK:'ORDER#'+resolved,SK:'META'});if(actual?.[cfg.partitionKey]!==input.orderId.toUpperCase())fail('PICKUP_WORKFLOW_UNAVAILABLE',404);}
 const ok={PK:'ORDER#'+resolved,SK:'META'},order=await get(O,ok);if(!readable(order))fail('PICKUP_WORKFLOW_UNAVAILABLE',404);
 const reports=order.pickupIssueReports||[];if(!Array.isArray(reports)||reports.length>50)fail('PICKUP_WORKFLOW_UNAVAILABLE');
 if(method==='GET')return {items:await Promise.all(reports.filter(r=>id(r.id)&&types.includes(r.issueType)).map(async r=>view(order,r,await get(S,key(order.orderId,r.id)),now))),canOperate,currentEmployeeId:actor.employeeId,canTakeover:ctx.allowed(actor,'support.assign'),orderNumber:order.orderNumber||order.orderId};
 if(!canOperate)fail('PERMISSION_REQUIRED',403);if(!ctx.enrolled)fail('ENROLLMENT_REQUIRED',403);ctx.recent(ctx.claims);
 if(!uuid(input.requestId)||!id(input.reportId)||!['CLAIM','CONTACT','WAIT','CLOSE'].includes(input.action)||!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<0||typeof input.reason!=='string'||input.reason.trim().length<5||input.reason.length>500)fail('PICKUP_WORKFLOW_INVALID',400);
 const report=reports.find(r=>r.id===input.reportId);if(!report||!types.includes(report.issueType))fail('PICKUP_WORKFLOW_UNAVAILABLE',404);
 const wk=key(order.orderId,report.id),old=await get(S,wk),eventKey={pk:wk.pk,sk:'EVENT#'+input.requestId},fingerprint=digest({actorId:actor.employeeId,input}),prior=await get(S,eventKey);
 if(prior){if(prior.requestDigest!==fingerprint)fail('PICKUP_WORKFLOW_REQUEST_CONFLICT');return {...prior.receipt,replayed:true};}
 if((old?.version||0)!==input.expectedVersion||old?.status==='CLOSED'||old&&old.reportDigest!==digest(report))fail('PICKUP_WORKFLOW_CHANGED');
 if(input.action!=='CLAIM'&&old?.assignedTo!==actor.employeeId)fail('PICKUP_WORKFLOW_CLAIM_REQUIRED');
 const next={...old,...wk,kind:'PICKUP_ISSUE_WORKFLOW',orderId:order.orderId,reportId:report.id,reportDigest:digest(report),version:(old?.version||0)+1,createdAt:old?.createdAt||at,updatedAt:at,financialPosting:false};const guards=[];
 if(input.action==='CLAIM'){
  if(!minutes(input.followUpMinutes)||old?.assignedTo&&old.assignedTo!==actor.employeeId&&!ctx.allowed(actor,'support.assign'))fail('PICKUP_WORKFLOW_CLAIM_REQUIRED');
  Object.assign(next,{assignedTo:actor.employeeId,assignedName:actor.fullName||actor.displayName||actor.name||'موظف الإدارة',status:'IN_PROGRESS',followUpAt:new Date(now+input.followUpMinutes*60000).toISOString()});
 }else if(input.action==='CONTACT'){
  if(!['MERCHANT','DRIVER','CUSTOMER'].includes(input.party)||!['PHONE','CHAT','IN_PERSON'].includes(input.channel)||!['REACHED','NO_ANSWER'].includes(input.result)||typeof input.reference!=='string'||input.reference.trim().length<3||input.reference.length>500||(old.contacts||[]).length>=50)fail('PICKUP_WORKFLOW_INVALID',400);
  next.contacts=[...(old.contacts||[]),{id:input.requestId,party:input.party,channel:input.channel,result:input.result,reference:input.reference.trim(),actorId:actor.employeeId,at}];
 }else if(input.action==='WAIT'){
  if(!minutes(input.followUpMinutes)||!['MERCHANT','DRIVER','CUSTOMER'].includes(input.waitingOn))fail('PICKUP_WORKFLOW_INVALID',400);
  Object.assign(next,{status:'WAITING',waitingOn:input.waitingOn,followUpAt:new Date(now+input.followUpMinutes*60000).toISOString()});
 }else{
  if(!['ORIGINAL_ORDER_CONTINUES','ORDER_CANCELLED','DRIVER_UNASSIGNED','DELIVERY_FINISHED'].includes(input.resolution)||typeof input.reference!=='string'||input.reference.trim().length<5||input.reference.length>500||typeof input.originalOrderUnchanged!=='boolean')fail('PICKUP_WORKFLOW_INVALID',400);
  if(input.resolution==='ORIGINAL_ORDER_CONTINUES'){
   if(!sameAssignment(order,report)||!pre.includes(order.status)||order.pickedUpAt||order.pickupAt||order.merchantHandover||!input.originalOrderUnchanged||!['MERCHANT','DRIVER'].every(p=>old.contacts?.some(c=>c.party===p&&c.result==='REACHED')))fail('PICKUP_WORKFLOW_OUTCOME_NOT_PROVEN');
  }else if(input.resolution==='ORDER_CANCELLED'){
   if(order.status!=='cancelled')fail('PICKUP_WORKFLOW_OUTCOME_NOT_PROVEN');
  }else if(input.resolution==='DRIVER_UNASSIGNED'){
   if(!report.assignment||sameAssignment(order,report))fail('PICKUP_WORKFLOW_OUTCOME_NOT_PROVEN');
   const ak={orderId:order.orderId,sk:'ASSIGNMENT_RELEASE#'+report.assignment.attempt},a=await get(H,ak);
   if(a?.outcome!=='UNASSIGNED'||a.driverId!==report.driverId||a.offerId!==report.assignment.offerId||a.attempt!==report.assignment.attempt)fail('PICKUP_WORKFLOW_OUTCOME_NOT_PROVEN');guards.push(check(H,ak,a));
  }else if(!['delivered','completed','returned'].includes(order.status))fail('PICKUP_WORKFLOW_OUTCOME_NOT_PROVEN');
  Object.assign(next,{status:'CLOSED',resolution:input.resolution,resolutionReference:input.reference.trim(),resolvedAt:at,resolvedBy:actor.employeeId,financialReviewSeparate:true});
 }
 const receipt={success:true,version:next.version,status:next.status,financialPosting:false};
 const ops=[ctx.guard(actor),check(O,ok,shortOrder(order)),...guards,{Put:{TableName:S,Item:next,...(old?fence(old):{ConditionExpression:'attribute_not_exists(pk)'})}},{Put:{TableName:S,Item:{...eventKey,kind:'PICKUP_ISSUE_EVENT',orderId:order.orderId,reportId:report.id,action:input.action,reason:input.reason.trim(),actorId:actor.employeeId,createdAt:at,requestDigest:fingerprint,receipt,financialPosting:false},ConditionExpression:'attribute_not_exists(pk)'}},ctx.audit(actor.employeeId,'PICKUP_ISSUE_'+input.action,old||null,next,input.requestId)];
 try{await ctx.db.send(new TransactWriteCommand({TransactItems:ops}));}catch(e){if(e.name==='TransactionCanceledException')fail('PICKUP_WORKFLOW_CHANGED');throw e;}
 return receipt;
}
module.exports={route,sameAssignment,view};
