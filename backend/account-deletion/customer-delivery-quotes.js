'use strict';
const {QueryCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {error}=require('./policy');
const environments={
 staging:{requests:'staging-AccountDeletion',quotes:'staging-DeliveryQuotes',profiles:'WizzUser_users_staging'},
 production:{requests:'wizz-production-AccountDeletion',quotes:'wizz-production-DeliveryQuotes',profiles:'wizz-production-Customers'},
};
// Only called after customer profiles are locked. No Scan, Cognito change or financial archive.
async function purge({db,r,job,requestTable='staging-AccountDeletion',clock=()=>new Date().toISOString(),maxPages=100,environment='staging'}){
 const tables=Object.hasOwn(environments,environment)?environments[environment]:null;
 const production=environment==='production';
 if(!tables||requestTable!==tables.requests||r.actorType!=='CUSTOMER'||r.scope?.kind!=='ACCOUNT'||r.scope.id!==r.subjectId||
  job.subjectId!==r.subjectId||job.requestId!==r.requestId||!r.pk||!r.sk||!r.leaseOwner||!Number.isSafeInteger(r.version)||
  !Array.isArray(job.profileIds)||!production&&!job.profileIds.length||
  job.profileIds.some(id=>typeof id!=='string'||!/^[A-Za-z0-9_.:-]{1,150}$/.test(id)))throw error('INVALID_CLEANUP_SCOPE');
 if(production&&(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(r.subjectId)||
  r.pk!=='SUBJECT#CUSTOMER#'+r.subjectId||r.sk!=='REQUEST#'+r.requestId||r.status!=='PROCESSING'||
  job.profileIds.some(id=>id!==r.subjectId)))throw error('INVALID_CLEANUP_SCOPE');
 for(const userId of new Set(production?[r.subjectId]:job.profileIds)){
  const pk='CUSTOMER#'+userId;let pages=0,more;
  do{
   // Restart at partition head: a crash after deleting a page cannot strand earlier items.
   const page=await db.send(new QueryCommand({TableName:tables.quotes,ConsistentRead:true,Limit:20,
    KeyConditionExpression:'pk=:pk',ExpressionAttributeValues:{':pk':pk}}));
   const rows=page.Items||[];
   const validKey=sk=>typeof sk==='string'&&(sk.startsWith('QUOTE#')||sk==='RATE#DELIVERY_QUOTE'||production&&sk==='RATE#STOREFRONT_PREVIEW');
   if(rows.some(row=>row.pk!==pk||!validKey(row.sk)||row.subjectId!==r.subjectId||
    typeof row.digest!=='string'||!row.digest))throw error('INVALID_CLEANUP_SCOPE');
   if(rows.some(row=>row.legalHold||row.retentionHold))throw error('DOCUMENTED_RETENTION_HOLD');
   if(rows.length)await db.send(new TransactWriteCommand({TransactItems:[
    {ConditionCheck:{TableName:requestTable,Key:{pk:r.pk,sk:r.sk},ConditionExpression:'leaseOwner=:owner AND leaseUntil>:now AND #v=:v AND #s=:processing',
     ExpressionAttributeNames:{'#v':'version','#s':'status'},ExpressionAttributeValues:{':owner':r.leaseOwner,':now':Math.floor(new Date(clock()).getTime()/1000),':v':r.version,':processing':'PROCESSING'}}},
    ...(production?[{ConditionCheck:{TableName:requestTable,Key:{pk:'ACCOUNT_LIFECYCLE#CUSTOMER#'+r.subjectId,sk:'META'},
     ConditionExpression:'requestId=:request AND #state=:closing',ExpressionAttributeNames:{'#state':'state'},
     ExpressionAttributeValues:{':request':job.requestId,':closing':'CLOSING'}}}]:[]),
    ...(job.profileIds.length?[{ConditionCheck:{TableName:tables.profiles,Key:{userId},ConditionExpression:'deletionRequestId=:request',ExpressionAttributeValues:{':request':job.requestId}}}]:[]),
    ...rows.map(row=>({Delete:{TableName:tables.quotes,Key:{pk,sk:row.sk},
     ConditionExpression:'subjectId=:sub AND #digest=:digest AND (attribute_not_exists(legalHold) OR legalHold=:no) AND (attribute_not_exists(retentionHold) OR retentionHold=:no)'+
      (production?(row.consumption===undefined?' AND attribute_not_exists(consumption)':' AND consumption=:consumption'):''),
     ExpressionAttributeNames:{'#digest':'digest'},ExpressionAttributeValues:{':sub':r.subjectId,':digest':row.digest,':no':false,
      ...(production&&row.consumption!==undefined?{':consumption':row.consumption}:{})}}}))
   ]}));
   more=!!page.LastEvaluatedKey;
   if(++pages>=maxPages&&more)throw error('INVENTORY_INCOMPLETE');
  }while(more);
 }
}
module.exports={purge};
