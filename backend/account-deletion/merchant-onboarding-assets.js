'use strict';
const {GetCommand,QueryCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {ListObjectVersionsCommand,DeleteObjectsCommand}=require('@aws-sdk/client-s3');
const {error}=require('./policy');
const BUCKET='staging-merchant-onboarding-699561669180',TABLE='staging-MerchantPlatform';
async function purge({db,s3,r,job,requestTable='staging-AccountDeletion',draftId,environment='staging',now=Date.now}){
 if(!s3||!r.subjectId||job.subjectId!==r.subjectId||!r.leaseOwner||!Number.isSafeInteger(r.version)||!/^[a-f0-9-]{36}$/i.test(r.subjectId)||(draftId&&!/^[a-f0-9-]{36}$/i.test(draftId)))throw error('INVALID_CLEANUP_SCOPE');
 const production=environment==='production';
 if(production?requestTable!=='wizz-production-AccountDeletion':environment!=='staging'||requestTable!=='staging-AccountDeletion')throw error('INVALID_CLEANUP_SCOPE');
 const table=production?'wizz-production-MerchantPlatform':TABLE;
 const bucket=production?'wizz-production-merchant-onboarding-746727375268':BUCKET;
 const bucketOwner=production?'746727375268':'699561669180';
 const clock=()=>Math.floor(now()/1000);
 const guard=()=>({ConditionCheck:{TableName:requestTable,Key:{pk:r.pk,sk:r.sk},ConditionExpression:'leaseOwner=:owner AND #v=:v AND leaseUntil>:now',ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':owner':r.leaseOwner,':v':r.version,':now':clock()}}});
 const lease=async()=>{const {Item}=await db.send(new GetCommand({TableName:requestTable,Key:{pk:r.pk,sk:r.sk},ConsistentRead:true}));if(Item?.leaseOwner!==r.leaseOwner||Item.version!==r.version||Item.leaseUntil<=clock())throw error('LEASE_LOST');};
 if(production){
  if(r.actorType!=='MERCHANT'||r.status!=='PROCESSING'||job.requestId!==r.requestId||
     r.pk!=='SUBJECT#MERCHANT#'+r.subjectId||r.sk!=='REQUEST#'+r.requestId||
     (draftId?r.scope?.kind!=='BUSINESS'||job.businessId!==r.scope.id:r.scope?.kind!=='ACCOUNT'||r.scope.id!==r.subjectId))throw error('INVALID_CLEANUP_SCOPE');
  const markerKey=draftId?'BUSINESS_LIFECYCLE#MERCHANT#'+r.scope.id:'ACCOUNT_LIFECYCLE#MERCHANT#'+r.subjectId;
  const {Item:marker}=await db.send(new GetCommand({TableName:requestTable,Key:{pk:markerKey,sk:'META'},ConsistentRead:true}));
  if(marker?.subjectId!==r.subjectId||marker.requestId!==r.requestId||marker.state!=='CLOSING')throw error('INVALID_CLEANUP_SCOPE');
  if(draftId){
   const {Item:draft}=await db.send(new GetCommand({TableName:table,Key:{pk:'PERSON#'+r.subjectId,sk:'DRAFT#'+draftId},ConsistentRead:true}));
   const {Item:branch}=await db.send(new GetCommand({TableName:'wizz-production-Merchants',Key:{businessId:r.scope.id},ConsistentRead:true}));
   if(branch?.ownerId!==r.subjectId||branch.cognitoUserId!==r.subjectId||branch.deletionRequestId!==r.requestId||
      branch.onboardingDraftId!==draftId||draft&&(draft.subjectId!==r.subjectId||draft.businessId!==r.scope.id))throw error('INVALID_CLEANUP_SCOPE');
  }
 }
 const operations=await db.send(new QueryCommand({TableName:requestTable,KeyConditionExpression:'pk=:pk',ExpressionAttributeValues:{':pk':'ACCOUNT_OPERATION#MERCHANT#'+r.subjectId},ConsistentRead:true}));if(operations.LastEvaluatedKey||(operations.Items||[]).some(o=>(!draftId||o.draftId===draftId)&&(!Number.isSafeInteger(o.expiresAt)||o.expiresAt>clock())))throw error('EXTERNAL_WRITES_IN_PROGRESS');
 const rows=[];let cursor;do{const page=await db.send(new QueryCommand({TableName:table,KeyConditionExpression:'pk=:pk',ExpressionAttributeValues:{':pk':'PERSON#'+r.subjectId},ConsistentRead:true,ExclusiveStartKey:cursor}));rows.push(...page.Items||[]);cursor=page.LastEvaluatedKey;}while(cursor);
 const owned=rows.filter(row=>row.subjectId===r.subjectId&&(!draftId||row.draftId===draftId));if(owned.some(row=>row.legalHold||row.retentionHold))throw error('DOCUMENTED_RETENTION_HOLD');
 const prefix='persons/'+r.subjectId+'/'+(draftId?'drafts/'+draftId+'/':'');let keyMarker,versionMarker;
 do{await lease();const page=await s3.send(new ListObjectVersionsCommand({Bucket:bucket,ExpectedBucketOwner:bucketOwner,Prefix:prefix,KeyMarker:keyMarker,VersionIdMarker:versionMarker}));const objects=[...page.Versions||[],...page.DeleteMarkers||[]].map(v=>{if(!v.Key.startsWith(prefix))throw error('ASSET_SCOPE_INVALID');return {Key:v.Key,VersionId:v.VersionId};});if(objects.length){await lease();const result=await s3.send(new DeleteObjectsCommand({Bucket:bucket,ExpectedBucketOwner:bucketOwner,Delete:{Objects:objects,Quiet:true}}));if(result.Errors?.length)throw error('ASSET_DELETE_RETRY_REQUIRED');}keyMarker=page.NextKeyMarker;versionMarker=page.NextVersionIdMarker;if(!page.IsTruncated)break;}while(keyMarker);
 for(const row of owned){if(!draftId&&!row.sk.startsWith('ASSET#'))continue;await db.send(new TransactWriteCommand({TransactItems:[guard(),{Delete:{TableName:table,Key:{pk:row.pk,sk:row.sk},ConditionExpression:'subjectId=:sub AND (attribute_not_exists(legalHold) OR legalHold=:no) AND (attribute_not_exists(retentionHold) OR retentionHold=:no)',ExpressionAttributeValues:{':sub':r.subjectId,':no':false}}}]}));}
 let next;do{const page=await db.send(new QueryCommand({TableName:table,KeyConditionExpression:'pk=:pk',ExpressionAttributeValues:{':pk':'REVIEW#MERCHANT'},ExclusiveStartKey:next,ConsistentRead:true}));for(const row of page.Items||[])if(row.subjectId===r.subjectId&&(!draftId||row.draftId===draftId))await db.send(new TransactWriteCommand({TransactItems:[guard(),{Delete:{TableName:table,Key:{pk:row.pk,sk:row.sk},ConditionExpression:'subjectId=:sub',ExpressionAttributeValues:{':sub':r.subjectId}}}]}));next=page.LastEvaluatedKey;}while(next);
}
module.exports={purge,BUCKET};
