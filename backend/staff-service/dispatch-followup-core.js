'use strict';
const {GetCommand}=require('@aws-sdk/lib-dynamodb');
const PK='OPERATIONAL_SETTINGS#DISPATCH_FOLLOWUP',PATH='/staff/settings/dispatch-followup';
const defaults={reviewMinutes:5,escalationMinutes:15},limits={reviewMinutes:[1,60],escalationMinutes:[2,240]};
const fail=(code,status=409)=>Object.assign(Error(code),{status});
function validate(values){if(!values||Object.keys(values).sort().join(',')!=='escalationMinutes,reviewMinutes'||Object.entries(limits).some(([k,[a,b]])=>!Number.isSafeInteger(values[k])||values[k]<a||values[k]>b)||values.escalationMinutes<=values.reviewMinutes)throw fail('INVALID_FOLLOWUP_SETTINGS',400);return {...values};}
const inboxKey=caseId=>({pk:'DISPATCH_FOLLOWUP_INBOX#OPEN',sk:caseId});
const inboxRow=row=>({...inboxKey(row.caseId),kind:'DISPATCH_FOLLOWUP_POINTER',caseId:row.caseId,orderId:row.orderId,selector:row.selector});
const key=caseId=>({pk:'DISPATCH_REVIEW#'+caseId,sk:'FOLLOWUP'});
const get=async(db,table,k)=>(await db.send(new GetCommand({TableName:table,Key:k,ConsistentRead:true}))).Item;
function exact(table,k,row,fields=Object.keys(row||{pk:null})){
 const names={},values={},terms=[];
 for(const [i,f]of fields.entries()){names['#f'+i]=f;if(row?.[f]===undefined)terms.push('attribute_not_exists(#f'+i+')');else{values[':f'+i]=row[f];terms.push('#f'+i+'=:f'+i);}}
 return {ConditionCheck:{TableName:table,Key:k,ConditionExpression:terms.join(' AND '),ExpressionAttributeNames:names,...(Object.keys(values).length?{ExpressionAttributeValues:values}:{})}};
}
async function policy(db,table){const row=await get(db,table,{pk:PK,sk:'CURRENT'});return {row,values:validate(row?.values??defaults),version:row?.version??0};}
function live(item){return (item.operationalReviewActive??item.active)&&['pending','confirmed','preparing','ready_for_pickup'].includes(item.orderStatus);}
function initial(item,source,p,now){
 const stamp=source?.dispatchReview?.observedAt??source?.updatedAt;
 const seen=Number.isFinite(Date.parse(stamp))&&Date.parse(stamp)<=now?Date.parse(stamp):now;
 return {...key(item.caseId),kind:'DISPATCH_FOLLOWUP',schemaVersion:1,caseId:item.caseId,selector:{orderId:item.orderId,source:item.source,...(item.attemptId?{attemptId:item.attemptId}:{})},orderId:item.orderId,branchId:item.branchId,regionId:item.regionId,status:'OPEN',version:1,ownerId:null,ownerName:null,firstObservedAt:new Date(seen).toISOString(),openedAt:new Date(now).toISOString(),reviewDueAt:new Date(seen+p.values.reviewMinutes*60000).toISOString(),escalationDueAt:new Date(seen+p.values.escalationMinutes*60000).toISOString(),policyVersion:p.version};
}
function view(row,now){return {version:row.version,status:row.status,ownerId:row.ownerId,ownerName:row.ownerName,firstObservedAt:row.firstObservedAt,reviewDueAt:row.reviewDueAt,escalationDueAt:row.escalationDueAt,overdue:row.status==='OPEN'&&Date.parse(row.reviewDueAt)<=now,escalated:row.status==='OPEN'&&Date.parse(row.escalationDueAt)<=now,lastNote:row.lastNote??null,policyVersion:row.policyVersion};}
async function restartProgress(db,job,alreadyFull=false){
 if(job.status!=='searching')return null;
 const full=alreadyFull?job:await get(db,'WizzDispatchJobs_staging',{orderId:job.orderId,SK:'METADATA'});
 if(!full||full.dispatchJobId!==job.dispatchJobId||full.dispatchCycle?.id!==job.dispatchCycle?.id||full.status!==job.status||full.updatedAt!==job.updatedAt)throw fail('REVIEW_CHANGED');
 const restartId=full.dispatchRestart?.restartId;
 if(!/^DRS:[a-f0-9]{48}$/.test(restartId??''))return null;
 const record=await get(db,'WizzDispatchJobs_staging',{orderId:job.orderId,SK:'DISPATCH_RESTART#'+restartId});
 const oldCase=record?.caseId??full.dispatchReviewOutcome?.caseId;
 if(!/^[a-f0-9]{64}$/.test(oldCase??''))return null;
 if(record&&(record.orderId!==job.orderId||record.kind!=='DISPATCH_RESTART_START'||record.cycleId!==full.dispatchCycle?.id||record.assignmentId!==full.dispatchJobId||record.restartId!==restartId||record.branchId!==full.restaurantId||typeof record.previousCycleId!=='string'||hash({orderId:job.orderId,source:'SEARCH',cycle:record.previousCycleId})!==oldCase))throw fail('REVIEW_CHANGED');
 const state=record?.state??'UNCONFIRMED';
 return {caseId:oldCase,restartId,state,waiting:state!=='STARTED',record,guard:exact('WizzDispatchJobs_staging',{orderId:job.orderId,SK:'DISPATCH_RESTART#'+restartId},record,record?Object.keys(record):['orderId'])};
}
const {createHash}=require('node:crypto');
const canon=v=>JSON.stringify(v===undefined?null:Array.isArray(v)?v.map(x=>JSON.parse(canon(x))):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(canon(v[k]))])):v);
const hash=v=>createHash('sha256').update(canon(v)).digest('hex');
module.exports={restartProgress,inboxKey,inboxRow,PK,PATH,defaults,limits,validate,key,get,exact,policy,live,initial,view,fail,hash};
