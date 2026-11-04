'use strict';
const {QueryCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {error}=require('./policy');
const TABLE='staging-DeliveryQuotes';
// Only called after customer profiles are locked. No Scan, Cognito change or financial archive.
async function purge({db,r,job,requestTable='staging-AccountDeletion',clock=()=>new Date().toISOString(),maxPages=100}){
 if(requestTable!=='staging-AccountDeletion'||r.actorType!=='CUSTOMER'||r.scope?.kind!=='ACCOUNT'||r.scope.id!==r.subjectId||
  job.subjectId!==r.subjectId||job.requestId!==r.requestId||!r.pk||!r.sk||!r.leaseOwner||!Number.isSafeInteger(r.version)||
  !Array.isArray(job.profileIds)||!job.profileIds.length||job.profileIds.some(id=>typeof id!=='string'||!/^[A-Za-z0-9_.:-]{1,150}$/.test(id)))throw error('INVALID_CLEANUP_SCOPE');
 for(const userId of new Set(job.profileIds)){
  const pk='CUSTOMER#'+userId;let pages=0,more;
  do{
   // Restart at partition head: a crash after deleting a page cannot strand earlier items.
   const page=await db.send(new QueryCommand({TableName:TABLE,ConsistentRead:true,Limit:20,
    KeyConditionExpression:'pk=:pk',ExpressionAttributeValues:{':pk':pk}}));
   const rows=page.Items||[];
   if(rows.some(row=>row.pk!==pk||typeof row.sk!=='string'||(!row.sk.startsWith('QUOTE#')&&row.sk!=='RATE#DELIVERY_QUOTE')||row.subjectId!==r.subjectId))throw error('INVALID_CLEANUP_SCOPE');
   if(rows.some(row=>row.legalHold||row.retentionHold))throw error('DOCUMENTED_RETENTION_HOLD');
   if(rows.length)await db.send(new TransactWriteCommand({TransactItems:[
    {ConditionCheck:{TableName:requestTable,Key:{pk:r.pk,sk:r.sk},ConditionExpression:'leaseOwner=:owner AND leaseUntil>:now AND #v=:v AND #s=:processing',
     ExpressionAttributeNames:{'#v':'version','#s':'status'},ExpressionAttributeValues:{':owner':r.leaseOwner,':now':Math.floor(new Date(clock()).getTime()/1000),':v':r.version,':processing':'PROCESSING'}}},
    {ConditionCheck:{TableName:'WizzUser_users_staging',Key:{userId},ConditionExpression:'deletionRequestId=:request',ExpressionAttributeValues:{':request':job.requestId}}},
    ...rows.map(row=>({Delete:{TableName:TABLE,Key:{pk,sk:row.sk},
     ConditionExpression:'subjectId=:sub AND #digest=:digest AND (attribute_not_exists(legalHold) OR legalHold=:no) AND (attribute_not_exists(retentionHold) OR retentionHold=:no)',
     ExpressionAttributeNames:{'#digest':'digest'},ExpressionAttributeValues:{':sub':r.subjectId,':digest':row.digest,':no':false}}}))
   ]}));
   more=!!page.LastEvaluatedKey;
   if(++pages>=maxPages&&more)throw error('INVENTORY_INCOMPLETE');
  }while(more);
 }
}
module.exports={purge};
