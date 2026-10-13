'use strict';
const {DynamoDBClient}=require('@aws-sdk/client-dynamodb');
const {DynamoDBDocumentClient,QueryCommand,DeleteCommand}=require('@aws-sdk/lib-dynamodb');
const {CognitoIdentityProviderClient,AdminUserGlobalSignOutCommand}=require('@aws-sdk/client-cognito-identity-provider');
const db=DynamoDBDocumentClient.from(new DynamoDBClient({})),cognito=new CognitoIdentityProviderClient({});
async function handler(){
 const result=await db.send(new QueryCommand({TableName:process.env.STAFF_TABLE,KeyConditionExpression:'pk = :pk',ExpressionAttributeValues:{':pk':'REVOCATIONS'},ConsistentRead:true,Limit:100}));
 let completed=0,failed=0;
 for(const item of result.Items||[]){
  try{
   await cognito.send(new AdminUserGlobalSignOutCommand({UserPoolId:process.env.USER_POOL_ID,Username:item.username}));
   await db.send(new DeleteCommand({TableName:process.env.STAFF_TABLE,Key:{pk:item.pk,sk:item.sk}}));completed++;
  }catch(error){failed++;console.warn('Session revocation remains pending',{code:error.name});}
 }
 return {completed,failed};
}
module.exports={handler};
