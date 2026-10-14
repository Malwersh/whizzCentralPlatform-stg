'use strict';
const {ListBackupsCommand,DeleteBackupCommand}=require('@aws-sdk/client-dynamodb');
const {GetCommand,PutCommand,UpdateCommand}=require('@aws-sdk/lib-dynamodb');
const {error}=require('./policy');
const TABLE='staging-AccountDeletion',DAYS=35;
const ALLOWED=new Set(['WizzOrders','staging-LedgerEntries','staging-AuditLog','staging-TopupRequests','staging-IdempotencyKeys','staging-Holds','staging-Wallets','WizzCentral_RegionIndex_staging','WizzCentral_Regions','WizzCentral_RegionsDerived_staging','WizzCentral_RegionNeighbors_staging','WhizzMerchants_BusinessSubcategories','WhizzMerchants_Businesses','WhizzMerchants_GlobalProducts','WhizzMerchants_Products','WhizzMerchants_RegionLinks','WhizzMerchants_RegionListings','WhizzDrivers_staging','WizzDriverLiveState_staging','WizzDriverPerformanceMetrics_staging','WizzUser_users_staging','WizzUser_addresses_staging','WizzUser_favorites_staging','WizzUser_transactions_staging','staging-PlatformStaff','staging-AccountDeletionFinancialArchive','WizzCentral_RegionAudit_staging','WhizzMerchants_Discounts','WhizzMerchants_Categories','WhizzMerchants_BusinessWorkingHours','staging-DeletionRetentionTest']);
function eligibleBackup(b){return b.BackupType==='USER'&&ALLOWED.has(b.TableName)&&typeof b.BackupArn==='string'&&b.BackupArn.startsWith('arn:aws:dynamodb:us-east-1:699561669180:table/'+b.TableName+'/backup/')&&b.BackupStatus==='AVAILABLE';}
function createBackupRetention({client,db,clock=()=>Math.floor(Date.now()/1000),dryRun=true}){
 return async()=>{
  let cursor,pages=0,registered=0,removed=0,blocked=0;const items=[];
  do{if(++pages>100)throw error('BACKUP_INVENTORY_INCOMPLETE');const r=await client.send(new ListBackupsCommand({BackupType:'USER',ExclusiveStartBackupArn:cursor}));items.push(...r.BackupSummaries||[]);cursor=r.LastEvaluatedBackupArn;}while(cursor);
  for(const b of items){if(!eligibleBackup(b))continue;const key={pk:'BACKUP_RETENTION',sk:b.BackupArn},now=clock();const {Item:r}=await db.send(new GetCommand({TableName:TABLE,Key:key,ConsistentRead:true}));
   if(!r){registered++;if(!dryRun){const created=Math.floor(new Date(b.BackupCreationDateTime).getTime()/1000);if(!Number.isSafeInteger(created))throw error('BACKUP_DATE_INVALID');await db.send(new PutCommand({TableName:TABLE,Item:{...key,tableName:b.TableName,policyDays:DAYS,policyVersion:1,status:'RETAINED',retainUntil:Math.max(created,now)+DAYS*86400,registeredAt:now},ConditionExpression:'attribute_not_exists(pk)'}));}continue;}
   if(r.status==='DELETED')continue;
   if(r.tableName!==b.TableName||r.policyDays!==DAYS||!Number.isSafeInteger(r.retainUntil)||r.legalHold||r.retentionHold||r.retainUntil>now){blocked++;continue;}
   if(dryRun){removed++;continue;}
   // Once removal begins, operational hold changes must reject DELETING records.
   await db.send(new UpdateCommand({TableName:TABLE,Key:key,UpdateExpression:'SET #s = :deleting',ConditionExpression:'(#s = :retained OR #s = :deleting) AND retainUntil = :until AND (attribute_not_exists(legalHold) OR legalHold = :no) AND (attribute_not_exists(retentionHold) OR retentionHold = :no)',ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':deleting':'DELETING',':retained':'RETAINED',':until':r.retainUntil,':no':false}}));
   try{await client.send(new DeleteBackupCommand({BackupArn:b.BackupArn}));}catch(e){if(e.name!=='BackupNotFoundException')throw e;}
   await db.send(new UpdateCommand({TableName:TABLE,Key:key,UpdateExpression:'SET #s = :deleted, deletedAt = :now',ConditionExpression:'#s = :deleting',ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':deleting':'DELETING',':deleted':'DELETED',':now':now}}));removed++;
  }return {dryRun,registered,removed,blocked,policyDays:DAYS};
 };
}
module.exports={createBackupRetention,eligibleBackup};
module.exports.handler=async(event={})=>{
 if(process.env.ENVIRONMENT!=='staging')throw error('ENVIRONMENT_NOT_ALLOWED');const dryRun=event.dryRun!==false;
 if(!dryRun&&process.env.BACKUP_RETENTION_ENABLED!=='true')throw error('BACKUP_RETENTION_DISABLED');
 const {DynamoDBClient}=require('@aws-sdk/client-dynamodb'),{DynamoDBDocumentClient}=require('@aws-sdk/lib-dynamodb');const client=new DynamoDBClient({});
 return createBackupRetention({client,db:DynamoDBDocumentClient.from(client,{marshallOptions:{removeUndefinedValues:true}}),dryRun})();
};
