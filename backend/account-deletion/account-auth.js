'use strict';
const {CognitoIdentityProviderClient,GetUserCommand}=require('@aws-sdk/client-cognito-identity-provider');
const {error}=require('./policy');
const CLIENTS=Object.freeze({
 CUSTOMER:{pool:'us-east-1_TpyyrVkEE',clientId:'4a9e8o3em311eq2rgckp0pd2s9'},
 DRIVER:{pool:'us-east-1_RGTqUXF5C',clientId:'2d26d3muq0vvcuf42lkpgmkgsr'},
 MERCHANT:{pool:'us-east-1_gtCR3ndzT',clientId:'4qabvh11nmghmf9fmc6e6ludd2'},
 STAFF:{pool:'us-east-1_wz7vwZZxz',clientId:'17mu2qlqis0qcs1n1n980q7e3j'},
});
function accountAuth({cognito=new CognitoIdentityProviderClient({}),allowedTypes=['CUSTOMER','DRIVER','MERCHANT','STAFF'],clients=CLIENTS}={}){
 return async event=>{
  const authorization=Object.entries(event.headers||{}).filter(([name])=>name.toLowerCase()==='authorization');
  const header=authorization.length===1&&authorization[0][1];
  const token=typeof header==='string'&&header.length<=8200?/^Bearer (\S+)$/.exec(header)?.[1]:null;
  if(!token)throw error('UNAUTHORIZED');
  // GetUser validates the token with Cognito before decoded claims are used.
  let user;try{user=await cognito.send(new GetUserCommand({AccessToken:token}));}catch(e){if(['NotAuthorizedException','UserNotFoundException','InvalidParameterException'].includes(e.name))throw error('UNAUTHORIZED');throw error('AUTH_UNAVAILABLE');}
  let claims;try{claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString());}catch(_){throw error('UNAUTHORIZED');}
  const attrs=Object.fromEntries((user.UserAttributes||[]).map(a=>[a.Name,a.Value]));
  const type=allowedTypes.find(t=>clients[t]&&claims.iss===`https://cognito-idp.us-east-1.amazonaws.com/${clients[t].pool}`&&claims.client_id===clients[t].clientId);
  if(!type||claims.token_use!=='access'||!attrs.sub||claims.sub!==attrs.sub)throw error('UNAUTHORIZED');
  return {type,sub:attrs.sub,username:user.Username,attrs};
 };
}
module.exports={accountAuth,CLIENTS};
