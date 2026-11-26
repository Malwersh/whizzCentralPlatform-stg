'use strict';
exports.handler=async event=>{
 if(process.env.ENVIRONMENT!=='production'||(process.env.DRIVER_REVIEW_ENABLED!=='true'&&!(process.env.DRIVER_REVIEW_READ_ENABLED==='true'&&event.httpMethod==='GET')))return {statusCode:503,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify({error:'PRODUCTION_REVIEW_UNAVAILABLE'})};
 const {CognitoJwtVerifier}=require('aws-jwt-verify');
 const {DynamoDBClient}=require('@aws-sdk/client-dynamodb');
 const {DynamoDBDocumentClient,GetCommand,ScanCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
 const {CognitoIdentityProviderClient,AdminGetUserCommand}=require('@aws-sdk/client-cognito-identity-provider');
 const {S3Client,HeadObjectCommand,GetObjectCommand}=require('@aws-sdk/client-s3');
 const {getSignedUrl}=require('@aws-sdk/s3-request-presigner');
 const s3=new S3Client({});
 const verifier=CognitoJwtVerifier.create({userPoolId:'us-east-1_njh6vaNWj',clientId:'7924qedsr5m1j1bvc3c7va8egk',tokenUse:'access'});
 const cognito=new CognitoIdentityProviderClient({});
 return require('./review-api.cjs').createReviewApi({db:DynamoDBDocumentClient.from(new DynamoDBClient({}),{marshallOptions:{removeUndefinedValues:true}}),GetCommand,ScanCommand,TransactWriteCommand,HeadObjectCommand,s3,reviewWritesEnabled:process.env.DRIVER_REVIEW_ENABLED==='true',signDocument:(input,expiresIn)=>getSignedUrl(s3,new GetObjectCommand(input),{expiresIn}),verifyAccessToken:t=>verifier.verify(t),liveIdentity:c=>cognito.send(new AdminGetUserCommand({UserPoolId:'us-east-1_njh6vaNWj',Username:c.username}))})(event);
};
