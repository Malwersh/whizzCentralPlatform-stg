import {CognitoIdentityProviderClient,AdminGetUserCommand} from '@aws-sdk/client-cognito-identity-provider';
import {CognitoJwtVerifier} from 'aws-jwt-verify';
import {timingSafeEqual} from 'crypto';
import {docClient,GetCommand} from './db';
import roles from './staff-roles.json';
const pools=[
 {kind:'customer',userPoolId:'us-east-1_TpyyrVkEE',clientId:'4a9e8o3em311eq2rgckp0pd2s9'},
 {kind:'driver',userPoolId:'us-east-1_RGTqUXF5C',clientId:'2d26d3muq0vvcuf42lkpgmkgsr'},
 {kind:'restaurant',userPoolId:'us-east-1_gtCR3ndzT',clientId:'4qabvh11nmghmf9fmc6e6ludd2'},
 {kind:'service',userPoolId:'us-east-1_1oxqmSN5P',clientId:'5erchruuvc35dfrcpld2gaeiq3'},
 {kind:'central',userPoolId:'us-east-1_wz7vwZZxz',clientId:'17mu2qlqis0qcs1n1n980q7e3j'}
];
const cognito=new CognitoIdentityProviderClient({region:'us-east-1'});
const verifier=CognitoJwtVerifier.create(pools.map(p=>({userPoolId:p.userPoolId,clientId:p.clientId,tokenUse:null})));
const fail=(message:string,status=403)=>Object.assign(Error(message),{status});
export async function authorizeOrder(event:any,body:any,verify=(token:string)=>verifier.verify(token)){
 const token=(event.headers?.Authorization||event.headers?.authorization||'').replace(/^Bearer\s+/i,'');
 if(!token){
  if(event.path!=='/order/cancel'||body.canceledBy!=='customer'||typeof body.guestToken!=='string'||body.guestToken.length<20)throw fail('UNAUTHORIZED',401);
  const {Item:order}=await docClient.send(new GetCommand({TableName:process.env.ORDERS_TABLE,Key:{PK:'ORDER#'+body.orderId,SK:'META'},ConsistentRead:true}));
  if(order?.isGuestOrder!==true||!order?.guestToken||typeof order.guestToken!=='string'||Buffer.byteLength(order.guestToken)!==Buffer.byteLength(body.guestToken)||!timingSafeEqual(Buffer.from(order.guestToken),Buffer.from(body.guestToken)))throw fail('UNAUTHORIZED',401);
  return {...body,requestedBy:order.customerId||order.userId||order.guestToken};
 }
 let claims:any;try{claims=await verify(token);}catch(_){throw fail('UNAUTHORIZED',401);}
 const provider=pools.find(p=>claims.iss==='https://cognito-idp.us-east-1.amazonaws.com/'+p.userPoolId);if(!provider)throw fail('UNAUTHORIZED',401);
 if(provider.kind==='service'){
  if(claims.token_use!=='access'||claims.username!==process.env.SERVICE_USERNAME)throw fail('FORBIDDEN');return body;
 }
 if(event.path==='/order/unassign'){
  if(provider.kind!=='driver'||body.driverId!==claims.sub)throw fail('FORBIDDEN');return {...body,requestedBy:claims.sub};
 }
 if(provider.kind==='central'){
  if(body.canceledBy!=='system'||claims.token_use!=='access')throw fail('FORBIDDEN');
  const {Item:employee}=await docClient.send(new GetCommand({TableName:'staging-PlatformStaff',Key:{pk:'EMPLOYEE#'+claims.sub,sk:'PROFILE'},ConsistentRead:true}));
  const permissions=(employee?.roles||[]).flatMap((role:string)=>(roles as any)[role]||[]);
  const live=await cognito.send(new AdminGetUserCommand({UserPoolId:'us-east-1_wz7vwZZxz',Username:claims.username}));
  if(!live.Enabled||(employee?.mfaRequired&&!live.UserMFASettingList?.includes('SOFTWARE_TOKEN_MFA')))throw fail('FORBIDDEN');
  if(employee?.status!=='ACTIVE'||!employee.scope?.allRegions||!permissions.includes('orders.cancel')||claims.auth_time<(employee.minimumAuthTime||0))throw fail('FORBIDDEN');return {...body,requestedBy:claims.sub};
 }
 if(body.canceledBy!==provider.kind)throw fail('FORBIDDEN');
 if(provider.kind==='restaurant'){
  if(typeof body.requestedBy!=='string')throw fail('FORBIDDEN');
  const {Item:business}=await docClient.send(new GetCommand({TableName:'WhizzMerchants_Businesses',Key:{businessId:body.requestedBy},ConsistentRead:true}));
  if(!business||![business.ownerId,business.cognitoUserId].includes(claims.sub))throw fail('FORBIDDEN');return body;
 }
 if(provider.kind==='customer'){
  const {Item:order}=await docClient.send(new GetCommand({TableName:process.env.ORDERS_TABLE,Key:{PK:'ORDER#'+body.orderId,SK:'META'},ConsistentRead:true}));
  if(!order||![order.customerId,order.userId,order.userSub].includes(claims.sub))throw fail('FORBIDDEN');return {...body,requestedBy:order.customerId||order.userId||claims.sub};
 }
 if(body.requestedBy!==claims.sub)throw fail('FORBIDDEN');return {...body,requestedBy:claims.sub};
}
