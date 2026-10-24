import { CognitoIdentityProviderClient, GetUserCommand, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
const pools={STAFF:'us-east-1_wz7vwZZxz',CUSTOMER:'us-east-1_TpyyrVkEE',DRIVER:'us-east-1_RGTqUXF5C',MERCHANT_OWNER:'us-east-1_gtCR3ndzT'} as const;
/** Pool is chosen by the server action, never by a payload role or decoded JWT alone. */
export async function authenticateFinancialIdentity<K extends keyof typeof pools>(cognito:Pick<CognitoIdentityProviderClient,'send'>,accessToken:string,kind:K){
 const bad=():never=>{throw Object.assign(Error('UNAUTHORIZED'),{code:'UNAUTHORIZED'});};
 const pool=pools[kind];if(!pool||typeof accessToken!=='string'||accessToken.length>16000)return bad();
 let claims:any;try{claims=JSON.parse(Buffer.from(accessToken.split('.')[1],'base64url').toString());}catch{return bad();}
 if(claims.iss!=='https://cognito-idp.us-east-1.amazonaws.com/'+pool||claims.token_use!=='access')return bad();
 const user=await cognito.send(new GetUserCommand({AccessToken:accessToken})),attrs=user.UserAttributes??[];
 const sub=attrs.find(a=>a.Name==='sub')?.Value;
 if(!sub||sub!==claims.sub||attrs.filter(a=>a.Name==='sub').length!==1||!user.Username||(kind==='DRIVER'&&user.Username!==sub))return bad();
 const live=await cognito.send(new AdminGetUserCommand({UserPoolId:pool,Username:user.Username}));
 if(live.Enabled!==true||live.UserStatus!=='CONFIRMED'||live.Username!==user.Username||live.UserAttributes?.filter(a=>a.Name==='sub').length!==1||live.UserAttributes?.find(a=>a.Name==='sub')?.Value!==sub)return bad();
 if(kind==='STAFF'&&!live.UserMFASettingList?.includes('SOFTWARE_TOKEN_MFA'))return bad();
 return {kind,subjectId:sub};
}
