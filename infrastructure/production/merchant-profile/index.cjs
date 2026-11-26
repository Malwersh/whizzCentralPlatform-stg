'use strict';
exports.handler=async event=>{
 const reply=(statusCode,data)=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(data)});
 if(process.env.ENVIRONMENT!=='production'||process.env.PROFILE_API_ENABLED!=='true')return reply(503,{code:'PRODUCTION_PROFILE_UNAVAILABLE',message:'الخدمة غير متاحة حاليًا'});
 try{
  const {DynamoDBClient}=require('@aws-sdk/client-dynamodb');
  const {DynamoDBDocumentClient,GetCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
  const {CognitoIdentityProviderClient,AdminGetUserCommand}=require('@aws-sdk/client-cognito-identity-provider');
  const {createAuthenticator}=require('./authenticate.cjs'),{createService}=require('./personal-profile.cjs');
  const db=DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const authenticate=createAuthenticator({cognito:new CognitoIdentityProviderClient({}),AdminGetUserCommand});
  return reply(200,await createService({db,GetCommand,TransactWriteCommand,authenticate})(event));
 }catch(e){const status=e.status||e.statusCode||503;return reply(status,{code:e.code||'PROFILE_REQUEST_UNAVAILABLE',message:status===401?'يرجى تسجيل الدخول':status===409?'تغيّرت البيانات؛ حدّث الصفحة وأعد المحاولة':'تعذر إكمال الطلب؛ حاول مجددًا'});}
};
