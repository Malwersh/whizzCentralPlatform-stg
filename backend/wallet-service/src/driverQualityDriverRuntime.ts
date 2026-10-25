import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';
import {CognitoIdentityProviderClient} from '@aws-sdk/client-cognito-identity-provider';
import {createAuthenticatedDriverQualityAppeal} from './driverQualityAppeal';
export async function handler(event:Record<string,any>){
 try{
  if(!event||Object.keys(event).sort().join(',')!=='accessToken,action,body'||event.action!=='driver_quality_case'||typeof event.accessToken!=='string')return {statusCode:400,code:'INVALID_DRIVER_QUALITY_REVIEW'};
  const db=DynamoDBDocumentClient.from(new DynamoDBClient({region:'us-east-1'}),{marshallOptions:{removeUndefinedValues:true}}),cognito=new CognitoIdentityProviderClient({region:'us-east-1'});
  return {statusCode:200,result:await createAuthenticatedDriverQualityAppeal({db,cognito,accessToken:event.accessToken})(event.body)};
 }catch(error:any){const codes=['UNAUTHORIZED','INVALID_DRIVER_QUALITY_REVIEW','DRIVER_QUALITY_REVIEW_CONFLICT','DRIVER_QUALITY_CASE_UNAVAILABLE','DRIVER_QUALITY_APPEAL_CONFLICT','DRIVER_QUALITY_REVIEW_LIMIT'];return {statusCode:error?.code==='UNAUTHORIZED'?403:409,code:codes.includes(error?.code)?error.code:'QUALITY_APPEAL_UNAVAILABLE'};}
}
export {createDriverQualityAppeal} from './driverQualityAppeal';
