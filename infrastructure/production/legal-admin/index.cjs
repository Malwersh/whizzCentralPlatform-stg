'use strict';
exports.handler=async event=>{
 if(process.env.ENVIRONMENT!=='production')return {statusCode:503,body:JSON.stringify({error:'LEGAL_ADMIN_UNAVAILABLE'})};
 const {CognitoJwtVerifier}=require('aws-jwt-verify');
 const {DynamoDBClient}=require('@aws-sdk/client-dynamodb');
 const {DynamoDBDocumentClient,GetCommand}=require('@aws-sdk/lib-dynamodb');
 const {CognitoIdentityProviderClient,AdminGetUserCommand}=require('@aws-sdk/client-cognito-identity-provider');
 const verifier=CognitoJwtVerifier.create({userPoolId:'us-east-1_njh6vaNWj',clientId:'7924qedsr5m1j1bvc3c7va8egk',tokenUse:'access'}),cognito=new CognitoIdentityProviderClient({});
 const {allowed}=require('./catalog'),audit=require('./audit-trail');
 return require('./api.cjs').createLegalApi({db:DynamoDBDocumentClient.from(new DynamoDBClient({}),{marshallOptions:{removeUndefinedValues:true}}),GetCommand,allowed,route:require('./service/customer-legal-documents-344').route,audit:audit.write,
 guard:(table,a)=>({ConditionCheck:{TableName:table,Key:{pk:'EMPLOYEE#'+a.employeeId,sk:'PROFILE'},ConditionExpression:'#v=:v AND #s=:s',ExpressionAttributeNames:{'#v':'version','#s':'status'},ExpressionAttributeValues:{':v':a.version,':s':'ACTIVE'}}}),
 verifyAccessToken:t=>verifier.verify(t),liveIdentity:c=>cognito.send(new AdminGetUserCommand({UserPoolId:'us-east-1_njh6vaNWj',Username:c.username}))})(event);
};
