'use strict';
exports.handler=async event=>{
 const reply=(statusCode,data)=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(data)});
 if(process.env.ENVIRONMENT!=='production'||process.env.BRANCH_API_ENABLED!=='true')return reply(503,{code:'PRODUCTION_BRANCHES_UNAVAILABLE',message:'تسجيل الفروع غير متاح حاليًا'});
 try{
  const {DynamoDBClient}=require('@aws-sdk/client-dynamodb');
  const sdk=require('@aws-sdk/lib-dynamodb');
  const {CognitoIdentityProviderClient,AdminGetUserCommand}=require('@aws-sdk/client-cognito-identity-provider');
  const {createAuthenticator}=require('../merchant-profile/authenticate.cjs');
  const {createRegionResolver}=require('../../../backend/region-management/covered-region-entry.js');
  const {createRegions,TABLES}=require('./regions.cjs');
  const {createRequestService}=require('./request-service.cjs');
  const db=sdk.DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const regions=createRegions({db,sdk,resolveCoverage:createRegionResolver({db,sdk,tables:TABLES})});
  const authenticate=createAuthenticator({cognito:new CognitoIdentityProviderClient({}),AdminGetUserCommand});
  return reply(200,await createRequestService({db,sdk,regions,authenticate})(event));
 }catch(e){const status=Number.isInteger(e.status)?e.status:503;return reply(status,{code:e.code|| (status<500?e.message:'BRANCH_REQUEST_UNAVAILABLE'),message:status===401?'يرجى تسجيل الدخول':status===409?'تغيّرت بيانات التسجيل؛ حدّث الصفحة وأعد المحاولة':'تعذر إكمال تسجيل الفرع؛ حاول مجددًا'});}
};
