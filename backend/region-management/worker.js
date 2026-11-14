'use strict';
const {randomUUID}=require('crypto');
const m=require('./model'),R=require('./repository'),{publicJob,inScope}=require('./service');
const ACTIVE=['QUEUED','BUILDING','ROLLING_BACK','PUBLISHED'];
const at=now=>new Date(now).toISOString();
const summary=r=>r?{name:r.name,name_ar:r.name_ar,level:r.level,parent_id:r.parent_id,is_active:r.is_active,version:r.version,geometryDigest:m.digest(r.geometry)}:null;
function make({db,sdk,table,allowed,enqueue,now=Date.now,deadline=()=>now()+45000,sleep=ms=>new Promise(r=>setTimeout(r,ms))}){
 const repo=R.create({db,sdk,table});
 const put=(TableName,Item,old,fields)=>{const {Key,...guard}=repo.fence(TableName,TableName===repo.table?{pk:Item.pk,sk:Item.sk}:TableName===R.TABLES.neighbors?{neighbor_pair_id:Item.neighbor_pair_id}:{regionId:Item.regionId},old,fields).ConditionCheck;return {Put:{...guard,Item}};};
 const backupKey=(job,kind,id)=>({pk:'REGION_JOB#'+job.jobId,sk:'BACKUP#'+kind+'#'+id});
 const audit=(job,action,extra={})=>({Put:{TableName:repo.table,Item:{pk:'AUDIT',sk:at(now())+'#'+randomUUID(),actorId:job.actorId,action,after:{jobId:job.jobId,regionIds:job.changes.map(r=>r.regionId),...extra}},ConditionExpression:'attribute_not_exists(sk)'}});
 async function batch(items){for(let i=0;i<items.length;i+=25){let pending={[R.TABLES.index]:items.slice(i,i+25)},attempt=0;while(Object.values(pending).some(x=>x.length)){const r=await db.send(new sdk.BatchWriteCommand({RequestItems:pending}));pending=r.UnprocessedItems||{};if(Object.values(pending).some(x=>x.length)){if(++attempt>5)throw m.fail('REGION_INDEX_WRITE_RETRY',503);await sleep(Math.min(2000,60*2**attempt));}}}}
 async function claim(id){const j=await repo.job(id);if(!j||!ACTIVE.includes(j.status)||j.status==='PUBLISHED'&&!j.cleanupPending)return null;if((j.leaseUntil||0)>now())return null;
  const claimed={...j,version:j.version+1,leaseOwner:randomUUID(),leaseUntil:now()+70000,updatedAt:at(now())};try{await repo.transaction([put(repo.table,claimed,j,['version','status','leaseUntil','leaseOwner'])]);return claimed;}catch(e){if(e.code==='REGION_VERSION_CONFLICT')return null;throw e;}}
 async function run(id){let job=await claim(id);if(!job)return {skipped:true};const end=deadline();
  const save=async patch=>{const next={...job,...patch,version:job.version+1,updatedAt:at(now())};await repo.transaction([put(repo.table,next,job,['version','status','leaseOwner'])]);job=next;};
  const again=async()=>{await save({leaseUntil:0,leaseOwner:null});try{await enqueue(id);}catch{}return {pending:true,stage:job.stage};};
  const permissions=async rows=>{const actor=await repo.get(repo.table,{pk:'EMPLOYEE#'+job.actorId,sk:'PROFILE'});if(!actor||actor.status!=='ACTIVE'||actor.version!==job.actorVersion||!allowed(actor,'regions.activate')||job.changes.some(r=>!inScope(actor,r,rows)))throw m.fail('REGION_OPERATOR_CHANGED',403);return actor;};
  async function context(){const c=await repo.catalog();let original=c.base;
   if(job.prepared){const originals=await Promise.all(job.changes.map(r=>repo.get(repo.table,backupKey(job,'BASE',r.regionId))));const changed=new Set(job.changes.map(r=>r.regionId));original=c.base.filter(r=>!changed.has(r.regionId)).concat(originals.filter(r=>r?.data).map(r=>r.data));}
   if(m.catalogDigest(original)!==job.sourceDigest)throw m.fail('REGION_SOURCE_CHANGED',409);
   for(const r of job.changes){const current=c.base.find(x=>x.regionId===r.regionId);if(job.prepared){const backup=await repo.get(repo.table,backupKey(job,'BASE',r.regionId));if(current?._regionPublication!==job.jobId||m.digest(current)!==backup?.preparedDigest)throw m.fail('REGION_PUBLICATION_LOCK_CHANGED',409);}}
   const validation=m.validatePlan(original,job.changes);if(!validation.valid)throw m.fail('REGION_GEOMETRY_REVIEW_REQUIRED',409,{errors:validation.errors});
   const actor=await permissions(validation.rows);return {...c,original,validation,actor};
  }
  async function finish(status,error){const next={...job,status,stage:status==='REVIEW_REQUIRED'?'MANUAL_REVIEW':status,error:error||job.error||null,cleanupPending:false,version:job.version+1,leaseUntil:0,leaseOwner:null,updatedAt:at(now())};const items=[put(repo.table,next,job,['version','status','leaseOwner']),{Delete:{TableName:repo.table,Key:repo.queueKey(id)}},
    {Put:{TableName:repo.table,Item:{...repo.historyKey(job.actorId,job.createdAt,id),summary:publicJob(next)}}},audit(job,'REGION_PUBLICATION_'+status,{error:next.error})];
   for(const d of job.chosenDrafts){const k=repo.draftKey(job.actorId,d.regionId),head=await repo.get(repo.table,k);if(head?.jobId===id&&head.status==='QUEUED')items.push(put(repo.table,{...head,status:status==='PUBLISHED'?'PUBLISHED':'DRAFT',jobId:null},head,['version','status','jobId']));}
   await repo.transaction(items);job=next;return {status};
  }
  async function cleanup(rollback){
   const plans=rollback?(job.indexPlans||[]):(job.indexPlans||[]),cursor=job.cleanupRegionCursor||0;
   for(let i=cursor;i<plans.length;i++){
    const plan=plans[i];let key=job.cleanupCursor||undefined;
    do{
     const page=await db.send(new sdk.QueryCommand({TableName:R.TABLES.index,IndexName:'region-id-index',KeyConditionExpression:'regionId=:id',ExpressionAttributeValues:{':id':plan.regionId},Limit:100,ExclusiveStartKey:key}));
     const deletions=(page.Items||[]).filter(row=>rollback?row.publicationId===id:row.publicationId!==id);
     for(let start=0;start<deletions.length;start+=10)await Promise.all(deletions.slice(start,start+10).map(async row=>{
      try{await db.send(new sdk.DeleteCommand({TableName:R.TABLES.index,Key:{index_cell_id:row.index_cell_id},ConditionExpression:'regionId=:id AND '+(row.publicationId===undefined?'attribute_not_exists(publicationId)':'publicationId=:publication'),ExpressionAttributeValues:{':id':plan.regionId,...(row.publicationId!==undefined?{':publication':row.publicationId}:{})}}));}catch(e){if(e.name!=='ConditionalCheckFailedException')throw e;}
     }));
     key=page.LastEvaluatedKey;await save({cleanupRegionCursor:i,cleanupCursor:key||null});if(now()>end-6000)return false;
    }while(key);
    await save({cleanupRegionCursor:i+1,cleanupCursor:null});
   }
   // Before removing new-region placeholders on rollback, wait until eventual
   // GSI visibility no longer advertises their staged rows.
   if(rollback)for(const plan of plans){let cursor,count=0;do{const page=await db.send(new sdk.QueryCommand({TableName:R.TABLES.index,IndexName:'region-id-index',KeyConditionExpression:'regionId=:id',FilterExpression:'publicationId=:job',ExpressionAttributeValues:{':id':plan.regionId,':job':id},Select:'COUNT',ExclusiveStartKey:cursor}));count+=page.Count||0;cursor=page.LastEvaluatedKey;}while(cursor);if(count){await save({cleanupRegionCursor:0,cleanupCursor:null});return false;}}
   return true;
  }
  try{
   if(job.cancelRequested&&!['PUBLISHED','ROLLING_BACK'].includes(job.status))throw m.fail('REGION_PUBLICATION_CANCELLED',409);
   if(job.status==='PUBLISHED'){
    if(!await cleanup(false))return again();return finish('PUBLISHED');
   }
   if(job.status==='ROLLING_BACK'){
    if(!await cleanup(true))return again();
    const c=await repo.catalog(),items=[];
    if(job.prepared){for(const r of job.changes){const old=await repo.get(repo.table,backupKey(job,'BASE',r.regionId)),current=c.base.find(x=>x.regionId===r.regionId);if(current?._regionPublication!==id||m.digest(current)!==old.preparedDigest)throw m.fail('REGION_ROLLBACK_REVIEW_REQUIRED',409);
      const fence=repo.fence(R.TABLES.base,{regionId:r.regionId},current,m.FIELDS).ConditionCheck;
      if(old.data){const {Key,...condition}=fence;items.push({Put:{...condition,Item:old.data}});}else items.push({Delete:fence});
     }
     for(const regionId of job.affectedDerivedIds){const old=await repo.get(repo.table,backupKey(job,'DERIVED',regionId)),current=c.derived.find(r=>r.regionId===regionId);if(current?._regionPublication!==id||m.digest(current)!==old.preparedDigest)throw m.fail('REGION_ROLLBACK_REVIEW_REQUIRED',409);
      const fence=repo.fence(R.TABLES.derived,{regionId},current,['regionId','version','_regionPublication','effective_is_active','effective_config']).ConditionCheck;
      if(old.data){const {Key,...condition}=fence;items.push({Put:{...condition,Item:old.data}});}else items.push({Delete:fence});
     }
    }
    const next={...job,prepared:false,stage:'ROLLED_BACK',version:job.version+1,updatedAt:at(now())};items.push(put(repo.table,next,job,['version','status','leaseOwner']));await repo.transaction(items);job=next;return finish(job.error==='REGION_PUBLICATION_CANCELLED'?'CANCELLED':'FAILED',job.error);
   }
   let c=await context();
   const finalRows=c.validation.rows.map(r=>{if(!job.changes.some(x=>x.regionId===r.regionId))return r;const old=c.original.find(x=>x.regionId===r.regionId);return {...old,...r,version:m.version(old)+1,publicationId:id,indexPublicationId:r.level===3&&m.geometryChanged(old,r)?id:old?.indexPublicationId??null,updated_at:at(now())};});
   const changedIds=new Set(job.changes.map(r=>r.regionId)),affected=finalRows.filter(r=>{let n=r;for(let i=0;n&&i<5;i++){if(changedIds.has(n.regionId))return true;n=finalRows.find(x=>x.regionId===n.parent_id);}return false;});
   const neighbors=await repo.scan(R.TABLES.neighbors),edgeChanges=m.neighborChanges(c.original,job.changes,finalRows,neighbors,id,at(now()));
   // Reject an oversized atomic cutover BEFORE making any area temporarily unavailable.
   const estimated=c.base.length+affected.length+edgeChanges.puts.length+edgeChanges.deletes.length+job.changes.length*3+affected.length*2+6;
   if(estimated>100)throw m.fail('REGION_PUBLICATION_BATCH_LIMIT',409);
   const plans=job.indexPlans.length?job.indexPlans:job.changes.filter(r=>r.level===3&&m.geometryChanged(c.original.find(o=>o.regionId===r.regionId),r)).map(r=>{const plan=m.indexCells(r);return {regionId:r.regionId,count:plan.cells.length,resolution:plan.resolution};});
   if(!job.prepared&&plans.length){
    const tempRows=finalRows.map(r=>changedIds.has(r.regionId)?{...r,is_active:false,_regionPublication:id}:r),items=[];
    for(const original of c.base)if(!changedIds.has(original.regionId))items.push(repo.fence(R.TABLES.base,{regionId:original.regionId},original,m.FIELDS));
    for(const r of job.changes){const old=c.base.find(x=>x.regionId===r.regionId),next=tempRows.find(x=>x.regionId===r.regionId);items.push({Put:{TableName:repo.table,Item:{...backupKey(job,'BASE',r.regionId),data:old??null,preparedDigest:m.digest(next)},ConditionExpression:'attribute_not_exists(pk)'}},put(R.TABLES.base,next,old,m.FIELDS));}
    for(const r of affected){const old=c.derived.find(x=>x.regionId===r.regionId),next={...m.derive(tempRows.find(x=>x.regionId===r.regionId),tempRows,old,at(now()),c.derived),effective_is_active:0,_regionPublication:id};items.push({Put:{TableName:repo.table,Item:{...backupKey(job,'DERIVED',r.regionId),data:old??null,preparedDigest:m.digest(next)},ConditionExpression:'attribute_not_exists(pk)'}},put(R.TABLES.derived,next,old,['regionId','version','effective_is_active','effective_config','_regionPublication']));}
    const next={...job,status:'BUILDING',prepared:true,indexPlans:plans,affectedDerivedIds:affected.map(r=>r.regionId),version:job.version+1,stage:'INDEXING',updatedAt:at(now())};items.push(put(repo.table,next,job,['version','status','leaseOwner']),repo.fence(repo.table,{pk:'EMPLOYEE#'+c.actor.employeeId,sk:'PROFILE'},c.actor,['version','status']),audit(job,'REGION_PUBLICATION_PREPARING'));
    await repo.transaction(items);job=next;c=await context();
   }else if(!job.indexPlans.length&&plans.length)await save({indexPlans:plans});
   for(let i=job.regionCursor||0;i<plans.length;i++){
    const plan=plans[i],region=job.changes.find(r=>r.regionId===plan.regionId),cells=m.indexCells(region);if(cells.resolution!==plan.resolution||cells.cells.length!==plan.count)throw m.fail('REGION_INDEX_PLAN_CHANGED',409);
    for(let start=i===(job.regionCursor||0)?job.cellCursor||0:0;start<cells.cells.length;start+=250){
     const part=cells.cells.slice(start,start+250);await batch(part.map(cell=>({PutRequest:{Item:{index_cell_id:region.regionId+'#'+id+'#'+cell,h3_cell:cell,regionId:region.regionId,region_name:region.name,level:3,publicationId:id,resolution:plan.resolution,indexed_at:at(now())}}})));
     await save({regionCursor:i,cellCursor:start+part.length,indexedCells:(job.indexedCells||0)+part.length});if(now()>end-6000)return again();
    }
    await save({regionCursor:i+1,cellCursor:0});
   }
   await save({stage:'VERIFYING'});
   for(const plan of plans){let cursor,count=0;do{const page=await db.send(new sdk.QueryCommand({TableName:R.TABLES.index,IndexName:'region-id-index',KeyConditionExpression:'regionId=:id',FilterExpression:'publicationId=:job',ExpressionAttributeValues:{':id':plan.regionId,':job':id},Select:'COUNT',ExclusiveStartKey:cursor}));count+=page.Count||0;cursor=page.LastEvaluatedKey;}while(cursor);if(count!==plan.count)return again();}
   c=await context();
   const items=[];
   for(const row of c.base)if(!changedIds.has(row.regionId))items.push(repo.fence(R.TABLES.base,{regionId:row.regionId},row,m.FIELDS));
   for(const r of job.changes){const row=finalRows.find(x=>x.regionId===r.regionId);delete row._regionPublication;items.push(put(R.TABLES.base,row,c.base.find(x=>x.regionId===r.regionId),m.FIELDS));
    if(!job.prepared)items.push({Put:{TableName:repo.table,Item:{...backupKey(job,'BASE',r.regionId),data:c.original.find(x=>x.regionId===r.regionId)??null},ConditionExpression:'attribute_not_exists(pk)'}});
    items.push({Put:{TableName:repo.table,Item:{pk:'REGION_JOB#'+id,sk:'PUBLISHED#BASE#'+r.regionId,data:row},ConditionExpression:'attribute_not_exists(pk)'}});
   }
   for(const r of affected){const current=c.derived.find(x=>x.regionId===r.regionId),backup=job.prepared?await repo.get(repo.table,backupKey(job,'DERIVED',r.regionId)):null,next=m.derive(r,finalRows,backup?.data??current,at(now()),c.derived);if(job.prepared&&m.digest(current)!==backup?.preparedDigest)throw m.fail('REGION_PUBLICATION_LOCK_CHANGED',409);delete next._regionPublication;items.push(put(R.TABLES.derived,next,current,['regionId','version','effective_is_active','effective_config','_regionPublication']));
    if(!job.prepared)items.push({Put:{TableName:repo.table,Item:{...backupKey(job,'DERIVED',r.regionId),data:current??null},ConditionExpression:'attribute_not_exists(pk)'}});
    items.push({Put:{TableName:repo.table,Item:{pk:'REGION_JOB#'+id,sk:'PUBLISHED#DERIVED#'+r.regionId,data:next},ConditionExpression:'attribute_not_exists(pk)'}});
   }
   for(const n of edgeChanges.puts){const current=neighbors.find(r=>r.neighbor_pair_id===n.neighbor_pair_id),{Key,...guard}=repo.fence(R.TABLES.neighbors,{neighbor_pair_id:n.neighbor_pair_id},current,['neighbor_pair_id','source_region_id','target_region_id','expansion_priority','publicationId']).ConditionCheck;items.push({Put:{...guard,Item:n}});}
   for(const n of edgeChanges.deletes)items.push({Delete:repo.fence(R.TABLES.neighbors,{neighbor_pair_id:n.neighbor_pair_id},n,['neighbor_pair_id','source_region_id','target_region_id','expansion_priority','publicationId']).ConditionCheck});
   const next={...job,status:'PUBLISHED',stage:plans.length?'CLEANUP':'PUBLISHED',cleanupPending:plans.length>0,leaseUntil:0,leaseOwner:null,version:job.version+1,updatedAt:at(now())};
   items.push(put(repo.table,next,job,['version','status','leaseOwner']),repo.fence(repo.table,{pk:'EMPLOYEE#'+c.actor.employeeId,sk:'PROFILE'},c.actor,['version','status']),{Put:{TableName:repo.table,Item:{...repo.historyKey(job.actorId,job.createdAt,id),summary:publicJob(next)}}},audit(job,'REGION_PUBLICATION_COMMITTED'));
   for(const d of job.chosenDrafts){const k=repo.draftKey(job.actorId,d.regionId),head=await repo.get(repo.table,k);if(head?.jobId!==id||head.version!==d.version||head.status!=='QUEUED')throw m.fail('REGION_VERSION_CONFLICT',409);items.push(put(repo.table,{...head,status:'PUBLISHED'},head,['version','status','jobId']));
    items.push({Put:{TableName:R.TABLES.audit,Item:{audit_id:id+'#'+d.regionId,regionId:d.regionId,timestamp:at(now()),changed_by:job.actorId,changed_by_name:c.actor.name||c.actor.fullName||'موظف إدارة',action:'REGION_PUBLICATION',publicationId:id,reason:job.reason,geometry_digest:m.digest(job.changes.find(r=>r.regionId===d.regionId).geometry),before:summary(c.original.find(r=>r.regionId===d.regionId)),after:summary(finalRows.find(r=>r.regionId===d.regionId))},ConditionExpression:'attribute_not_exists(audit_id)'}});
   }
   if(!plans.length)items.push({Delete:{TableName:repo.table,Key:repo.queueKey(id)}});
   await repo.transaction(items);job=next;if(plans.length)try{await enqueue(id);}catch{}return {status:'PUBLISHED',cleanupPending:plans.length>0};
  }catch(error){
   if(error.code==='REGION_VERSION_CONFLICT')throw error;
   if(job.status==='PUBLISHED')throw error;
   if(job.status==='ROLLING_BACK'){if(error.code==='REGION_ROLLBACK_REVIEW_REQUIRED')return finish('REVIEW_REQUIRED',error.code);throw error;}
   if(job.prepared&&['REGION_INDEX_WRITE_RETRY','ThrottlingException','ProvisionedThroughputExceededException','TimeoutError','NetworkingError'].includes(error.code||error.name)&&(job.retryCount||0)<5){await save({retryCount:(job.retryCount||0)+1,lastRetryCode:error.code||error.name,leaseUntil:0,leaseOwner:null});try{await enqueue(id);}catch{}return {retrying:true};}
   if(job.prepared){await save({status:'ROLLING_BACK',stage:'ROLLBACK_INDEX',error:error.code||'REGION_PUBLICATION_FAILED',cleanupRegionCursor:0,cleanupCursor:null,leaseUntil:0,leaseOwner:null});try{await enqueue(id);}catch{}return {rollingBack:true};}
   return finish(error.code==='REGION_PUBLICATION_CANCELLED'?'CANCELLED':'FAILED',error.code||'REGION_PUBLICATION_FAILED');
  }
 }
 async function tick(){const rows=await repo.query(R.JOB_PK);for(const r of rows)await enqueue(r.jobId);return {queued:rows.length};}
 return {run,tick};
}
module.exports={make};
