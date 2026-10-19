'use strict';
const {CognitoJwtVerifier}=require('aws-jwt-verify');
const {GetUserCommand}=require('@aws-sdk/client-cognito-identity-provider');
const verifier=CognitoJwtVerifier.create({userPoolId:'us-east-1_gtCR3ndzT',clientId:'4qabvh11nmghmf9fmc6e6ludd2',tokenUse:'access'});
async function handle(ctx,event){
 try{
  if(ctx.enabled!==true)return {statusCode:503,code:event?.action==='settlement_schedule_owner'?'SETTLEMENT_SCHEDULE_ADMIN_DISABLED':'COMMERCIAL_MANAGEMENT_DISABLED'};
  if(Object.keys(event).sort().join(',')!=='accessToken,action,httpMethod,input'||!['GET','POST'].includes(event.httpMethod)||typeof event.accessToken!=='string')return {statusCode:400,code:'INVALID_COMMERCIAL_REQUEST'};
  let claims,user;
  try{claims=await (ctx.verify||verifier.verify.bind(verifier))(event.accessToken);user=await ctx.cognito.send(new GetUserCommand({AccessToken:event.accessToken}));}
  catch{return {statusCode:401,code:'UNAUTHORIZED'};}
  const attrs=Object.fromEntries((user.UserAttributes||[]).map(a=>[a.Name,a.Value]));
  if(!claims.sub||attrs.sub!==claims.sub||attrs.phone_number_verified!=='true')return {statusCode:401,code:'UNAUTHORIZED'};
  // A currently valid, live Cognito session is sufficient for explicit consent.
  // Do not force a second phone login solely because auth_time is older than five minutes.
  const result=event.action==='settlement_schedule_owner'?await require('./settlement-schedules').owner(ctx,claims.sub,event.httpMethod,event.input):await require('./commercial-management').service(ctx,{kind:'OWNER',sub:claims.sub},event.httpMethod,event.input);return {statusCode:200,result};
 }catch(e){return {statusCode:e.status||503,code:e.status?e.message:'COMMERCIAL_UNAVAILABLE'};}
}
module.exports={handle};
