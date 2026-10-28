'use strict';
const m=require('./model'),geometry=require('./geometry'),R=require('./repository');
const {randomUUID}=require('crypto');
const reason=value=>{if(typeof value!=='string'||value.trim().length<5||value.length>1000)throw m.fail('REGION_REASON_REQUIRED');return value.trim();};
const permission=(ctx,actor,p)=>{if(!ctx.allowed(actor,p))throw m.fail('PERMISSION_REQUIRED',403);};
function inScope(actor,row,rows){if(actor.scope?.allRegions===true)return true;const ids=new Set(actor.scope?.regionIds||[]),byId=new Map(rows.map(r=>[r.regionId,r]));let n=row;for(let i=0;n&&i<5;i++){if(ids.has(n.regionId))return true;n=byId.get(n.parent_id);}return false;}
function permitted(ctx,actor,p,row,rows){permission(ctx,actor,p);if(!inScope(actor,row,rows))throw m.fail('REGION_FORBIDDEN',403);}
function publicJob(j){return j?{jobId:j.jobId||j.sk,status:j.status,stage:j.stage,error:j.error||null,detail:j.detail||null,createdAt:j.createdAt,updatedAt:j.updatedAt,indexedCells:j.indexedCells||0,cleanupPending:j.cleanupPending===true,regionIds:j.changes.map(r=>r.regionId)}:null;}
async function scopeRows(repo,actor,base,region){const map=new Map(base.map(r=>[r.regionId,r]));for(const d of await repo.drafts(actor.employeeId))if(d.status==='DRAFT')map.set(d.region.regionId,d.region);map.set(region.regionId,region);return [...map.values()];}
async function route(ctx,actor,method,path,input={}){
 const repo=R.create({db:ctx.db,sdk:ctx.sdk,table:ctx.table});permission(ctx,actor,'regions.read');
 if(method==='GET'){
  if(path==='/staff/regions/manage'){
   const [catalog,drafts,jobs]=await Promise.all([repo.catalog(),repo.drafts(actor.employeeId),repo.recent('REGIONS_HISTORY#'+actor.employeeId)]);
   const regions=catalog.base.map(r=>({...m.reference(r),effective:catalog.derived.find(d=>d.regionId===r.regionId)||null,editable:inScope(actor,r,catalog.base)}));
   if(Buffer.byteLength(JSON.stringify(regions))>5000000)throw m.fail('REGION_CATALOG_CAPACITY',503);
   return {regions,digest:catalog.digest,drafts,jobs:jobs.map(j=>j.summary),permissions:{edit:ctx.allowed(actor,'regions.edit'),publish:ctx.allowed(actor,'regions.activate'),history:ctx.allowed(actor,'regions.activate')||ctx.allowed(actor,'audit.read')}};
  }
  const history=path.match(/^\/staff\/regions\/manage\/history\/([A-Za-z0-9_-]{1,100})$/);
  if(history){if(!ctx.allowed(actor,'audit.read')&&!ctx.allowed(actor,'regions.activate'))throw m.fail('PERMISSION_REQUIRED',403);const c=await repo.catalog(),r=c.base.find(r=>r.regionId===history[1]);if(!r||!inScope(actor,r,c.base))throw m.fail('REGION_FORBIDDEN',403);const result=await ctx.db.send(new ctx.sdk.QueryCommand({TableName:R.TABLES.audit,IndexName:'region-index',KeyConditionExpression:'regionId=:id',ExpressionAttributeValues:{':id':r.regionId},Limit:30,ScanIndexForward:false}));return {items:(result.Items||[]).map(row=>({at:row.timestamp,actorName:row.changed_by_name||'موظف إدارة',reason:row.reason||'',before:row.before||null,after:row.after||null,action:row.action||'REGION_PUBLICATION'}))};}
  const match=path.match(/^\/staff\/regions\/manage\/jobs\/([A-Za-z0-9_-]{1,100})$/);if(match){const j=await repo.job(match[1]);if(!j||j.actorId!==actor.employeeId&&!ctx.allowed(actor,'audit.read'))throw m.fail('REGION_JOB_NOT_FOUND',404);return publicJob(j);}
  throw m.fail('NOT_FOUND',404);
 }
 if(method!=='POST')throw m.fail('METHOD_NOT_ALLOWED',405);
 if(path==='/staff/regions/manage/validate-plan'){
  permission(ctx,actor,'regions.edit');const c=await repo.catalog();if(input.catalogDigest!==c.digest)throw m.fail('REGION_VERSION_CONFLICT',409);
  if(!Array.isArray(input.drafts)||!input.drafts.length||input.drafts.length>10)throw m.fail('REGION_PLAN_INVALID');
  const changes=await Promise.all(input.drafts.map(async d=>{if(!m.id(d.regionId))throw m.fail('REGION_PLAN_INVALID');const draft=await repo.get(repo.table,repo.draftKey(actor.employeeId,d.regionId));if(!draft||draft.version!==d.version||draft.status!=='DRAFT'||draft.catalogDigest!==c.digest)throw m.fail('REGION_VERSION_CONFLICT',409);permitted(ctx,actor,'regions.edit',draft.region,await scopeRows(repo,actor,c.base,draft.region));return m.normalize(m.editable(draft.region),c.base.find(r=>r.regionId===d.regionId));}));
  const report=m.validatePlan(c.base,changes);return {valid:report.valid,errors:report.errors,highlights:report.highlights,digest:c.digest};
 }
 if(path==='/staff/regions/manage/validate'){
  permission(ctx,actor,'regions.edit');const c=await repo.catalog();if(c.base.some(r=>r._regionPublication))throw m.fail('REGION_PUBLICATION_IN_PROGRESS',409);
  const region=m.normalize(input.region,c.base.find(r=>r.regionId===input.region?.regionId));permitted(ctx,actor,'regions.edit',region,await scopeRows(repo,actor,c.base,region));
  return {...geometry.validate(region,c.base),digest:c.digest};
 }
 permission(ctx,actor,'regions.edit');ctx.recent(ctx.claims);
 if(path==='/staff/regions/manage/draft'){
  const c=await repo.catalog();if(input.catalogDigest!==c.digest)throw m.fail('REGION_VERSION_CONFLICT',409);if(c.base.some(r=>r._regionPublication))throw m.fail('REGION_PUBLICATION_IN_PROGRESS',409);
  const region=m.normalize(input.region,c.base.find(r=>r.regionId===input.region?.regionId));permitted(ctx,actor,'regions.edit',region,await scopeRows(repo,actor,c.base,region));
  const why=reason(input.reason),key=repo.draftKey(actor.employeeId,region.regionId),old=await repo.get(repo.table,key);
  if((old?.version??0)!==input.expectedDraftVersion)throw m.fail('REGION_VERSION_CONFLICT',409);
  if(old?.status==='QUEUED')throw m.fail('REGION_PUBLICATION_IN_PROGRESS',409);
  const at=new Date(ctx.now?.()??Date.now()).toISOString(),version=(old?.version??0)+1,report=geometry.validate(region,c.base),draft={...key,version,region,status:'DRAFT',catalogDigest:c.digest,reason:why,updatedAt:at,actorId:actor.employeeId};
  const fence=repo.fence(repo.table,key,old,['version','status']).ConditionCheck;
  await repo.transaction([ctx.guard(actor),{Put:{...fence,Item:draft,Key:undefined}},
   {Put:{TableName:repo.table,Item:{...draft,...repo.versionKey(actor.employeeId,region.regionId,version)},ConditionExpression:'attribute_not_exists(pk)'}},ctx.audit(actor.employeeId,'REGION_DRAFT_SAVED',{regionId:region.regionId,version:old?.version??0},{regionId:region.regionId,version,geometryDigest:m.digest(region.geometry),reason:why},randomUUID())].map(x=>{if(x.Put)delete x.Put.Key;return x;}));
  return {draft,validation:report};
 }
 if(path==='/staff/regions/manage/discard'){
  if(!m.id(input.regionId))throw m.fail('REGION_INPUT_INVALID');const key=repo.draftKey(actor.employeeId,input.regionId),old=await repo.get(repo.table,key);
  if(!old||old.version!==input.expectedDraftVersion||old.status!=='DRAFT')throw m.fail('REGION_VERSION_CONFLICT',409);
  const c=await repo.catalog();permitted(ctx,actor,'regions.edit',old.region,c.base.concat(old.region));const fence=repo.fence(repo.table,key,old,['version','status']).ConditionCheck;
  await repo.transaction([ctx.guard(actor),{Delete:fence},ctx.audit(actor.employeeId,'REGION_DRAFT_DISCARDED',{regionId:input.regionId,version:old.version},{reason:reason(input.reason)},randomUUID())]);return {discarded:true};
 }
 if(path==='/staff/regions/manage/cancel'){
  permission(ctx,actor,'regions.activate');if(!m.id(input.jobId))throw m.fail('REGION_INPUT_INVALID');const job=await repo.job(input.jobId);
  if(!job||job.actorId!==actor.employeeId&&!ctx.allowed(actor,'audit.read'))throw m.fail('REGION_JOB_NOT_FOUND',404);
  if(!['QUEUED','BUILDING'].includes(job.status))throw m.fail('REGION_PUBLICATION_ALREADY_FINISHED',409);
  const c=await repo.catalog();for(const r of job.changes)permitted(ctx,actor,'regions.activate',r,c.base.concat(r));
  const next={...job,cancelRequested:true,cancelReason:reason(input.reason),version:job.version+1,updatedAt:new Date(ctx.now?.()??Date.now()).toISOString()};
  const {Key,...condition}=repo.fence(repo.table,repo.jobKey(input.jobId),job,['version','status']).ConditionCheck;
  await repo.transaction([ctx.guard(actor),{Put:{...condition,Item:next}},ctx.audit(actor.employeeId,'REGION_PUBLICATION_CANCEL_REQUESTED',{}, {jobId:input.jobId,reason:next.cancelReason},randomUUID())]);
  try{await ctx.enqueue(input.jobId);}catch{}return {job:publicJob(next)};
 }
 if(path==='/staff/regions/manage/publish'){
  permission(ctx,actor,'regions.activate');if(!m.id(input.requestId)||!Array.isArray(input.drafts)||!input.drafts.length||input.drafts.length>10||new Set(input.drafts.map(d=>d.regionId)).size!==input.drafts.length)throw m.fail('REGION_PLAN_INVALID');
  const jobId='RP_'+m.digest({actor:actor.employeeId,request:input.requestId}).slice(0,40),requestDigest=m.digest(input),existing=await repo.job(jobId);
  if(existing){if(existing.requestDigest!==requestDigest)throw m.fail('REGION_REQUEST_CONFLICT',409);return {job:publicJob(existing),replayed:true};}
  const c=await repo.catalog();if(input.catalogDigest!==c.digest)throw m.fail('REGION_VERSION_CONFLICT',409);
  const drafts=await Promise.all(input.drafts.map(async d=>{if(!m.id(d.regionId)||!Number.isSafeInteger(d.version))throw m.fail('REGION_PLAN_INVALID');const row=await repo.get(repo.table,repo.draftKey(actor.employeeId,d.regionId));if(!row||row.version!==d.version||row.status!=='DRAFT'||row.catalogDigest!==c.digest)throw m.fail('REGION_VERSION_CONFLICT',409);return row;}));
  const changes=drafts.map(d=>m.normalize(m.editable(d.region),c.base.find(r=>r.regionId===d.region.regionId))),report=m.validatePlan(c.base,changes);for(const r of changes)permitted(ctx,actor,'regions.activate',r,report.rows);if(!report.valid)throw m.fail('REGION_GEOMETRY_REVIEW_REQUIRED',409,{errors:report.errors,highlights:report.highlights});
  for(const row of report.rows)if(changes.some(d=>d.regionId===row.parent_id))permitted(ctx,actor,'regions.activate',row,report.rows);
  const at=new Date(ctx.now?.()??Date.now()).toISOString(),job={...repo.jobKey(jobId),jobId,status:'QUEUED',stage:'INDEXING',actorId:actor.employeeId,actorVersion:actor.version,requestDigest,sourceDigest:c.digest,changes,chosenDrafts:input.drafts,reason:reason(input.reason),version:1,createdAt:at,updatedAt:at,regionCursor:0,cellCursor:0,indexedCells:0,indexPlans:[],cleanupPending:false};
  if(Buffer.byteLength(JSON.stringify(job))>300000)throw m.fail('REGION_PLAN_CAPACITY');
  await repo.transaction([ctx.guard(actor),...drafts.map(d=>({Put:{...repo.fence(repo.table,{pk:d.pk,sk:d.sk},d,['version','status']).ConditionCheck,Key:undefined,Item:{...d,status:'QUEUED',jobId}}})),
   {Put:{TableName:repo.table,Item:job,ConditionExpression:'attribute_not_exists(pk)'}},
   {Put:{TableName:repo.table,Item:{...repo.queueKey(jobId),jobId,actorId:actor.employeeId,createdAt:at},ConditionExpression:'attribute_not_exists(pk)'}},
   {Put:{TableName:repo.table,Item:{...repo.historyKey(actor.employeeId,at,jobId),summary:publicJob(job)},ConditionExpression:'attribute_not_exists(pk)'}},ctx.audit(actor.employeeId,'REGION_PUBLICATION_REQUESTED',{}, {jobId,regionIds:changes.map(r=>r.regionId),reason:job.reason,sourceDigest:c.digest},randomUUID())].map(x=>{if(x.Put)delete x.Put.Key;return x;}));
  let queuePending=false;try{await ctx.enqueue(jobId);}catch{queuePending=true;}return {job:publicJob(job),queuePending};
 }
 throw m.fail('NOT_FOUND',404);
}
module.exports={route,inScope,publicJob};
