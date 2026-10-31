'use strict';
const {QueryCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {allowed}=require('./catalog');
const {restartProgress,inboxKey,inboxRow,PK,PATH,defaults,limits,validate,key,get,exact,policy,live,initial,view,fail}=require('./dispatch-followup-core');
async function ownerState(ctx,row,regionId){
 if(!row.ownerId)return {unavailable:false,guards:[]};
 const owner=await ctx.employee(row.ownerId);
 if(owner&&owner.employeeId!==row.ownerId)throw fail('FOLLOWUP_OWNER_UNAVAILABLE',503);
 return {unavailable:!owner||owner.status!=='ACTIVE'||!allowed(owner,'orders.assign',regionId),guards:[exact(ctx.table,{pk:'EMPLOYEE#'+row.ownerId,sk:'PROFILE'},owner,owner?['employeeId','version','status','roles','scope']:['pk'])]};
}
async function tracking(ctx,c){
 const restart=c.item.source==='SEARCH'?await restartProgress(ctx.db,c.job):null;
 const waiting=!!restart?.waiting&&['pending','confirmed','preparing','ready_for_pickup'].includes(c.order.status)&&!c.order.driverId&&!c.order.assignedDriverId&&!c.order.pickedUpAt&&!c.order.deliveredAt&&!c.order.completedAt;
 return {caseId:waiting?restart.caseId:c.item.caseId,active:live(c.item)||waiting,restart:waiting?restart:null};
}
async function decorate(ctx,c,actor){
 const track=await tracking(ctx,c),p=await policy(ctx.db,ctx.table),stored=await get(ctx.db,ctx.table,key(track.caseId)),row=stored??initial({...c.item,caseId:track.caseId},c.source,p,ctx.now?.()??Date.now()),owner=await ownerState(ctx,row,c.item.regionId);
 if(stored&&(stored.orderId!==c.item.orderId||stored.branchId!==c.item.branchId))throw fail('REVIEW_CHANGED');
 return {...view({...row,version:stored?.version??0},ctx.now?.()??Date.now()),ownerUnavailable:owner.unavailable,restartState:track.restart?.state??null,trackingCaseId:track.caseId,active:track.active&&row.status==='OPEN',canClaim:track.active&&row.status==='OPEN'&&allowed(actor,'orders.assign',c.item.regionId)&&(!row.ownerId||row.ownerId===actor.employeeId||owner.unavailable),canRelease:track.active&&row.status==='OPEN'&&row.ownerId===actor.employeeId&&allowed(actor,'orders.assign',c.item.regionId)};
}
async function mutate(ctx,actor,input,reader){
 if(Object.keys(input).sort().join(',')!=='action,baseVersion,note,requestId,selector'||!['CLAIM','RELEASE','NOTE'].includes(input.action)||!Number.isSafeInteger(input.baseVersion)||input.baseVersion<0||typeof input.note!=='string'||input.note.trim().length<5||input.note.length>1000||!/^[-a-f0-9]{36}$/.test(input.requestId??''))throw fail('INVALID_FOLLOWUP',400);
 if(!ctx.enrolled)throw fail('ENROLLMENT_REQUIRED',403);ctx.recent(ctx.claims);
 const c=await reader.load(input.selector),track=await tracking(ctx,c);
 if(!track.active||!allowed(actor,'orders.assign',c.item.regionId))throw fail('REVIEW_ACTION_NOT_ALLOWED',403);
 const old=await get(ctx.db,ctx.table,key(track.caseId)),now=ctx.now?.()??Date.now(),p=await policy(ctx.db,ctx.table),base=old??initial({...c.item,caseId:track.caseId},c.source,p,now);
 if(old&&(old.orderId!==c.item.orderId||old.branchId!==c.item.branchId))throw fail('REVIEW_CHANGED');
 const markerKey={pk:base.pk,sk:'FOLLOWUP_REQUEST#'+input.requestId};
 const digest=require('./dispatch-reviews').hash({input,actorId:actor.employeeId});
 const prior=await get(ctx.db,ctx.table,markerKey);
 if(prior){if(prior.digest!==digest)throw fail('FOLLOWUP_REQUEST_CONFLICT');await reader.fresh();return {saved:true,replayed:true,followup:await decorate(ctx,c,actor)};}
 if(old&&old.status!=='OPEN')throw fail('REVIEW_ACTION_NOT_ALLOWED');
 if((old?.version??0)!==input.baseVersion)throw fail('FOLLOWUP_CHANGED');
 const owner=await ownerState(ctx,base,c.item.regionId);
 if(base.ownerId&&base.ownerId!==actor.employeeId&&!(input.action==='CLAIM'&&owner.unavailable))throw fail('FOLLOWUP_OWNED_BY_OTHER');
 if(input.action!=='CLAIM'&&base.ownerId!==actor.employeeId)throw fail('FOLLOWUP_CLAIM_REQUIRED');
 const next={...base,version:(old?.version??0)+1,ownerId:input.action==='RELEASE'?null:actor.employeeId,ownerName:input.action==='RELEASE'?null:(actor.displayName??actor.name??'موظف التشغيل'),lastNote:input.note.trim(),updatedAt:new Date(now).toISOString(),updatedBy:actor.employeeId};
 const {TableName,Key,...condition}=exact(ctx.table,key(track.caseId),old).ConditionCheck;
 const tx=[ctx.guard(actor),...c.guards,...(track.restart?[track.restart.guard]:[]),...(base.ownerId&&base.ownerId!==actor.employeeId?owner.guards:[]),exact(ctx.table,{pk:PK,sk:'CURRENT'},p.row),{Put:{TableName:ctx.table,Item:next,...condition}},{Put:{TableName:ctx.table,Item:inboxRow(next)}},{Put:{TableName:ctx.table,Item:{...markerKey,digest,createdAt:next.updatedAt},ConditionExpression:'attribute_not_exists(pk)'}},ctx.audit(actor.employeeId,'DISPATCH_FOLLOWUP_'+input.action,old??null,next,input.requestId)];
 try{await ctx.db.send(new TransactWriteCommand({TransactItems:tx}));}catch(e){const saved=await get(ctx.db,ctx.table,markerKey);if(saved?.digest===digest)return {saved:true,replayed:true,followup:await decorate(ctx,c,actor)};if(e.name==='TransactionCanceledException')throw fail('FOLLOWUP_CHANGED');throw e;}
 return {saved:true,followup:view(next,now)};
}
async function alerts(ctx,actor,reader){
 let cursor;
 if(ctx.query?.cursor){try{const raw=JSON.parse(Buffer.from(ctx.query.cursor,'base64url').toString());if(raw.actorId!==actor.employeeId||raw.version!==actor.version||typeof raw.key?.pk!=='string'||typeof raw.key?.sk!=='string'||ctx.query.cursor.length>2048)throw Error();cursor=raw.key;}catch{throw fail('INVALID_CURSOR',400);}}
 const page=await ctx.db.send(new QueryCommand({TableName:ctx.table,ConsistentRead:true,Limit:50,ExclusiveStartKey:cursor,KeyConditionExpression:'pk=:inbox',ExpressionAttributeValues:{':inbox':'DISPATCH_FOLLOWUP_INBOX#OPEN'}})),items=[];
 for(const row of page.Items??[]){try{const c=await reader.load(row.selector),track=await tracking(ctx,c);if(track.active&&track.caseId===row.caseId){await reader.readFence(c);const stored=await get(ctx.db,ctx.table,key(track.caseId));if(stored?.status==='OPEN'&&stored.orderId===c.item.orderId&&stored.branchId===c.item.branchId)items.push({orderId:c.item.orderId,branchName:c.item.branchName,caseId:track.caseId,followup:{...view(stored,ctx.now?.()??Date.now()),restartState:track.restart?.state??null}});}}catch(e){if(e.message!=='REVIEW_UNAVAILABLE')throw e;}}
 await reader.fresh();return {items,nextCursor:page.LastEvaluatedKey?Buffer.from(JSON.stringify({actorId:actor.employeeId,version:actor.version,key:page.LastEvaluatedKey})).toString('base64url'):null};
}
async function decisionFollowup(ctx,actor,c){
 if(c.item.source!=='SEARCH')return [];
 const old=await get(ctx.db,ctx.table,key(c.item.caseId));if(old)return [];
 const p=await policy(ctx.db,ctx.table),row={...initial(c.item,c.source,p,ctx.now?.()??Date.now()),ownerId:actor.employeeId,ownerName:actor.displayName??actor.name??'موظف التشغيل',lastNote:'سُجل قرار معالجة؛ تبقى المتابعة حتى تأكيد النتيجة الفعلية.'};
 return [exact(ctx.table,{pk:PK,sk:'CURRENT'},p.row),{Put:{TableName:ctx.table,Item:row,ConditionExpression:'attribute_not_exists(pk)'}},{Put:{TableName:ctx.table,Item:inboxRow(row)}}];
}
async function settings(ctx,actor,method,path,input){
 if(actor.scope?.allRegions!==true)throw fail('PERMISSION_REQUIRED',403);
 const result=await (ctx.settingsRoute??require('./operational-settings').route)({...ctx,allowed:(p,k)=>p.scope?.allRegions===true&&ctx.allowed(p,k),settingsSpec:{pk:PK,validate,actionPrefix:'DISPATCH_FOLLOWUP'}},actor,method,path.replace(PATH,'/staff/settings/account-deletion'),input);
 return {...result,limits,effectiveFor:'NEW_REVIEW_CASES',automaticCancellation:false};
}
module.exports={PK,PATH,defaults,limits,validate,key,get,exact,policy,live,initial,view,decorate,mutate,alerts,settings,decisionFollowup};
