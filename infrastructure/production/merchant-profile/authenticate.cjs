'use strict';
const POOL='us-east-1_2sKZ4fGbZ',CLIENT='5l8ng11uudg146crop63926svq';
function createAuthenticator({cognito,AdminGetUserCommand,now=()=>Date.now()/1000}){
 return async event=>{
  // API Gateway's Cognito authorizer verifies the signature; enforce the exact app as well.
  const c=event.requestContext?.authorizer?.claims;
  const deny=()=>{throw Object.assign(Error('UNAUTHORIZED'),{code:'UNAUTHORIZED',status:401});};
  if(!c||c.iss!=='https://cognito-idp.us-east-1.amazonaws.com/'+POOL||c.aud!==CLIENT||c.token_use!=='id'||!Number.isFinite(Number(c.exp))||Number(c.exp)<=now()||!Number.isFinite(Number(c.iat))||Number(c.iat)>now()+60||!/^[a-f0-9-]{36}$/i.test(c.sub||'')||typeof c['cognito:username']!=='string'||!c['cognito:username'])deny();
  const user=await cognito.send(new AdminGetUserCommand({UserPoolId:POOL,Username:c['cognito:username']}));
  const attrs=Object.fromEntries((user.UserAttributes||[]).map(x=>[x.Name,x.Value]));
  if(attrs.sub!==c.sub||user.Enabled!==true||user.UserStatus!=='CONFIRMED'||attrs.phone_number!==c.phone_number||attrs.phone_number_verified!=='true')deny();
  return {sub:c.sub,user};
 };
}
module.exports={createAuthenticator,POOL,CLIENT};
