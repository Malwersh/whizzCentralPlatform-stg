'use strict';
const {DynamoDBClient}=require('@aws-sdk/client-dynamodb');
const {DynamoDBDocumentClient,GetCommand}=require('@aws-sdk/lib-dynamodb');
// Inventory readiness is a separately reviewed deployment property, never a UI policy checkbox.
function retentionSettings({db=DynamoDBDocumentClient.from(new DynamoDBClient({})),table=process.env.STAFF_TABLE,approvedInventories=new Set()}={}){
 if(table!=='staging-PlatformStaff')throw Error('INVALID_STAGING_TABLE');
 return async(type,version)=>{
  if(!['CUSTOMER','DRIVER','MERCHANT','STAFF'].includes(type))throw Error('INVALID_ACCOUNT_TYPE');
  if(version!==null&&version!==undefined&&!/^[a-f0-9-]{36}$/.test(version))throw Error('INVALID_POLICY_VERSION');
  const {Item}=await db.send(new GetCommand({TableName:table,Key:{pk:'OPERATIONAL_SETTINGS#ACCOUNT_DELETION',sk:version?'VERSION#'+version:'CURRENT'},ConsistentRead:true}));
  if(!Item?.policyVersion||!Item.approvedAt||!Item.approvedBy||!Item.values)throw Error('RETENTION_POLICY_UNAVAILABLE');
  if(version&&Item.policyVersion!==version)throw Error('RETENTION_POLICY_UNAVAILABLE');
  return {...Item.values,retentionPolicyVersion:Item.policyVersion,inventoryApproved:approvedInventories.has(type),refundMethods:Item.refundMethods,mandatoryWaitingDays:Item.mandatoryWaitingDays};
 };
}
module.exports={retentionSettings};
