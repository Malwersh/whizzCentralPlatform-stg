'use strict';
const {GetCommand,QueryCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {createHash}=require('node:crypto');
const {error}=require('./policy');
const TABLE='staging-MerchantPlatform';
async function purge({db,r,job,requestTable='staging-AccountDeletion',phoneNumber}){
 if(!r.subjectId||job.subjectId!==r.subjectId||!r.pk||!r.sk||!r.leaseOwner||!Number.isSafeInteger(r.version))throw error('INVALID_CLEANUP_SCOPE');
 const wholeBranch=!!job.businessId;
 if(wholeBranch&&r.scope?.id!==job.businessId)throw error('INVALID_CLEANUP_SCOPE');
 const get=async key=>(await db.send(new GetCommand({TableName:TABLE,Key:key,ConsistentRead:true}))).Item;
 const rows=async pk=>{const all=[];let cursor;do{const p=await db.send(new QueryCommand({TableName:TABLE,KeyConditionExpression:'pk=:p',ExpressionAttributeValues:{':p':pk},ConsistentRead:true,ExclusiveStartKey:cursor}));all.push(...p.Items||[]);cursor=p.LastEvaluatedKey;}while(cursor);return all;};
 const fence=()=>({ConditionCheck:{TableName:requestTable,Key:{pk:r.pk,sk:r.sk},ConditionExpression:'leaseOwner=:l AND #v=:v AND leaseUntil>:now',ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':l':r.leaseOwner,':v':r.version,':now':Math.floor(Date.now()/1000)}}});
 async function remove(row){if(row.legalHold||row.retentionHold)throw error('DOCUMENTED_RETENTION_HOLD');const values={':o':row.ownerId,':no':false},names={};let condition='ownerId=:o AND (attribute_not_exists(legalHold) OR legalHold=:no) AND (attribute_not_exists(retentionHold) OR retentionHold=:no)';if(row.version!==undefined){condition+=' AND #v=:v';names['#v']='version';values[':v']=row.version;}
  await db.send(new TransactWriteCommand({TransactItems:[fence(),{Delete:{TableName:TABLE,Key:{pk:row.pk,sk:row.sk},ConditionExpression:condition,ExpressionAttributeValues:values,...(row.version===undefined?{}:{ExpressionAttributeNames:names})}}]}));
 }
 const selected=[];
 if(wholeBranch){
  for(const row of await rows('BRANCH#'+job.businessId)){
   if(row.businessId!==job.businessId||row.ownerId!==r.subjectId)throw error('STAFF_SCOPE_CHANGED');selected.push(row);
   if(row.sk.startsWith('INVITE#')){const p=await get({pk:'STAFF_PHONE#'+createHash('sha256').update(row.phoneNumber).digest('hex'),sk:row.sk});if(p?.ownerId===r.subjectId&&p.businessId===job.businessId)selected.push(p);}
   if(row.sk.startsWith('MEMBER#')){const p=await get({pk:'PERSON#'+row.subjectId,sk:'MEMBER#'+job.businessId});if(p?.ownerId===r.subjectId&&p.businessId===job.businessId)selected.push(p);}
  }
 }else{
  if(r.scope?.kind!=='ACCOUNT')throw error('INVALID_CLEANUP_SCOPE');
  const pointers=(await rows('PERSON#'+r.subjectId)).filter(x=>x.sk.startsWith('MEMBER#'));
  for(const pointer of pointers){
   const branchRows=await rows('BRANCH#'+pointer.businessId);
   for(const row of branchRows){if(row.ownerId!==pointer.ownerId)throw error('STAFF_SCOPE_CHANGED');if((row.sk==='MEMBER#'+r.subjectId&&row.subjectId===r.subjectId)||(row.sk.startsWith('INVITE#')&&row.acceptedBy===r.subjectId)||((row.sk.startsWith('STAFF_AUDIT#')||row.sk.startsWith('DEVICE_AUDIT#')||row.sk.startsWith('STAFF_SESSION#')||row.sk==='PIN#'+r.subjectId)&&(row.subjectId===r.subjectId||row.actorId===r.subjectId)))selected.push(row);
    if(row.sk.startsWith('INVITE#')&&row.acceptedBy===r.subjectId){const inbox=await get({pk:'STAFF_PHONE#'+createHash('sha256').update(row.phoneNumber).digest('hex'),sk:row.sk});if(inbox?.ownerId===row.ownerId&&inbox.businessId===row.businessId)selected.push(inbox);}
   }
   selected.push(pointer);
  }
  if(phoneNumber){const pk='STAFF_PHONE#'+createHash('sha256').update(phoneNumber).digest('hex');for(const pointer of await rows(pk)){const i=await get({pk:'BRANCH#'+pointer.businessId,sk:pointer.sk});if(i?.phoneNumber===phoneNumber&&i.status==='PENDING'){selected.push(i,pointer);}}}
 }
 if(selected.some(row=>row.legalHold||row.retentionHold))throw error('DOCUMENTED_RETENTION_HOLD');
 // Keep the person's discovery pointer until canonical records are gone, so retries
 // after a crash can still find older accepted invitations and revoked memberships.
 const unique=[...new Map(selected.map(row=>[row.pk+'\0'+row.sk,row])).values()];
 const order=row=>wholeBranch?(row.pk.startsWith('BRANCH#')?1:0):(row.pk.startsWith('PERSON#')?2:row.pk.startsWith('BRANCH#')?1:0);
 unique.sort((a,b)=>order(a)-order(b));
 for(const row of unique)await remove(row);
}
module.exports={purge};
