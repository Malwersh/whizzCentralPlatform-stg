'use strict';
const {DynamoDBClient}=require('@aws-sdk/client-dynamodb');
const {DynamoDBDocumentClient,QueryCommand,GetCommand,ScanCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {CognitoIdentityProviderClient,AdminGetUserCommand,AdminDisableUserCommand,AdminUserGlobalSignOutCommand,AdminDeleteUserCommand}=require('@aws-sdk/client-cognito-identity-provider');
const {redact}=require('./account-deletion');
function createWorker({db,cognito,table,pool}){
 if(table!=='staging-PlatformStaff'||pool!=='us-east-1_wz7vwZZxz')throw Error('ENVIRONMENT_NOT_ALLOWED');
 const get=async key=>(await db.send(new GetCommand({TableName:table,Key:key,ConsistentRead:true}))).Item;
 return async()=>{
  const result=await db.send(new QueryCommand({TableName:table,KeyConditionExpression:'pk = :pk',ExpressionAttributeValues:{':pk':'STAFF_DELETIONS'},ConsistentRead:true}));
  if(result.LastEvaluatedKey)throw Error('DELETION_JOBS_INCOMPLETE');let completed=0;
  for(const job of result.Items||[]){
   if(job.status!=='READY')continue;
   const key={pk:'EMPLOYEE#'+job.employeeId,sk:'PROFILE'},target=await get(key);
   if(!target||target.status!=='DELETING'||target.deletionRequestId!==job.requestId||target.roles.includes('bootstrap_admin')||target.legalHold||target.retentionHold)throw Error('TARGET_CHANGED_OR_HELD');
   const fence=()=>({ConditionCheck:{TableName:table,Key:key,ConditionExpression:'#s = :deleting AND deletionRequestId = :id AND #v = :v AND (attribute_not_exists(legalHold) OR legalHold = :no) AND (attribute_not_exists(retentionHold) OR retentionHold = :no)',ExpressionAttributeNames:{'#s':'status','#v':'version'},ExpressionAttributeValues:{':deleting':'DELETING',':id':job.requestId,':v':target.version,':no':false}}});
   let rows=[],cursor,pages=0;do{if(++pages>100)throw Error('STAFF_INVENTORY_INCOMPLETE');const page=await db.send(new ScanCommand({TableName:table,ConsistentRead:true,ExclusiveStartKey:cursor}));rows.push(...page.Items||[]);cursor=page.LastEvaluatedKey;}while(cursor);
   // Inventory and holds precede any identity removal.
   if(rows.some(r=>JSON.stringify(r).includes(job.employeeId)&&(r.legalHold||r.retentionHold)))throw Error('DOCUMENTED_RETENTION_HOLD');
   let identityPresent=true;try{const live=await cognito.send(new AdminGetUserCommand({UserPoolId:pool,Username:target.username}));if(live.UserAttributes?.find(a=>a.Name==='sub')?.Value!==target.employeeId)throw Error('IDENTITY_GENERATION_CHANGED');}catch(e){if(e.name!=='UserNotFoundException')throw e;identityPresent=false;}
   for(const Command of identityPresent?[AdminDisableUserCommand,AdminUserGlobalSignOutCommand]:[])try{await cognito.send(new Command({UserPoolId:pool,Username:target.username}));}catch(e){if(e.name!=='UserNotFoundException')throw e;}
   for(const row of rows){
    if(row.pk===key.pk&&row.sk===key.sk)continue;
    if(row.pk==='REVOCATIONS'&&row.employeeId===job.employeeId){await db.send(new TransactWriteCommand({TransactItems:[fence(),{Delete:{TableName:table,Key:{pk:row.pk,sk:row.sk},ConditionExpression:'employeeId = :id',ExpressionAttributeValues:{':id':job.employeeId}}}]}));continue;}
    const redacted=redact(row,job.employeeId);if(JSON.stringify(redacted)===JSON.stringify(row))continue;
    const names={},values={},conditions=[];Object.entries(row).forEach(([field,value],i)=>{names['#f'+i]=field;values[':f'+i]=value;conditions.push('#f'+i+' = :f'+i);});
    await db.send(new TransactWriteCommand({TransactItems:[fence(),{Put:{TableName:table,Item:redacted,ConditionExpression:conditions.join(' AND '),ExpressionAttributeNames:names,ExpressionAttributeValues:values}}]}));
   }

   // Recheck the fence just before the irreversible provider call. Worker concurrency is one;
   // all API changes reject DELETING targets.
   const current=await get(key);if(current?.version!==target.version||current?.deletionRequestId!==job.requestId||current?.legalHold||current?.retentionHold)throw Error('TARGET_CHANGED_OR_HELD');
   if(identityPresent)try{const live=await cognito.send(new AdminGetUserCommand({UserPoolId:pool,Username:target.username}));if(live.UserAttributes?.find(a=>a.Name==='sub')?.Value!==target.employeeId)throw Error('IDENTITY_GENERATION_CHANGED');await cognito.send(new AdminDeleteUserCommand({UserPoolId:pool,Username:target.username}));}catch(e){if(e.name!=='UserNotFoundException')throw e;}
   if(target.email){const emailKey={pk:'EMAIL#'+target.email,sk:'PROFILE'},claim=await get(emailKey);if(claim){if(claim.employeeId!==target.employeeId)throw Error('EMAIL_CLAIM_CONFLICT');await db.send(new TransactWriteCommand({TransactItems:[fence(),{Delete:{TableName:table,Key:emailKey,ConditionExpression:'employeeId = :id',ExpressionAttributeValues:{':id':target.employeeId}}}]}));}}
   const now=new Date().toISOString();
   await db.send(new TransactWriteCommand({TransactItems:[{Put:{TableName:table,Item:{...key,employeeId:target.employeeId,status:'DELETED',roles:[],scope:{allRegions:false,regionIds:[]},approvalLimit:0,version:target.version+1,deletionRequestId:job.requestId,deletedAt:now},ConditionExpression:'#s = :s AND deletionRequestId = :id AND #v = :v',ExpressionAttributeNames:{'#s':'status','#v':'version'},ExpressionAttributeValues:{':s':'DELETING',':id':job.requestId,':v':target.version}}},{Put:{TableName:table,Item:{...job,status:'COMPLETED',completedAt:now},ConditionExpression:'#s = :s',ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':s':'READY'}}}]}));completed++;
  }return {completed};
 };
}
module.exports={createWorker};
module.exports.handler=async()=>createWorker({db:DynamoDBDocumentClient.from(new DynamoDBClient({}),{marshallOptions:{removeUndefinedValues:true}}),cognito:new CognitoIdentityProviderClient({}),table:process.env.STAFF_TABLE,pool:process.env.USER_POOL_ID})();
