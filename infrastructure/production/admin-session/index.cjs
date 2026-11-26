'use strict';
exports.handler=async event=>{
 if(process.env.ENVIRONMENT!=='production'||process.env.ADMIN_SESSION_ENABLED!=='true')return {statusCode:503,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify({error:'PRODUCTION_ADMIN_SESSION_UNAVAILABLE'})};
 const {CognitoJwtVerifier}=require('aws-jwt-verify');
 const {DynamoDBClient}=require('@aws-sdk/client-dynamodb');
 const {DynamoDBDocumentClient,GetCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
 const {CognitoIdentityProviderClient,AdminGetUserCommand}=require('@aws-sdk/client-cognito-identity-provider');
 const {createSessionApi,POOL,CLIENT}=require('./session-api.cjs');
 const verifier=CognitoJwtVerifier.create({userPoolId:POOL,clientId:CLIENT,tokenUse:'access'}),cognito=new CognitoIdentityProviderClient({});
 return createSessionApi({db:DynamoDBDocumentClient.from(new DynamoDBClient({}),{marshallOptions:{removeUndefinedValues:true}}),GetCommand,TransactWriteCommand,verifyAccessToken:t=>verifier.verify(t),liveIdentity:c=>cognito.send(new AdminGetUserCommand({UserPoolId:POOL,Username:c.username}))})(event);
};
