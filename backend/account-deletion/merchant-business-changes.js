'use strict';
const {QueryCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {error}=require('./policy');
const TABLE='staging-MerchantPlatform';
async function purge({db,r,job,requestTable='staging-AccountDeletion'}){
 if(!r.subjectId||r.subjectId!==job.subjectId||r.scope?.id!==job.businessId||!job.businessId||!r.pk||!r.sk||!r.leaseOwner||!Number.isSafeInteger(r.version))throw error('INVALID_CLEANUP_SCOPE');
 const rows=[];
 for(const [pk,prefix] of [['PERSON#'+r.subjectId,'CHANGE#'],['REVIEW#MERCHANT','CHANGE#'],['PERSON#'+r.subjectId,'CONTACT_CHANGE'],['PERSON#'+r.subjectId,'PROFILE_AUDIT#']]){let cursor;do{const page=await db.send(new QueryCommand({TableName:TABLE,KeyConditionExpression:'pk=:pk AND begins_with(sk,:prefix)',ExpressionAttributeValues:{':pk':pk,':prefix':prefix},ConsistentRead:true,ExclusiveStartKey:cursor}));for(const row of page.Items||[])if(row.subjectId===r.subjectId&&row.businessId===job.businessId)rows.push(row);cursor=page.LastEvaluatedKey;}while(cursor);}
 if(rows.some(row=>row.legalHold||row.retentionHold))throw error('DOCUMENTED_RETENTION_HOLD');
 for(const row of new Map(rows.map(row=>[row.pk+row.sk,row])).values()){await db.send(new TransactWriteCommand({TransactItems:[
  {ConditionCheck:{TableName:requestTable,Key:{pk:r.pk,sk:r.sk},ConditionExpression:'leaseOwner=:owner AND #v=:v AND leaseUntil>:now',ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':owner':r.leaseOwner,':v':r.version,':now':Math.floor(Date.now()/1000)}}},
  {Delete:{TableName:TABLE,Key:{pk:row.pk,sk:row.sk},ConditionExpression:'subjectId=:sub AND businessId=:business AND (attribute_not_exists(legalHold) OR legalHold=:no) AND (attribute_not_exists(retentionHold) OR retentionHold=:no)',ExpressionAttributeValues:{':sub':r.subjectId,':business':job.businessId,':no':false}}}
 ]}));}
}
module.exports={purge};
