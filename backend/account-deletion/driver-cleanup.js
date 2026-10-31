'use strict';
const {QueryCommand,GetCommand}=require('@aws-sdk/lib-dynamodb');
const {ListObjectVersionsCommand,ListObjectsV2Command,DeleteObjectsCommand}=require('@aws-sdk/client-s3');
const {customerCleanup}=require('./customer-cleanup');
const {error}=require('./policy');
const POOL='us-east-1_RGTqUXF5C',BUCKET='whizzdrivers-documents-staging-699561669180';
const PERSONAL=[
 ['WizzDriverLiveState_staging',['driverId'],['driverId']],
 ['WizzDriverPerformanceMetrics_staging',['PK','SK'],['driverId','PK']],
 ['WaveOffers_staging',['orderId','SK'],['driverId']],
 ['WizzUser_websocket_connections_staging',['connectionId'],['userId','driverId']],
 ['WizzUser_websocket_subscriptions_staging',['subscriptionId'],['userId','driverId']],
 ['WizzCentral_PushDeviceTokens_staging',['token'],['subjectId'],'app'],
 ['staging-WalletNotifications',['eventId'],['driverId'],'recipientApp'],
 ['chat-sessions-staging',['sessionId'],['driverId']],
];
const FINANCIAL=[
 ['WizzOrders',{keys:['PK','SK'],owners:['driverId','assignedDriverId'],kind:'order'}],
 ['staging-LedgerEntries',{keys:['walletId','sk'],owners:['walletId'],kind:'ledger'}],
 ['staging-TopupRequests',{keys:['topupId','sk'],owners:['walletId','driverId'],kind:'topup'}],
 ['staging-IdempotencyKeys',{keys:['idempotencyKey','sk'],owners:['sourceWalletId','recipientWalletId','requestedBy','driverId'],kind:'transfer'}],
 ['staging-AuditLog',{keys:['datePartition','sk'],owners:['sourceWalletId','recipientWalletId','walletId','actorId','driverId','subjectId'],kind:'audit'}],
 ['staging-SandboxPayments',{keys:['pk','sk'],owners:['driverId'],ownerPrefix:'DRIVER#',kind:'sandbox'}],
];
const ORDER_PII=['driverId','assignedDriverId','driverName','driverPhone','driverEmail','driverInfo','driver','driverLocation','driverLatitude','driverLongitude','driverAssignmentHistory','orderTimeline'];
function driverCleanup({db,cognito,s3,connections,requestTable='staging-AccountDeletion',archiveTable='staging-AccountDeletionFinancialArchive',clock=()=>new Date().toISOString(),maxPages=100}){
 const common=customerCleanup({db,cognito,connections,requestTable,archiveTable,clock,maxPages,actorType:'DRIVER',pool:POOL,profileTable:'WhizzDrivers_staging',profileKey:'driverId',personalTables:PERSONAL,financialTables:FINANCIAL,orderPii:ORDER_PII,authTables:['WhizzDrivers_otp_sessions_staging'],temporaryTables:[]});
 async function lease(r){const {Item:c}=await db.send(new GetCommand({TableName:requestTable,Key:{pk:r.pk,sk:r.sk},ConsistentRead:true}));if(c?.leaseOwner!==r.leaseOwner||c.version!==r.version||c.status!=='PROCESSING'||c.leaseUntil<=Math.floor(new Date(clock()).getTime()/1000))throw error('LEASE_LOST');}
 async function uploads(job){const r=await db.send(new QueryCommand({TableName:requestTable,KeyConditionExpression:'pk = :pk',ExpressionAttributeValues:{':pk':'ACCOUNT_OPERATION#DRIVER#'+job.subjectId},ConsistentRead:true}));const now=Math.floor(new Date(clock()).getTime()/1000);if(r.LastEvaluatedKey||(r.Items||[]).some(o=>!Number.isSafeInteger(o.expiresAt)||o.expiresAt>now))throw error('EXTERNAL_WRITES_IN_PROGRESS');}
 async function documents(r,job){
  if(!s3)throw error('ASSET_STORAGE_UNAVAILABLE');
  await uploads(job);
  for(const id of job.profileIds){
   if(!/^[A-Za-z0-9_-]{1,100}$/.test(id))throw error('ASSET_OWNER_INVALID');
   const prefix='drivers/'+id+'/';
   const {Item:profile}=await db.send(new GetCommand({TableName:'WhizzDrivers_staging',Key:{driverId:id},ConsistentRead:true}));
   if(profile&&profile.deletionRequestId!==job.requestId)throw error('PROFILE_GENERATION_CHANGED');
   if(profile?.legalHold===true||profile?.retentionHold===true)throw error('DOCUMENTED_RETENTION_HOLD');
   for(const field of ['drivingLicenseUrl','registrationPaperUrl','nationalIdUrl','profileImage','profileImageUrl','photoUrl','avatarUrl'])if(profile?.[field]&&!String(profile[field]).startsWith('s3://'+BUCKET+'/'+prefix))throw error('ASSET_INVENTORY_REQUIRED');
   // Both current objects and every historical version are removed. A shared
   // merchant/catalog URL can never become an S3 deletion target here.
   let keyMarker,versionMarker,count=0;
   do{
    await lease(r);
    const page=await s3.send(new ListObjectVersionsCommand({Bucket:BUCKET,Prefix:prefix,KeyMarker:keyMarker,VersionIdMarker:versionMarker}));
    const objects=[...(page.Versions||[]),...(page.DeleteMarkers||[])].map(o=>({Key:o.Key,VersionId:o.VersionId}));
    if(objects.some(o=>!o.Key?.startsWith(prefix)||!o.VersionId))throw error('ASSET_SCOPE_INVALID');
    if(objects.length){await lease(r);const removed=await s3.send(new DeleteObjectsCommand({Bucket:BUCKET,Delete:{Objects:objects,Quiet:true}}));if(removed.Errors?.length)throw error('ASSET_DELETE_RETRY_REQUIRED');}
    keyMarker=page.NextKeyMarker;versionMarker=page.NextVersionIdMarker;
    if(page.IsTruncated&&!keyMarker)throw error('ASSET_INVENTORY_INCOMPLETE');
    if(++count>=maxPages&&page.IsTruncated)throw error('ASSET_INVENTORY_INCOMPLETE');
    if(!page.IsTruncated)break;
   }while(keyMarker);
   await lease(r);
   const remaining=await s3.send(new ListObjectsV2Command({Bucket:BUCKET,Prefix:prefix,MaxKeys:1}));if(remaining.KeyCount||remaining.Contents?.length)throw error('ASSET_DELETE_RETRY_REQUIRED');
  }
 }
 return {async execute(step,r,job){
  if(r.actorType!=='DRIVER'||!r.leaseOwner||r.subjectId!==job.subjectId||r.requestId!==job.requestId||job.pool!==POOL)throw error('INVALID_CLEANUP_SCOPE');
  if(step==='externalWrites'){await lease(r);return uploads(job);}
  if(step==='documents')return documents(r,job);
  if(step==='profileClosure'){
   const {Item:receipt}=await db.send(new GetCommand({TableName:requestTable,Key:{pk:r.pk,sk:`STEP#${r.requestId}#documents`},ConsistentRead:true}));
   if(receipt?.status!=='COMPLETED'||receipt.requestId!==r.requestId)throw error('ASSET_CLEANUP_REQUIRED');
  }
  return common.execute(step,r,job);
 }};
}
module.exports={driverCleanup,PERSONAL,FINANCIAL,ORDER_PII,BUCKET};
