'use strict';
exports.handler=async event=>{
 if(process.env.ENVIRONMENT!=='production'||process.env.PLATFORM_ENVIRONMENT!=='production')return {statusCode:503,body:JSON.stringify({error:'REGION_MANAGEMENT_UNAVAILABLE'})};
 const {CognitoJwtVerifier}=require('aws-jwt-verify');
 const {DynamoDBClient}=require('@aws-sdk/client-dynamodb');
 const sdk=require('@aws-sdk/lib-dynamodb');
 const {CognitoIdentityProviderClient,AdminGetUserCommand}=require('@aws-sdk/client-cognito-identity-provider');
 const verifier=CognitoJwtVerifier.create({userPoolId:'us-east-1_njh6vaNWj',clientId:'7924qedsr5m1j1bvc3c7va8egk',tokenUse:'access'});
 const cognito=new CognitoIdentityProviderClient({});
 return require('./region-api.cjs').createRegionApi({db:sdk.DynamoDBDocumentClient.from(new DynamoDBClient({}),{marshallOptions:{removeUndefinedValues:true}}),sdk,
 enabled:process.env.REGION_MANAGEMENT_ENABLED==='true',writesEnabled:process.env.REGION_WRITES_ENABLED==='true',readersReady:process.env.REGION_COMPOSITE_READERS_READY==='true',
 verifyAccessToken:token=>verifier.verify(token),liveIdentity:c=>cognito.send(new AdminGetUserCommand({UserPoolId:'us-east-1_njh6vaNWj',Username:c.username})),route:require('./api-entry').route})(event);
};
