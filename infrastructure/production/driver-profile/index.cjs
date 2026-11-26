'use strict';
exports.handler=async event=>{
 if(process.env.ENVIRONMENT!=='production'||process.env.PROFILE_API_ENABLED!=='true')return {statusCode:503,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify({code:'PRODUCTION_PROFILE_UNAVAILABLE',message:'الخدمة غير متاحة حاليًا'})};
 const {DynamoDBClient}=require('@aws-sdk/client-dynamodb');
 const {DynamoDBDocumentClient,GetCommand,ScanCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
 const {S3Client,PutObjectCommand,HeadObjectCommand}=require('@aws-sdk/client-s3');
 const {driverRequestContext,beginDriverUpload}=require('./driver-lifecycle');
 const {createApi}=require('./profile-api.cjs');
 const db=DynamoDBDocumentClient.from(new DynamoDBClient({}));
 return createApi({db,s3:new S3Client({}),GetCommand,ScanCommand,TransactWriteCommand,PutObjectCommand,HeadObjectCommand,beginUpload:sub=>beginDriverUpload(db,sub),withContext:(sub,fn)=>driverRequestContext.run({sub},fn)})(event);
};
