'use strict';
const {ScanCommand,GetCommand,QueryCommand}=require('@aws-sdk/lib-dynamodb');
const {ListObjectVersionsCommand,DeleteObjectsCommand}=require('@aws-sdk/client-s3');
const {error}=require('./policy');
const BUCKET='wizz-merchants-staging-businessphotosbucket-up3j1qega8m5',ACCOUNT='699561669180';
const FIELDS=['businessPhotoUrl','businessPhoto','logoUrl','photoUrl','imageUrl','licenseUrl','identityUrl','healthCertificateUrl','ownerPhotoUrl'];
function merchantAssets({db,s3,clock=()=>Math.floor(Date.now()/1000)}){
 async function rows(table){let all=[],cursor;do{const p=await db.send(new ScanCommand({TableName:table,ConsistentRead:true,ExclusiveStartKey:cursor}));all.push(...p.Items||[]);cursor=p.LastEvaluatedKey;}while(cursor);return all;}
 function key(url){let p;try{p=new URL(url);}catch(_){throw error('ASSET_INVENTORY_REQUIRED');}if(p.protocol!=='https:'||p.hostname!==BUCKET+'.s3.amazonaws.com'||p.search||p.hash)throw error('ASSET_INVENTORY_REQUIRED');const k=decodeURIComponent(p.pathname.slice(1));if(!/^((?:business-photos|business-documents|product-images)\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+|merchants\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+)$/.test(k))throw error('ASSET_SCOPE_INVALID');return k;}
 async function inventory(profile){
  const tables={};for(const table of ['WhizzMerchants_Businesses','WhizzMerchants_Products','WhizzMerchants_GlobalProducts'])tables[table]=await rows(table);
  const candidates=FIELDS.filter(field=>profile[field]).map(field=>({field,url:profile[field]}));
  function imageUrls(value){if(typeof value==='string')return value.startsWith('https://'+BUCKET+'.s3.amazonaws.com/')?[value]:[];if(Array.isArray(value))return value.flatMap(imageUrls);if(value&&typeof value==='object')return Object.values(value).flatMap(imageUrls);return [];}
  for(const product of tables.WhizzMerchants_Products)if(product.businessId===profile.businessId)for(const url of imageUrls(product))if(!candidates.some(a=>a.url===url))candidates.push({url});
  return candidates.map(asset=>{
   const k=key(asset.url);let shared=false;
   for(const [table,records] of Object.entries(tables))for(const row of records){
    if(table!=='WhizzMerchants_GlobalProducts'&&row.businessId===profile.businessId)continue;
    if(JSON.stringify(row).includes(asset.url))shared=true;
   }
   return {...asset,bucket:BUCKET,key:k,shared};
  });
 }
 async function cleanup(r,job){
  const active=await db.send(new QueryCommand({TableName:'staging-AccountDeletion',KeyConditionExpression:'pk=:pk',ExpressionAttributeValues:{':pk':'ACCOUNT_OPERATION#MERCHANT#'+job.subjectId},ConsistentRead:true}));if(active.LastEvaluatedKey||(active.Items||[]).some(x=>!Number.isSafeInteger(x.expiresAt)||x.expiresAt>clock()))throw error('EXTERNAL_WRITES_IN_PROGRESS');
  const assets=[...job.assets||[]];
  const prefix='merchants/'+job.businessId+'/';
  if(!/^[A-Za-z0-9_-]{1,100}$/.test(job.businessId||''))throw error('ASSET_SCOPE_INVALID');
  // Inventory again after fencing and waiting, including unlinked late uploads.
  let cursorKey,cursorVersion;
  do{
   const page=await s3.send(new ListObjectVersionsCommand({Bucket:BUCKET,ExpectedBucketOwner:ACCOUNT,Prefix:prefix,KeyMarker:cursorKey,VersionIdMarker:cursorVersion}));
   for(const row of [...page.Versions||[],...page.DeleteMarkers||[]]){
    if(!row.Key.startsWith(prefix))throw error('ASSET_SCOPE_INVALID');
    if(assets.some(a=>a.key===row.Key))continue;
    const url='https://'+BUCKET+'.s3.amazonaws.com/'+row.Key;key(url);let shared=false;
    for(const table of ['WhizzMerchants_Products','WhizzMerchants_GlobalProducts','WhizzMerchants_Businesses'])for(const record of await rows(table)){
     if(record.businessId===job.businessId&&table!=='WhizzMerchants_GlobalProducts')continue;
     if(JSON.stringify(record).includes(url))shared=true;
    }
    assets.push({bucket:BUCKET,key:row.Key,url,shared});
   }
   cursorKey=page.NextKeyMarker;cursorVersion=page.NextVersionIdMarker;if(!page.IsTruncated)break;
  }while(cursorKey);
  for(const asset of assets){
   if(asset.shared)continue;
   const {Item:business}=await db.send(new GetCommand({TableName:'WhizzMerchants_Businesses',Key:{businessId:job.businessId},ConsistentRead:true}));
   if(!business||business.deletionRequestId!==job.requestId)throw error('PROFILE_GENERATION_CHANGED');
   if(business.legalHold||business.retentionHold)throw error('DOCUMENTED_RETENTION_HOLD');
   if(asset.field&&business[asset.field]!==asset.url)throw error('ASSET_GENERATION_CHANGED');if(asset.bucket!==BUCKET||key(asset.url)!==asset.key)throw error('ASSET_SCOPE_INVALID');
   let keyMarker,versionMarker;
   do{
    const {Item:c}=await db.send(new GetCommand({TableName:'staging-AccountDeletion',Key:{pk:r.pk,sk:r.sk},ConsistentRead:true}));if(c?.leaseOwner!==r.leaseOwner||c.version!==r.version||c.leaseUntil<=clock())throw error('LEASE_LOST');
    const p=await s3.send(new ListObjectVersionsCommand({Bucket:BUCKET,ExpectedBucketOwner:ACCOUNT,Prefix:asset.key,KeyMarker:keyMarker,VersionIdMarker:versionMarker}));
    const versions=[...p.Versions||[],...p.DeleteMarkers||[]].filter(x=>x.Key===asset.key).map(x=>({Key:x.Key,VersionId:x.VersionId}));
    if(versions.length){const result=await s3.send(new DeleteObjectsCommand({Bucket:BUCKET,ExpectedBucketOwner:ACCOUNT,Delete:{Objects:versions,Quiet:true}}));if(result.Errors?.length)throw error('ASSET_DELETE_RETRY_REQUIRED');}
    keyMarker=p.NextKeyMarker;versionMarker=p.NextVersionIdMarker;if(!p.IsTruncated)break;
   }while(keyMarker);
  }
 }
 return {inventory,cleanup};
}
module.exports={merchantAssets,BUCKET,FIELDS};
