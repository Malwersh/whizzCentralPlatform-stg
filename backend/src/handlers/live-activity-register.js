'use strict';
const {createHash}=require('node:crypto');
const {DynamoDBClient}=require('@aws-sdk/client-dynamodb');
const {DynamoDBDocumentClient,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {authorize}=require('./live-activity-order-access');
const {corsHeaders}=require('../utils/http');
const db=DynamoDBDocumentClient.from(new DynamoDBClient({region:process.env.AWS_REGION||'us-east-1'}));
exports.register=async event=>{
 const response=(statusCode,body)=>({statusCode,headers:{...corsHeaders,'Cache-Control':'no-store'},body:JSON.stringify(body)});
 if(event.httpMethod==='OPTIONS')return response(200,{});
 try{
  if(!process.env.LIVE_ACTIVITIES_TABLE)return response(503,{success:false,code:'LIVE_ACTIVITY_UNAVAILABLE'});
  const body=JSON.parse(event.body||'{}'),token=body.activityPushToken;
  if(typeof token!=='string'||!/^[a-fA-F0-9]{32,512}$/.test(token)||body.app&&body.app!=='user'||body.platform&&body.platform!=='ios')return response(400,{success:false,code:'INVALID_ACTIVITY_TOKEN'});
  const {order,subjectId,guards}=await authorize({event,body,db}),at=new Date().toISOString();
  const key={pk:'ORDER#'+order.orderId,sk:'USER#'+subjectId+'#ACTIVITY#'+createHash('sha256').update(token).digest('hex').slice(0,32)};
  await db.send(new TransactWriteCommand({TransactItems:[...guards,{Put:{TableName:process.env.LIVE_ACTIVITIES_TABLE,Item:{...key,orderId:order.orderId,userId:subjectId,subjectId,activityPushToken:token,app:'user',platform:'ios',status:order.status,createdAt:at,updatedAt:at,ttl:Math.floor(Date.now()/1000)+7*86400}}}]}));
  return response(200,{success:true,orderId:order.orderId,registered:true});
 }catch(e){const denied=e.status===403||e.name==='TransactionCanceledException';return response(denied?403:e.status===400?400:503,{success:false,code:denied?'LIVE_ACTIVITY_FORBIDDEN':e.status===400?e.code:'LIVE_ACTIVITY_UNAVAILABLE'});}
};
