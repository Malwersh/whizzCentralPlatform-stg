'use strict';
const {CognitoIdentityProviderClient,GetUserCommand}=require('@aws-sdk/client-cognito-identity-provider');
const {error}=require('./policy');
function customerAuth({cognito=new CognitoIdentityProviderClient({}),pool='us-east-1_TpyyrVkEE',clientId='4a9e8o3em311eq2rgckp0pd2s9'}={}){
 return async event=>{
  const token=/^Bearer (\S+)$/.exec(event.headers?.Authorization||event.headers?.authorization||'')?.[1];
  if(!token)throw error('UNAUTHORIZED');
  let user;try{user=await cognito.send(new GetUserCommand({AccessToken:token}));}catch(e){if(['NotAuthorizedException','UserNotFoundException','InvalidParameterException'].includes(e.name))throw error('UNAUTHORIZED');throw error('AUTH_UNAVAILABLE');}
  let claims;try{claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString());}catch(_){throw error('UNAUTHORIZED');}
  const attrs=Object.fromEntries((user.UserAttributes||[]).map(x=>[x.Name,x.Value]));
  if(claims.iss!==`https://cognito-idp.us-east-1.amazonaws.com/${pool}`||claims.client_id!==clientId||claims.token_use!=='access'||claims.sub!==attrs.sub)throw error('UNAUTHORIZED');
  return {type:'CUSTOMER',sub:attrs.sub,username:user.Username,attrs};
 };
}
module.exports={customerAuth};
