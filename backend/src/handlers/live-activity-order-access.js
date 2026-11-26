'use strict';
const {timingSafeEqual}=require('node:crypto');
const {GetCommand}=require('@aws-sdk/lib-dynamodb');
const {verifyJwtMulti}=require('../utils/jwt-multi-verify');
const ORDERS='WizzOrders',PROFILES='WizzUser_users_staging';
const fail=(code='LIVE_ACTIVITY_FORBIDDEN',status=403)=>{throw Object.assign(Error(code),{code,status});};
const terminal=s=>['delivered','completed','returned','cancelled','canceled','failed','expired','rejected'].includes(s)||/^(canceled|cancelled)_by_/.test(s??'');
function fence(table,key,row,fields){const names={},values={},conditions=[];fields.forEach((k,i)=>{names['#la'+i]=k;if(row[k]===undefined)conditions.push('attribute_not_exists(#la'+i+')');else{values[':la'+i]=row[k];conditions.push('#la'+i+'=:la'+i);}});return {ConditionCheck:{TableName:table,Key:key,ConditionExpression:conditions.join(' AND '),ExpressionAttributeNames:names,...(Object.keys(values).length?{ExpressionAttributeValues:values}:{})}};}
async function authorize({event,body,db,verify=verifyJwtMulti,allowTerminal=false,clientId=process.env.USERS_CLIENT_ID}){
 const orderId=body.orderId;if(typeof orderId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,149}$/.test(orderId))fail('INVALID_ORDER_ID',400);
 const key={PK:'ORDER#'+orderId,SK:'META'},o=(await db.send(new GetCommand({TableName:ORDERS,Key:key,ConsistentRead:true}))).Item;
 if(!o||o.orderId!==orderId||o.isDeleted===true||o.deletedAt!=null||o.deletionRequestId!=null||!allowTerminal&&terminal(o.status))fail();
 const guards=[fence(ORDERS,key,o,['orderId','userId','userSub','customerId','guestToken','isGuestOrder','status','isDeleted','deletedAt','deletionRequestId'])];
 let subjectId;
 if(body.guestToken!==undefined){
  const supplied=Buffer.from(typeof body.guestToken==='string'?body.guestToken:''),expected=Buffer.from(typeof o.guestToken==='string'?o.guestToken:'');
  if(o.isGuestOrder!==true||!expected.length||supplied.length!==expected.length||!timingSafeEqual(supplied,expected))fail();
  subjectId=String(o.guestToken).startsWith('GUEST_')?o.guestToken:'GUEST_'+o.guestToken;
 }else{
  let jwt;try{jwt=await verify(event,'user');}catch(_){fail();}
  const p=jwt.payload;
  if(jwt.pool!=='users'||!p?.sub||!clientId||(p.token_use==='id'?p.aud:p.token_use==='access'?p.client_id:null)!==clientId)fail();
  subjectId=p.sub;
  if(o.isGuestOrder===true||(o.userSub!=null?o.userSub!==subjectId:!(o.userId===subjectId||o.customerId===subjectId)))fail();
  if(typeof o.userId!=='string')fail();
  const profileKey={userId:o.userId},profile=(await db.send(new GetCommand({TableName:PROFILES,Key:profileKey,ConsistentRead:true}))).Item;
  if(!profile||profile.isActive===false||profile.deletionRequestId!=null||profile.cognitoSub!=null&&profile.cognitoSub!==subjectId)fail();
  guards.push(fence(PROFILES,profileKey,profile,['userId','cognitoSub','isActive','deletionRequestId']));
 }
 return {order:o,subjectId,guards};
}
module.exports={authorize,terminal};
