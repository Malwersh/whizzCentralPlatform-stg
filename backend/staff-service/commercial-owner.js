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
  const owner={subjectId:claims.sub,authTime:claims.auth_time,revalidate:async()=>{const live=await ctx.cognito.send(new GetUserCommand({AccessToken:event.accessToken}));const a=Object.fromEntries((live.UserAttributes||[]).map(x=>[x.Name,x.Value]));if(a.sub!==claims.sub||a.phone_number_verified!=='true')throw Object.assign(Error('UNAUTHORIZED'),{status:401});return a;}};
  let result;
  if(event.action==='settlement_schedule_owner')result=await require('./settlement-schedules').owner(ctx,claims.sub,event.httpMethod,event.input,owner);
  else if(ctx.financialLockEnabled===true){
   if(!event.input||typeof event.input.businessId!=='string'||Object.prototype.hasOwnProperty.call(event.input,'branchId'))throw Object.assign(Error('PAYOUT_FINANCIAL_INVALID_REQUEST'),{status:400});
   const gate=await require('./merchant-financial-access').createAccess(ctx,owner).protect({...event.input,branchId:event.input.businessId});
   const {branchId,...body}=gate.body;
   result=await require('./commercial-management').service({...ctx,db:gate.db},{kind:'OWNER',sub:claims.sub},event.httpMethod,body);
   await gate.verify();
  }else result=await require('./commercial-management').service(ctx,{kind:'OWNER',sub:claims.sub},event.httpMethod,event.input);
  return {statusCode:200,result};
 }catch(e){return {statusCode:e.status||503,code:e.status?e.message:/^(PAYOUT_|CORRECTION_)/.test(e.code||'')?e.code:'COMMERCIAL_UNAVAILABLE'};}
}
module.exports={handle};
