'use strict';
const {CognitoJwtVerifier}=require('aws-jwt-verify');
const {GetUserCommand}=require('@aws-sdk/client-cognito-identity-provider');
const verifier=CognitoJwtVerifier.create({userPoolId:'us-east-1_gtCR3ndzT',clientId:'4qabvh11nmghmf9fmc6e6ludd2',tokenUse:'access'});
async function handle(ctx,event){
 try{
  if(ctx.enabled!==true)return {statusCode:503,code:'COMMERCIAL_MANAGEMENT_DISABLED'};
  if(Object.keys(event).sort().join(',')!=='accessToken,action,httpMethod,input'||!['GET','POST'].includes(event.httpMethod)||typeof event.accessToken!=='string')return {statusCode:400,code:'INVALID_COMMERCIAL_REQUEST'};
  let claims,user;
  try{claims=await (ctx.verify||verifier.verify.bind(verifier))(event.accessToken);user=await ctx.cognito.send(new GetUserCommand({AccessToken:event.accessToken}));}
  catch{return {statusCode:401,code:'UNAUTHORIZED'};}
  const attrs=Object.fromEntries((user.UserAttributes||[]).map(a=>[a.Name,a.Value]));
  if(!claims.sub||attrs.sub!==claims.sub||attrs.phone_number_verified!=='true')return {statusCode:401,code:'UNAUTHORIZED'};
  if(event.httpMethod==='POST'){const age=Math.floor(Date.now()/1000)-claims.auth_time;if(!Number.isInteger(claims.auth_time)||age< -30||age>300)return {statusCode:403,code:'COMMERCIAL_RECENT_SIGN_IN_REQUIRED'};}
  const result=await require('./commercial-management').service(ctx,{kind:'OWNER',sub:claims.sub},event.httpMethod,event.input);return {statusCode:200,result};
 }catch(e){return {statusCode:e.status||503,code:e.status?e.message:'COMMERCIAL_UNAVAILABLE'};}
}
module.exports={handle};
