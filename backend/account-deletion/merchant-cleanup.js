'use strict';
const {customerCleanup}=require('./customer-cleanup');
const {ScanCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {error}=require('./policy');
const POOL='us-east-1_gtCR3ndzT';
const PERSONAL=[
 ['WizzUser_websocket_connections_staging',['connectionId'],['businessId']],
 ['WizzUser_websocket_subscriptions_staging',['subscriptionId'],['businessId']],
 ['chat-sessions-staging',['sessionId'],['businessId','storeId']],
 ['WhizzMerchants_Products',['productId'],['businessId']],
 ['WhizzMerchants_BusinessWorkingHours',['businessId','weekday'],['businessId']],
 ['WhizzMerchants_BusinessSubcategories',['subcategoryId'],['businessId']],
 ['WhizzMerchants_DeviceTokens',['tokenId'],['businessId','merchantId']],
 ['staging-WalletNotifications',['eventId'],['driverId'],'recipientApp'],
 ['WhizzMerchants_Discounts',['discountId'],['businessId']],
 ['WhizzMerchants_RegionListings',['regionId','metadataType'],['businessId']],
 ['WizzCentral_PushDeviceTokens_staging',['token'],['businessId'],'app'],
];
const FINANCIAL=[
 ['WizzOrders',{keys:['PK','SK'],owners:['storeId','businessId','restaurantId'],kind:'order'}],
 ['staging-LedgerEntries',{keys:['walletId','sk'],owners:['walletId'],kind:'ledger'}],
 ['staging-TopupRequests',{keys:['topupId','sk'],owners:['walletId'],kind:'topup'}],
 ['staging-IdempotencyKeys',{keys:['idempotencyKey','sk'],owners:['sourceWalletId','recipientWalletId'],kind:'transfer'}],
 ['staging-AuditLog',{keys:['datePartition','sk'],owners:['walletId','sourceWalletId','recipientWalletId','branchId'],kind:'audit'}],
];
function merchantBusinessCleanup({db,cognito,connections,requestTable='staging-AccountDeletion',archiveTable='staging-AccountDeletionFinancialArchive',clock=()=>new Date().toISOString()}){
 const common=customerCleanup({db,cognito,connections,requestTable,archiveTable,clock,actorType:'MERCHANT',pool:POOL,profileTable:'WhizzMerchants_Businesses',profileKey:'businessId',personalTables:PERSONAL,financialTables:FINANCIAL,orderPii:['businessName','restaurantName','storeName','merchantPhone','merchantEmail','businessPhone','businessEmail','businessAddress','storeAddress'],authTables:[],temporaryTables:[]});
 return {async execute(step,r,job){
  if(r.scope.kind!=='BUSINESS'||job.businessId!==r.scope.id||job.ownedIds?.length!==1||job.ownedIds[0]!==r.scope.id)throw error('INVALID_CLEANUP_SCOPE');
  // A business closure never disables or deletes the owner's Cognito identity.
  if(['disableIdentity','identityClosure'].includes(step))throw error('INVALID_BUSINESS_IDENTITY_STEP');
  if(step==='memberships'){
   let cursor;
   do{
    const page=await db.send(new ScanCommand({TableName:'staging-IdempotencyKeys',ExclusiveStartKey:cursor,ConsistentRead:true}));
    for(const row of page.Items||[]){
     if(!row.idempotencyKey?.startsWith('MERCHANT_FINANCE#'+job.businessId+'#'))continue;
     if(row.legalHold||row.retentionHold)throw error('DOCUMENTED_RETENTION_HOLD');
     await db.send(new TransactWriteCommand({TransactItems:[
      {ConditionCheck:{TableName:requestTable,Key:{pk:r.pk,sk:r.sk},ConditionExpression:'leaseOwner=:owner AND leaseUntil>:now AND #v=:v AND #s=:processing',ExpressionAttributeNames:{'#v':'version','#s':'status'},ExpressionAttributeValues:{':owner':r.leaseOwner,':now':Math.floor(new Date(clock()).getTime()/1000),':v':r.version,':processing':'PROCESSING'}}},
      {Delete:{TableName:'staging-IdempotencyKeys',Key:{idempotencyKey:row.idempotencyKey,sk:row.sk},ConditionExpression:'ownerId=:owner AND memberId=:member',ExpressionAttributeValues:{':owner':row.ownerId,':member':row.memberId}}}
     ]}));
    }
    cursor=page.LastEvaluatedKey;
   }while(cursor);return;
  }
  return common.execute(step,r,job);
 }};
}
module.exports={merchantBusinessCleanup,PERSONAL,FINANCIAL};
